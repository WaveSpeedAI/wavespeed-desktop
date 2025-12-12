import { env, SamModel, AutoProcessor, RawImage, Tensor } from '@huggingface/transformers'

env.allowLocalModels = false

const MODEL_ID = 'Xenova/slimsam-77-uniform'

// State
let model: Awaited<ReturnType<typeof SamModel.from_pretrained>> | null = null
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null
let imageInputs: { pixel_values: Tensor; original_sizes: [number, number][]; reshaped_input_sizes: [number, number][] } | null = null
let imageEmbeddings: Record<string, Tensor> | null = null
let device: 'webgpu' | 'wasm' = 'wasm'
let isLoading = false
let isProcessing = false
let isDecoding = false

// Queue for pending decode requests
let pendingDecodeRequest: { id: number; points: PointPrompt[] } | null = null

interface PointPrompt {
  point: [number, number]
  label: 0 | 1
}

// Detect WebGPU
async function hasWebGPU(): Promise<boolean> {
  try {
    return !!(navigator.gpu && await navigator.gpu.requestAdapter())
  } catch {
    return false
  }
}

// Load model with mutex to prevent concurrent loads
async function loadModel(id: number): Promise<void> {
  // If already loaded, just return ready
  if (model && processor) {
    self.postMessage({ type: 'ready', payload: { id, device } })
    return
  }

  // If already loading, wait for it
  if (isLoading) {
    // Wait for loading to complete
    while (isLoading) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (model && processor) {
      self.postMessage({ type: 'ready', payload: { id, device } })
      return
    }
    throw new Error('Model failed to load')
  }

  isLoading = true

  try {
    // Mobile: prefer WASM for stability
    device = 'wasm'
    const hasGPU = await hasWebGPU()
    if (hasGPU) {
      device = 'webgpu'
    }

    self.postMessage({ type: 'phase', payload: { phase: 'download', id } })

    const fileProgress: Record<string, { loaded: number; total: number }> = {}
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) {
        fileProgress[p.file] = { loaded: p.loaded || 0, total: p.total || 1 }
        const totals = Object.values(fileProgress).reduce((acc, f) => ({ loaded: acc.loaded + f.loaded, total: acc.total + f.total }), { loaded: 0, total: 0 })
        if (totals.total > 0) {
          self.postMessage({ type: 'progress', payload: { phase: 'download', progress: (totals.loaded / totals.total) * 100, detail: { current: totals.loaded, total: totals.total, unit: 'bytes' }, id } })
        }
      }
    }

    // Always use fp32 and wasm on mobile for stability
    const dtype = 'fp32'
    const useDevice = 'wasm'

    try {
      ;[model, processor] = await Promise.all([
        SamModel.from_pretrained(MODEL_ID, { dtype, device: useDevice, progress_callback } as Parameters<typeof SamModel.from_pretrained>[1]),
        AutoProcessor.from_pretrained(MODEL_ID, { progress_callback })
      ])
      device = useDevice
    } catch (e) {
      console.error('Model loading error:', e)
      throw e
    }

    self.postMessage({ type: 'progress', payload: { phase: 'download', progress: 100, id } })
    self.postMessage({ type: 'ready', payload: { id, device } })
  } finally {
    isLoading = false
  }
}

// Encode image with mutex
async function segmentImage(id: number, imageDataUrl: string): Promise<void> {
  if (!model || !processor) throw new Error('Model not initialized')

  if (isProcessing) {
    throw new Error('Another image is being processed')
  }

  isProcessing = true

  try {
    self.postMessage({ type: 'phase', payload: { phase: 'process', id } })
    self.postMessage({ type: 'progress', payload: { phase: 'process', progress: 0, id } })

    const image = await RawImage.read(imageDataUrl)
    imageInputs = await (processor as unknown as (img: RawImage) => Promise<typeof imageInputs>)(image)
    self.postMessage({ type: 'progress', payload: { phase: 'process', progress: 50, id } })

    imageEmbeddings = await (model as unknown as { get_image_embeddings: (i: typeof imageInputs) => Promise<Record<string, Tensor>> }).get_image_embeddings(imageInputs)
    self.postMessage({ type: 'progress', payload: { phase: 'process', progress: 100, id } })
    self.postMessage({ type: 'segmented', payload: { id } })
  } finally {
    isProcessing = false
  }
}

// Decode mask with mutex to prevent concurrent ONNX sessions
async function decodeMask(id: number, points: PointPrompt[]): Promise<void> {
  if (!model || !processor || !imageInputs || !imageEmbeddings) throw new Error('Image not segmented')

  // If already decoding, queue this request and skip
  if (isDecoding) {
    pendingDecodeRequest = { id, points }
    return
  }

  isDecoding = true

  try {
    const [reshaped, original] = [imageInputs.reshaped_input_sizes[0], imageInputs.original_sizes[0]]
    const inputPoints = new Tensor('float32', points.flatMap(p => [p.point[0] * reshaped[1], p.point[1] * reshaped[0]]), [1, 1, points.length, 2])
    const inputLabels = new Tensor('int64', points.map(p => BigInt(p.label)), [1, 1, points.length])

    const outputs = await (model as unknown as (i: Record<string, Tensor>) => Promise<{ pred_masks: Tensor; iou_scores: Tensor }>)({
      ...imageEmbeddings, input_points: inputPoints, input_labels: inputLabels
    })

    const masks = await (processor as unknown as { post_process_masks: (m: Tensor, o: [number, number][], r: [number, number][]) => Promise<Tensor[][]> })
      .post_process_masks(outputs.pred_masks, imageInputs.original_sizes, imageInputs.reshaped_input_sizes)

    const maskBuffer = (masks[0][0].data as Uint8Array).buffer.slice(0)
    const scoresBuffer = new Float32Array(outputs.iou_scores.data as Float32Array).buffer

    self.postMessage({ type: 'maskResult', payload: { mask: maskBuffer, width: original[1], height: original[0], scores: scoresBuffer, id } }, { transfer: [maskBuffer, scoresBuffer] })
  } finally {
    isDecoding = false

    // Process pending request if any
    if (pendingDecodeRequest) {
      const pending = pendingDecodeRequest
      pendingDecodeRequest = null
      // Process asynchronously to avoid stack overflow
      setTimeout(() => decodeMask(pending.id, pending.points), 0)
    }
  }
}

// Message handler
self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data
  const id = payload?.id ?? 0

  try {
    switch (type) {
      case 'init':
        await loadModel(id)
        break
      case 'segment':
        if (!model) await loadModel(id)
        await segmentImage(id, payload.imageDataUrl)
        break
      case 'decodeMask':
        await decodeMask(id, payload.points)
        break
      case 'reset':
        imageInputs = imageEmbeddings = null
        self.postMessage({ type: 'reset', payload: { id } })
        break
      case 'dispose':
        imageInputs = imageEmbeddings = null
        // Don't dispose model, keep it for reuse
        self.postMessage({ type: 'disposed', payload: { id } })
        break
    }
  } catch (error) {
    self.postMessage({ type: 'error', payload: { message: (error as Error).message, id } })
  }
}
