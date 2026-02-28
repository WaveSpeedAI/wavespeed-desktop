const CDN_BASE_URLS = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm',
  'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm',
]

interface FFmpegCore {
  FS: {
    writeFile(path: string, data: Uint8Array | string): void
    readFile(path: string, opts?: { encoding?: string }): Uint8Array | string
    unlink(path: string): void
    mkdir(path: string): void
    readdir(path: string): string[]
    stat(path: string): { mode: number }
    isDir(mode: number): boolean
  }
  exec(...args: string[]): void
  ret: number
  reset(): void
  setTimeout(timeout: number): void
  setLogger(cb: (data: { type: string; message: string }) => void): void
  setProgress(cb: (data: { progress: number; time: number }) => void): void
}

async function fetchValidated(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`)
  return resp.arrayBuffer()
}

function toBlobURL(buf: ArrayBuffer, mimeType: string): string {
  return URL.createObjectURL(new Blob([buf], { type: mimeType }))
}

async function fetchFromCDNs(filename: string): Promise<ArrayBuffer> {
  let lastErr: Error | null = null
  for (const base of CDN_BASE_URLS) {
    try {
      const buf = await fetchValidated(`${base}/${filename}`)
      if (filename.endsWith('.wasm')) {
        const magic = new Uint8Array(buf, 0, 4)
        if (magic[0] !== 0x00 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
          throw new Error(`Invalid WASM from ${base}/${filename}`)
        }
      }
      return buf
    } catch (e) {
      lastErr = e as Error
    }
  }
  throw lastErr ?? new Error(`Failed to fetch ${filename} from all CDNs`)
}

let ffmpegCore: FFmpegCore | null = null
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

async function ensureLoaded(onProgress?: (progress: number) => void): Promise<FFmpegCore> {
  if (isLoaded && ffmpegCore) return ffmpegCore

  if (loadingPromise) {
    await loadingPromise
    return ffmpegCore!
  }

  loadingPromise = (async () => {
    onProgress?.(5)
    const coreBuf = await fetchFromCDNs('ffmpeg-core.js')

    onProgress?.(40)
    const wasmBuf = await fetchFromCDNs('ffmpeg-core.wasm')

    onProgress?.(80)

    // Import the core module directly — bypasses @ffmpeg/ffmpeg's internal
    // Worker layer which always derives a workerURL and causes the load to hang
    // when @ffmpeg/core is the single-thread build (no .worker.js file).
    const coreURL = toBlobURL(coreBuf, 'text/javascript')
    const coreFactory = (await import(/* @vite-ignore */ coreURL)).default as (
      config: Record<string, unknown>
    ) => Promise<FFmpegCore>

    // Pass wasmBinary directly so Emscripten skips its own fetch of the .wasm
    // file (which would fail because import.meta.url is a blob URL).
    ffmpegCore = await coreFactory({
      wasmBinary: wasmBuf,
    })

    isLoaded = true
    onProgress?.(100)
  })()

  try {
    await loadingPromise
    return ffmpegCore!
  } catch (error) {
    loadingPromise = null
    isLoaded = false
    ffmpegCore = null
    throw error
  }
}

function buildConvertArgs(
  inputFile: string,
  outputFile: string,
  outputFormat: string,
  options?: ConvertOptions
): string[] {
  const args: string[] = ['-i', inputFile]

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

  if (options?.videoCodec) args.push('-c:v', options.videoCodec)
  if (options?.videoBitrate) args.push('-b:v', options.videoBitrate)
  if (options?.audioCodec) args.push('-c:a', options.audioCodec)
  if (options?.audioBitrate) args.push('-b:a', options.audioBitrate)

  if (options?.resolution && options.resolution !== 'original') {
    args.push('-vf', `scale=${options.resolution.replace('x', ':')}`)
  }
  if (options?.fps) args.push('-r', String(options.fps))
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

function runExec(ff: FFmpegCore, args: string[]): number {
  ff.exec(...args)
  const ret = ff.ret
  ff.reset()
  return ret
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

        const inputExt = fileName.split('.').pop() || 'bin'
        const safeInput = `input.${inputExt}`
        ff.FS.writeFile(safeInput, new Uint8Array(file))

        let totalDuration: number | null = null
        ff.setLogger(({ message }) => {
          if (!totalDuration) totalDuration = parseDuration(message)
        })

        ff.setProgress(({ progress, time }) => {
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
        runExec(ff, buildConvertArgs(safeInput, outputFile, outputFormat, options))

        const data = ff.FS.readFile(outputFile) as Uint8Array
        ff.FS.unlink(safeInput)
        ff.FS.unlink(outputFile)

        const buffer = data.buffer
        self.postMessage({ type: 'result', payload: { data: buffer, filename: outputFile, id } }, { transfer: [buffer] })
        currentOperationId = null
        break
      }

      case 'merge': {
        const { files, fileNames, outputFormat: _outputFormat, outputExt, id } = payload as MergePayload
        currentOperationId = id

        // Phase 1: Load FFmpeg
        self.postMessage({ type: 'phase', payload: { phase: 'download', id } })
        const ff = await ensureLoaded((progress) => {
          self.postMessage({ type: 'progress', payload: { phase: 'download', progress, id } })
        })

        const isAudioOnly = ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'wma'].includes(outputExt)
        const total = files.length

        const safeNames: string[] = []
        for (let i = 0; i < files.length; i++) {
          const ext = fileNames[i].split('.').pop() || outputExt
          const safeName = `input_${i}.${ext}`
          ff.FS.writeFile(safeName, new Uint8Array(files[i]))
          safeNames.push(safeName)
        }

        // Phase 2: Transcode each input to uniform intermediate format
        self.postMessage({ type: 'phase', payload: { phase: 'transcode', id } })

        const intermediateNames: string[] = []
        for (let i = 0; i < safeNames.length; i++) {
          const fileProgress = (i / total) * 100
          self.postMessage({
            type: 'progress',
            payload: { phase: 'transcode', progress: fileProgress, detail: { current: i + 1, total, unit: 'items' }, id }
          })

          if (isAudioOnly) {
            const intName = `intermediate_${i}.wav`
            const ret = runExec(ff, ['-i', safeNames[i], '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', intName])
            if (ret !== 0) {
              throw new Error(`Failed to transcode input ${i + 1} (${fileNames[i]})`)
            }
            intermediateNames.push(intName)
          } else {
            const intName = `intermediate_${i}.ts`

            let probeLog = ''
            ff.setLogger(({ message }) => { probeLog += message + '\n' })
            try { runExec(ff, ['-i', safeNames[i], '-f', 'null', '-']) } catch { /* probe may fail */ }
            ff.setLogger(() => {})

            const hasAudio = /Audio:/.test(probeLog)

            const encodeArgs = ['-i', safeNames[i]]
            if (!hasAudio) {
              encodeArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo')
              encodeArgs.push('-shortest')
            }
            encodeArgs.push(
              '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
              '-f', 'mpegts', intName
            )

            const ret = runExec(ff, encodeArgs)
            if (ret !== 0) {
              throw new Error(`Failed to transcode input ${i + 1} (${fileNames[i]})`)
            }
            intermediateNames.push(intName)
          }
          ff.FS.unlink(safeNames[i])
        }

        self.postMessage({
          type: 'progress',
          payload: { phase: 'transcode', progress: 100, detail: { current: total, total, unit: 'items' }, id }
        })

        // Phase 3: Concatenate intermediates into final output
        self.postMessage({ type: 'phase', payload: { phase: 'merge', id } })

        const concatContent = intermediateNames.map(name => `file '${name}'`).join('\n')
        ff.FS.writeFile('concat.txt', new TextEncoder().encode(concatContent))

        ff.setProgress(({ progress }) => {
          if (currentOperationId !== id) return
          self.postMessage({ type: 'progress', payload: { phase: 'merge', progress: progress * 100, id } })
        })

        const outputFile = `output.${outputExt}`
        if (isAudioOnly) {
          const ret = runExec(ff, ['-f', 'concat', '-safe', '0', '-i', 'concat.txt', outputFile])
          if (ret !== 0) throw new Error('Failed to merge audio files')
        } else {
          const ret = runExec(ff, ['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', outputFile])
          if (ret !== 0) throw new Error('Failed to merge video files')
        }

        const data = ff.FS.readFile(outputFile) as Uint8Array
        for (const name of intermediateNames) ff.FS.unlink(name)
        ff.FS.unlink('concat.txt')
        ff.FS.unlink(outputFile)

        const buffer = data.buffer
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

        const trimInputExt = fileName.split('.').pop() || 'bin'
        const safeTrimInput = `input.${trimInputExt}`
        ff.FS.writeFile(safeTrimInput, new Uint8Array(file))
        const duration = endTime - startTime

        ff.setProgress(({ progress }) => {
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
        runExec(ff, ['-ss', String(startTime), '-i', safeTrimInput, '-t', String(duration), '-c', 'copy', outputFile])

        const data = ff.FS.readFile(outputFile) as Uint8Array
        ff.FS.unlink(safeTrimInput)
        ff.FS.unlink(outputFile)

        const buffer = data.buffer
        self.postMessage({ type: 'result', payload: { data: buffer, filename: outputFile, id } }, { transfer: [buffer] })
        currentOperationId = null
        break
      }

      case 'getInfo': {
        const { file, fileName, id } = payload as InfoPayload
        const ff = await ensureLoaded()

        const infoInputExt = fileName.split('.').pop() || 'bin'
        const safeInfoInput = `input.${infoInputExt}`
        ff.FS.writeFile(safeInfoInput, new Uint8Array(file))

        let logOutput = ''
        ff.setLogger(({ message }) => { logOutput += message + '\n' })

        try {
          runExec(ff, ['-i', safeInfoInput, '-f', 'null', '-'])
        } catch {
          // Expected to fail for info probing, but logs contain the metadata
        }

        const duration = parseDuration(logOutput)
        const resMatch = logOutput.match(/(\d{2,4})x(\d{2,4})/)
        const videoCodecMatch = logOutput.match(/Video: (\w+)/)
        const audioCodecMatch = logOutput.match(/Audio: (\w+)/)

        ff.FS.unlink(safeInfoInput)

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
        ffmpegCore = null
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
