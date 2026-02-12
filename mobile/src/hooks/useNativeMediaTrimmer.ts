import { useCallback, useRef } from 'react'
import { Mp3Encoder } from '@breezystack/lamejs'

interface TrimOptions {
  onProgress?: (progress: number) => void
}

interface TrimResult {
  blob: Blob
  duration: number
}

/**
 * Native media trimmer using browser APIs
 * - Audio: Web Audio API + lamejs for MP3 encoding
 * - Video: HTML5 video + MediaRecorder API
 */
export function useNativeMediaTrimmer() {
  const abortRef = useRef(false)

  /**
   * Trim audio file using Web Audio API
   */
  const trimAudio = useCallback(async (
    file: File,
    startTime: number,
    endTime: number,
    options?: TrimOptions
  ): Promise<TrimResult> => {
    abortRef.current = false
    const { onProgress } = options || {}

    onProgress?.(5)

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()

    onProgress?.(10)

    // Decode audio using Web Audio API
    const audioContext = new AudioContext()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

    onProgress?.(20)

    // Calculate sample range
    const sampleRate = audioBuffer.sampleRate
    const numberOfChannels = audioBuffer.numberOfChannels
    const startSample = Math.floor(startTime * sampleRate)
    const endSample = Math.floor(endTime * sampleRate)
    const trimmedLength = endSample - startSample

    // Create trimmed buffer
    const trimmedBuffer = audioContext.createBuffer(
      numberOfChannels,
      trimmedLength,
      sampleRate
    )

    // Copy trimmed data
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel)
      const destData = trimmedBuffer.getChannelData(channel)
      for (let i = 0; i < trimmedLength; i++) {
        if (abortRef.current) throw new Error('Cancelled')
        destData[i] = sourceData[startSample + i]
      }
    }

    onProgress?.(40)

    // Determine output format based on input
    const ext = file.name.split('.').pop()?.toLowerCase()
    const isWav = ext === 'wav'

    let blob: Blob

    if (isWav) {
      // Export as WAV
      blob = audioBufferToWav(trimmedBuffer)
      onProgress?.(100)
    } else {
      // Export as MP3
      blob = await audioBufferToMp3(trimmedBuffer, (p) => {
        onProgress?.(40 + p * 0.6)
      })
    }

    await audioContext.close()

    return {
      blob,
      duration: endTime - startTime
    }
  }, [])

  /**
   * Trim video file using MediaRecorder API
   */
  const trimVideo = useCallback(async (
    file: File,
    startTime: number,
    endTime: number,
    options?: TrimOptions
  ): Promise<TrimResult> => {
    abortRef.current = false
    const { onProgress } = options || {}

    return new Promise((resolve, reject) => {
      onProgress?.(5)

      // Create video element
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true

      const url = URL.createObjectURL(file)
      video.src = url

      const chunks: Blob[] = []
      let mediaRecorder: MediaRecorder | null = null
      let stream: MediaStream | null = null

      const cleanup = () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop()
        }
        if (stream) {
          stream.getTracks().forEach(track => track.stop())
        }
        URL.revokeObjectURL(url)
        video.remove()
      }

      video.onloadedmetadata = async () => {
        try {
          onProgress?.(10)

          // Seek to start time
          video.currentTime = startTime

          await new Promise<void>((res) => {
            video.onseeked = () => res()
          })

          onProgress?.(15)

          // Capture stream from video
          // @ts-ignore - captureStream is available on video elements
          stream = video.captureStream ? video.captureStream() : video.mozCaptureStream?.()

          if (!stream) {
            throw new Error('captureStream not supported in this browser')
          }

          // Determine output format
          const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : MediaRecorder.isTypeSupported('video/webm')
              ? 'video/webm'
              : 'video/mp4'

          mediaRecorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 5000000 // 5 Mbps
          })

          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
              chunks.push(e.data)
            }
          }

          mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
            cleanup()
            onProgress?.(100)
            resolve({
              blob,
              duration: endTime - startTime
            })
          }

          mediaRecorder.onerror = (e) => {
            cleanup()
            reject(new Error('MediaRecorder error: ' + e))
          }

          // Start recording
          mediaRecorder.start(100) // Collect data every 100ms

          onProgress?.(20)

          // Play video
          await video.play()

          // Update progress during playback
          const duration = endTime - startTime
          const progressInterval = setInterval(() => {
            if (abortRef.current) {
              clearInterval(progressInterval)
              cleanup()
              reject(new Error('Cancelled'))
              return
            }

            const elapsed = video.currentTime - startTime
            const progress = Math.min(20 + (elapsed / duration) * 75, 95)
            onProgress?.(progress)
          }, 100)

          // Stop when end time is reached
          const checkEnd = () => {
            if (video.currentTime >= endTime || video.ended) {
              clearInterval(progressInterval)
              video.pause()
              if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop()
              }
            } else {
              requestAnimationFrame(checkEnd)
            }
          }
          checkEnd()

        } catch (err) {
          cleanup()
          reject(err)
        }
      }

      video.onerror = () => {
        cleanup()
        reject(new Error('Failed to load video'))
      }
    })
  }, [])

  /**
   * Trim media file (auto-detect audio/video)
   */
  const trim = useCallback(async (
    file: File,
    startTime: number,
    endTime: number,
    mediaType: 'audio' | 'video',
    options?: TrimOptions
  ): Promise<TrimResult> => {
    if (mediaType === 'audio') {
      return trimAudio(file, startTime, endTime, options)
    } else {
      return trimVideo(file, startTime, endTime, options)
    }
  }, [trimAudio, trimVideo])

  const cancel = useCallback(() => {
    abortRef.current = true
  }, [])

  return { trim, trimAudio, trimVideo, cancel }
}

/**
 * Convert AudioBuffer to WAV blob
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const format = 1 // PCM
  const bitDepth = 16

  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  const dataLength = buffer.length * blockAlign
  const bufferLength = 44 + dataLength

  const arrayBuffer = new ArrayBuffer(bufferLength)
  const view = new DataView(arrayBuffer)

  // WAV header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, bufferLength - 8, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, format, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  // Write audio data
  const channels: Float32Array[] = []
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i))
  }

  let offset = 44
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]))
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      view.setInt16(offset, int16, true)
      offset += 2
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/**
 * Convert AudioBuffer to MP3 blob using lamejs
 */
async function audioBufferToMp3(
  buffer: AudioBuffer,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const numChannels = Math.min(buffer.numberOfChannels, 2) // MP3 supports max 2 channels
  const sampleRate = buffer.sampleRate
  const kbps = 128

  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps)
  const mp3Data: Int8Array[] = []

  // Get channel data
  const left = buffer.getChannelData(0)
  const right = numChannels > 1 ? buffer.getChannelData(1) : left

  // Convert to Int16
  const samples = buffer.length
  const leftInt16 = new Int16Array(samples)
  const rightInt16 = new Int16Array(samples)

  for (let i = 0; i < samples; i++) {
    leftInt16[i] = Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767)))
    rightInt16[i] = Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767)))
  }

  // Encode in chunks
  const chunkSize = 1152
  const totalChunks = Math.ceil(samples / chunkSize)

  for (let i = 0; i < samples; i += chunkSize) {
    const leftChunk = leftInt16.subarray(i, Math.min(i + chunkSize, samples))
    const rightChunk = rightInt16.subarray(i, Math.min(i + chunkSize, samples))

    const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk)
    if (mp3buf.length > 0) {
      mp3Data.push(new Int8Array(mp3buf))
    }

    // Report progress
    const chunkIndex = Math.floor(i / chunkSize)
    onProgress?.(chunkIndex / totalChunks)
  }

  // Flush remaining data
  const mp3buf = encoder.flush()
  if (mp3buf.length > 0) {
    mp3Data.push(new Int8Array(mp3buf))
  }

  onProgress?.(1)

  // Combine all chunks
  const totalLength = mp3Data.reduce((acc, arr) => acc + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of mp3Data) {
    result.set(new Uint8Array(chunk.buffer), offset)
    offset += chunk.length
  }

  return new Blob([result], { type: 'audio/mp3' })
}
