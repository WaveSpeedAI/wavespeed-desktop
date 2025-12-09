import {
  env,
  SamModel,
  AutoProcessor,
  RawImage,
  Tensor
} from '@xenova/transformers'

// Disable local models - always fetch from HuggingFace
env.allowLocalModels = false

// Model configuration
const MODEL_ID = 'Xenova/slimsam-77-uniform'

// Detect WebGPU support for GPU acceleration
const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
const deviceType = hasWebGPU ? 'webgpu' : 'wasm'

// Worker global state
let modelInstance: Awaited<ReturnType<typeof SamModel.from_pretrained>> | null = null
let currentDevice: 'webgpu' | 'wasm' = deviceType
let processorInstance: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null
let cachedImageInputs: {
  pixel_values: Tensor
  original_sizes: Array<[number, number]>
  reshaped_input_sizes: Array<[number, number]>
} | null = null
let cachedImageEmbeddings: Record<string, Tensor> | null = null

interface PointPrompt {
  point: [number, number] // Normalized coordinates (0-1)
  label: 0 | 1 // 0 = negative (exclude), 1 = positive (include)
}

interface InitMessage {
  type: 'init'
  payload: { id: number }
}

interface SegmentMessage {
  type: 'segment'
  payload: { id: number; imageDataUrl: string }
}

interface DecodeMaskMessage {
  type: 'decodeMask'
  payload: { id: number; points: PointPrompt[] }
}

interface ResetMessage {
  type: 'reset'
  payload: { id: number }
}

interface DisposeMessage {
  type: 'dispose'
  payload?: { id?: number }
}

type WorkerMessage = InitMessage | SegmentMessage | DecodeMaskMessage | ResetMessage | DisposeMessage

// Load model and processor
async function loadModel(id: number): Promise<void> {
  if (modelInstance && processorInstance) {
    self.postMessage({ type: 'ready', payload: { id, device: currentDevice } })
    return
  }

  self.postMessage({ type: 'phase', payload: { phase: 'download', id } })
  self.postMessage({ type: 'progress', payload: { phase: 'download', progress: 0, id } })

  // Track progress across multiple files
  const fileProgress: Record<string, { loaded: number; total: number }> = {}

  const progressCallback = (progress: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
    if (progress.status === 'progress' && progress.file) {
      fileProgress[progress.file] = {
        loaded: progress.loaded || 0,
        total: progress.total || 1
      }

      // Calculate total progress across all files
      let totalLoaded = 0
      let totalSize = 0
      for (const file of Object.values(fileProgress)) {
        totalLoaded += file.loaded
        totalSize += file.total
      }

      if (totalSize > 0) {
        self.postMessage({
          type: 'progress',
          payload: {
            phase: 'download',
            progress: (totalLoaded / totalSize) * 100,
            detail: { current: totalLoaded, total: totalSize, unit: 'bytes' },
            id
          }
        })
      }
    }
  }

  // Load model and processor in parallel with GPU acceleration if available
  let model: Awaited<ReturnType<typeof SamModel.from_pretrained>>
  let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>

  try {
    // Note: 'device' option is supported at runtime but not in type definitions
    ;[model, processor] = await Promise.all([
      SamModel.from_pretrained(MODEL_ID, {
        quantized: true,
        device: currentDevice,
        progress_callback: progressCallback
      } as Parameters<typeof SamModel.from_pretrained>[1]),
      AutoProcessor.from_pretrained(MODEL_ID, {
        progress_callback: progressCallback
      })
    ])
  } catch (error) {
    // If WebGPU fails, fallback to WASM
    if (currentDevice === 'webgpu') {
      console.warn('WebGPU initialization failed, falling back to WASM:', error)
      currentDevice = 'wasm'
      ;[model, processor] = await Promise.all([
        SamModel.from_pretrained(MODEL_ID, {
          quantized: true,
          device: 'wasm',
          progress_callback: progressCallback
        } as Parameters<typeof SamModel.from_pretrained>[1]),
        AutoProcessor.from_pretrained(MODEL_ID, {
          progress_callback: progressCallback
        })
      ])
    } else {
      throw error
    }
  }

  modelInstance = model
  processorInstance = processor

  self.postMessage({ type: 'progress', payload: { phase: 'download', progress: 100, id } })
  self.postMessage({ type: 'ready', payload: { id, device: currentDevice } })
}

// Segment image and cache embeddings
async function segmentImage(id: number, imageDataUrl: string): Promise<void> {
  if (!modelInstance || !processorInstance) {
    throw new Error('Model not initialized')
  }

  self.postMessage({ type: 'phase', payload: { phase: 'process', id } })
  self.postMessage({ type: 'progress', payload: { phase: 'process', progress: 0, id } })

  // Load and process image
  const image = await RawImage.read(imageDataUrl)
  cachedImageInputs = await (processorInstance as unknown as (image: RawImage) => Promise<typeof cachedImageInputs>)(image)

  self.postMessage({ type: 'progress', payload: { phase: 'process', progress: 50, id } })

  // Extract embeddings (this is the slow part, only done once per image)
  cachedImageEmbeddings = await (modelInstance as unknown as { get_image_embeddings: (inputs: typeof cachedImageInputs) => Promise<Record<string, Tensor>> }).get_image_embeddings(cachedImageInputs)

  self.postMessage({ type: 'progress', payload: { phase: 'process', progress: 100, id } })
  self.postMessage({ type: 'segmented', payload: { id } })
}

// Decode mask from point prompts
async function decodeMask(id: number, points: PointPrompt[]): Promise<void> {
  if (!modelInstance || !processorInstance || !cachedImageInputs || !cachedImageEmbeddings) {
    throw new Error('Image not segmented yet')
  }

  // Get reshaped dimensions for coordinate scaling
  const reshaped = cachedImageInputs.reshaped_input_sizes[0]
  const original = cachedImageInputs.original_sizes[0]

  // Scale normalized points to reshaped image coordinates
  const scaledPoints = points.map((p) => [p.point[0] * reshaped[1], p.point[1] * reshaped[0]])
  const labels = points.map((p) => BigInt(p.label))

  // Create tensors for points and labels
  const inputPoints = new Tensor('float32', scaledPoints.flat(), [1, 1, points.length, 2])
  const inputLabels = new Tensor('int64', labels, [1, 1, labels.length])

  // Run decoder
  const outputs = await (modelInstance as unknown as (inputs: Record<string, Tensor>) => Promise<{ pred_masks: Tensor; iou_scores: Tensor }>)({
    ...cachedImageEmbeddings,
    input_points: inputPoints,
    input_labels: inputLabels
  })

  // Post-process masks to original image size
  const masks = await (processorInstance as unknown as { post_process_masks: (masks: Tensor, originalSizes: Array<[number, number]>, reshapedSizes: Array<[number, number]>) => Promise<Tensor[][]> }).post_process_masks(
    outputs.pred_masks,
    cachedImageInputs.original_sizes,
    cachedImageInputs.reshaped_input_sizes
  )

  // Get the first mask (best quality)
  const maskTensor = masks[0][0]
  const maskData = maskTensor.data as Uint8Array
  const scores = outputs.iou_scores.data as Float32Array

  // Transfer the buffer for efficiency
  const maskBuffer = maskData.buffer.slice(0)
  const scoresBuffer = new Float32Array(scores).buffer

  self.postMessage(
    {
      type: 'maskResult',
      payload: {
        mask: maskBuffer,
        width: original[1],
        height: original[0],
        scores: scoresBuffer,
        id
      }
    },
    { transfer: [maskBuffer, scoresBuffer] }
  )
}

// Reset cached data
function reset(id: number): void {
  cachedImageInputs = null
  cachedImageEmbeddings = null
  self.postMessage({ type: 'reset', payload: { id } })
}

// Dispose resources
function dispose(id?: number): void {
  cachedImageInputs = null
  cachedImageEmbeddings = null
  // Keep model instance cached for reuse
  self.postMessage({ type: 'disposed', payload: { id } })
}

// Message handler
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, payload } = e.data
  const id = payload?.id ?? 0

  try {
    switch (type) {
      case 'init':
        await loadModel(id)
        break
      case 'segment':
        // Auto-init if not already initialized
        if (!modelInstance || !processorInstance) {
          await loadModel(id)
        }
        await segmentImage(id, (payload as SegmentMessage['payload']).imageDataUrl)
        break
      case 'decodeMask':
        await decodeMask(id, (payload as DecodeMaskMessage['payload']).points)
        break
      case 'reset':
        reset(id)
        break
      case 'dispose':
        dispose(id)
        break
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      payload: { message: (error as Error).message, id }
    })
  }
}
