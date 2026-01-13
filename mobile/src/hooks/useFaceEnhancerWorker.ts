import { useRef, useCallback, useEffect } from 'react'
import type { ProgressDetail } from '@/types/progress'

interface EnhanceResult {
  data: Float32Array
  width: number
  height: number
  faces: number
  id: number
}

interface WorkerMessage {
  type: 'ready' | 'phase' | 'progress' | 'result' | 'error' | 'disposed'
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

interface UseFaceEnhancerWorkerOptions {
  onPhase?: (phase: string) => void
  onProgress?: (phase: string, progress: number, detail?: ProgressDetail) => void
  onError?: (error: string) => void
}

/**
 * Convert Float32Array HWC [0,1] to ImageData
 */
function float32ToImageData(
  data: Float32Array,
  width: number,
  height: number
): ImageData {
  const imageData = new ImageData(width, height)
  const pixels = imageData.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3
      const dstIdx = (y * width + x) * 4

      pixels[dstIdx] = Math.round(data[srcIdx] * 255)
      pixels[dstIdx + 1] = Math.round(data[srcIdx + 1] * 255)
      pixels[dstIdx + 2] = Math.round(data[srcIdx + 2] * 255)
      pixels[dstIdx + 3] = 255
    }
  }

  return imageData
}

/**
 * Convert ImageData to Float32Array HWC [0,1]
 */
function imageDataToFloat32(imageData: ImageData): Float32Array {
  const { width, height, data } = imageData
  const result = new Float32Array(width * height * 3)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4
      const dstIdx = (y * width + x) * 3

      result[dstIdx] = data[srcIdx] / 255
      result[dstIdx + 1] = data[srcIdx + 1] / 255
      result[dstIdx + 2] = data[srcIdx + 2] / 255
    }
  }

  return result
}

/**
 * Convert ImageData to data URL
 */
function imageDataToDataURL(imageData: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export function useFaceEnhancerWorker(options: UseFaceEnhancerWorkerOptions = {}) {
  const workerRef = useRef<Worker | null>(null)
  const callbacksRef = useRef<Map<number, (result: { dataUrl: string; faces: number }) => void>>(new Map())
  const idCounterRef = useRef(0)
  const optionsRef = useRef(options)
  const hasFailedRef = useRef(false)
  const isInitializedRef = useRef(false)

  optionsRef.current = options

  const createWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
    }
    hasFailedRef.current = false
    isInitializedRef.current = false

    workerRef.current = new Worker(
      new URL('../workers/faceEnhancer.worker.ts', import.meta.url),
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
          const { data, width, height, faces, id } = payload as EnhanceResult
          const callback = callbacksRef.current.get(id)
          if (callback) {
            const imageData = float32ToImageData(data, width, height)
            const dataUrl = imageDataToDataURL(imageData)
            callback({ dataUrl, faces })
            callbacksRef.current.delete(id)
          }
          break
        }
        case 'ready':
          isInitializedRef.current = true
          break
        case 'error':
          hasFailedRef.current = true
          optionsRef.current.onError?.(payload as string)
          break
      }
    }
  }, [])

  useEffect(() => {
    createWorker()

    return () => {
      workerRef.current?.postMessage({ type: 'dispose' })
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [createWorker])

  const initModel = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      if (isInitializedRef.current) {
        resolve()
        return
      }

      const id = idCounterRef.current++

      const handleMessage = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === 'ready') {
          workerRef.current?.removeEventListener('message', handleMessage)
          resolve()
        } else if (e.data.type === 'error') {
          workerRef.current?.removeEventListener('message', handleMessage)
          reject(new Error(e.data.payload as string))
        }
      }

      workerRef.current.addEventListener('message', handleMessage)
      workerRef.current.postMessage({
        type: 'init',
        payload: {
          id,
          timeout: 3600000 // 60 minutes
        }
      })
    })
  }, [])

  const enhance = useCallback((imageData: ImageData): Promise<{ dataUrl: string; faces: number }> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      const id = idCounterRef.current++
      callbacksRef.current.set(id, resolve)

      const float32Data = imageDataToFloat32(imageData)

      const handleError = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === 'error') {
          callbacksRef.current.delete(id)
          workerRef.current?.removeEventListener('message', handleError)
          reject(new Error(e.data.payload as string))
        }
      }
      workerRef.current.addEventListener('message', handleError)

      workerRef.current.postMessage(
        {
          type: 'enhance',
          payload: {
            imageData: float32Data,
            width: imageData.width,
            height: imageData.height,
            id
          }
        },
        { transfer: [float32Data.buffer] }
      )
    })
  }, [])

  const dispose = useCallback(() => {
    workerRef.current?.postMessage({ type: 'dispose' })
    isInitializedRef.current = false
  }, [])

  const hasFailed = useCallback(() => hasFailedRef.current, [])

  const retryWorker = useCallback(() => {
    createWorker()
  }, [createWorker])

  return { initModel, enhance, dispose, hasFailed, retryWorker }
}
