/**
 * Image Eraser Web Worker
 * Uses LaMa inpainting model via ONNX Runtime (WASM only)
 */

// @ts-expect-error - onnxruntime-web types not resolved due to package.json exports
import * as ort from 'onnxruntime-web'

// Configure WASM paths to use CDN (required for Vite bundling)
// Must match the installed onnxruntime-web version
const ORT_WASM_VERSION = '1.21.0'
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WASM_VERSION}/dist/`

// LaMa model from Hugging Face (quantized)
const MODEL_URL =
  'https://huggingface.co/opencv/inpainting_lama/resolve/main/inpainting_lama_2025jan.onnx'
const MODEL_SIZE = 512
const CACHE_NAME = 'lama-model-cache'

// ONNX Runtime session
let session: ort.InferenceSession | null = null

interface WorkerMessage {
  type: 'init' | 'process' | 'dispose'
  payload?: {
    imageData?: Float32Array
    maskData?: Float32Array
    width?: number
    height?: number
    id?: number
  }
}

/**
 * Download model with progress tracking
 */
async function downloadModel(
  onProgress: (current: number, total: number) => void
): Promise<ArrayBuffer> {
  // Try to get from cache first
  const cache = await caches.open(CACHE_NAME)
  const cachedResponse = await cache.match(MODEL_URL)

  if (cachedResponse) {
    const buffer = await cachedResponse.arrayBuffer()
    onProgress(buffer.byteLength, buffer.byteLength)
    return buffer
  }

  // Download with progress
  const response = await fetch(MODEL_URL, {
    mode: 'cors'
  })

  if (!response.ok) {
    throw new Error(`Failed to download model: ${response.status}`)
  }

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Failed to get response reader')
  }

  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    chunks.push(value)
    received += value.length
    onProgress(received, total)
  }

  // Combine chunks
  const buffer = new Uint8Array(received)
  let position = 0
  for (const chunk of chunks) {
    buffer.set(chunk, position)
    position += chunk.length
  }

  // Cache the model for future use
  try {
    const cacheResponse = new Response(buffer.buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.byteLength.toString()
      }
    })
    await cache.put(MODEL_URL, cacheResponse)
  } catch (e) {
    // Model cache failed
  }

  return buffer.buffer
}

/**
 * Initialize ONNX session with WASM
 */
async function initSession(modelBuffer: ArrayBuffer): Promise<void> {
  session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true,
    executionMode: 'sequential'
  })
  // WASM backend initialized
}

/**
 * Bilinear resize for Float32Array image data in CHW format
 */
function resizeCHW(
  data: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  channels: number
): Float32Array {
  const result = new Float32Array(channels * dstH * dstW)

  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        // Map to source coordinates
        const srcX = (x * (srcW - 1)) / (dstW - 1)
        const srcY = (y * (srcH - 1)) / (dstH - 1)

        const x0 = Math.floor(srcX)
        const y0 = Math.floor(srcY)
        const x1 = Math.min(x0 + 1, srcW - 1)
        const y1 = Math.min(y0 + 1, srcH - 1)

        const xFrac = srcX - x0
        const yFrac = srcY - y0

        // Get source values
        const v00 = data[c * srcH * srcW + y0 * srcW + x0]
        const v10 = data[c * srcH * srcW + y0 * srcW + x1]
        const v01 = data[c * srcH * srcW + y1 * srcW + x0]
        const v11 = data[c * srcH * srcW + y1 * srcW + x1]

        // Bilinear interpolation
        const v0 = v00 * (1 - xFrac) + v10 * xFrac
        const v1 = v01 * (1 - xFrac) + v11 * xFrac
        const v = v0 * (1 - yFrac) + v1 * yFrac

        result[c * dstH * dstW + y * dstW + x] = v
      }
    }
  }

  return result
}

/**
 * Nearest neighbor resize for mask data in CHW format
 */
function resizeMaskCHW(
  data: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Float32Array {
  const result = new Float32Array(dstH * dstW)

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.round((x * (srcW - 1)) / (dstW - 1))
      const srcY = Math.round((y * (srcH - 1)) / (dstH - 1))
      result[y * dstW + x] = data[srcY * srcW + srcX]
    }
  }

  return result
}

/**
 * Find bounding box of masked area
 */
function getMaskBoundingBox(
  maskData: Float32Array,
  width: number,
  height: number
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let hasMask = false

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (maskData[y * width + x] > 0.5) {
        hasMask = true
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  return hasMask ? { minX, minY, maxX, maxY } : null
}

/**
 * Calculate crop region: 3x mask size, min 768x768, clamped to image bounds
 */
function calculateCropRegion(
  maskBbox: { minX: number; minY: number; maxX: number; maxY: number },
  imgWidth: number,
  imgHeight: number
): { x: number; y: number; w: number; h: number } {
  const maskW = maskBbox.maxX - maskBbox.minX + 1
  const maskH = maskBbox.maxY - maskBbox.minY + 1
  const maskCenterX = (maskBbox.minX + maskBbox.maxX) / 2
  const maskCenterY = (maskBbox.minY + maskBbox.maxY) / 2

  // Target size: 3x mask size, but at least MODEL_SIZE
  let cropW = Math.max(maskW * 3, MODEL_SIZE)
  let cropH = Math.max(maskH * 3, MODEL_SIZE)

  // Clamp to image dimensions
  cropW = Math.min(cropW, imgWidth)
  cropH = Math.min(cropH, imgHeight)

  // Center crop on mask, but clamp to image bounds
  let cropX = Math.round(maskCenterX - cropW / 2)
  let cropY = Math.round(maskCenterY - cropH / 2)

  cropX = Math.max(0, Math.min(cropX, imgWidth - cropW))
  cropY = Math.max(0, Math.min(cropY, imgHeight - cropH))

  return { x: cropX, y: cropY, w: cropW, h: cropH }
}

/**
 * Extract crop from CHW image data
 */
function extractCropCHW(
  data: Float32Array,
  imgW: number,
  imgH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  channels: number
): Float32Array {
  const result = new Float32Array(channels * cropH * cropW)

  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const srcIdx = c * imgH * imgW + (cropY + y) * imgW + (cropX + x)
        const dstIdx = c * cropH * cropW + y * cropW + x
        result[dstIdx] = data[srcIdx]
      }
    }
  }

  return result
}

/**
 * Extract crop from single-channel mask data
 */
function extractCropMask(
  data: Float32Array,
  imgW: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number
): Float32Array {
  const result = new Float32Array(cropH * cropW)

  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      result[y * cropW + x] = data[(cropY + y) * imgW + (cropX + x)]
    }
  }

  return result
}

/**
 * Paste crop back into original image with feathered blending at edges
 */
function pasteCropWithBlend(
  original: Float32Array,
  crop: Float32Array,
  mask: Float32Array,
  imgW: number,
  imgH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  channels: number,
  featherSize: number = 8
): Float32Array {
  const result = new Float32Array(original)

  // Create blend mask: 1.0 in center, fading to 0 at edges
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const maskVal = mask[y * cropW + x]

        // Only blend where mask is active
        if (maskVal < 0.01) continue

        // Calculate edge feather factor
        const distToLeft = x
        const distToRight = cropW - 1 - x
        const distToTop = y
        const distToBottom = cropH - 1 - y
        const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom)
        const edgeFactor = Math.min(1.0, minDist / featherSize)

        // Blend factor: full blend in masked area, feathered at crop edges
        const blendFactor = maskVal * edgeFactor

        const srcIdx = c * cropH * cropW + y * cropW + x
        const dstIdx = c * imgH * imgW + (cropY + y) * imgW + (cropX + x)

        // Blend: original * (1 - blend) + inpainted * blend
        result[dstIdx] =
          original[dstIdx] * (1 - blendFactor) + crop[srcIdx] * blendFactor
      }
    }
  }

  return result
}

/**
 * Run inpainting inference with smart crop around masked area
 */
async function removeArea(
  imageData: Float32Array,
  maskData: Float32Array,
  width: number,
  height: number
): Promise<Float32Array> {
  if (!session) {
    throw new Error('Session not initialized')
  }

  // Find mask bounding box
  const maskBbox = getMaskBoundingBox(maskData, width, height)
  if (!maskBbox) {
    // No mask - return original
    return new Float32Array(imageData)
  }

  // Calculate crop region (3x mask size, min MODEL_SIZE)
  const crop = calculateCropRegion(maskBbox, width, height)

  // Extract crops
  const croppedImage = extractCropCHW(
    imageData,
    width,
    height,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    3
  )
  const croppedMask = extractCropMask(
    maskData,
    width,
    crop.x,
    crop.y,
    crop.w,
    crop.h
  )

  // Resize to model input size
  let resizedImage: Float32Array
  let resizedMask: Float32Array

  if (crop.w === MODEL_SIZE && crop.h === MODEL_SIZE) {
    resizedImage = croppedImage
    resizedMask = croppedMask
  } else {
    resizedImage = resizeCHW(
      croppedImage,
      crop.w,
      crop.h,
      MODEL_SIZE,
      MODEL_SIZE,
      3
    )
    resizedMask = resizeMaskCHW(croppedMask, crop.w, crop.h, MODEL_SIZE, MODEL_SIZE)
  }

  // Binarize mask (model expects 0 or 1)
  const maskBinary = new Float32Array(resizedMask.length)
  for (let i = 0; i < resizedMask.length; i++) {
    maskBinary[i] = resizedMask[i] > 0.5 ? 1.0 : 0.0
  }

  // Create tensors (image in 0-1 range, mask binary 0/1)
  const imageTensor = new ort.Tensor('float32', resizedImage, [
    1,
    3,
    MODEL_SIZE,
    MODEL_SIZE
  ])
  const maskTensor = new ort.Tensor('float32', maskBinary, [
    1,
    1,
    MODEL_SIZE,
    MODEL_SIZE
  ])

  // Run inference
  const feeds: Record<string, ort.Tensor> = {
    image: imageTensor,
    mask: maskTensor
  }

  const results = await session.run(feeds)
  const rawOutput = results['output'].data as Float32Array

  // Model outputs 0-255 range, convert to 0-1
  const output = new Float32Array(rawOutput.length)
  for (let i = 0; i < rawOutput.length; i++) {
    output[i] = Math.max(0, Math.min(1, rawOutput[i] / 255.0))
  }

  // Resize output back to crop size
  let resizedOutput: Float32Array
  if (crop.w === MODEL_SIZE && crop.h === MODEL_SIZE) {
    resizedOutput = output
  } else {
    resizedOutput = resizeCHW(output, MODEL_SIZE, MODEL_SIZE, crop.w, crop.h, 3)
  }

  // Paste back with blending
  const result = pasteCropWithBlend(
    imageData,
    resizedOutput,
    croppedMask,
    width,
    height,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    3
  )

  return result
}

/**
 * Handle incoming messages
 */
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, payload } = e.data

  switch (type) {
    case 'init': {
      try {
        // Check if model is cached first
        const cache = await caches.open(CACHE_NAME)
        const cachedResponse = await cache.match(MODEL_URL)

        let modelBuffer: ArrayBuffer

        if (cachedResponse) {
          // Model is cached - skip download phase, go straight to loading
          self.postMessage({
            type: 'phase',
            payload: { phase: 'loading', id: payload?.id }
          })
          modelBuffer = await cachedResponse.arrayBuffer()
        } else {
          // Model not cached - show download phase
          self.postMessage({
            type: 'phase',
            payload: { phase: 'download', id: payload?.id }
          })

          modelBuffer = await downloadModel((current, total) => {
            self.postMessage({
              type: 'progress',
              payload: {
                phase: 'download',
                progress: total > 0 ? (current / total) * 100 : 0,
                detail: { current, total, unit: 'bytes' },
                id: payload?.id
              }
            })
          })

          // Phase: loading (after download)
          self.postMessage({
            type: 'phase',
            payload: { phase: 'loading', id: payload?.id }
          })
        }

        await initSession(modelBuffer)

        self.postMessage({
          type: 'ready',
          payload: { id: payload?.id }
        })
      } catch (error) {
        console.error('Model initialization error:', error)
        let errorMessage = 'Failed to initialize model'
        if (error instanceof Error) {
          errorMessage = error.message
          // Add more context for common errors
          if (error.message.includes('Failed to download')) {
            errorMessage = `Model download failed. Please check your network connection. (${error.message})`
          } else if (error.message.includes('CORS') || error.message.includes('cross-origin')) {
            errorMessage = 'Cross-origin request blocked. Try refreshing the page.'
          }
        }
        self.postMessage({
          type: 'error',
          payload: errorMessage
        })
      }
      break
    }

    case 'process': {
      if (
        !payload?.imageData ||
        !payload?.maskData ||
        !payload?.width ||
        !payload?.height
      ) {
        self.postMessage({
          type: 'error',
          payload: 'Missing image or mask data'
        })
        return
      }

      try {
        // Phase: process
        self.postMessage({
          type: 'phase',
          payload: { phase: 'process', id: payload.id }
        })

        self.postMessage({
          type: 'progress',
          payload: {
            phase: 'process',
            progress: 10,
            id: payload.id
          }
        })

        const result = await removeArea(
          payload.imageData,
          payload.maskData,
          payload.width,
          payload.height
        )

        self.postMessage({
          type: 'progress',
          payload: {
            phase: 'process',
            progress: 100,
            id: payload.id
          }
        })

        // Transfer the result buffer for efficiency
        // DeepFillv2 output is normalized 0-1
        self.postMessage(
          {
            type: 'result',
            payload: {
              data: result,
              width: payload.width,
              height: payload.height,
              id: payload.id
            }
          },
          { transfer: [result.buffer] }
        )
      } catch (error) {
        self.postMessage({
          type: 'error',
          payload:
            error instanceof Error ? error.message : 'Failed to process image'
        })
      }
      break
    }

    case 'dispose': {
      if (session) {
        session = null
      }
      self.postMessage({ type: 'disposed' })
      break
    }
  }
}
