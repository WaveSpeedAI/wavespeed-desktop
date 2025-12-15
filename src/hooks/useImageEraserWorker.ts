import { useRef, useCallback, useEffect } from 'react'
import type { ProgressDetail } from '@/types/progress'
import { getDownloadTimeoutMs } from '@/stores/settingsStore'

interface WorkerMessage {
  type: 'phase' | 'progress' | 'ready' | 'result' | 'error' | 'disposed'
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

interface ReadyPayload {
  id: number
}

interface ResultPayload {
  data: Float32Array
  width: number
  height: number
  id: number
}

export interface EraserResult {
  data: Float32Array
  width: number
  height: number
}

interface UseImageEraserWorkerOptions {
  onPhase?: (phase: string) => void
  onProgress?: (phase: string, progress: number, detail?: ProgressDetail) => void
  onReady?: () => void
  onError?: (error: string) => void
}

export function useImageEraserWorker(options: UseImageEraserWorkerOptions = {}) {
  const workerRef = useRef<Worker | null>(null)
  const callbacksRef = useRef<Map<number, (result: EraserResult) => void>>(
    new Map()
  )
  const readyCallbacksRef = useRef<Map<number, () => void>>(new Map())
  const idCounterRef = useRef(0)
  const optionsRef = useRef(options)
  const isInitializedRef = useRef(false)
  const hasFailedRef = useRef(false)

  // Keep options ref up to date
  optionsRef.current = options

  const createWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
    }
    isInitializedRef.current = false
    hasFailedRef.current = false

    workerRef.current = new Worker(
      new URL('../workers/imageEraser.worker.ts', import.meta.url),
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
        case 'ready': {
          const { id } = payload as ReadyPayload
          isInitializedRef.current = true
          optionsRef.current.onReady?.()
          const callback = readyCallbacksRef.current.get(id)
          if (callback) {
            callback()
            readyCallbacksRef.current.delete(id)
          }
          break
        }
        case 'result': {
          const { data, width, height, id } = payload as ResultPayload
          const callback = callbacksRef.current.get(id)
          if (callback) {
            callback({ data, width, height })
            callbacksRef.current.delete(id)
          }
          break
        }
        case 'error':
          hasFailedRef.current = true
          optionsRef.current.onError?.(payload as string)
          // Reject all pending callbacks
          for (const [id] of callbacksRef.current) {
            callbacksRef.current.delete(id)
          }
          for (const [id] of readyCallbacksRef.current) {
            readyCallbacksRef.current.delete(id)
          }
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
      isInitializedRef.current = false
    }
  }, [createWorker])

  const initModel = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      // If already initialized, resolve immediately
      if (isInitializedRef.current) {
        resolve()
        return
      }

      const id = idCounterRef.current++
      readyCallbacksRef.current.set(id, resolve)

      // Set up error handler for this specific call
      const handleError = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === 'error') {
          readyCallbacksRef.current.delete(id)
          workerRef.current?.removeEventListener('message', handleError)
          reject(new Error(e.data.payload as string))
        }
      }
      workerRef.current.addEventListener('message', handleError)

      workerRef.current.postMessage({
        type: 'init',
        payload: {
          id,
          timeout: getDownloadTimeoutMs()
        }
      })
    })
  }, [])

  const removeObjects = useCallback(
    (
      imageData: Float32Array,
      maskData: Float32Array,
      width: number,
      height: number
    ): Promise<EraserResult> => {
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

        // Clone data to transfer
        const imageDataCopy = new Float32Array(imageData)
        const maskDataCopy = new Float32Array(maskData)

        workerRef.current.postMessage(
          {
            type: 'process',
            payload: {
              imageData: imageDataCopy,
              maskData: maskDataCopy,
              width,
              height,
              id
            }
          },
          { transfer: [imageDataCopy.buffer, maskDataCopy.buffer] }
        )
      })
    },
    []
  )

  const dispose = useCallback(() => {
    workerRef.current?.postMessage({ type: 'dispose' })
    isInitializedRef.current = false
  }, [])

  const isInitialized = useCallback(() => isInitializedRef.current, [])
  const hasFailed = useCallback(() => hasFailedRef.current, [])

  const retryWorker = useCallback(() => {
    createWorker()
  }, [createWorker])

  return { initModel, removeObjects, dispose, isInitialized, hasFailed, retryWorker }
}
