/**
 * Lightweight Audio Converter using lamejs
 * Much faster than FFmpeg WASM (~200KB vs ~24MB)
 *
 * Supported conversions:
 * - MP3 ↔ WAV (receives decoded PCM data from main thread)
 */

import { Mp3Encoder } from '@breezystack/lamejs'

interface ConvertPayload {
  // Decoded audio data from main thread
  channelData: Float32Array[] // Array of channel data
  sampleRate: number
  numberOfChannels: number
  outputFormat: 'mp3' | 'wav'
  bitrate?: number // kbps for MP3 (default: 192)
  id: number
}

/**
 * Convert PCM data to WAV format
 */
function pcmToWav(
  channelData: Float32Array[],
  sampleRate: number,
  numberOfChannels: number
): ArrayBuffer {
  const samples = channelData[0].length
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8

  // Calculate buffer size
  const dataSize = samples * numberOfChannels * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // WAV header helper
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  // RIFF header
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')

  // fmt chunk
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, numberOfChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numberOfChannels * bytesPerSample, true) // byte rate
  view.setUint16(32, numberOfChannels * bytesPerSample, true) // block align
  view.setUint16(34, bitDepth, true)

  // data chunk
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  // Write interleaved audio data
  let offset = 44
  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]))
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      view.setInt16(offset, intSample, true)
      offset += 2
    }
  }

  return buffer
}

/**
 * Convert PCM data to MP3 using lamejs
 */
function pcmToMp3(
  channelData: Float32Array[],
  sampleRate: number,
  numberOfChannels: number,
  bitrate: number,
  onProgress?: (progress: number) => void
): ArrayBuffer {
  const samples = channelData[0].length

  // Create MP3 encoder
  const mp3encoder = new Mp3Encoder(numberOfChannels, sampleRate, bitrate)
  const mp3Data: Int8Array[] = []

  // Get channel data
  const left = channelData[0]
  const right = numberOfChannels > 1 ? channelData[1] : channelData[0]

  // Convert to Int16
  const leftInt16 = new Int16Array(samples)
  const rightInt16 = new Int16Array(samples)

  for (let i = 0; i < samples; i++) {
    leftInt16[i] = Math.max(-32768, Math.min(32767, Math.floor(left[i] * 32768)))
    rightInt16[i] = Math.max(-32768, Math.min(32767, Math.floor(right[i] * 32768)))
  }

  // Encode in chunks
  const chunkSize = 1152 // MP3 frame size
  const totalChunks = Math.ceil(samples / chunkSize)

  for (let i = 0; i < samples; i += chunkSize) {
    const leftChunk = leftInt16.subarray(i, i + chunkSize)
    const rightChunk = rightInt16.subarray(i, i + chunkSize)

    let mp3buf: Int8Array
    if (numberOfChannels === 1) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk)
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk)
    }

    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf)
    }

    // Report progress
    const currentChunk = Math.floor(i / chunkSize)
    if (currentChunk % 50 === 0) {
      onProgress?.(Math.round((currentChunk / totalChunks) * 100))
    }
  }

  // Flush remaining data
  const mp3buf = mp3encoder.flush()
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf)
  }

  // Combine chunks
  const totalLength = mp3Data.reduce((acc, buf) => acc + buf.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const buf of mp3Data) {
    result.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.length), offset)
    offset += buf.length
  }

  return result.buffer
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  try {
    switch (type) {
      case 'convert': {
        const {
          channelData,
          sampleRate,
          numberOfChannels,
          outputFormat,
          bitrate = 192,
          id
        } = payload as ConvertPayload

        console.log(`[AudioConverter] Converting to ${outputFormat}, ${sampleRate}Hz, ${numberOfChannels}ch`)
        self.postMessage({ type: 'progress', payload: { progress: 5, id } })

        let outputBuffer: ArrayBuffer
        let mimeType: string

        if (outputFormat === 'mp3') {
          console.log(`[AudioConverter] Encoding to MP3 at ${bitrate}kbps...`)
          outputBuffer = pcmToMp3(channelData, sampleRate, numberOfChannels, bitrate, (progress) => {
            self.postMessage({ type: 'progress', payload: { progress: 5 + progress * 0.9, id } })
          })
          mimeType = 'audio/mpeg'
        } else {
          console.log('[AudioConverter] Converting to WAV...')
          outputBuffer = pcmToWav(channelData, sampleRate, numberOfChannels)
          mimeType = 'audio/wav'
          self.postMessage({ type: 'progress', payload: { progress: 95, id } })
        }

        console.log(`[AudioConverter] Done! Output size: ${(outputBuffer.byteLength / 1024 / 1024).toFixed(2)}MB`)

        self.postMessage({
          type: 'result',
          payload: {
            data: outputBuffer,
            filename: `output.${outputFormat}`,
            mimeType,
            id
          }
        }, { transfer: [outputBuffer] })
        break
      }

      case 'cancel': {
        // Not much to cancel in this simple implementation
        break
      }
    }
  } catch (error) {
    console.error('[AudioConverter] Error:', error)
    self.postMessage({ type: 'error', payload: (error as Error).message })
  }
}
