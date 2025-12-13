import Upscaler from 'upscaler'
import * as tf from '@tensorflow/tfjs'

// Mobile only bundles slim models to keep APK size reasonable (~4MB)
// Medium and thick models would add ~11MB and ~100MB+ respectively
type ModelType = 'slim' | 'medium' | 'thick'
type ScaleType = '2x' | '3x' | '4x'

let upscaler: InstanceType<typeof Upscaler> | null = null
let backendInitialized = false

/**
 * Initialize TensorFlow.js backend with WebGL -> CPU fallback
 */
async function initBackend(): Promise<string> {
  if (backendInitialized) {
    return tf.getBackend()
  }

  // Try WebGL first (faster)
  try {
    await tf.setBackend('webgl')
    await tf.ready()

    // Test WebGL by creating a small tensor
    const testTensor = tf.tensor([1, 2, 3])
    testTensor.dispose()

    backendInitialized = true
    // WebGL backend initialized
    return 'webgl'
  } catch (e) {
    // WebGL backend fallback
  }

  // Fall back to CPU (slower but more compatible)
  try {
    await tf.setBackend('cpu')
    await tf.ready()
    backendInitialized = true
    // CPU backend initialized
    return 'cpu'
  } catch (e) {
    throw new Error('Failed to initialize any TensorFlow.js backend')
  }
}

const getModel = async (_model: ModelType, scale: ScaleType) => {
  // Mobile only bundles slim models - always use slim regardless of requested model type
  // This keeps APK size reasonable (~4MB vs 100MB+ for all models)
  const modelMap = {
    '2x': () => import('@upscalerjs/esrgan-slim/2x'),
    '3x': () => import('@upscalerjs/esrgan-slim/3x'),
    '4x': () => import('@upscalerjs/esrgan-slim/4x')
  }
  return (await modelMap[scale]()).default
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  try {
    switch (type) {
      case 'load': {
        const { model, scale, id } = payload as {
          model: ModelType
          scale: ScaleType
          id?: number
        }

        // Dispose previous upscaler if exists
        if (upscaler) {
          upscaler.dispose()
          upscaler = null
        }

        // Signal start of download phase
        self.postMessage({
          type: 'phase',
          payload: { phase: 'download', id }
        })

        self.postMessage({
          type: 'progress',
          payload: {
            phase: 'download',
            progress: 0,
            id
          }
        })

        // Initialize backend first
        const backend = await initBackend()

        self.postMessage({
          type: 'progress',
          payload: {
            phase: 'download',
            progress: 20,
            id
          }
        })

        const modelDef = await getModel(model, scale)

        self.postMessage({
          type: 'progress',
          payload: {
            phase: 'download',
            progress: 50,
            id
          }
        })

        upscaler = new Upscaler({ model: modelDef })

        self.postMessage({
          type: 'progress',
          payload: {
            phase: 'download',
            progress: 100,
            id
          }
        })

        self.postMessage({
          type: 'loaded',
          payload: { id, backend }
        })
        break
      }

      case 'upscale': {
        if (!upscaler) {
          throw new Error('Model not loaded')
        }

        const { imageData, id } = payload as { imageData: ImageData; id: number }

        // Signal start of process phase
        self.postMessage({
          type: 'phase',
          payload: { phase: 'process', id }
        })

        // Upscale using ImageData directly, output as tensor to avoid base64 issues in worker
        const result = await upscaler.upscale(imageData, {
          output: 'tensor',
          patchSize: 64,
          padding: 2,
          progress: (percent: number) => {
            // Emit standardized progress (percent is 0-1 from upscaler)
            self.postMessage({
              type: 'progress',
              payload: {
                phase: 'process',
                progress: percent * 100,
                detail: {
                  current: Math.round(percent * 100),
                  total: 100,
                  unit: 'percent' as const
                },
                id
              }
            })
          }
        })

        // Convert tensor to ImageData
        // Result tensor shape is [height, width, channels] (RGB, 3 channels)
        const [height, width, channels] = result.shape
        const data = await result.data()
        result.dispose()

        // Create Uint8ClampedArray for ImageData (needs RGBA, 4 channels)
        const pixelCount = width * height
        const uint8Data = new Uint8ClampedArray(pixelCount * 4)

        for (let i = 0; i < pixelCount; i++) {
          const srcIdx = i * channels
          const dstIdx = i * 4
          uint8Data[dstIdx] = Math.round(data[srcIdx]) // R
          uint8Data[dstIdx + 1] = Math.round(data[srcIdx + 1]) // G
          uint8Data[dstIdx + 2] = Math.round(data[srcIdx + 2]) // B
          uint8Data[dstIdx + 3] = 255 // A (fully opaque)
        }

        const resultImageData = new ImageData(uint8Data, width, height)

        // Transfer the buffer back to main thread for efficiency
        self.postMessage(
          {
            type: 'result',
            payload: {
              imageData: resultImageData,
              width,
              height,
              id
            }
          },
          { transfer: [resultImageData.data.buffer] }
        )
        break
      }

      case 'dispose': {
        if (upscaler) {
          upscaler.dispose()
          upscaler = null
        }
        self.postMessage({ type: 'disposed' })
        break
      }
    }
  } catch (error) {
    const errorMessage = (error as Error).message

    // Check for WebGL-specific errors and provide helpful message
    if (errorMessage.includes('shader') ||
        errorMessage.includes('WebGL') ||
        errorMessage.includes('CONTEXT_LOST')) {
      // Reset backend state to retry with CPU next time
      backendInitialized = false
      self.postMessage({
        type: 'error',
        payload: 'WebGL not supported on this device. Please try again (will use CPU mode).'
      })
    } else {
      self.postMessage({ type: 'error', payload: errorMessage })
    }
  }
}
