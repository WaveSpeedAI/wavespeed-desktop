import { useRef, useCallback, useEffect } from 'react'
import type { ProgressDetail } from '@/types/progress'

interface ConvertOptions {
  // Video options
  videoCodec?: string
  videoBitrate?: string
  resolution?: string
  fps?: number
  // Audio options
  audioCodec?: string
  audioBitrate?: string
  sampleRate?: number
  // Image options
  quality?: number
}

interface MediaInfo {
  duration: number | null
  resolution: { width: number; height: number } | null
  videoCodec: string | null
  audioCodec: string | null
}

interface WorkerMessage {
  type: 'loaded' | 'phase' | 'progress' | 'result' | 'info' | 'error' | 'disposed'
  payload?: unknown
}

interface PhasePayload {
  phase: string
  id?: number
}

interface ProgressPayload {
  phase: string
  progress: number
  detail?: ProgressDetail
  id?: number
}

interface ResultPayload {
  data: ArrayBuffer
  filename: string
  id: number
}

interface InfoPayload extends MediaInfo {
  id: number
}

interface UseFFmpegWorkerOptions {
  onPhase?: (phase: string) => void
  onProgress?: (phase: string, progress: number, detail?: ProgressDetail) => void
  onError?: (error: string) => void
}

export function useFFmpegWorker(options: UseFFmpegWorkerOptions = {}) {
  const workerRef = useRef<Worker | null>(null)
  const resultCallbacksRef = useRef<Map<number, (result: { data: ArrayBuffer; filename: string }) => void>>(new Map())
  const infoCallbacksRef = useRef<Map<number, (info: MediaInfo) => void>>(new Map())
  const idCounterRef = useRef(0)
  const optionsRef = useRef(options)
  const hasFailedRef = useRef(false)
  const isLoadedRef = useRef(false)

  // Keep options ref up to date
  optionsRef.current = options

  const createWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
    }
    hasFailedRef.current = false
    isLoadedRef.current = false

    workerRef.current = new Worker(
      new URL('../workers/ffmpeg.worker.ts', import.meta.url),
      { type: 'module' }
    )

    workerRef.current.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const { type, payload } = e.data

      switch (type) {
        case 'loaded': {
          isLoadedRef.current = true
          break
        }
        case 'phase': {
          const { phase } = payload as PhasePayload
          optionsRef.current.onPhase?.(phase)
          break
        }
        case 'progress': {
          const { phase, progress, detail } = payload as ProgressPayload
          optionsRef.current.onProgress?.(phase, progress, detail)
          break
        }
        case 'result': {
          const { data, filename, id } = payload as ResultPayload
          const callback = resultCallbacksRef.current.get(id)
          if (callback) {
            callback({ data, filename })
            resultCallbacksRef.current.delete(id)
          }
          break
        }
        case 'info': {
          const { id, ...info } = payload as InfoPayload
          const callback = infoCallbacksRef.current.get(id)
          if (callback) {
            callback(info)
            infoCallbacksRef.current.delete(id)
          }
          break
        }
        case 'error':
          hasFailedRef.current = true
          optionsRef.current.onError?.(payload as string)
          // Reject all pending callbacks
          resultCallbacksRef.current.forEach((_, id) => {
            resultCallbacksRef.current.delete(id)
          })
          infoCallbacksRef.current.forEach((_, id) => {
            infoCallbacksRef.current.delete(id)
          })
          break
      }
    }
  }, [])

  // Initialize worker
  useEffect(() => {
    createWorker()

    return () => {
      workerRef.current?.postMessage({ type: 'dispose' })
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [createWorker])

  // Pre-load FFmpeg (optional, can be called early)
  const load = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      if (isLoadedRef.current) {
        resolve()
        return
      }

      const handleMessage = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === 'loaded') {
          workerRef.current?.removeEventListener('message', handleMessage)
          resolve()
        } else if (e.data.type === 'error') {
          workerRef.current?.removeEventListener('message', handleMessage)
          reject(new Error(e.data.payload as string))
        }
      }

      workerRef.current.addEventListener('message', handleMessage)
      workerRef.current.postMessage({ type: 'load' })
    })
  }, [])

  // Convert media file
  const convert = useCallback((
    file: ArrayBuffer,
    fileName: string,
    outputFormat: string,
    outputExt: string,
    options?: ConvertOptions
  ): Promise<{ data: ArrayBuffer; filename: string }> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      const id = idCounterRef.current++
      resultCallbacksRef.current.set(id, resolve)

      const handleError = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === 'error') {
          resultCallbacksRef.current.delete(id)
          workerRef.current?.removeEventListener('message', handleError)
          reject(new Error(e.data.payload as string))
        }
      }
      workerRef.current.addEventListener('message', handleError)

      workerRef.current.postMessage(
        {
          type: 'convert',
          payload: { file, fileName, outputFormat, outputExt, options, id }
        },
        { transfer: [file] }
      )
    })
  }, [])

  // Merge multiple media files
  const merge = useCallback((
    files: ArrayBuffer[],
    fileNames: string[],
    outputFormat: string,
    outputExt: string
  ): Promise<{ data: ArrayBuffer; filename: string }> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      const id = idCounterRef.current++
      resultCallbacksRef.current.set(id, resolve)

      const handleError = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === 'error') {
          resultCallbacksRef.current.delete(id)
          workerRef.current?.removeEventListener('message', handleError)
          reject(new Error(e.data.payload as string))
        }
      }
      workerRef.current.addEventListener('message', handleError)

      workerRef.current.postMessage(
        {
          type: 'merge',
          payload: { files, fileNames, outputFormat, outputExt, id }
        },
        { transfer: files }
      )
    })
  }, [])

  // Trim media file
  const trim = useCallback((
    file: ArrayBuffer,
    fileName: string,
    startTime: number,
    endTime: number,
    outputFormat: string,
    outputExt: string
  ): Promise<{ data: ArrayBuffer; filename: string }> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      const id = idCounterRef.current++
      resultCallbacksRef.current.set(id, resolve)

      const handleError = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === 'error') {
          resultCallbacksRef.current.delete(id)
          workerRef.current?.removeEventListener('message', handleError)
          reject(new Error(e.data.payload as string))
        }
      }
      workerRef.current.addEventListener('message', handleError)

      workerRef.current.postMessage(
        {
          type: 'trim',
          payload: { file, fileName, startTime, endTime, outputFormat, outputExt, id }
        },
        { transfer: [file] }
      )
    })
  }, [])

  // Get media info
  const getMediaInfo = useCallback((
    file: ArrayBuffer,
    fileName: string
  ): Promise<MediaInfo> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      const id = idCounterRef.current++
      infoCallbacksRef.current.set(id, resolve)

      const handleError = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === 'error') {
          infoCallbacksRef.current.delete(id)
          workerRef.current?.removeEventListener('message', handleError)
          reject(new Error(e.data.payload as string))
        }
      }
      workerRef.current.addEventListener('message', handleError)

      // Clone the buffer since we can't transfer and keep
      const clonedBuffer = file.slice(0)
      workerRef.current.postMessage(
        {
          type: 'getInfo',
          payload: { file: clonedBuffer, fileName, id }
        },
        { transfer: [clonedBuffer] }
      )
    })
  }, [])

  // Cancel current operation
  const cancel = useCallback(() => {
    workerRef.current?.postMessage({ type: 'cancel' })
  }, [])

  // Dispose worker
  const dispose = useCallback(() => {
    workerRef.current?.postMessage({ type: 'dispose' })
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  const hasFailed = useCallback(() => hasFailedRef.current, [])
  const isLoaded = useCallback(() => isLoadedRef.current, [])

  const retryWorker = useCallback(() => {
    createWorker()
  }, [createWorker])

  return {
    load,
    convert,
    merge,
    trim,
    getMediaInfo,
    cancel,
    dispose,
    hasFailed,
    isLoaded,
    retryWorker
  }
}
