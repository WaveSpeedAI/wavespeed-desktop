import Upscaler from 'upscaler'

type ModelType = 'slim' | 'medium' | 'thick'
type ScaleType = '2x' | '3x' | '4x'

let upscaler: InstanceType<typeof Upscaler> | null = null
let currentScale: number = 2

const getModel = async (model: ModelType, scale: ScaleType) => {
  const modelMap = {
    slim: {
      '2x': () => import('@upscalerjs/esrgan-slim/2x'),
      '3x': () => import('@upscalerjs/esrgan-slim/3x'),
      '4x': () => import('@upscalerjs/esrgan-slim/4x'),
    },
    medium: {
      '2x': () => import('@upscalerjs/esrgan-medium/2x'),
      '3x': () => import('@upscalerjs/esrgan-medium/3x'),
      '4x': () => import('@upscalerjs/esrgan-medium/4x'),
    },
    thick: {
      '2x': () => import('@upscalerjs/esrgan-thick/2x'),
      '3x': () => import('@upscalerjs/esrgan-thick/3x'),
      '4x': () => import('@upscalerjs/esrgan-thick/4x'),
    },
  }
  return (await modelMap[model][scale]()).default
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  try {
    switch (type) {
      case 'load': {
        const { model, scale } = payload as { model: ModelType; scale: ScaleType }

        // Dispose previous upscaler if exists
        if (upscaler) {
          upscaler.dispose()
          upscaler = null
        }

        currentScale = parseInt(scale.replace('x', ''))

        self.postMessage({ type: 'status', payload: 'downloading' })

        const modelDef = await getModel(model, scale)
        upscaler = new Upscaler({ model: modelDef })

        // Warmup to force model download
        await upscaler.warmup([{ patchSize: 64, padding: 2 }])

        self.postMessage({ type: 'loaded' })
        break
      }

      case 'upscale': {
        if (!upscaler) {
          throw new Error('Model not loaded')
        }

        const { imageData, id } = payload as { imageData: ImageData; id: number }

        // Upscale using ImageData directly, output as tensor to avoid base64 issues in worker
        const result = await upscaler.upscale(imageData, {
          output: 'tensor',
          patchSize: 64,
          padding: 2,
          progress: (percent: number) => {
            self.postMessage({ type: 'progress', payload: { percent, id } })
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
          uint8Data[dstIdx] = Math.round(data[srcIdx])       // R
          uint8Data[dstIdx + 1] = Math.round(data[srcIdx + 1]) // G
          uint8Data[dstIdx + 2] = Math.round(data[srcIdx + 2]) // B
          uint8Data[dstIdx + 3] = 255                          // A (fully opaque)
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
          [resultImageData.data.buffer]
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
    self.postMessage({ type: 'error', payload: (error as Error).message })
  }
}
