import { useRef, useCallback, useEffect } from 'react'
import type { ProgressDetail } from '@/types/progress'
import { getDownloadTimeoutMs } from '@/stores/settingsStore'

interface FaceBox {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

interface DetectedFace {
  box: FaceBox
  landmarks: number[][]
  index: number
}

interface DetectResult {
  faces: DetectedFace[]
  imageId: 'source' | 'target'
  id: number
}

interface SwapResult {
  data: Float32Array
  width: number
  height: number
  id: number
}

interface WorkerMessage {
  type: 'ready' | 'phase' | 'progress' | 'detectResult' | 'swapResult' | 'error' | 'disposed'
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

interface UseFaceSwapperWorkerOptions {
  onPhase?: (phase: string) => void
  onProgress?: (phase: string, progress: number, detail?: ProgressDetail) => void
  onError?: (error: string) => void
}

interface SwapParams {
  sourceImage: ImageData
  sourceLandmarks: number[][]
  targetImage: ImageData
  targetFaces: { landmarks: number[][]; box: FaceBox }[]
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

      pixels[dstIdx] = Math.round(data[srcIdx] * 255) // R
      pixels[dstIdx + 1] = Math.round(data[srcIdx + 1] * 255) // G
      pixels[dstIdx + 2] = Math.round(data[srcIdx + 2] * 255) // B
      pixels[dstIdx + 3] = 255 // A
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

      result[dstIdx] = data[srcIdx] / 255 // R
      result[dstIdx + 1] = data[srcIdx + 1] / 255 // G
      result[dstIdx + 2] = data[srcIdx + 2] / 255 // B
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

export function useFaceSwapperWorker(options: UseFaceSwapperWorkerOptions = {}) {
  const workerRef = useRef<Worker | null>(null)
  const detectCallbacksRef = useRef<Map<number, (result: DetectedFace[]) => void>>(new Map())
  const swapCallbacksRef = useRef<Map<number, (result: { dataUrl: string }) => void>>(new Map())
  const idCounterRef = useRef(0)
  const optionsRef = useRef(options)
  const hasFailedRef = useRef(false)
  const isInitializedRef = useRef(false)

  // Keep options ref up to date
  optionsRef.current = options

  const createWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
    }
    hasFailedRef.current = false
    isInitializedRef.current = false

    workerRef.current = new Worker(
      new URL('../workers/faceSwapper.worker.ts', import.meta.url),
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
        case 'detectResult': {
          const { faces, id } = payload as DetectResult
          const callback = detectCallbacksRef.current.get(id)
          if (callback) {
            callback(faces)
            detectCallbacksRef.current.delete(id)
          }
          break
        }
        case 'swapResult': {
          const { data, width, height, id } = payload as SwapResult
          const callback = swapCallbacksRef.current.get(id)
          if (callback) {
            // Convert Float32Array to data URL
            const imageData = float32ToImageData(data, width, height)
            const dataUrl = imageDataToDataURL(imageData)
            callback({ dataUrl })
            swapCallbacksRef.current.delete(id)
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

  // Initialize worker
  useEffect(() => {
    createWorker()

    return () => {
      workerRef.current?.postMessage({ type: 'dispose' })
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [createWorker])

  const initModels = useCallback((enableEnhancement: boolean = false): Promise<void> => {
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
          timeout: getDownloadTimeoutMs(),
          enableEnhancement
        }
      })
    })
  }, [])

  const detectFaces = useCallback((
    imageData: ImageData,
    imageId: 'source' | 'target'
  ): Promise<DetectedFace[]> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      const id = idCounterRef.current++
      detectCallbacksRef.current.set(id, resolve)

      // Convert ImageData to Float32Array
      const float32Data = imageDataToFloat32(imageData)

      // Set up error handler
      const handleError = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === 'error') {
          detectCallbacksRef.current.delete(id)
          workerRef.current?.removeEventListener('message', handleError)
          reject(new Error(e.data.payload as string))
        }
      }
      workerRef.current.addEventListener('message', handleError)

      workerRef.current.postMessage(
        {
          type: 'detect',
          payload: {
            imageData: float32Data,
            width: imageData.width,
            height: imageData.height,
            imageId,
            id
          }
        },
        { transfer: [float32Data.buffer] }
      )
    })
  }, [])

  const swapFaces = useCallback((params: SwapParams): Promise<{ dataUrl: string }> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      const id = idCounterRef.current++
      swapCallbacksRef.current.set(id, resolve)

      // Convert ImageData to Float32Array
      const sourceFloat32 = imageDataToFloat32(params.sourceImage)
      const targetFloat32 = imageDataToFloat32(params.targetImage)

      // Set up error handler
      const handleError = (e: MessageEvent<WorkerMessage>) => {
        if (e.data.type === 'error') {
          swapCallbacksRef.current.delete(id)
          workerRef.current?.removeEventListener('message', handleError)
          reject(new Error(e.data.payload as string))
        }
      }
      workerRef.current.addEventListener('message', handleError)

      workerRef.current.postMessage(
        {
          type: 'swap',
          payload: {
            sourceImage: sourceFloat32,
            sourceWidth: params.sourceImage.width,
            sourceHeight: params.sourceImage.height,
            sourceLandmarks: params.sourceLandmarks,
            targetImage: targetFloat32,
            targetWidth: params.targetImage.width,
            targetHeight: params.targetImage.height,
            targetFaces: params.targetFaces,
            id
          }
        },
        { transfer: [sourceFloat32.buffer, targetFloat32.buffer] }
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

  return { initModels, detectFaces, swapFaces, dispose, hasFailed, retryWorker }
}

export type { DetectedFace, FaceBox }
