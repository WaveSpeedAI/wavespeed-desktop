/**
 * Face Enhancer Web Worker
 * Uses YOLO v8 for face detection and GFPGAN v1.4 for face enhancement
 * Both models run via ONNX Runtime (WebGPU with WASM fallback)
 */

// @ts-expect-error - onnxruntime-web types not resolved due to package.json exports
import * as ort from 'onnxruntime-web'

// Configure WASM paths to use CDN
const ORT_WASM_VERSION = '1.21.0'
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WASM_VERSION}/dist/`

// Track which backend is being used
let useWebGPU = false

/**
 * Check if WebGPU is available
 */
async function checkWebGPU(): Promise<boolean> {
  try {
    if (!navigator.gpu) return false
    const adapter = await navigator.gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}

// Model URLs
const YOLO_MODEL_URL = 'https://huggingface.co/deepghs/yolo-face/resolve/main/yolov8n-face/model.onnx'
const GFPGAN_MODEL_URL = 'https://huggingface.co/facefusion/models-3.0.0/resolve/main/gfpgan_1.4.onnx'

// Model sizes
const YOLO_INPUT_SIZE = 640
const GFPGAN_INPUT_SIZE = 512

// Detection thresholds
const CONFIDENCE_THRESHOLD = 0.5
const IOU_THRESHOLD = 0.45

// Cache names
const CACHE_NAME = 'face-enhancer-models'

// ONNX sessions
let yoloSession: ort.InferenceSession | null = null
let gfpganSession: ort.InferenceSession | null = null

interface FaceBox {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

interface WorkerMessage {
  type: 'init' | 'enhance' | 'dispose'
  payload?: {
    imageData?: Float32Array
    width?: number
    height?: number
    id?: number
    timeout?: number
  }
}

// Default timeout (60 minutes)
const DEFAULT_TIMEOUT = 3600000

/**
 * Download model with progress tracking
 */
async function downloadModel(
  url: string,
  onProgress: (current: number, total: number) => void,
  timeout: number = DEFAULT_TIMEOUT
): Promise<ArrayBuffer> {
  // Try to get from cache first
  const cache = await caches.open(CACHE_NAME)
  const cachedResponse = await cache.match(url)

  if (cachedResponse) {
    const buffer = await cachedResponse.arrayBuffer()
    onProgress(buffer.byteLength, buffer.byteLength)
    return buffer
  }

  // Download with progress and configurable timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const timeoutSeconds = Math.round(timeout / 1000)

  try {
    const response = await fetch(url, {
      headers: { Origin: self.location.origin },
      signal: controller.signal
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
      if (controller.signal.aborted) {
        reader.cancel()
        throw new Error(`Model download timed out after ${timeoutSeconds} seconds`)
      }

      const { done, value } = await reader.read()
      if (done) break

      chunks.push(value)
      received += value.length
      onProgress(received, total)
    }

    clearTimeout(timeoutId)

    // Combine chunks
    const buffer = new Uint8Array(received)
    let position = 0
    for (const chunk of chunks) {
      buffer.set(chunk, position)
      position += chunk.length
    }

    // Cache the model
    try {
      const cacheResponse = new Response(buffer.buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': buffer.byteLength.toString()
        }
      })
      await cache.put(url, cacheResponse)
    } catch (e) {
      console.warn('Failed to cache model:', e)
    }

    return buffer.buffer
  } catch (error) {
    clearTimeout(timeoutId)
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Model download timed out after ${timeoutSeconds} seconds`)
    }
    throw error
  }
}

/**
 * Check if model is cached
 */
async function isModelCached(url: string): Promise<boolean> {
  const cache = await caches.open(CACHE_NAME)
  const cachedResponse = await cache.match(url)
  return cachedResponse !== undefined
}

/**
 * Initialize ONNX session with WebGPU (fallback to WASM)
 */
async function createSession(modelBuffer: ArrayBuffer): Promise<ort.InferenceSession> {
  if (useWebGPU) {
    try {
      return await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all'
      })
    } catch (e) {
      console.warn('WebGPU session creation failed, falling back to WASM:', e)
      useWebGPU = false
    }
  }

  return await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true,
    executionMode: 'parallel'
  })
}

/**
 * Letterbox resize image to target size (maintains aspect ratio with padding)
 */
function letterboxResize(
  imageData: Float32Array,
  srcW: number,
  srcH: number,
  targetSize: number
): { data: Float32Array; scale: number; padX: number; padY: number } {
  const scale = Math.min(targetSize / srcW, targetSize / srcH)
  const newW = Math.round(srcW * scale)
  const newH = Math.round(srcH * scale)

  const padX = (targetSize - newW) / 2
  const padY = (targetSize - newH) / 2

  const output = new Float32Array(3 * targetSize * targetSize)
  output.fill(0.5)

  const padXInt = Math.floor(padX)
  const padYInt = Math.floor(padY)

  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const srcX = x / scale
        const srcY = y / scale

        const x0 = Math.floor(srcX)
        const y0 = Math.floor(srcY)
        const x1 = Math.min(x0 + 1, srcW - 1)
        const y1 = Math.min(y0 + 1, srcH - 1)

        const xFrac = srcX - x0
        const yFrac = srcY - y0

        const v00 = imageData[(y0 * srcW + x0) * 3 + c]
        const v10 = imageData[(y0 * srcW + x1) * 3 + c]
        const v01 = imageData[(y1 * srcW + x0) * 3 + c]
        const v11 = imageData[(y1 * srcW + x1) * 3 + c]

        const v0 = v00 * (1 - xFrac) + v10 * xFrac
        const v1 = v01 * (1 - xFrac) + v11 * xFrac
        const v = v0 * (1 - yFrac) + v1 * yFrac

        const outIdx = c * targetSize * targetSize + (padYInt + y) * targetSize + (padXInt + x)
        output[outIdx] = v
      }
    }
  }

  return { data: output, scale, padX, padY }
}

/**
 * Non-Maximum Suppression
 */
function nms(boxes: FaceBox[], iouThreshold: number): FaceBox[] {
  if (boxes.length === 0) return []

  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence)
  const selected: FaceBox[] = []

  while (sorted.length > 0) {
    const best = sorted.shift()!
    selected.push(best)

    for (let i = sorted.length - 1; i >= 0; i--) {
      if (iou(best, sorted[i]) > iouThreshold) {
        sorted.splice(i, 1)
      }
    }
  }

  return selected
}

/**
 * Calculate IoU between two boxes
 */
function iou(a: FaceBox, b: FaceBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const aArea = a.width * a.height
  const bArea = b.width * b.height
  const union = aArea + bArea - intersection

  return intersection / union
}

/**
 * Parse YOLO output to face boxes
 */
function parseYoloOutput(
  output: Float32Array,
  imgW: number,
  imgH: number,
  scale: number,
  padX: number,
  padY: number
): FaceBox[] {
  const boxes: FaceBox[] = []
  const numDetections = output.length / 5

  for (let i = 0; i < numDetections; i++) {
    const confidence = output[4 * numDetections + i]

    if (confidence < CONFIDENCE_THRESHOLD) continue

    const xCenter = output[0 * numDetections + i]
    const yCenter = output[1 * numDetections + i]
    const width = output[2 * numDetections + i]
    const height = output[3 * numDetections + i]

    const x = (xCenter - padX) / scale - width / (2 * scale)
    const y = (yCenter - padY) / scale - height / (2 * scale)
    const w = width / scale
    const h = height / scale

    const clampedX = Math.max(0, Math.min(x, imgW))
    const clampedY = Math.max(0, Math.min(y, imgH))
    const clampedW = Math.min(w, imgW - clampedX)
    const clampedH = Math.min(h, imgH - clampedY)

    if (clampedW > 0 && clampedH > 0) {
      boxes.push({
        x: clampedX,
        y: clampedY,
        width: clampedW,
        height: clampedH,
        confidence
      })
    }
  }

  return nms(boxes, IOU_THRESHOLD)
}

/**
 * Detect faces using YOLO
 */
async function detectFaces(
  imageData: Float32Array,
  width: number,
  height: number
): Promise<FaceBox[]> {
  if (!yoloSession) throw new Error('YOLO session not initialized')

  const { data, scale, padX, padY } = letterboxResize(imageData, width, height, YOLO_INPUT_SIZE)
  const inputTensor = new ort.Tensor('float32', data, [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE])
  const results = await yoloSession.run({ images: inputTensor })
  const outputName = Object.keys(results)[0]
  const output = results[outputName].data as Float32Array

  return parseYoloOutput(output, width, height, scale, padX, padY)
}

/**
 * Crop face with padding and resize to target size
 */
function cropAndResizeFace(
  imageData: Float32Array,
  imgW: number,
  imgH: number,
  box: FaceBox,
  targetSize: number,
  padding: number = 0.3
): { data: Float32Array; cropBox: { x: number; y: number; w: number; h: number } } {
  const expandW = box.width * padding
  const expandH = box.height * padding

  let cropX = box.x - expandW
  let cropY = box.y - expandH
  let cropW = box.width + expandW * 2
  let cropH = box.height + expandH * 2

  const size = Math.max(cropW, cropH)
  cropX = cropX - (size - cropW) / 2
  cropY = cropY - (size - cropH) / 2
  cropW = size
  cropH = size

  cropX = Math.max(0, cropX)
  cropY = Math.max(0, cropY)
  cropW = Math.min(cropW, imgW - cropX)
  cropH = Math.min(cropH, imgH - cropY)

  const output = new Float32Array(3 * targetSize * targetSize)

  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < targetSize; y++) {
      for (let x = 0; x < targetSize; x++) {
        const srcX = cropX + (x / targetSize) * cropW
        const srcY = cropY + (y / targetSize) * cropH

        const x0 = Math.floor(srcX)
        const y0 = Math.floor(srcY)
        const x1 = Math.min(x0 + 1, imgW - 1)
        const y1 = Math.min(y0 + 1, imgH - 1)

        const xFrac = srcX - x0
        const yFrac = srcY - y0

        const v00 = imageData[(y0 * imgW + x0) * 3 + c]
        const v10 = imageData[(y0 * imgW + x1) * 3 + c]
        const v01 = imageData[(y1 * imgW + x0) * 3 + c]
        const v11 = imageData[(y1 * imgW + x1) * 3 + c]

        const v0 = v00 * (1 - xFrac) + v10 * xFrac
        const v1 = v01 * (1 - xFrac) + v11 * xFrac
        let v = v0 * (1 - yFrac) + v1 * yFrac

        v = (v - 0.5) / 0.5

        output[c * targetSize * targetSize + y * targetSize + x] = v
      }
    }
  }

  return { data: output, cropBox: { x: cropX, y: cropY, w: cropW, h: cropH } }
}

/**
 * Enhance a single face using GFPGAN
 */
async function enhanceFace(faceData: Float32Array): Promise<Float32Array> {
  if (!gfpganSession) throw new Error('GFPGAN session not initialized')

  const inputTensor = new ort.Tensor('float32', faceData, [1, 3, GFPGAN_INPUT_SIZE, GFPGAN_INPUT_SIZE])
  const results = await gfpganSession.run({ input: inputTensor })
  const outputName = Object.keys(results)[0]
  const output = results[outputName].data as Float32Array

  return output
}

/**
 * Paste enhanced face back into original image with feathered blending
 */
function pasteEnhancedFace(
  originalData: Float32Array,
  enhancedFace: Float32Array,
  imgW: number,
  imgH: number,
  cropBox: { x: number; y: number; w: number; h: number },
  featherSize: number = 16
): Float32Array {
  const result = new Float32Array(originalData)
  const { x: cropX, y: cropY, w: cropW, h: cropH } = cropBox

  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      if (x >= cropX && x < cropX + cropW && y >= cropY && y < cropY + cropH) {
        const faceX = ((x - cropX) / cropW) * GFPGAN_INPUT_SIZE
        const faceY = ((y - cropY) / cropH) * GFPGAN_INPUT_SIZE

        const fx0 = Math.floor(faceX)
        const fy0 = Math.floor(faceY)
        const fx1 = Math.min(fx0 + 1, GFPGAN_INPUT_SIZE - 1)
        const fy1 = Math.min(fy0 + 1, GFPGAN_INPUT_SIZE - 1)

        const xFrac = faceX - fx0
        const yFrac = faceY - fy0

        const distToLeft = x - cropX
        const distToRight = cropX + cropW - 1 - x
        const distToTop = y - cropY
        const distToBottom = cropY + cropH - 1 - y
        const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom)
        const blendFactor = Math.min(1.0, minDist / featherSize)

        for (let c = 0; c < 3; c++) {
          const v00 = enhancedFace[c * GFPGAN_INPUT_SIZE * GFPGAN_INPUT_SIZE + fy0 * GFPGAN_INPUT_SIZE + fx0]
          const v10 = enhancedFace[c * GFPGAN_INPUT_SIZE * GFPGAN_INPUT_SIZE + fy0 * GFPGAN_INPUT_SIZE + fx1]
          const v01 = enhancedFace[c * GFPGAN_INPUT_SIZE * GFPGAN_INPUT_SIZE + fy1 * GFPGAN_INPUT_SIZE + fx0]
          const v11 = enhancedFace[c * GFPGAN_INPUT_SIZE * GFPGAN_INPUT_SIZE + fy1 * GFPGAN_INPUT_SIZE + fx1]

          const v0 = v00 * (1 - xFrac) + v10 * xFrac
          const v1 = v01 * (1 - xFrac) + v11 * xFrac
          let enhanced = v0 * (1 - yFrac) + v1 * yFrac

          enhanced = (enhanced + 1) / 2
          enhanced = Math.max(0, Math.min(1, enhanced))

          const origIdx = (y * imgW + x) * 3 + c
          const original = originalData[origIdx]

          result[origIdx] = original * (1 - blendFactor) + enhanced * blendFactor
        }
      }
    }
  }

  return result
}

/**
 * Process image: detect faces and enhance each one
 */
async function processImage(
  imageData: Float32Array,
  width: number,
  height: number,
  onProgress: (progress: number, faces?: number) => void
): Promise<{ result: Float32Array; faceCount: number }> {
  onProgress(10)
  const faces = await detectFaces(imageData, width, height)

  if (faces.length === 0) {
    return { result: new Float32Array(imageData), faceCount: 0 }
  }

  onProgress(20, faces.length)

  let result = new Float32Array(imageData)
  const progressPerFace = 80 / faces.length

  for (let i = 0; i < faces.length; i++) {
    const face = faces[i]

    const { data: faceData, cropBox } = cropAndResizeFace(
      result,
      width,
      height,
      face,
      GFPGAN_INPUT_SIZE,
      0.3
    )

    const enhancedFace = await enhanceFace(faceData)
    result = pasteEnhancedFace(result, enhancedFace, width, height, cropBox)

    onProgress(20 + (i + 1) * progressPerFace, faces.length)
  }

  return { result, faceCount: faces.length }
}

/**
 * Handle incoming messages
 */
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, payload } = e.data

  switch (type) {
    case 'init': {
      try {
        const timeout = payload?.timeout ?? DEFAULT_TIMEOUT

        useWebGPU = await checkWebGPU()
        console.log(`Face Enhancer using ${useWebGPU ? 'WebGPU' : 'WASM'} backend`)

        const yoloCached = await isModelCached(YOLO_MODEL_URL)
        const gfpganCached = await isModelCached(GFPGAN_MODEL_URL)

        let totalProgress = 0
        const yoloWeight = 0.03
        const gfpganWeight = 0.97

        if (!yoloCached) {
          self.postMessage({ type: 'phase', payload: { phase: 'download', id: payload?.id } })
        }

        const yoloBuffer = await downloadModel(YOLO_MODEL_URL, (current, total) => {
          const progress = total > 0 ? (current / total) * yoloWeight * 100 : 0
          self.postMessage({
            type: 'progress',
            payload: {
              phase: 'download',
              progress,
              detail: yoloCached ? undefined : { current, total, unit: 'bytes' },
              id: payload?.id
            }
          })
        }, timeout)
        totalProgress = yoloWeight * 100

        if (!gfpganCached) {
          self.postMessage({ type: 'phase', payload: { phase: 'download', id: payload?.id } })
        }

        const gfpganBuffer = await downloadModel(GFPGAN_MODEL_URL, (current, total) => {
          const progress = totalProgress + (total > 0 ? (current / total) * gfpganWeight * 100 : 0)
          self.postMessage({
            type: 'progress',
            payload: {
              phase: 'download',
              progress,
              detail: gfpganCached ? undefined : { current, total, unit: 'bytes' },
              id: payload?.id
            }
          })
        }, timeout)

        self.postMessage({ type: 'phase', payload: { phase: 'loading', id: payload?.id } })

        yoloSession = await createSession(yoloBuffer)
        gfpganSession = await createSession(gfpganBuffer)

        self.postMessage({ type: 'ready', payload: { id: payload?.id } })
      } catch (error) {
        self.postMessage({
          type: 'error',
          payload: error instanceof Error ? error.message : 'Failed to initialize models'
        })
      }
      break
    }

    case 'enhance': {
      if (!payload?.imageData || !payload?.width || !payload?.height) {
        self.postMessage({ type: 'error', payload: 'Missing image data' })
        return
      }

      try {
        self.postMessage({ type: 'phase', payload: { phase: 'detect', id: payload.id } })

        let faceCount = 0

        const { result, faceCount: count } = await processImage(
          payload.imageData,
          payload.width,
          payload.height,
          (progress, faces) => {
            if (faces !== undefined) faceCount = faces
            if (progress >= 20 && faceCount > 0) {
              self.postMessage({ type: 'phase', payload: { phase: 'enhance', id: payload.id } })
            }
            self.postMessage({
              type: 'progress',
              payload: {
                phase: progress < 20 ? 'detect' : 'enhance',
                progress,
                id: payload.id
              }
            })
          }
        )

        faceCount = count

        self.postMessage(
          {
            type: 'result',
            payload: {
              data: result,
              width: payload.width,
              height: payload.height,
              faces: faceCount,
              id: payload.id
            }
          },
          { transfer: [result.buffer] }
        )
      } catch (error) {
        self.postMessage({
          type: 'error',
          payload: error instanceof Error ? error.message : 'Failed to enhance image'
        })
      }
      break
    }

    case 'dispose': {
      yoloSession = null
      gfpganSession = null
      self.postMessage({ type: 'disposed' })
      break
    }
  }
}
