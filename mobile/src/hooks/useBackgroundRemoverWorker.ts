import { useRef, useCallback, useEffect } from 'react'
import type { ProgressDetail } from '@/types/progress'

type ModelType = 'isnet_quint8' | 'isnet_fp16' | 'isnet'
type OutputType = 'foreground' | 'background' | 'mask'

interface WorkerMessage {
  type: 'phase' | 'progress' | 'result' | 'resultAll' | 'error' | 'disposed'
  payload?: unknown
}

interface PhasePayload {
  phase: string
  id: number
}

interface ProgressPayload {
  phase: string
  progress: number
  detail?: ProgressDetail
  id: number
}

interface ResultPayload {
  arrayBuffer: ArrayBuffer
  id: number
}

interface ResultAllPayload {
  foreground: ArrayBuffer
  background: ArrayBuffer
  mask: ArrayBuffer
  id: number
}

export interface AllOutputsResult {
  foreground: Blob
  background: Blob
  mask: Blob
}

interface UseBackgroundRemoverWorkerOptions {
  onPhase?: (phase: string) => void
  onProgress?: (phase: string, progress: number, detail?: ProgressDetail) => void
  onError?: (error: string) => void
}

export function useBackgroundRemoverWorker(
  options: UseBackgroundRemoverWorkerOptions = {}
) {
  const workerRef = useRef<Worker | null>(null)
  const callbacksRef = useRef<Map<number, (result: Blob) => void>>(new Map())
  const callbacksAllRef = useRef<Map<number, (result: AllOutputsResult) => void>>(new Map())
  const idCounterRef = useRef(0)
  const optionsRef = useRef(options)
  const hasFailedRef = useRef(false)

  // Keep options ref up to date
  optionsRef.current = options

  const createWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
    }
    hasFailedRef.current = false

    // Use mobile-specific worker
    workerRef.current = new Worker(
      new URL('../workers/backgroundRemover.worker.ts', import.meta.url),
      { type: 'module' }
    )

    workerRef.current.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const { type, payload } = e.data

      switch (type) {
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
          const { arrayBuffer, id } = payload as ResultPayload
          const callback = callbacksRef.current.get(id)
          if (callback) {
            // Convert ArrayBuffer back to Blob
            const blob = new Blob([arrayBuffer], { type: 'image/png' })
            callback(blob)
            callbacksRef.current.delete(id)
          }
          break
        }
        case 'resultAll': {
          const { foreground, background, mask, id } = payload as ResultAllPayload
          const callback = callbacksAllRef.current.get(id)
          if (callback) {
            // Convert ArrayBuffers back to Blobs
            callback({
              foreground: new Blob([foreground], { type: 'image/png' }),
              background: new Blob([background], { type: 'image/png' }),
              mask: new Blob([mask], { type: 'image/png' })
            })
            callbacksAllRef.current.delete(id)
          }
          break
        }
        case 'error':
          hasFailedRef.current = true
          optionsRef.current.onError?.(payload as string)
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

  const removeBackground = useCallback(
    (
      imageBlob: Blob,
      model: ModelType = 'isnet_fp16',
      outputType: OutputType = 'foreground'
    ): Promise<Blob> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Worker not initialized'))
          return
        }

        const id = idCounterRef.current++
        callbacksRef.current.set(id, resolve)

        // Set up error handler for this specific call
        const handleError = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === 'error') {
            callbacksRef.current.delete(id)
            workerRef.current?.removeEventListener('message', handleError)
            reject(new Error(e.data.payload as string))
          }
        }
        workerRef.current.addEventListener('message', handleError)

        workerRef.current.postMessage({
          type: 'process',
          payload: { imageBlob, model, outputType, id }
        })
      })
    },
    []
  )

  const removeBackgroundAll = useCallback(
    (imageBlob: Blob, model: ModelType = 'isnet_fp16'): Promise<AllOutputsResult> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Worker not initialized'))
          return
        }

        const id = idCounterRef.current++
        callbacksAllRef.current.set(id, resolve)

        // Set up error handler for this specific call
        const handleError = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === 'error') {
            callbacksAllRef.current.delete(id)
            workerRef.current?.removeEventListener('message', handleError)
            reject(new Error(e.data.payload as string))
          }
        }
        workerRef.current.addEventListener('message', handleError)

        workerRef.current.postMessage({
          type: 'processAll',
          payload: { imageBlob, model, id }
        })
      })
    },
    []
  )

  const dispose = useCallback(() => {
    workerRef.current?.postMessage({ type: 'dispose' })
  }, [])

  const retryWorker = useCallback(() => {
    createWorker()
  }, [createWorker])

  const hasFailed = useCallback(() => hasFailedRef.current, [])

  return { removeBackground, removeBackgroundAll, dispose, retryWorker, hasFailed }
}
