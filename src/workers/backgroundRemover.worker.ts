import {
  removeBackground,
  removeForeground,
  segmentForeground,
  type Config
} from '@imgly/background-removal'

type ModelType = 'isnet_quint8' | 'isnet_fp16' | 'isnet'
type OutputType = 'foreground' | 'background' | 'mask'

// Track last emitted phase to detect phase changes
let lastPhase = ''

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  try {
    switch (type) {
      case 'process': {
        const { imageBlob, model, outputType, id } = payload as {
          imageBlob: Blob
          model: ModelType
          outputType: OutputType
          id: number
        }

        // Reset phase tracking
        lastPhase = ''

        // Auto-detect GPU support
        const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator

        const config: Config = {
          model,
          device: hasGpu ? 'gpu' : 'cpu',
          output: {
            format: 'image/png',
            quality: 1
          },
          progress: (key: string, current: number, total: number) => {
            // Map library progress keys to standardized phases
            // Keys from @imgly/background-removal:
            // - fetch:* for model downloading
            // - compute:* for processing
            const isDownload = key.startsWith('fetch')
            const phase = isDownload ? 'download' : 'process'

            // Notify of phase change
            if (phase !== lastPhase) {
              self.postMessage({
                type: 'phase',
                payload: { phase, id }
              })
              lastPhase = phase
            }

            // Emit standardized progress
            self.postMessage({
              type: 'progress',
              payload: {
                phase,
                progress: total > 0 ? (current / total) * 100 : 0,
                detail: isDownload
                  ? { current, total, unit: 'bytes' as const }
                  : undefined,
                id
              }
            })
          }
        }

        // Signal start of download phase
        self.postMessage({
          type: 'phase',
          payload: { phase: 'download', id }
        })
        lastPhase = 'download'

        // Call the appropriate function based on output type
        let resultBlob: Blob
        switch (outputType) {
          case 'foreground':
            resultBlob = await removeBackground(imageBlob, config)
            break
          case 'background':
            resultBlob = await removeForeground(imageBlob, config)
            break
          case 'mask':
            resultBlob = await segmentForeground(imageBlob, config)
            break
          default:
            resultBlob = await removeBackground(imageBlob, config)
        }

        // Convert blob to ArrayBuffer for transfer
        const arrayBuffer = await resultBlob.arrayBuffer()

        self.postMessage(
          {
            type: 'result',
            payload: { arrayBuffer, id }
          },
          [arrayBuffer]
        )
        break
      }

      case 'processAll': {
        const { imageBlob, model, id } = payload as {
          imageBlob: Blob
          model: ModelType
          id: number
        }

        // Reset phase tracking
        lastPhase = ''

        // Auto-detect GPU support
        const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator

        // Track total progress across all three operations
        let completedOps = 0
        const totalOps = 3

        const createConfig = (opIndex: number): Config => ({
          model,
          device: hasGpu ? 'gpu' : 'cpu',
          output: {
            format: 'image/png',
            quality: 1
          },
          progress: (key: string, current: number, total: number) => {
            const isDownload = key.startsWith('fetch')
            const phase = isDownload ? 'download' : 'process'

            if (phase !== lastPhase) {
              self.postMessage({
                type: 'phase',
                payload: { phase, id }
              })
              lastPhase = phase
            }

            // Calculate progress: each op contributes 1/3 of total
            // Download phase is shared (model cached after first), so only count once
            let overallProgress: number
            if (isDownload) {
              overallProgress = total > 0 ? (current / total) * 100 : 0
            } else {
              const opProgress = total > 0 ? (current / total) * 100 : 0
              overallProgress = ((completedOps + opProgress / 100) / totalOps) * 100
            }

            self.postMessage({
              type: 'progress',
              payload: {
                phase,
                progress: Math.min(overallProgress, 100),
                detail: isDownload
                  ? { current, total, unit: 'bytes' as const }
                  : undefined,
                id
              }
            })
          }
        })

        // Signal start of download phase
        self.postMessage({
          type: 'phase',
          payload: { phase: 'download', id }
        })
        lastPhase = 'download'

        // Process all three outputs (model is cached after first call)
        const foregroundBlob = await removeBackground(imageBlob, createConfig(0))
        completedOps = 1

        const backgroundBlob = await removeForeground(imageBlob, createConfig(1))
        completedOps = 2

        const maskBlob = await segmentForeground(imageBlob, createConfig(2))
        completedOps = 3

        // Convert blobs to ArrayBuffers for transfer
        const foregroundBuffer = await foregroundBlob.arrayBuffer()
        const backgroundBuffer = await backgroundBlob.arrayBuffer()
        const maskBuffer = await maskBlob.arrayBuffer()

        self.postMessage(
          {
            type: 'resultAll',
            payload: {
              foreground: foregroundBuffer,
              background: backgroundBuffer,
              mask: maskBuffer,
              id
            }
          },
          [foregroundBuffer, backgroundBuffer, maskBuffer]
        )
        break
      }

      case 'dispose': {
        // Clean up if needed (library handles its own cleanup)
        self.postMessage({ type: 'disposed' })
        break
      }
    }
  } catch (error) {
    self.postMessage({ type: 'error', payload: (error as Error).message })
  }
}
