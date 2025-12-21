import { env, SamModel, AutoProcessor, RawImage, Tensor } from '@huggingface/transformers'

env.allowLocalModels = false
// Force onnxruntime-web@1.21.0 WASM files from CDN to avoid version mismatch
// with bundled WASM in @huggingface/transformers
env.backends.onnx.wasm!.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/'

const MODEL_ID = 'Xenova/slimsam-77-uniform'

// State
let model: Awaited<ReturnType<typeof SamModel.from_pretrained>> | null = null
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null
let imageInputs: { pixel_values: Tensor; original_sizes: [number, number][]; reshaped_input_sizes: [number, number][] } | null = null
let imageEmbeddings: Record<string, Tensor> | null = null
let device: 'webgpu' | 'wasm' = 'wasm'

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

// Load model
async function loadModel(id: number): Promise<void> {
  if (model && processor) {
    self.postMessage({ type: 'ready', payload: { id, device } })
    return
  }

  device = await hasWebGPU() ? 'webgpu' : 'wasm'
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

  const dtype = device === 'webgpu' ? 'fp16' : 'fp32'
  try {
    ;[model, processor] = await Promise.all([
      SamModel.from_pretrained(MODEL_ID, { dtype, device, progress_callback } as Parameters<typeof SamModel.from_pretrained>[1]),
      AutoProcessor.from_pretrained(MODEL_ID, { progress_callback })
    ])
  } catch (e) {
    if (device === 'webgpu') {
      const errorMsg = e instanceof Error ? e.message : String(e)
      console.warn(`WebGPU model loading failed, falling back to WASM. Reason: ${errorMsg}`)
      device = 'wasm'
      ;[model, processor] = await Promise.all([
        SamModel.from_pretrained(MODEL_ID, { dtype: 'fp32', device: 'wasm', progress_callback } as Parameters<typeof SamModel.from_pretrained>[1]),
        AutoProcessor.from_pretrained(MODEL_ID, { progress_callback })
      ])
    } else throw e
  }

  self.postMessage({ type: 'progress', payload: { phase: 'download', progress: 100, id } })
  self.postMessage({ type: 'ready', payload: { id, device } })
}

// Encode image
async function segmentImage(id: number, imageDataUrl: string): Promise<void> {
  if (!model || !processor) throw new Error('Model not initialized')

  self.postMessage({ type: 'phase', payload: { phase: 'process', id } })
  self.postMessage({ type: 'progress', payload: { phase: 'process', progress: 0, id } })

  const image = await RawImage.read(imageDataUrl)
  imageInputs = await (processor as unknown as (img: RawImage) => Promise<typeof imageInputs>)(image)
  self.postMessage({ type: 'progress', payload: { phase: 'process', progress: 50, id } })

  imageEmbeddings = await (model as unknown as { get_image_embeddings: (i: typeof imageInputs) => Promise<Record<string, Tensor>> }).get_image_embeddings(imageInputs)
  self.postMessage({ type: 'progress', payload: { phase: 'process', progress: 100, id } })
  self.postMessage({ type: 'segmented', payload: { id } })
}

// Decode mask
async function decodeMask(id: number, points: PointPrompt[]): Promise<void> {
  if (!model || !processor || !imageInputs || !imageEmbeddings) throw new Error('Image not segmented')

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
        self.postMessage({ type: 'disposed', payload: { id } })
        break
    }
  } catch (error) {
    self.postMessage({ type: 'error', payload: { message: (error as Error).message, id } })
  }
}
