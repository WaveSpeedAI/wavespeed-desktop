/**
 * Face Swapper Web Worker
 * Uses YOLOFace for face detection + 5-point landmarks,
 * ArcFace for embedding extraction, inswapper for face swapping,
 * and optionally GFPGAN for enhancement.
 * Face parsing uses @huggingface/transformers pipeline for precise masking.
 * All models run via ONNX Runtime (WebGPU with WASM fallback)
 */

// @ts-expect-error - onnxruntime-web types not resolved due to package.json exports
import * as ort from 'onnxruntime-web'
import { pipeline, env, RawImage } from '@huggingface/transformers'
import { FACE_LABELS, featherMask } from '@/lib/faceParsingUtils'

// Configure transformers.js
env.allowLocalModels = false

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
const DET_10G_MODEL_URL = 'https://huggingface.co/wavespeed/misc/resolve/main/inswapper/det_10g_patched.onnx'
const ARCFACE_MODEL_URL = 'https://huggingface.co/fofr/comfyui/resolve/main/insightface/models/buffalo_l/w600k_r50.onnx'
// Full precision model required - fp16 version produces distorted results
const INSWAPPER_MODEL_URL = 'https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx'
const EMAP_URL = 'https://huggingface.co/wavespeed/misc/resolve/main/inswapper/emap.bin'
const GFPGAN_MODEL_URL = 'https://huggingface.co/facefusion/models-3.0.0/resolve/main/gfpgan_1.4.onnx'

// Model sizes (approximate, for progress weight calculation)
const MODEL_SIZES = {
  det10g: 17,    // ~17MB (det_10g from InsightFace)
  arcface: 174,  // ~174MB
  inswapper: 554, // ~554MB (full precision)
  emap: 1,       // ~1MB (embedding transformation matrix)
  gfpgan: 340    // ~340MB
}

// Model input sizes
const DET_INPUT_SIZE = 640
const ARCFACE_INPUT_SIZE = 112
const INSWAPPER_INPUT_SIZE = 128
const GFPGAN_INPUT_SIZE = 512

// Detection thresholds
const CONFIDENCE_THRESHOLD = 0.5
const NMS_THRESHOLD = 0.4

// Cache names
const CACHE_NAME = 'face-swapper-models'  // For arcface, inswapper
const FACE_ENHANCER_CACHE = 'face-enhancer-models'  // Shared with faceEnhancer for GFPGAN

// ONNX sessions
let det10gSession: ort.InferenceSession | null = null
let arcfaceSession: ort.InferenceSession | null = null
let inswapperSession: ort.InferenceSession | null = null
let gfpganSession: ort.InferenceSession | null = null

// Face parsing segmenter (using transformers.js pipeline)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let segmenter: any = null

// EMAP matrix for embedding transformation (extracted from inswapper model)
let emapMatrix: Float32Array | null = null

// Standard ArcFace destination landmarks for 112x112 aligned face
// These are the target positions for the 5 facial landmarks
const ARCFACE_DST_112 = [
  [38.2946, 51.6963],  // left eye
  [73.5318, 51.5014],  // right eye
  [56.0252, 71.7366],  // nose tip
  [41.5493, 92.3655],  // left mouth corner
  [70.7299, 92.2041]   // right mouth corner
]

// Destination landmarks for 128x128 inswapper input
// InsightFace adds 8.0 to x coordinates for 128x128 (not scaled!)
// See: insightface/utils/face_align.py estimate_norm()
const INSWAPPER_DST_128 = ARCFACE_DST_112.map(([x, y]) => [
  x + 8.0,  // Add 8 to x (centers the face in 128x128)
  y         // Y stays the same
])

interface FaceBox {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

interface DetectedFace {
  box: FaceBox
  landmarks: number[][] // 5-point: [left_eye, right_eye, nose, left_mouth, right_mouth]
  index: number
}

interface WorkerMessage {
  type: 'init' | 'detect' | 'swap' | 'dispose'
  payload?: {
    imageData?: Float32Array
    width?: number
    height?: number
    imageId?: 'source' | 'target'
    id?: number
    timeout?: number
    enableEnhancement?: boolean
    sourceImage?: Float32Array
    sourceWidth?: number
    sourceHeight?: number
    sourceLandmarks?: number[][]
    targetImage?: Float32Array
    targetWidth?: number
    targetHeight?: number
    targetFaces?: { landmarks: number[][]; box: FaceBox }[]
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
  timeout: number = DEFAULT_TIMEOUT,
  cacheName: string = CACHE_NAME
): Promise<ArrayBuffer> {
  const cache = await caches.open(cacheName)
  const cachedResponse = await cache.match(url)

  if (cachedResponse) {
    const buffer = await cachedResponse.arrayBuffer()
    onProgress(buffer.byteLength, buffer.byteLength)
    return buffer
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const timeoutSeconds = Math.round(timeout / 1000)

  try {
    const response = await fetch(url, {
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

    const buffer = new Uint8Array(received)
    let position = 0
    for (const chunk of chunks) {
      buffer.set(chunk, position)
      position += chunk.length
    }

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
async function isModelCached(url: string, cacheName: string = CACHE_NAME): Promise<boolean> {
  const cache = await caches.open(cacheName)
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
      const errorMsg = e instanceof Error ? e.message : String(e)
      console.warn(`WebGPU session creation failed, falling back to WASM. Reason: ${errorMsg}`)
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
 * Transform embedding using EMAP matrix
 * This is required by inswapper to properly interpret ArcFace embeddings
 */
function transformEmbedding(embedding: Float32Array, emap: Float32Array): Float32Array {
  const result = new Float32Array(512)

  // Matrix multiplication: result = embedding @ emap
  // embedding is [512], emap is [512, 512], result is [512]
  for (let i = 0; i < 512; i++) {
    let sum = 0
    for (let j = 0; j < 512; j++) {
      sum += embedding[j] * emap[j * 512 + i]
    }
    result[i] = sum
  }

  // Normalize to unit length
  const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0))
  if (norm > 0) {
    for (let i = 0; i < 512; i++) {
      result[i] /= norm
    }
  }

  return result
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
 * NMS that returns indices of selected faces (preserves landmark association)
 */
function nmsWithIndices(
  faces: Array<{ box: FaceBox; landmarks: number[][] }>,
  iouThreshold: number
): number[] {
  if (faces.length === 0) return []

  // Create indexed array and sort by confidence descending
  const indexed = faces.map((f, i) => ({ ...f, idx: i }))
  indexed.sort((a, b) => b.box.confidence - a.box.confidence)

  const selectedIndices: number[] = []
  const remaining = [...indexed]

  while (remaining.length > 0) {
    const best = remaining.shift()!
    selectedIndices.push(best.idx)

    // Remove overlapping faces
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (iou(best.box, remaining[i].box) > iouThreshold) {
        remaining.splice(i, 1)
      }
    }
  }

  return selectedIndices
}

/**
 * Detect faces with 5-point landmarks using InsightFace det_10g (SCRFD)
 * Returns DetectedFace objects with both bounding box and landmarks
 *
 * SCRFD det_10g output format:
 * 9 outputs grouped by stride level (8, 16, 32):
 * - 3 score outputs: confidence scores (need sigmoid)
 * - 3 bbox outputs: distances from anchor (left, top, right, bottom) * stride
 * - 3 kps outputs: offsets from anchor for 5 keypoints * stride
 */
async function detectFacesWithLandmarks(
  imageData: Float32Array,
  width: number,
  height: number
): Promise<DetectedFace[]> {
  if (!det10gSession) throw new Error('det_10g session not initialized')

  const { data, scale, padX, padY } = letterboxResize(imageData, width, height, DET_INPUT_SIZE)
  const inputTensor = new ort.Tensor('float32', data, [1, 3, DET_INPUT_SIZE, DET_INPUT_SIZE])

  // Get input name
  const inputName = det10gSession.inputNames[0]
  const results = await det10gSession.run({ [inputName]: inputTensor })

  // SCRFD outputs 9 tensors grouped by stride level
  const outputNames = Object.keys(results)

  // Collect all detections from all stride levels
  const allFaces: { box: FaceBox; landmarks: number[][] }[] = []

  // SCRFD strides and their feature map sizes for 640x640 input
  const strides = [8, 16, 32]
  const numAnchorsPerPos = 2

  // Group outputs by last dimension (1=score, 4=bbox, 10=kps)
  const scoreOutputs: { data: Float32Array; dims: number[] }[] = []
  const bboxOutputs: { data: Float32Array; dims: number[] }[] = []
  const kpsOutputs: { data: Float32Array; dims: number[] }[] = []

  for (const name of outputNames) {
    const output = results[name]
    const outputData = output.data as Float32Array
    const dims = output.dims as number[]
    const lastDim = dims[dims.length - 1]

    if (lastDim === 1) {
      scoreOutputs.push({ data: outputData, dims })
    } else if (lastDim === 4) {
      bboxOutputs.push({ data: outputData, dims })
    } else if (lastDim === 10) {
      kpsOutputs.push({ data: outputData, dims })
    }
  }

  // Sort by number of anchors (descending) to match stride order (8, 16, 32)
  scoreOutputs.sort((a, b) => b.data.length - a.data.length)
  bboxOutputs.sort((a, b) => b.data.length - a.data.length)
  kpsOutputs.sort((a, b) => b.data.length - a.data.length)

  // Process each stride level
  for (let s = 0; s < strides.length; s++) {
    const stride = strides[s]
    const scoreData = scoreOutputs[s]?.data
    const bboxData = bboxOutputs[s]?.data
    const kpsData = kpsOutputs[s]?.data

    if (!scoreData || !bboxData || !kpsData) continue

    // Feature map size for this stride
    const fmSize = Math.floor(DET_INPUT_SIZE / stride)
    const numAnchors = fmSize * fmSize * numAnchorsPerPos

    // Iterate over all anchor positions
    // Note: det_10g outputs are already sigmoid'd (scores in 0-1 range)
    for (let i = 0; i < numAnchors; i++) {
      const confidence = scoreData[i]
      if (confidence < CONFIDENCE_THRESHOLD) continue

      // Calculate anchor position
      const anchorIdx = Math.floor(i / numAnchorsPerPos)
      const anchorY = Math.floor(anchorIdx / fmSize)
      const anchorX = anchorIdx % fmSize

      // Anchor center in input image coordinates
      const anchorCenterX = (anchorX + 0.5) * stride
      const anchorCenterY = (anchorY + 0.5) * stride

      // Decode bbox: distances from anchor center
      const bboxOffset = i * 4
      const left = bboxData[bboxOffset] * stride
      const top = bboxData[bboxOffset + 1] * stride
      const right = bboxData[bboxOffset + 2] * stride
      const bottom = bboxData[bboxOffset + 3] * stride

      // Convert to x1, y1, x2, y2 in input coordinates
      const x1Input = anchorCenterX - left
      const y1Input = anchorCenterY - top
      const x2Input = anchorCenterX + right
      const y2Input = anchorCenterY + bottom

      // Convert to original image coordinates
      const x1 = (x1Input - padX) / scale
      const y1 = (y1Input - padY) / scale
      const x2 = (x2Input - padX) / scale
      const y2 = (y2Input - padY) / scale

      const boxW = x2 - x1
      const boxH = y2 - y1

      if (boxW <= 0 || boxH <= 0) continue

      // Clamp to image bounds
      const clampedX = Math.max(0, Math.min(x1, width - 1))
      const clampedY = Math.max(0, Math.min(y1, height - 1))
      const clampedW = Math.min(boxW, width - clampedX)
      const clampedH = Math.min(boxH, height - clampedY)

      if (clampedW <= 0 || clampedH <= 0) continue

      // Decode 5-point landmarks: offsets from anchor center
      const kpsOffset = i * 10
      const landmarks: number[][] = []
      for (let j = 0; j < 5; j++) {
        const offsetX = kpsData[kpsOffset + j * 2] * stride
        const offsetY = kpsData[kpsOffset + j * 2 + 1] * stride
        const lmXInput = anchorCenterX + offsetX
        const lmYInput = anchorCenterY + offsetY
        const lmX = (lmXInput - padX) / scale
        const lmY = (lmYInput - padY) / scale
        landmarks.push([
          Math.max(0, Math.min(lmX, width - 1)),
          Math.max(0, Math.min(lmY, height - 1))
        ])
      }

      allFaces.push({
        box: {
          x: clampedX,
          y: clampedY,
          width: clampedW,
          height: clampedH,
          confidence
        },
        landmarks
      })
    }
  }

  // Apply NMS with index tracking (preserves landmark association)
  const selectedIndices = nmsWithIndices(allFaces, NMS_THRESHOLD)

  // Build result using indices directly (no floating-point matching)
  const result: DetectedFace[] = selectedIndices.map((idx, i) => ({
    box: allFaces[idx].box,
    landmarks: allFaces[idx].landmarks,
    index: i
  }))

  return result
}

/**
 * Average multiple points
 */
function averagePoints(points: number[][]): number[] {
  const sum = [0, 0]
  for (const p of points) {
    sum[0] += p[0]
    sum[1] += p[1]
  }
  return [sum[0] / points.length, sum[1] / points.length]
}

/**
 * Compute 2x2 SVD using closed-form analytical solution
 * Returns U, S (singular values), V matrices
 */
function svd2x2(a: number, b: number, c: number, d: number): {
  U: number[][]
  S: number[]
  V: number[][]
} {
  const e = (a + d) / 2
  const f = (a - d) / 2
  const g = (c + b) / 2
  const h = (c - b) / 2

  const q = Math.sqrt(e * e + h * h)
  const r = Math.sqrt(f * f + g * g)

  const s1 = q + r
  const s2 = Math.abs(q - r)

  const a1 = Math.atan2(g, f)
  const a2 = Math.atan2(h, e)

  const theta = (a2 - a1) / 2
  const phi = (a2 + a1) / 2

  return {
    U: [[Math.cos(phi), -Math.sin(phi)], [Math.sin(phi), Math.cos(phi)]],
    S: [s1, s2],
    V: [[Math.cos(theta), Math.sin(theta)], [-Math.sin(theta), Math.cos(theta)]]
  }
}

/**
 * Estimate similarity transform using Umeyama algorithm
 * More robust than simple least-squares, handles reflection cases properly
 * Returns a 2x3 affine matrix
 */
function estimateSimilarityTransform(
  srcLandmarks: number[][],
  dstLandmarks: number[][]
): number[] {
  const n = srcLandmarks.length

  // 1. Compute centroids
  const srcCentroid = averagePoints(srcLandmarks)
  const dstCentroid = averagePoints(dstLandmarks)

  // 2. Center points
  const srcCentered = srcLandmarks.map(p => [p[0] - srcCentroid[0], p[1] - srcCentroid[1]])
  const dstCentered = dstLandmarks.map(p => [p[0] - dstCentroid[0], p[1] - dstCentroid[1]])

  // 3. Compute source variance
  let srcVar = 0
  for (const p of srcCentered) {
    srcVar += p[0] * p[0] + p[1] * p[1]
  }
  srcVar /= n

  // Handle degenerate case
  if (srcVar < 1e-10) {
    return [1, 0, dstCentroid[0] - srcCentroid[0], 0, 1, dstCentroid[1] - srcCentroid[1]]
  }

  // 4. Compute 2x2 covariance matrix H = dst^T * src / n
  let h00 = 0, h01 = 0, h10 = 0, h11 = 0
  for (let i = 0; i < n; i++) {
    h00 += dstCentered[i][0] * srcCentered[i][0]
    h01 += dstCentered[i][0] * srcCentered[i][1]
    h10 += dstCentered[i][1] * srcCentered[i][0]
    h11 += dstCentered[i][1] * srcCentered[i][1]
  }
  h00 /= n
  h01 /= n
  h10 /= n
  h11 /= n

  // 5. SVD of 2x2 covariance matrix
  const { U, S, V } = svd2x2(h00, h01, h10, h11)

  // 6. Compute rotation R = V * U^T, handling reflection
  // Determinant of U and V
  const detU = U[0][0] * U[1][1] - U[0][1] * U[1][0]
  const detV = V[0][0] * V[1][1] - V[0][1] * V[1][0]

  // Create sign matrix D for reflection handling
  const d = detU * detV < 0 ? -1 : 1

  // R = V * D * U^T where D = diag(1, d)
  // V * D:
  const vd00 = V[0][0]
  const vd01 = V[0][1] * d
  const vd10 = V[1][0]
  const vd11 = V[1][1] * d

  // (V * D) * U^T:
  const r00 = vd00 * U[0][0] + vd01 * U[0][1]
  const r01 = vd00 * U[1][0] + vd01 * U[1][1]
  const r10 = vd10 * U[0][0] + vd11 * U[0][1]
  const r11 = vd10 * U[1][0] + vd11 * U[1][1]

  // 7. Compute scale: c = trace(D * S) / variance_src
  const traceDS = S[0] + d * S[1]
  const scale = traceDS / srcVar

  // 8. Compute translation: t = dst_centroid - scale * R * src_centroid
  const tx = dstCentroid[0] - scale * (r00 * srcCentroid[0] + r01 * srcCentroid[1])
  const ty = dstCentroid[1] - scale * (r10 * srcCentroid[0] + r11 * srcCentroid[1])

  // Return 2x3 matrix [a, b, tx, c, d, ty] where:
  // x' = a*x + b*y + tx
  // y' = c*x + d*y + ty
  return [scale * r00, scale * r01, tx, scale * r10, scale * r11, ty]
}

/**
 * Invert a 2x3 affine matrix
 */
function invertAffineMatrix(m: number[]): number[] {
  const [a, b, tx, c, d, ty] = m
  const det = a * d - b * c

  if (Math.abs(det) < 1e-10) {
    throw new Error('Matrix is singular')
  }

  const invDet = 1 / det
  const ia = d * invDet
  const ib = -b * invDet
  const ic = -c * invDet
  const id = a * invDet
  const itx = -(ia * tx + ib * ty)
  const ity = -(ic * tx + id * ty)

  return [ia, ib, itx, ic, id, ity]
}

/**
 * Apply affine warp to extract aligned face
 * @param toBGR - if true, swap R and B channels for InsightFace models
 */
function warpAffine(
  imageData: Float32Array,
  imgW: number,
  imgH: number,
  matrix: number[],
  outputSize: number,
  normalize: boolean = true,
  toBGR: boolean = false
): Float32Array {
  const output = new Float32Array(3 * outputSize * outputSize)
  const invMatrix = invertAffineMatrix(matrix)

  for (let y = 0; y < outputSize; y++) {
    for (let x = 0; x < outputSize; x++) {
      // Map output coords to input coords using inverse matrix
      const srcX = invMatrix[0] * x + invMatrix[1] * y + invMatrix[2]
      const srcY = invMatrix[3] * x + invMatrix[4] * y + invMatrix[5]

      // Bilinear interpolation
      const x0 = Math.floor(srcX)
      const y0 = Math.floor(srcY)
      const x1 = Math.min(x0 + 1, imgW - 1)
      const y1 = Math.min(y0 + 1, imgH - 1)

      const xFrac = srcX - x0
      const yFrac = srcY - y0

      // Check bounds
      if (x0 >= 0 && x0 < imgW && y0 >= 0 && y0 < imgH) {
        for (let c = 0; c < 3; c++) {
          // For BGR output, swap R(0) and B(2) channels
          const srcC = toBGR ? (c === 0 ? 2 : c === 2 ? 0 : c) : c

          const v00 = imageData[(y0 * imgW + x0) * 3 + srcC]
          const v10 = imageData[(y0 * imgW + Math.min(x1, imgW - 1)) * 3 + srcC]
          const v01 = imageData[(Math.min(y1, imgH - 1) * imgW + x0) * 3 + srcC]
          const v11 = imageData[(Math.min(y1, imgH - 1) * imgW + Math.min(x1, imgW - 1)) * 3 + srcC]

          const v0 = v00 * (1 - xFrac) + v10 * xFrac
          const v1 = v01 * (1 - xFrac) + v11 * xFrac
          let v = v0 * (1 - yFrac) + v1 * yFrac

          // Normalize to [-1, 1] for model input
          if (normalize) {
            v = v * 2 - 1
          }

          output[c * outputSize * outputSize + y * outputSize + x] = v
        }
      } else {
        // Out of bounds - fill with black (normalized)
        for (let c = 0; c < 3; c++) {
          output[c * outputSize * outputSize + y * outputSize + x] = normalize ? -1 : 0
        }
      }
    }
  }

  return output
}

/**
 * Extract face embedding using ArcFace
 */
async function extractEmbedding(
  imageData: Float32Array,
  imgW: number,
  imgH: number,
  landmarks: number[][]
): Promise<Float32Array> {
  if (!arcfaceSession) throw new Error('ArcFace session not initialized')

  // Compute alignment matrix
  const matrix = estimateSimilarityTransform(landmarks, ARCFACE_DST_112)

  // Warp face to 112x112 aligned position (BGR for InsightFace ArcFace)
  const alignedFace = warpAffine(imageData, imgW, imgH, matrix, ARCFACE_INPUT_SIZE, true, true)

  // Run ArcFace - Input: NCHW [1, 3, 112, 112]
  const inputTensor = new ort.Tensor('float32', alignedFace, [1, 3, ARCFACE_INPUT_SIZE, ARCFACE_INPUT_SIZE])

  // Use actual input name from model (may be 'input', 'input.1', 'data', etc.)
  const inputName = arcfaceSession.inputNames[0]
  const results = await arcfaceSession.run({ [inputName]: inputTensor })

  const outputName = Object.keys(results)[0]
  const embedding = results[outputName].data as Float32Array

  // Normalize embedding to unit length
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
  const normalized = new Float32Array(embedding.length)
  for (let i = 0; i < embedding.length; i++) {
    normalized[i] = embedding[i] / norm
  }

  return normalized
}

/**
 * Swap face using inswapper model
 */
async function swapFace(
  targetImage: Float32Array,
  targetW: number,
  targetH: number,
  targetLandmarks: number[][],
  sourceEmbedding: Float32Array
): Promise<{ swapped: Float32Array; matrix: number[] }> {
  if (!inswapperSession) throw new Error('Inswapper session not initialized')

  // Compute alignment matrix for target face
  const matrix = estimateSimilarityTransform(targetLandmarks, INSWAPPER_DST_128)

  // Warp target face to 128x128 - inswapper expects RGB, [0, 1] range
  const alignedTarget = warpAffine(targetImage, targetW, targetH, matrix, INSWAPPER_INPUT_SIZE, false, false)

  // Run inswapper
  const targetTensor = new ort.Tensor('float32', alignedTarget, [1, 3, INSWAPPER_INPUT_SIZE, INSWAPPER_INPUT_SIZE])

  // Transform embedding using EMAP matrix (required by inswapper)
  const transformedEmbedding = emapMatrix
    ? transformEmbedding(sourceEmbedding, emapMatrix)
    : sourceEmbedding
  const embeddingTensor = new ort.Tensor('float32', transformedEmbedding, [1, 512])

  // Map inputs based on model input names
  const inputNames = inswapperSession.inputNames
  const inputs: Record<string, ort.Tensor> = {}

  for (const name of inputNames) {
    const lowerName = name.toLowerCase()
    if (lowerName.includes('source') || lowerName.includes('latent') || lowerName.includes('emb')) {
      inputs[name] = embeddingTensor
    } else if (lowerName.includes('target') || lowerName.includes('input') || lowerName.includes('image')) {
      inputs[name] = targetTensor
    }
  }

  // Fallback: use positional mapping (InsightFace order: image first, embedding second)
  if (Object.keys(inputs).length < 2) {
    inputs[inputNames[0]] = targetTensor
    inputs[inputNames[1]] = embeddingTensor
  }

  const results = await inswapperSession.run(inputs)
  const outputName = Object.keys(results)[0]
  const swapped = results[outputName].data as Float32Array

  return { swapped, matrix }
}

/**
 * Parse aligned face to generate semantic segmentation mask
 * Uses affine transform matrix to warp image to face space before parsing
 * This ensures the mask coordinates match the face swap transformation
 */
async function parseFaceAligned(
  originalData: Float32Array,
  imgW: number,
  imgH: number,
  matrix: number[],
  outputSize: number = INSWAPPER_INPUT_SIZE
): Promise<Uint8Array> {
  if (!segmenter) throw new Error('Face segmenter not initialized')

  // Invert the matrix to map from face space to original image
  const invMatrix = invertAffineMatrix(matrix)

  // Create aligned face image as Uint8Array RGBA for RawImage
  const rgbaData = new Uint8Array(outputSize * outputSize * 4)

  for (let y = 0; y < outputSize; y++) {
    for (let x = 0; x < outputSize; x++) {
      // Map face coordinates to original image coordinates using inverse matrix
      const srcX = invMatrix[0] * x + invMatrix[1] * y + invMatrix[2]
      const srcY = invMatrix[3] * x + invMatrix[4] * y + invMatrix[5]

      const outIdx = (y * outputSize + x) * 4

      // Bilinear interpolation
      const x0 = Math.floor(srcX)
      const y0 = Math.floor(srcY)
      const x1 = Math.min(x0 + 1, imgW - 1)
      const y1 = Math.min(y0 + 1, imgH - 1)

      if (x0 >= 0 && x0 < imgW && y0 >= 0 && y0 < imgH) {
        const xFrac = srcX - x0
        const yFrac = srcY - y0

        for (let c = 0; c < 3; c++) {
          const v00 = originalData[(y0 * imgW + x0) * 3 + c]
          const v10 = originalData[(y0 * imgW + Math.min(x1, imgW - 1)) * 3 + c]
          const v01 = originalData[(Math.min(y1, imgH - 1) * imgW + x0) * 3 + c]
          const v11 = originalData[(Math.min(y1, imgH - 1) * imgW + Math.min(x1, imgW - 1)) * 3 + c]

          const v0 = v00 * (1 - xFrac) + v10 * xFrac
          const v1 = v01 * (1 - xFrac) + v11 * xFrac
          const v = v0 * (1 - yFrac) + v1 * yFrac

          rgbaData[outIdx + c] = Math.round(v * 255)
        }
        rgbaData[outIdx + 3] = 255
      } else {
        // Out of bounds - black
        rgbaData[outIdx] = 0
        rgbaData[outIdx + 1] = 0
        rgbaData[outIdx + 2] = 0
        rgbaData[outIdx + 3] = 255
      }
    }
  }

  // Create RawImage and run segmentation
  const image = new RawImage(rgbaData, outputSize, outputSize, 4)
  const results = await segmenter(image)

  // Combine face region masks
  const mask = new Uint8Array(outputSize * outputSize)

  for (const segment of results) {
    const label = segment.label.replace(/\.png$/i, '')
    if (FACE_LABELS.has(label)) {
      const segMask = segment.mask
      const maskData = segMask.data as Uint8Array
      const maskW = segMask.width
      const maskH = segMask.height

      for (let y = 0; y < outputSize; y++) {
        for (let x = 0; x < outputSize; x++) {
          const srcX = (x / outputSize) * maskW
          const srcY = (y / outputSize) * maskH
          const srcIdx = Math.floor(srcY) * maskW + Math.floor(srcX)

          if (maskData[srcIdx] > 0) {
            mask[y * outputSize + x] = 255
          }
        }
      }
    }
  }

  // Apply feathering to mask edges
  const featheredMask = featherMask(mask, outputSize, 8)

  return featheredMask
}

/**
 * Parse face using crop box for GFPGAN enhancement
 * Uses simple crop (not affine transform) to match GFPGAN's input
 */
async function parseFaceCrop(
  originalData: Float32Array,
  imgW: number,
  imgH: number,
  faceBox: FaceBox,
  outputSize: number = GFPGAN_INPUT_SIZE
): Promise<Uint8Array> {
  if (!segmenter) throw new Error('Face segmenter not initialized')

  // Crop face with padding (10%)
  const padding = 0.1
  const expandW = faceBox.width * padding
  const expandH = faceBox.height * padding

  let cropX = faceBox.x - expandW
  let cropY = faceBox.y - expandH
  let cropW = faceBox.width + expandW * 2
  let cropH = faceBox.height + expandH * 2

  // Make square
  const squareSize = Math.max(cropW, cropH)
  cropX = cropX - (squareSize - cropW) / 2
  cropY = cropY - (squareSize - cropH) / 2
  cropW = squareSize
  cropH = squareSize

  // Clamp to image bounds
  cropX = Math.max(0, cropX)
  cropY = Math.max(0, cropY)
  cropW = Math.min(cropW, imgW - cropX)
  cropH = Math.min(cropH, imgH - cropY)

  // Create cropped image as Uint8Array RGBA for RawImage
  const rgbaData = new Uint8Array(outputSize * outputSize * 4)

  for (let y = 0; y < outputSize; y++) {
    for (let x = 0; x < outputSize; x++) {
      const srcX = cropX + (x / outputSize) * cropW
      const srcY = cropY + (y / outputSize) * cropH

      const x0 = Math.floor(srcX)
      const y0 = Math.floor(srcY)
      const x1 = Math.min(x0 + 1, imgW - 1)
      const y1 = Math.min(y0 + 1, imgH - 1)

      const xFrac = srcX - x0
      const yFrac = srcY - y0

      const outIdx = (y * outputSize + x) * 4

      for (let c = 0; c < 3; c++) {
        const v00 = originalData[(y0 * imgW + x0) * 3 + c]
        const v10 = originalData[(y0 * imgW + x1) * 3 + c]
        const v01 = originalData[(y1 * imgW + x0) * 3 + c]
        const v11 = originalData[(y1 * imgW + x1) * 3 + c]

        const v0 = v00 * (1 - xFrac) + v10 * xFrac
        const v1 = v01 * (1 - xFrac) + v11 * xFrac
        const v = v0 * (1 - yFrac) + v1 * yFrac

        rgbaData[outIdx + c] = Math.round(v * 255)
      }
      rgbaData[outIdx + 3] = 255
    }
  }

  // Create RawImage and run segmentation
  const image = new RawImage(rgbaData, outputSize, outputSize, 4)
  const results = await segmenter(image)

  // Combine face region masks
  const mask = new Uint8Array(outputSize * outputSize)

  for (const segment of results) {
    const label = segment.label.replace(/\.png$/i, '')
    if (FACE_LABELS.has(label)) {
      const segMask = segment.mask
      const maskData = segMask.data as Uint8Array
      const maskW = segMask.width
      const maskH = segMask.height

      for (let y = 0; y < outputSize; y++) {
        for (let x = 0; x < outputSize; x++) {
          const srcX = (x / outputSize) * maskW
          const srcY = (y / outputSize) * maskH
          const srcIdx = Math.floor(srcY) * maskW + Math.floor(srcX)

          if (maskData[srcIdx] > 0) {
            mask[y * outputSize + x] = 255
          }
        }
      }
    }
  }

  // Apply feathering to mask edges
  const featheredMask = featherMask(mask, outputSize, 8)

  return featheredMask
}

/**
 * Match swapped face colors to target face region
 * Uses linear color transfer: output = (input - srcMean) * (dstStd / srcStd) + dstMean
 */
function matchFaceColors(
  swappedFace: Float32Array,  // CHW format, RGB
  originalImage: Float32Array,  // HWC format, RGB
  imgW: number,
  imgH: number,
  matrix: number[],  // Transform to sample target region
  faceMask: Uint8Array,  // Face mask
  faceSize: number
): Float32Array {
  const result = new Float32Array(swappedFace.length)

  // Compute statistics for target face region (sample from original image using transform)
  const targetSums = [0, 0, 0]
  const targetSqSums = [0, 0, 0]
  let targetCount = 0

  // Sample target face pixels using inverse transform
  const invMatrix = invertAffineMatrix(matrix)
  for (let fy = 0; fy < faceSize; fy++) {
    for (let fx = 0; fx < faceSize; fx++) {
      if (faceMask[fy * faceSize + fx] < 128) continue

      // Transform face coords to original image coords
      const srcX = invMatrix[0] * fx + invMatrix[1] * fy + invMatrix[2]
      const srcY = invMatrix[3] * fx + invMatrix[4] * fy + invMatrix[5]

      if (srcX >= 0 && srcX < imgW - 1 && srcY >= 0 && srcY < imgH - 1) {
        const x0 = Math.floor(srcX)
        const y0 = Math.floor(srcY)
        const idx = (y0 * imgW + x0) * 3

        for (let c = 0; c < 3; c++) {
          const v = originalImage[idx + c]
          targetSums[c] += v
          targetSqSums[c] += v * v
        }
        targetCount++
      }
    }
  }

  if (targetCount < 100) {
    // Not enough target pixels, return unmodified
    return swappedFace
  }

  const targetMean = targetSums.map(s => s / targetCount)
  const targetStd = targetSqSums.map((sq, i) =>
    Math.sqrt(Math.max(0.01, sq / targetCount - targetMean[i] * targetMean[i]))
  )

  // Compute statistics for swapped face
  const swappedSums = [0, 0, 0]
  const swappedSqSums = [0, 0, 0]
  let swappedCount = 0

  for (let fy = 0; fy < faceSize; fy++) {
    for (let fx = 0; fx < faceSize; fx++) {
      if (faceMask[fy * faceSize + fx] < 128) continue

      for (let c = 0; c < 3; c++) {
        const v = swappedFace[c * faceSize * faceSize + fy * faceSize + fx]
        swappedSums[c] += v
        swappedSqSums[c] += v * v
      }
      swappedCount++
    }
  }

  if (swappedCount < 100) {
    return swappedFace
  }

  const swappedMean = swappedSums.map(s => s / swappedCount)
  const swappedStd = swappedSqSums.map((sq, i) =>
    Math.sqrt(Math.max(0.01, sq / swappedCount - swappedMean[i] * swappedMean[i]))
  )

  // Apply linear color transfer with clamped scale to prevent distortion
  for (let c = 0; c < 3; c++) {
    // Clamp scale to prevent extreme color changes that distort facial features
    const rawScale = targetStd[c] / swappedStd[c]
    const scale = Math.max(0.5, Math.min(2.0, rawScale))  // Limit to 0.5x - 2x
    const shift = targetMean[c] - swappedMean[c] * scale

    for (let i = 0; i < faceSize * faceSize; i++) {
      const idx = c * faceSize * faceSize + i
      let v = swappedFace[idx] * scale + shift
      result[idx] = Math.max(0, Math.min(1, v))
    }
  }

  return result
}

/**
 * Inverse warp and blend swapped face back to original image
 * Uses semantic segmentation mask for precise blending
 */
function inverseWarpAndBlend(
  originalImage: Float32Array,
  imgW: number,
  imgH: number,
  swappedFace: Float32Array,
  matrix: number[],
  faceMask: Uint8Array,
  featherSize: number = 10
): Float32Array {
  const result = new Float32Array(originalImage)
  const faceSize = INSWAPPER_INPUT_SIZE

  // For each pixel in the original image
  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      // Transform to face coordinates
      const faceX = matrix[0] * x + matrix[1] * y + matrix[2]
      const faceY = matrix[3] * x + matrix[4] * y + matrix[5]

      // Check if inside face region
      if (faceX >= 0 && faceX < faceSize && faceY >= 0 && faceY < faceSize) {
        // Get mask value at this position (bilinear interpolation)
        const fx0 = Math.floor(faceX)
        const fy0 = Math.floor(faceY)
        const fx1 = Math.min(fx0 + 1, faceSize - 1)
        const fy1 = Math.min(fy0 + 1, faceSize - 1)
        const xFrac = faceX - fx0
        const yFrac = faceY - fy0

        // Bilinear interpolation of mask (mask is 0-255, normalize to 0-1)
        const m00 = faceMask[fy0 * faceSize + fx0] / 255
        const m10 = faceMask[fy0 * faceSize + fx1] / 255
        const m01 = faceMask[fy1 * faceSize + fx0] / 255
        const m11 = faceMask[fy1 * faceSize + fx1] / 255
        const m0 = m00 * (1 - xFrac) + m10 * xFrac
        const m1 = m01 * (1 - xFrac) + m11 * xFrac
        const maskValue = m0 * (1 - yFrac) + m1 * yFrac

        // Skip if outside face mask
        if (maskValue <= 0) continue

        // Compute edge feathering
        const edgeDist = Math.min(faceX, faceY, faceSize - 1 - faceX, faceSize - 1 - faceY)
        const edgeFactor = Math.min(1, edgeDist / featherSize)

        // Combine mask and edge feathering
        const blendFactor = maskValue * edgeFactor

        if (blendFactor > 0) {
          for (let c = 0; c < 3; c++) {
            // Swapped face is in CHW RGB format (same as original image)
            const v00 = swappedFace[c * faceSize * faceSize + fy0 * faceSize + fx0]
            const v10 = swappedFace[c * faceSize * faceSize + fy0 * faceSize + fx1]
            const v01 = swappedFace[c * faceSize * faceSize + fy1 * faceSize + fx0]
            const v11 = swappedFace[c * faceSize * faceSize + fy1 * faceSize + fx1]

            const v0 = v00 * (1 - xFrac) + v10 * xFrac
            const v1 = v01 * (1 - xFrac) + v11 * xFrac
            let swappedVal = v0 * (1 - yFrac) + v1 * yFrac

            // Inswapper outputs [0, 1] range, just clamp
            swappedVal = Math.max(0, Math.min(1, swappedVal))

            // Blend with original (RGB)
            const origIdx = (y * imgW + x) * 3 + c
            result[origIdx] = originalImage[origIdx] * (1 - blendFactor) + swappedVal * blendFactor
          }
        }
      }
    }
  }

  return result
}

/**
 * Enhance face using GFPGAN (optional)
 * Uses semantic segmentation mask for precise blending (same as face enhancer)
 */
async function enhanceFaceRegion(
  imageData: Float32Array,
  imgW: number,
  imgH: number,
  faceBox: FaceBox,
  faceMask: Uint8Array
): Promise<Float32Array> {
  if (!gfpganSession) throw new Error('GFPGAN session not initialized')

  // Crop face with padding (10%)
  const padding = 0.1
  const expandW = faceBox.width * padding
  const expandH = faceBox.height * padding

  let cropX = faceBox.x - expandW
  let cropY = faceBox.y - expandH
  let cropW = faceBox.width + expandW * 2
  let cropH = faceBox.height + expandH * 2

  // Make square
  const size = Math.max(cropW, cropH)
  cropX = cropX - (size - cropW) / 2
  cropY = cropY - (size - cropH) / 2
  cropW = size
  cropH = size

  // Clamp
  cropX = Math.max(0, cropX)
  cropY = Math.max(0, cropY)
  cropW = Math.min(cropW, imgW - cropX)
  cropH = Math.min(cropH, imgH - cropY)

  // Crop and resize to 512x512 for GFPGAN
  const faceData = new Float32Array(3 * GFPGAN_INPUT_SIZE * GFPGAN_INPUT_SIZE)

  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < GFPGAN_INPUT_SIZE; y++) {
      for (let x = 0; x < GFPGAN_INPUT_SIZE; x++) {
        const srcX = cropX + (x / GFPGAN_INPUT_SIZE) * cropW
        const srcY = cropY + (y / GFPGAN_INPUT_SIZE) * cropH

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

        // Normalize to [-1, 1]
        v = (v - 0.5) / 0.5

        faceData[c * GFPGAN_INPUT_SIZE * GFPGAN_INPUT_SIZE + y * GFPGAN_INPUT_SIZE + x] = v
      }
    }
  }

  // Run GFPGAN
  const inputTensor = new ort.Tensor('float32', faceData, [1, 3, GFPGAN_INPUT_SIZE, GFPGAN_INPUT_SIZE])
  const inputName = gfpganSession.inputNames[0]
  const results = await gfpganSession.run({ [inputName]: inputTensor })
  const outputName = Object.keys(results)[0]
  const enhanced = results[outputName].data as Float32Array

  // Paste back with semantic mask and edge feathering
  const result = new Float32Array(imageData)
  const edgeFeatherSize = 12

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

        // Get mask alpha from semantic segmentation (bilinear interpolation)
        const m00 = faceMask[fy0 * GFPGAN_INPUT_SIZE + fx0]
        const m10 = faceMask[fy0 * GFPGAN_INPUT_SIZE + fx1]
        const m01 = faceMask[fy1 * GFPGAN_INPUT_SIZE + fx0]
        const m11 = faceMask[fy1 * GFPGAN_INPUT_SIZE + fx1]
        const m0 = m00 * (1 - xFrac) + m10 * xFrac
        const m1 = m01 * (1 - xFrac) + m11 * xFrac
        let maskAlpha = (m0 * (1 - yFrac) + m1 * yFrac) / 255

        // Apply additional edge feathering at crop boundaries
        const distToEdge = Math.min(
          x - cropX, cropX + cropW - 1 - x,
          y - cropY, cropY + cropH - 1 - y
        )
        const edgeFactor = Math.min(1, distToEdge / edgeFeatherSize)

        // Combine mask alpha with edge feathering
        const blendFactor = maskAlpha * edgeFactor

        if (blendFactor > 0) {
          for (let c = 0; c < 3; c++) {
            const v00 = enhanced[c * GFPGAN_INPUT_SIZE * GFPGAN_INPUT_SIZE + fy0 * GFPGAN_INPUT_SIZE + fx0]
            const v10 = enhanced[c * GFPGAN_INPUT_SIZE * GFPGAN_INPUT_SIZE + fy0 * GFPGAN_INPUT_SIZE + fx1]
            const v01 = enhanced[c * GFPGAN_INPUT_SIZE * GFPGAN_INPUT_SIZE + fy1 * GFPGAN_INPUT_SIZE + fx0]
            const v11 = enhanced[c * GFPGAN_INPUT_SIZE * GFPGAN_INPUT_SIZE + fy1 * GFPGAN_INPUT_SIZE + fx1]

            const v0 = v00 * (1 - xFrac) + v10 * xFrac
            const v1 = v01 * (1 - xFrac) + v11 * xFrac
            let enhancedVal = v0 * (1 - yFrac) + v1 * yFrac

            // Denormalize from [-1, 1] to [0, 1]
            enhancedVal = (enhancedVal + 1) / 2
            enhancedVal = Math.max(0, Math.min(1, enhancedVal))

            const origIdx = (y * imgW + x) * 3 + c
            result[origIdx] = imageData[origIdx] * (1 - blendFactor) + enhancedVal * blendFactor
          }
        }
      }
    }
  }

  return result
}

/**
 * Detect faces with landmarks using SCRFD
 * This is a convenience wrapper around detectFacesWithLandmarks
 */
async function detectFaces(
  imageData: Float32Array,
  width: number,
  height: number
): Promise<DetectedFace[]> {
  return detectFacesWithLandmarks(imageData, width, height)
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
        const enableEnhancement = payload?.enableEnhancement ?? false

        // Check for WebGPU support
        useWebGPU = await checkWebGPU()
        console.log(`Face Swapper using ${useWebGPU ? 'WebGPU' : 'WASM'} backend`)

        // Calculate total model size for progress
        let totalSize = MODEL_SIZES.det10g + MODEL_SIZES.arcface + MODEL_SIZES.inswapper + MODEL_SIZES.emap
        if (enableEnhancement) {
          totalSize += MODEL_SIZES.gfpgan
        }

        // Check cache status
        const det10gCached = await isModelCached(DET_10G_MODEL_URL)
        const arcfaceCached = await isModelCached(ARCFACE_MODEL_URL)
        const inswapperCached = await isModelCached(INSWAPPER_MODEL_URL)
        const emapCached = await isModelCached(EMAP_URL)
        const gfpganCached = enableEnhancement ? await isModelCached(GFPGAN_MODEL_URL, FACE_ENHANCER_CACHE) : true

        let downloadedSize = 0

        // Download det_10g (detection + landmarks from InsightFace)
        self.postMessage({ type: 'phase', payload: { phase: 'download', id: payload?.id } })

        const det10gBuffer = await downloadModel(DET_10G_MODEL_URL, (current, total) => {
          const progress = ((downloadedSize + (current / (total || 1)) * MODEL_SIZES.det10g) / totalSize) * 100
          self.postMessage({
            type: 'progress',
            payload: {
              phase: 'download',
              progress,
              detail: det10gCached ? undefined : { current, total, unit: 'bytes' },
              id: payload?.id
            }
          })
        }, timeout)
        downloadedSize += MODEL_SIZES.det10g

        // Download ArcFace
        const arcfaceBuffer = await downloadModel(ARCFACE_MODEL_URL, (current, total) => {
          const progress = ((downloadedSize + (current / (total || 1)) * MODEL_SIZES.arcface) / totalSize) * 100
          self.postMessage({
            type: 'progress',
            payload: {
              phase: 'download',
              progress,
              detail: arcfaceCached ? undefined : { current, total, unit: 'bytes' },
              id: payload?.id
            }
          })
        }, timeout)
        downloadedSize += MODEL_SIZES.arcface

        // Download Inswapper
        const inswapperBuffer = await downloadModel(INSWAPPER_MODEL_URL, (current, total) => {
          const progress = ((downloadedSize + (current / (total || 1)) * MODEL_SIZES.inswapper) / totalSize) * 100
          self.postMessage({
            type: 'progress',
            payload: {
              phase: 'download',
              progress,
              detail: inswapperCached ? undefined : { current, total, unit: 'bytes' },
              id: payload?.id
            }
          })
        }, timeout)
        downloadedSize += MODEL_SIZES.inswapper

        // Download EMAP matrix (embedding transformation for inswapper)
        const emapBuffer = await downloadModel(EMAP_URL, (current, total) => {
          const progress = ((downloadedSize + (current / (total || 1)) * MODEL_SIZES.emap) / totalSize) * 100
          self.postMessage({
            type: 'progress',
            payload: {
              phase: 'download',
              progress,
              detail: emapCached ? undefined : { current, total, unit: 'bytes' },
              id: payload?.id
            }
          })
        }, timeout)
        downloadedSize += MODEL_SIZES.emap

        // Download GFPGAN if enhancement enabled
        let gfpganBuffer: ArrayBuffer | null = null
        if (enableEnhancement) {
          gfpganBuffer = await downloadModel(GFPGAN_MODEL_URL, (current, total) => {
            const progress = ((downloadedSize + (current / (total || 1)) * MODEL_SIZES.gfpgan) / totalSize) * 100
            self.postMessage({
              type: 'progress',
              payload: {
                phase: 'download',
                progress,
                detail: gfpganCached ? undefined : { current, total, unit: 'bytes' },
                id: payload?.id
              }
            })
          }, timeout, FACE_ENHANCER_CACHE)
        }

        // Create ONNX sessions
        self.postMessage({ type: 'phase', payload: { phase: 'loading', id: payload?.id } })

        det10gSession = await createSession(det10gBuffer)
        arcfaceSession = await createSession(arcfaceBuffer)

        // Parse EMAP matrix from downloaded binary (512x512 float32 = 1MB)
        emapMatrix = new Float32Array(emapBuffer)
        console.log(`EMAP matrix loaded: ${emapMatrix.length} floats`)

        inswapperSession = await createSession(inswapperBuffer)

        if (enableEnhancement && gfpganBuffer) {
          gfpganSession = await createSession(gfpganBuffer)
        }

        // Initialize face-parsing segmenter using transformers.js pipeline
        // This is used for precise face masking (same as face enhancer)
        segmenter = await pipeline('image-segmentation', 'Xenova/face-parsing', {
          device: useWebGPU ? 'webgpu' : 'wasm',
          dtype: 'fp32'
        })

        self.postMessage({ type: 'ready', payload: { id: payload?.id } })
      } catch (error) {
        self.postMessage({
          type: 'error',
          payload: error instanceof Error ? error.message : 'Failed to initialize models'
        })
      }
      break
    }

    case 'detect': {
      if (!payload?.imageData || !payload?.width || !payload?.height) {
        self.postMessage({ type: 'error', payload: 'Missing image data' })
        return
      }

      try {
        self.postMessage({ type: 'phase', payload: { phase: 'detect', id: payload.id } })

        const faces = await detectFaces(
          payload.imageData,
          payload.width,
          payload.height
        )

        self.postMessage({
          type: 'detectResult',
          payload: {
            faces,
            imageId: payload.imageId,
            id: payload.id
          }
        })
      } catch (error) {
        self.postMessage({
          type: 'error',
          payload: error instanceof Error ? error.message : 'Failed to detect faces'
        })
      }
      break
    }

    case 'swap': {
      if (!payload?.sourceImage || !payload?.targetImage || !payload?.sourceLandmarks || !payload?.targetFaces) {
        self.postMessage({ type: 'error', payload: 'Missing swap parameters' })
        return
      }

      try {
        // Phase: embed - extract source embedding
        self.postMessage({ type: 'phase', payload: { phase: 'embed', id: payload.id } })

        const sourceEmbedding = await extractEmbedding(
          payload.sourceImage,
          payload.sourceWidth!,
          payload.sourceHeight!,
          payload.sourceLandmarks
        )

        self.postMessage({
          type: 'progress',
          payload: { phase: 'embed', progress: 100, id: payload.id }
        })

        // Phase: swap - swap each target face
        self.postMessage({ type: 'phase', payload: { phase: 'swap', id: payload.id } })

        // Keep reference to original target image for face parsing and color matching
        // This ensures we always use the original target face features, not already-swapped faces
        const originalTarget = new Float32Array(payload.targetImage)
        let result = new Float32Array(payload.targetImage)
        const targetFaces = payload.targetFaces
        const totalFaces = targetFaces.length

        // Store face boxes and masks for enhancement phase
        const swappedFaceData: { box: FaceBox; mask: Uint8Array }[] = []

        for (let i = 0; i < totalFaces; i++) {
          const face = targetFaces[i]

          // Swap face using original target image for consistent alignment
          const { swapped, matrix } = await swapFace(
            originalTarget,
            payload.targetWidth!,
            payload.targetHeight!,
            face.landmarks,
            sourceEmbedding
          )

          // Generate face mask from ORIGINAL target face (not already-swapped result)
          // This ensures we identify the face region based on original target features
          const swapMask = await parseFaceAligned(
            originalTarget,
            payload.targetWidth!,
            payload.targetHeight!,
            matrix,
            INSWAPPER_INPUT_SIZE
          )

          // Match swapped face colors to target face for seamless blending
          const colorMatchedFace = matchFaceColors(
            swapped,
            originalTarget,
            payload.targetWidth!,
            payload.targetHeight!,
            matrix,
            swapMask,
            INSWAPPER_INPUT_SIZE
          )

          result = inverseWarpAndBlend(
            result,
            payload.targetWidth!,
            payload.targetHeight!,
            colorMatchedFace,
            matrix,
            swapMask
          ) as Float32Array<ArrayBuffer>

          // Generate mask at GFPGAN size using crop from original target
          const enhanceMask = await parseFaceCrop(
            originalTarget,
            payload.targetWidth!,
            payload.targetHeight!,
            face.box,
            GFPGAN_INPUT_SIZE
          )

          swappedFaceData.push({ box: face.box, mask: enhanceMask })

          self.postMessage({
            type: 'progress',
            payload: {
              phase: 'swap',
              progress: ((i + 1) / totalFaces) * 100,
              id: payload.id
            }
          })
        }

        // Phase: enhance - optional GFPGAN enhancement
        if (gfpganSession && swappedFaceData.length > 0) {
          self.postMessage({ type: 'phase', payload: { phase: 'enhance', id: payload.id } })

          for (let i = 0; i < swappedFaceData.length; i++) {
            const { box, mask } = swappedFaceData[i]
            result = (await enhanceFaceRegion(
              result,
              payload.targetWidth!,
              payload.targetHeight!,
              box,
              mask
            )) as Float32Array<ArrayBuffer>

            self.postMessage({
              type: 'progress',
              payload: {
                phase: 'enhance',
                progress: ((i + 1) / swappedFaceData.length) * 100,
                id: payload.id
              }
            })
          }
        }

        // Send result
        self.postMessage(
          {
            type: 'swapResult',
            payload: {
              data: result,
              width: payload.targetWidth,
              height: payload.targetHeight,
              id: payload.id
            }
          },
          { transfer: [result.buffer] }
        )
      } catch (error) {
        self.postMessage({
          type: 'error',
          payload: error instanceof Error ? error.message : 'Failed to swap faces'
        })
      }
      break
    }

    case 'dispose': {
      det10gSession = null
      arcfaceSession = null
      inswapperSession = null
      gfpganSession = null
      segmenter = null
      self.postMessage({ type: 'disposed' })
      break
    }
  }
}
