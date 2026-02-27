/**
 * Standalone FFmpeg worker helpers for the browser workflow engine.
 * These are non-React wrappers around the same ffmpeg.worker.ts used by useFFmpegWorker.
 */

interface ConvertOptions {
  videoCodec?: string
  videoBitrate?: string
  audioCodec?: string
  audioBitrate?: string
  resolution?: string
}

interface WorkerResult {
  data: ArrayBuffer
  filename: string
}

function createWorkerPromise<T>(
  handler: (worker: Worker, resolve: (v: T) => void, reject: (e: Error) => void) => void
): Promise<T> {
  const worker = new Worker(
    new URL('../../workers/ffmpeg.worker.ts', import.meta.url),
    { type: 'module' }
  )
  return new Promise<T>((resolve, reject) => {
    handler(worker, resolve, reject)
  }).finally(() => {
    worker.postMessage({ type: 'dispose' })
    worker.terminate()
  })
}

async function urlToArrayBuffer(url: string): Promise<{ buffer: ArrayBuffer; name: string }> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`)
  const buffer = await resp.arrayBuffer()
  const name = url.split('/').pop() || 'input'
  return { buffer, name }
}

const MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
}

function resultToBlobUrl(result: WorkerResult): string {
  const ext = (result.filename.split('.').pop() || '').toLowerCase()
  const mime = MIME_MAP[ext] || 'application/octet-stream'
  const blob = new Blob([result.data], { type: mime })
  return URL.createObjectURL(blob)
}

export async function ffmpegMerge(inputUrls: string[], format: string): Promise<string> {
  const fetched = await Promise.all(inputUrls.map(urlToArrayBuffer))
  const files = fetched.map(f => f.buffer)
  const fileNames = fetched.map(f => f.name)

  const result = await createWorkerPromise<WorkerResult>((worker, resolve, reject) => {
    const id = 0
    worker.onmessage = (e) => {
      if (e.data.type === 'result' && e.data.payload.id === id) {
        resolve({ data: e.data.payload.data, filename: e.data.payload.filename })
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.payload))
      }
    }
    worker.postMessage(
      { type: 'merge', payload: { files, fileNames, outputFormat: format, outputExt: format, id } },
      { transfer: files }
    )
  })

  return resultToBlobUrl(result)
}

export async function ffmpegTrim(
  inputUrl: string, startTime: number, endTime: number, format: string
): Promise<string> {
  const { buffer, name } = await urlToArrayBuffer(inputUrl)

  const result = await createWorkerPromise<WorkerResult>((worker, resolve, reject) => {
    const id = 0
    worker.onmessage = (e) => {
      if (e.data.type === 'result' && e.data.payload.id === id) {
        resolve({ data: e.data.payload.data, filename: e.data.payload.filename })
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.payload))
      }
    }
    worker.postMessage(
      { type: 'trim', payload: { file: buffer, fileName: name, startTime, endTime, outputFormat: format, outputExt: format, id } },
      { transfer: [buffer] }
    )
  })

  return resultToBlobUrl(result)
}

export async function ffmpegConvert(
  inputUrl: string, outputFormat: string, outputExt: string, options?: ConvertOptions
): Promise<string> {
  const { buffer, name } = await urlToArrayBuffer(inputUrl)

  const result = await createWorkerPromise<WorkerResult>((worker, resolve, reject) => {
    const id = 0
    worker.onmessage = (e) => {
      if (e.data.type === 'result' && e.data.payload.id === id) {
        resolve({ data: e.data.payload.data, filename: e.data.payload.filename })
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.payload))
      }
    }
    worker.postMessage(
      { type: 'convert', payload: { file: buffer, fileName: name, outputFormat, outputExt, options, id } },
      { transfer: [buffer] }
    )
  })

  return resultToBlobUrl(result)
}
