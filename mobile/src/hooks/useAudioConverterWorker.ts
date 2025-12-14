import { useCallback, useRef, useEffect } from 'react'

interface AudioConverterOptions {
  onProgress?: (progress: number) => void
  onError?: (error: string) => void
}

interface ConvertResult {
  data: ArrayBuffer
  filename: string
  mimeType: string
}

/**
 * Decode audio file to AudioBuffer using Web Audio API (main thread only)
 */
async function decodeAudioFile(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const audioContext = new AudioContext()
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    return audioBuffer
  } finally {
    await audioContext.close()
  }
}

/**
 * Extract channel data from AudioBuffer
 */
function extractChannelData(audioBuffer: AudioBuffer): Float32Array[] {
  const channels: Float32Array[] = []
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i))
  }
  return channels
}

export function useAudioConverterWorker(options: AudioConverterOptions = {}) {
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef<{
    resolve: (result: ConvertResult) => void
    reject: (error: Error) => void
  } | null>(null)
  const idRef = useRef(0)

  useEffect(() => {
    // Create worker
    workerRef.current = new Worker(
      new URL('../workers/audioConverter.worker.ts', import.meta.url),
      { type: 'module' }
    )

    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data

      switch (type) {
        case 'progress':
          options.onProgress?.(payload.progress)
          break
        case 'result':
          if (pendingRef.current) {
            pendingRef.current.resolve({
              data: payload.data,
              filename: payload.filename,
              mimeType: payload.mimeType
            })
            pendingRef.current = null
          }
          break
        case 'error':
          options.onError?.(payload)
          if (pendingRef.current) {
            pendingRef.current.reject(new Error(payload))
            pendingRef.current = null
          }
          break
      }
    }

    workerRef.current.onerror = (e) => {
      const errorMsg = e.message || 'Worker error'
      options.onError?.(errorMsg)
      if (pendingRef.current) {
        pendingRef.current.reject(new Error(errorMsg))
        pendingRef.current = null
      }
    }

    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, []) // Only create worker once

  const convert = useCallback(
    async (
      file: ArrayBuffer,
      fileName: string,
      outputFormat: 'mp3' | 'wav',
      bitrate: number = 192
    ): Promise<ConvertResult> => {
      if (!workerRef.current) {
        throw new Error('Worker not initialized')
      }

      const id = ++idRef.current

      // Decode audio in main thread (AudioContext not available in workers)
      console.log('[AudioConverter] Decoding audio file...')
      options.onProgress?.(2)

      const audioBuffer = await decodeAudioFile(file)
      console.log(`[AudioConverter] Decoded: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz`)

      // Extract channel data
      const channelData = extractChannelData(audioBuffer)

      return new Promise((resolve, reject) => {
        pendingRef.current = { resolve, reject }

        // Send decoded PCM data to worker for encoding
        workerRef.current!.postMessage({
          type: 'convert',
          payload: {
            channelData,
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: audioBuffer.numberOfChannels,
            outputFormat,
            bitrate,
            id
          }
        })
      })
    },
    []
  )

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'cancel' })
    }
    if (pendingRef.current) {
      pendingRef.current.reject(new Error('Cancelled'))
      pendingRef.current = null
    }
  }, [])

  return { convert, cancel }
}
