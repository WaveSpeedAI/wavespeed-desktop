/**
 * Image processing utilities for LaMa inpainting model
 * Adapted from https://github.com/geronimi73/next-lama
 */

// LaMa model requires fixed 512x512 input
export const LAMA_INPUT_SIZE = 512

/**
 * Find bounding box of non-transparent pixels in mask canvas
 * Returns { x, y, width, height } or null if no mask
 * Ensures crop region always fully contains the mask with padding
 */
export function getMaskBoundingBox(
  canvas: HTMLCanvasElement,
  minSize = LAMA_INPUT_SIZE
): { x: number; y: number; width: number; height: number } | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data, width: canvasWidth, height: canvasHeight } = imageData

  let minX = canvasWidth
  let minY = canvasHeight
  let maxX = 0
  let maxY = 0
  let hasMask = false

  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const alpha = data[(y * canvasWidth + x) * 4 + 3]
      if (alpha > 0) {
        hasMask = true
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  if (!hasMask) return null

  // Calculate mask dimensions
  const maskWidth = maxX - minX + 1
  const maskHeight = maxY - minY + 1

  // Desired crop should be at least 2x mask size and at least minSize (512)
  const desiredSize = Math.max(minSize, maskWidth * 2, maskHeight * 2)

  // Limit crop size to canvas dimensions
  const cropSize = Math.min(desiredSize, canvasWidth, canvasHeight)

  // Center the crop around the mask
  const maskCenterX = minX + maskWidth / 2
  const maskCenterY = minY + maskHeight / 2

  let x = Math.round(maskCenterX - cropSize / 2)
  let y = Math.round(maskCenterY - cropSize / 2)

  // Ensure crop contains the entire mask (priority over centering)
  // Shift crop if mask would be cut off
  if (x > minX) x = Math.max(0, minX - Math.floor((cropSize - maskWidth) / 2))
  if (y > minY) y = Math.max(0, minY - Math.floor((cropSize - maskHeight) / 2))
  if (x + cropSize < maxX + 1) x = Math.min(canvasWidth - cropSize, maxX + 1 - cropSize + Math.floor((cropSize - maskWidth) / 2))
  if (y + cropSize < maxY + 1) y = Math.min(canvasHeight - cropSize, maxY + 1 - cropSize + Math.floor((cropSize - maskHeight) / 2))

  // Final clamp to canvas bounds
  x = Math.max(0, Math.min(x, canvasWidth - cropSize))
  y = Math.max(0, Math.min(y, canvasHeight - cropSize))

  // Verify mask fits in crop (if not, mask is larger than canvas - rare edge case)
  const finalWidth = Math.min(cropSize, canvasWidth)
  const finalHeight = Math.min(cropSize, canvasHeight)

  return { x, y, width: finalWidth, height: finalHeight }
}

/**
 * Crop a region from canvas
 */
export function cropCanvas(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): HTMLCanvasElement {
  const cropped = document.createElement('canvas')
  cropped.width = width
  cropped.height = height
  const ctx = cropped.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Failed to get canvas context')

  ctx.drawImage(canvas, x, y, width, height, 0, 0, width, height)
  return cropped
}

/**
 * Paste a canvas back into a target canvas at specified position with optional blending
 */
export function pasteWithBlending(
  targetCanvas: HTMLCanvasElement,
  sourceCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  blendEdge = 8
): void {
  const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true })
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!targetCtx || !sourceCtx || !maskCtx) return

  const width = sourceCanvas.width
  const height = sourceCanvas.height

  const targetData = targetCtx.getImageData(x, y, width, height)
  const sourceData = sourceCtx.getImageData(0, 0, width, height)
  const maskData = maskCtx.getImageData(0, 0, width, height)

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4
      const maskAlpha = maskData.data[i + 3]

      if (maskAlpha > 0) {
        // Calculate distance from mask edge for blending
        let blendFactor = 1.0

        // Check distance to transparent pixels for edge blending
        let minDist = blendEdge
        for (let dy = -blendEdge; dy <= blendEdge && minDist > 0; dy++) {
          for (let dx = -blendEdge; dx <= blendEdge && minDist > 0; dx++) {
            const nx = px + dx
            const ny = py + dy
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const ni = (ny * width + nx) * 4
              if (maskData.data[ni + 3] === 0) {
                const dist = Math.sqrt(dx * dx + dy * dy)
                minDist = Math.min(minDist, dist)
              }
            }
          }
        }

        if (minDist < blendEdge) {
          blendFactor = minDist / blendEdge
        }

        // Blend source and target
        targetData.data[i] = Math.round(
          targetData.data[i] * (1 - blendFactor) + sourceData.data[i] * blendFactor
        )
        targetData.data[i + 1] = Math.round(
          targetData.data[i + 1] * (1 - blendFactor) + sourceData.data[i + 1] * blendFactor
        )
        targetData.data[i + 2] = Math.round(
          targetData.data[i + 2] * (1 - blendFactor) + sourceData.data[i + 2] * blendFactor
        )
      }
    }
  }

  targetCtx.putImageData(targetData, x, y)
}

/**
 * Convert RGB canvas to Float32Array in CHW format (channel-first)
 * Output shape: [1, 3, height, width] normalized to 0-1
 */
export function canvasToFloat32Array(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Failed to get canvas context')

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data, width, height } = imageData
  const float32 = new Float32Array(3 * width * height)

  for (let i = 0; i < width * height; i++) {
    float32[i] = data[i * 4] / 255                        // R -> channel 0
    float32[width * height + i] = data[i * 4 + 1] / 255   // G -> channel 1
    float32[2 * width * height + i] = data[i * 4 + 2] / 255 // B -> channel 2
  }

  return float32
}

/**
 * Convert mask canvas to Float32Array
 * Output shape: [1, 1, height, width] binary 0 or 1
 * Non-transparent pixels (alpha > 0) become 1 (area to inpaint), transparent become 0
 */
export function maskCanvasToFloat32Array(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Failed to get canvas context')

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data, width, height } = imageData
  const float32 = new Float32Array(width * height)

  for (let i = 0; i < width * height; i++) {
    // Check alpha channel - any non-transparent pixel is part of the mask
    float32[i] = data[i * 4 + 3] > 0 ? 1 : 0
  }

  return float32
}

/**
 * Convert Float32Array tensor back to canvas
 * Input shape: [1, 3, height, width]
 * @param normalized - if true, input is 0-1 range; if false, input is 0-255 range
 */
export function tensorToCanvas(
  tensor: Float32Array,
  width: number,
  height: number,
  normalized = true
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')

  const imageData = ctx.createImageData(width, height)
  const { data } = imageData

  for (let i = 0; i < width * height; i++) {
    // Convert from CHW back to HWC (RGBA)
    if (normalized) {
      // 0-1 range -> multiply by 255
      data[i * 4] = Math.round(Math.max(0, Math.min(1, tensor[i])) * 255)                        // R
      data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, tensor[width * height + i])) * 255)   // G
      data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, tensor[2 * width * height + i])) * 255) // B
    } else {
      // 0-255 range -> clamp directly
      data[i * 4] = Math.round(Math.max(0, Math.min(255, tensor[i])))                        // R
      data[i * 4 + 1] = Math.round(Math.max(0, Math.min(255, tensor[width * height + i])))   // G
      data[i * 4 + 2] = Math.round(Math.max(0, Math.min(255, tensor[2 * width * height + i]))) // B
    }
    data[i * 4 + 3] = 255 // A
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

/**
 * Resize canvas to target dimensions while preserving content
 */
export function resizeCanvas(
  sourceCanvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')

  ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight)
  return canvas
}

/**
 * Resize canvas to LaMa model input size (512x512)
 */
export function resizeToModelInput(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  return resizeCanvas(sourceCanvas, LAMA_INPUT_SIZE, LAMA_INPUT_SIZE)
}

/**
 * Resize result canvas back to original dimensions
 */
export function resizeFromModelOutput(
  resultCanvas: HTMLCanvasElement,
  originalWidth: number,
  originalHeight: number
): HTMLCanvasElement {
  return resizeCanvas(resultCanvas, originalWidth, originalHeight)
}

/**
 * Create a canvas from an image blob
 */
export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(img.src)
      resolve(canvas)
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Failed to load image'))
    }
    img.src = URL.createObjectURL(blob)
  })
}

/**
 * Convert canvas to blob
 */
export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to convert canvas to blob'))
        }
      },
      type,
      quality
    )
  })
}

/**
 * Apply mask to image canvas - composites the inpainted result with original
 * Only replaces pixels where mask is white (> 128)
 */
export function applyMaskedResult(
  originalCanvas: HTMLCanvasElement,
  resultCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement
): HTMLCanvasElement {
  const width = originalCanvas.width
  const height = originalCanvas.height

  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = width
  outputCanvas.height = height
  const outputCtx = outputCanvas.getContext('2d')
  if (!outputCtx) throw new Error('Failed to get canvas context')

  const originalCtx = originalCanvas.getContext('2d')
  const resultCtx = resultCanvas.getContext('2d')
  const maskCtx = maskCanvas.getContext('2d')
  if (!originalCtx || !resultCtx || !maskCtx) throw new Error('Failed to get canvas context')

  const originalData = originalCtx.getImageData(0, 0, width, height)
  const resultData = resultCtx.getImageData(0, 0, width, height)
  const maskData = maskCtx.getImageData(0, 0, width, height)
  const outputData = outputCtx.createImageData(width, height)

  for (let i = 0; i < width * height; i++) {
    const maskValue = maskData.data[i * 4] / 255 // 0-1 for blending

    // Blend based on mask value
    outputData.data[i * 4] = Math.round(
      originalData.data[i * 4] * (1 - maskValue) + resultData.data[i * 4] * maskValue
    )
    outputData.data[i * 4 + 1] = Math.round(
      originalData.data[i * 4 + 1] * (1 - maskValue) + resultData.data[i * 4 + 1] * maskValue
    )
    outputData.data[i * 4 + 2] = Math.round(
      originalData.data[i * 4 + 2] * (1 - maskValue) + resultData.data[i * 4 + 2] * maskValue
    )
    outputData.data[i * 4 + 3] = 255
  }

  outputCtx.putImageData(outputData, 0, 0)
  return outputCanvas
}
