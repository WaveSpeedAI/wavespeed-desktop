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

        // Force CPU mode to avoid WebGPU compatibility issues with different ONNX Runtime versions
        // The @imgly/background-removal library has its own bundled ONNX Runtime that may conflict with global versions
        const config: Config = {
          model,
          device: 'cpu',
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

        // Start in process phase - download phase only emitted if library fetches model
        self.postMessage({
          type: 'phase',
          payload: { phase: 'process', id }
        })
        lastPhase = 'process'

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
          { transfer: [arrayBuffer] }
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

        // Total operations for progress calculation
        const totalOps = 3
        const downloadWeight = 10 // Download is 10% of total progress
        const processWeight = 90 // Processing is 90% of total progress
        const perOpWeight = processWeight / totalOps // 30% per operation

        // Force CPU mode to avoid WebGPU compatibility issues
        const createConfig = (opIndex: number): Config => ({
          model,
          device: 'cpu',
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

            // Calculate progress using opIndex for deterministic mapping:
            // Download: 0-10%, Op 0: 10-40%, Op 1: 40-70%, Op 2: 70-100%
            let overallProgress: number
            if (isDownload) {
              // Download progress scales to first 10%
              overallProgress = total > 0 ? (current / total) * downloadWeight : 0
            } else {
              // Each operation gets equal share of remaining 90%
              const opProgress = total > 0 ? (current / total) * 100 : 0
              overallProgress = downloadWeight + (opIndex * perOpWeight) + (opProgress / 100 * perOpWeight)
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

        // Start in process phase - download phase only emitted if library fetches model
        self.postMessage({
          type: 'phase',
          payload: { phase: 'process', id }
        })
        lastPhase = 'process'

        // Process all three outputs (model is cached after first call)
        const foregroundBlob = await removeBackground(imageBlob, createConfig(0))
        const backgroundBlob = await removeForeground(imageBlob, createConfig(1))
        const maskBlob = await segmentForeground(imageBlob, createConfig(2))

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
          { transfer: [foregroundBuffer, backgroundBuffer, maskBuffer] }
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
