import { useCallback, useRef } from 'react'
import { Mp3Encoder } from '@breezystack/lamejs'

interface MergeOptions {
  onProgress?: (progress: number) => void
}

interface MergeResult {
  blob: Blob
}

/**
 * Native media merger using browser APIs
 * - Audio: Web Audio API + lamejs for MP3 encoding
 * - Video: HTML5 video + MediaRecorder API (plays videos sequentially)
 */
export function useNativeMediaMerger() {
  const abortRef = useRef(false)

  /**
   * Merge multiple audio files using Web Audio API
   */
  const mergeAudio = useCallback(async (
    files: File[],
    options?: MergeOptions
  ): Promise<MergeResult> => {
    abortRef.current = false
    const { onProgress } = options || {}

    onProgress?.(5)

    const audioContext = new AudioContext()
    const audioBuffers: AudioBuffer[] = []

    // Decode all audio files
    for (let i = 0; i < files.length; i++) {
      if (abortRef.current) throw new Error('Cancelled')

      const arrayBuffer = await files[i].arrayBuffer()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      audioBuffers.push(audioBuffer)

      onProgress?.(5 + (i + 1) / files.length * 25)
    }

    onProgress?.(30)

    // Calculate total length and verify sample rates match
    const sampleRate = audioBuffers[0].sampleRate
    const numberOfChannels = Math.max(...audioBuffers.map(b => b.numberOfChannels))
    let totalLength = 0

    for (const buffer of audioBuffers) {
      // Resample if needed (simple approach: use original length)
      totalLength += buffer.length
    }

    // Create merged buffer
    const mergedBuffer = audioContext.createBuffer(
      numberOfChannels,
      totalLength,
      sampleRate
    )

    // Copy audio data from each buffer
    let offset = 0
    for (let bufIdx = 0; bufIdx < audioBuffers.length; bufIdx++) {
      if (abortRef.current) throw new Error('Cancelled')

      const buffer = audioBuffers[bufIdx]
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const destData = mergedBuffer.getChannelData(channel)
        // If this buffer has fewer channels, use channel 0
        const sourceChannel = Math.min(channel, buffer.numberOfChannels - 1)
        const sourceData = buffer.getChannelData(sourceChannel)

        for (let i = 0; i < buffer.length; i++) {
          destData[offset + i] = sourceData[i]
        }
      }
      offset += buffer.length

      onProgress?.(30 + (bufIdx + 1) / audioBuffers.length * 20)
    }

    onProgress?.(50)

    // Determine output format - use MP3 for smaller file size
    const blob = await audioBufferToMp3(mergedBuffer, (p) => {
      onProgress?.(50 + p * 50)
    })

    await audioContext.close()

    return { blob }
  }, [])

  /**
   * Merge multiple video files by playing them sequentially and recording
   */
  const mergeVideo = useCallback(async (
    files: File[],
    options?: MergeOptions
  ): Promise<MergeResult> => {
    abortRef.current = false
    const { onProgress } = options || {}

    return new Promise((resolve, reject) => {
      onProgress?.(5)

      // Create video element for playback (muted to avoid sound during processing)
      const video = document.createElement('video')
      video.muted = true  // Mute playback, audio will still be captured via createMediaElementSource
      video.playsInline = true

      // Create canvas for video rendering
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!

      // Create audio context for capturing video audio (without playing through speakers)
      const audioContext = new AudioContext()
      const audioDestination = audioContext.createMediaStreamDestination()

      let mediaRecorder: MediaRecorder | null = null
      const chunks: Blob[] = []
      let currentFileIndex = 0
      let totalDuration = 0
      let playedDuration = 0
      const fileUrls: string[] = []

      // Pre-calculate total duration
      const getDurations = async () => {
        for (const file of files) {
          const url = URL.createObjectURL(file)
          fileUrls.push(url)

          await new Promise<void>((res) => {
            const tempVideo = document.createElement('video')
            tempVideo.src = url
            tempVideo.onloadedmetadata = () => {
              totalDuration += tempVideo.duration
              res()
            }
            tempVideo.onerror = () => res()
          })
        }
      }

      const cleanup = () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop()
        }
        fileUrls.forEach(url => URL.revokeObjectURL(url))
        video.remove()
        canvas.remove()
        audioContext.close()
      }

      const playNextVideo = async () => {
        if (currentFileIndex >= files.length) {
          // All videos played, stop recording
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop()
          }
          return
        }

        video.src = fileUrls[currentFileIndex]

        await new Promise<void>((res) => {
          video.onloadedmetadata = () => res()
        })

        // Set canvas size to match first video
        if (currentFileIndex === 0) {
          canvas.width = video.videoWidth || 1280
          canvas.height = video.videoHeight || 720
        }

        await video.play()
      }

      const startRecording = async () => {
        try {
          await getDurations()
          onProgress?.(10)

          // Set initial canvas size
          canvas.width = 1280
          canvas.height = 720

          // Create combined stream
          const canvasStream = canvas.captureStream(30)
          const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioDestination.stream.getAudioTracks()
          ])

          // Determine output format
          const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : MediaRecorder.isTypeSupported('video/webm')
              ? 'video/webm'
              : 'video/mp4'

          mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType,
            videoBitsPerSecond: 5000000
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
            resolve({ blob })
          }

          mediaRecorder.onerror = (e) => {
            cleanup()
            reject(new Error('MediaRecorder error: ' + e))
          }

          // Set up video element event handlers
          video.onended = () => {
            playedDuration += video.duration
            currentFileIndex++
            playNextVideo()
          }

          video.onerror = () => {
            cleanup()
            reject(new Error('Failed to load video'))
          }

          // Connect video audio to recorder (not to speakers since video is muted)
          video.onplay = () => {
            try {
              const source = audioContext.createMediaElementSource(video)
              source.connect(audioDestination)
              // Note: Do NOT connect to audioContext.destination as video is muted for silent processing
            } catch {
              // Already connected
            }
          }

          // Draw video frames to canvas
          const drawFrame = () => {
            if (abortRef.current) {
              cleanup()
              reject(new Error('Cancelled'))
              return
            }

            if (video.readyState >= 2) {
              // Scale video to fit canvas while maintaining aspect ratio
              const scale = Math.min(
                canvas.width / video.videoWidth,
                canvas.height / video.videoHeight
              )
              const w = video.videoWidth * scale
              const h = video.videoHeight * scale
              const x = (canvas.width - w) / 2
              const y = (canvas.height - h) / 2

              ctx.fillStyle = '#000'
              ctx.fillRect(0, 0, canvas.width, canvas.height)
              ctx.drawImage(video, x, y, w, h)
            }

            // Update progress
            const currentProgress = playedDuration + (video.currentTime || 0)
            const progress = totalDuration > 0
              ? 10 + (currentProgress / totalDuration) * 85
              : 10
            onProgress?.(Math.min(95, progress))

            if (mediaRecorder?.state === 'recording') {
              requestAnimationFrame(drawFrame)
            }
          }

          // Start recording and play first video
          mediaRecorder.start(100)
          drawFrame()
          await playNextVideo()

        } catch (err) {
          cleanup()
          reject(err)
        }
      }

      startRecording()
    })
  }, [])

  /**
   * Merge media files (auto-detect audio/video)
   */
  const merge = useCallback(async (
    files: File[],
    mediaType: 'audio' | 'video',
    options?: MergeOptions
  ): Promise<MergeResult> => {
    if (mediaType === 'audio') {
      return mergeAudio(files, options)
    } else {
      return mergeVideo(files, options)
    }
  }, [mergeAudio, mergeVideo])

  const cancel = useCallback(() => {
    abortRef.current = true
  }, [])

  return { merge, mergeAudio, mergeVideo, cancel }
}

/**
 * Convert AudioBuffer to MP3 blob using lamejs
 */
async function audioBufferToMp3(
  buffer: AudioBuffer,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const numChannels = Math.min(buffer.numberOfChannels, 2)
  const sampleRate = buffer.sampleRate
  const kbps = 128

  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps)
  const mp3Data: Int8Array[] = []

  const left = buffer.getChannelData(0)
  const right = numChannels > 1 ? buffer.getChannelData(1) : left

  const samples = buffer.length
  const leftInt16 = new Int16Array(samples)
  const rightInt16 = new Int16Array(samples)

  for (let i = 0; i < samples; i++) {
    leftInt16[i] = Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767)))
    rightInt16[i] = Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767)))
  }

  const chunkSize = 1152
  const totalChunks = Math.ceil(samples / chunkSize)

  for (let i = 0; i < samples; i += chunkSize) {
    const leftChunk = leftInt16.subarray(i, Math.min(i + chunkSize, samples))
    const rightChunk = rightInt16.subarray(i, Math.min(i + chunkSize, samples))

    const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk)
    if (mp3buf.length > 0) {
      mp3Data.push(new Int8Array(mp3buf))
    }

    const chunkIndex = Math.floor(i / chunkSize)
    onProgress?.(chunkIndex / totalChunks)
  }

  const mp3buf = encoder.flush()
  if (mp3buf.length > 0) {
    mp3Data.push(new Int8Array(mp3buf))
  }

  onProgress?.(1)

  const totalLength = mp3Data.reduce((acc, arr) => acc + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of mp3Data) {
    result.set(new Uint8Array(chunk.buffer), offset)
    offset += chunk.length
  }

  return new Blob([result], { type: 'audio/mp3' })
}
