import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

let ffmpeg: FFmpeg | null = null
let isLoaded = false
let loadingPromise: Promise<void> | null = null
let currentOperationId: number | null = null

interface ConvertOptions {
  videoCodec?: string
  videoBitrate?: string
  resolution?: string
  fps?: number
  audioCodec?: string
  audioBitrate?: string
  sampleRate?: number
  quality?: number
}

interface ConvertPayload {
  file: ArrayBuffer
  fileName: string
  outputFormat: string
  outputExt: string
  options?: ConvertOptions
  id: number
}

interface MergePayload {
  files: ArrayBuffer[]
  fileNames: string[]
  outputFormat: string
  outputExt: string
  id: number
}

interface TrimPayload {
  file: ArrayBuffer
  fileName: string
  startTime: number
  endTime: number
  outputFormat: string
  outputExt: string
  id: number
}

interface InfoPayload {
  file: ArrayBuffer
  fileName: string
  id: number
}

const BASE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm'

async function ensureLoaded(onProgress?: (progress: number) => void): Promise<FFmpeg> {
  if (isLoaded && ffmpeg) return ffmpeg

  if (loadingPromise) {
    await loadingPromise
    return ffmpeg!
  }

  loadingPromise = (async () => {
    ffmpeg = new FFmpeg()

    onProgress?.(10)
    const coreURL = await toBlobURL(`${BASE_URL}/ffmpeg-core.js`, 'text/javascript')

    onProgress?.(50)
    const wasmURL = await toBlobURL(`${BASE_URL}/ffmpeg-core.wasm`, 'application/wasm')

    onProgress?.(90)
    await ffmpeg.load({ coreURL, wasmURL })

    isLoaded = true
    onProgress?.(100)
  })()

  await loadingPromise
  return ffmpeg!
}

function buildConvertArgs(
  inputFile: string,
  outputFile: string,
  outputFormat: string,
  options?: ConvertOptions
): string[] {
  const args: string[] = ['-i', inputFile]

  // Image conversion
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(outputFormat)) {
    if (options?.quality && ['jpg', 'jpeg', 'webp'].includes(outputFormat)) {
      if (outputFormat === 'webp') {
        args.push('-quality', String(options.quality))
      } else {
        const qscale = Math.round(31 - (options.quality / 100) * 29)
        args.push('-qscale:v', String(qscale))
      }
    }
    args.push('-frames:v', '1', '-update', '1', outputFile)
    return args
  }

  // Video/Audio options
  if (options?.videoCodec) args.push('-c:v', options.videoCodec)
  if (options?.videoBitrate) args.push('-b:v', options.videoBitrate)
  if (options?.resolution && options.resolution !== 'original') {
    args.push('-vf', `scale=${options.resolution.replace('x', ':')}`)
  }
  if (options?.fps) args.push('-r', String(options.fps))
  if (options?.audioCodec) args.push('-c:a', options.audioCodec)
  if (options?.audioBitrate) args.push('-b:a', options.audioBitrate)
  if (options?.sampleRate) args.push('-ar', String(options.sampleRate))

  args.push(outputFile)
  return args
}

function parseDuration(log: string): number | null {
  const match = log.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/)
  if (match) {
    return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 100
  }
  return null
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  try {
    switch (type) {
      case 'load': {
        self.postMessage({ type: 'phase', payload: { phase: 'download' } })
        await ensureLoaded((progress) => {
          self.postMessage({ type: 'progress', payload: { phase: 'download', progress } })
        })
        self.postMessage({ type: 'loaded' })
        break
      }

      case 'convert': {
        const { file, fileName, outputFormat, outputExt, options, id } = payload as ConvertPayload
        currentOperationId = id

        self.postMessage({ type: 'phase', payload: { phase: 'download', id } })
        const ff = await ensureLoaded((progress) => {
          self.postMessage({ type: 'progress', payload: { phase: 'download', progress, id } })
        })

        self.postMessage({ type: 'phase', payload: { phase: 'process', id } })

        await ff.writeFile(fileName, new Uint8Array(file))

        let totalDuration: number | null = null
        ff.on('log', ({ message }) => {
          if (!totalDuration) totalDuration = parseDuration(message)
        })

        ff.on('progress', ({ progress, time }) => {
          if (currentOperationId !== id) return
          self.postMessage({
            type: 'progress',
            payload: {
              phase: 'process',
              progress: progress * 100,
              detail: totalDuration ? { current: Math.floor(time / 1000000), total: Math.floor(totalDuration), unit: 'seconds' } : undefined,
              id
            }
          })
        })

        const outputFile = `output.${outputExt}`
        await ff.exec(buildConvertArgs(fileName, outputFile, outputFormat, options))

        const data = await ff.readFile(outputFile)
        await ff.deleteFile(fileName)
        await ff.deleteFile(outputFile)

        const buffer = (data as Uint8Array).buffer
        self.postMessage({ type: 'result', payload: { data: buffer, filename: outputFile, id } }, { transfer: [buffer] })
        currentOperationId = null
        break
      }

      case 'merge': {
        const { files, fileNames, outputFormat: _outputFormat, outputExt, id } = payload as MergePayload
        currentOperationId = id

        self.postMessage({ type: 'phase', payload: { phase: 'download', id } })
        const ff = await ensureLoaded((progress) => {
          self.postMessage({ type: 'progress', payload: { phase: 'download', progress, id } })
        })

        self.postMessage({ type: 'phase', payload: { phase: 'process', id } })

        for (let i = 0; i < files.length; i++) {
          await ff.writeFile(fileNames[i], new Uint8Array(files[i]))
        }

        const concatList = fileNames.map(name => `file '${name}'`).join('\n')
        await ff.writeFile('concat.txt', concatList)

        ff.on('progress', ({ progress }) => {
          if (currentOperationId !== id) return
          self.postMessage({ type: 'progress', payload: { phase: 'process', progress: progress * 100, id } })
        })

        const outputFile = `output.${outputExt}`
        await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', outputFile])

        const data = await ff.readFile(outputFile)
        for (const name of fileNames) await ff.deleteFile(name)
        await ff.deleteFile('concat.txt')
        await ff.deleteFile(outputFile)

        const buffer = (data as Uint8Array).buffer
        self.postMessage({ type: 'result', payload: { data: buffer, filename: outputFile, id } }, { transfer: [buffer] })
        currentOperationId = null
        break
      }

      case 'trim': {
        const { file, fileName, startTime, endTime, outputFormat: _outputFormat, outputExt, id } = payload as TrimPayload
        currentOperationId = id

        self.postMessage({ type: 'phase', payload: { phase: 'download', id } })
        const ff = await ensureLoaded((progress) => {
          self.postMessage({ type: 'progress', payload: { phase: 'download', progress, id } })
        })

        self.postMessage({ type: 'phase', payload: { phase: 'process', id } })

        await ff.writeFile(fileName, new Uint8Array(file))
        const duration = endTime - startTime

        ff.on('progress', ({ progress }) => {
          if (currentOperationId !== id) return
          self.postMessage({
            type: 'progress',
            payload: {
              phase: 'process',
              progress: progress * 100,
              detail: { current: Math.floor(progress * duration), total: Math.floor(duration), unit: 'seconds' },
              id
            }
          })
        })

        const outputFile = `output.${outputExt}`
        await ff.exec(['-ss', String(startTime), '-i', fileName, '-t', String(duration), '-c', 'copy', outputFile])

        const data = await ff.readFile(outputFile)
        await ff.deleteFile(fileName)
        await ff.deleteFile(outputFile)

        const buffer = (data as Uint8Array).buffer
        self.postMessage({ type: 'result', payload: { data: buffer, filename: outputFile, id } }, { transfer: [buffer] })
        currentOperationId = null
        break
      }

      case 'getInfo': {
        const { file, fileName, id } = payload as InfoPayload
        const ff = await ensureLoaded()

        await ff.writeFile(fileName, new Uint8Array(file))

        let logOutput = ''
        ff.on('log', ({ message }) => { logOutput += message + '\n' })

        try {
          await ff.exec(['-i', fileName, '-f', 'null', '-'])
        } catch {
          // Expected to fail, but logs contain info
        }

        const duration = parseDuration(logOutput)
        const resMatch = logOutput.match(/(\d{2,4})x(\d{2,4})/)
        const videoCodecMatch = logOutput.match(/Video: (\w+)/)
        const audioCodecMatch = logOutput.match(/Audio: (\w+)/)

        await ff.deleteFile(fileName)

        self.postMessage({
          type: 'info',
          payload: {
            duration,
            resolution: resMatch ? { width: parseInt(resMatch[1]), height: parseInt(resMatch[2]) } : null,
            videoCodec: videoCodecMatch?.[1] || null,
            audioCodec: audioCodecMatch?.[1] || null,
            id
          }
        })
        break
      }

      case 'cancel': {
        currentOperationId = null
        break
      }

      case 'dispose': {
        ffmpeg = null
        isLoaded = false
        loadingPromise = null
        self.postMessage({ type: 'disposed' })
        break
      }
    }
  } catch (error) {
    self.postMessage({ type: 'error', payload: (error as Error).message })
  }
}
