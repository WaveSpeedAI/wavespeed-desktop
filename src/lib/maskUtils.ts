/**
 * Flood fill algorithm using scan-line approach
 * Fills connected pixels of the same color with the target color
 */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: [number, number, number, number]
): void {
  const canvas = ctx.canvas
  const width = canvas.width
  const height = canvas.height
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  // Get starting pixel color
  const startIdx = (Math.floor(startY) * width + Math.floor(startX)) * 4
  const startR = data[startIdx]
  const startG = data[startIdx + 1]
  const startB = data[startIdx + 2]
  const startA = data[startIdx + 3]

  // If clicking on same color, do nothing
  if (
    startR === fillColor[0] &&
    startG === fillColor[1] &&
    startB === fillColor[2] &&
    startA === fillColor[3]
  ) {
    return
  }

  // Check if a pixel matches the starting color
  const matchesStart = (idx: number): boolean => {
    return (
      data[idx] === startR &&
      data[idx + 1] === startG &&
      data[idx + 2] === startB &&
      data[idx + 3] === startA
    )
  }

  // Fill a pixel with the target color
  const fillPixel = (idx: number): void => {
    data[idx] = fillColor[0]
    data[idx + 1] = fillColor[1]
    data[idx + 2] = fillColor[2]
    data[idx + 3] = fillColor[3]
  }

  // Scan-line flood fill
  const stack: [number, number][] = [[Math.floor(startX), Math.floor(startY)]]
  const visited = new Set<number>()

  while (stack.length > 0) {
    const [x, y] = stack.pop()!

    if (x < 0 || x >= width || y < 0 || y >= height) continue

    const idx = (y * width + x) * 4
    if (visited.has(idx)) continue
    if (!matchesStart(idx)) continue

    visited.add(idx)
    fillPixel(idx)

    // Add neighboring pixels
    stack.push([x + 1, y])
    stack.push([x - 1, y])
    stack.push([x, y + 1])
    stack.push([x, y - 1])
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * Invert mask colors (black <-> white)
 */
export function invertMask(ctx: CanvasRenderingContext2D): void {
  const canvas = ctx.canvas
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data

  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i]         // R
    data[i + 1] = 255 - data[i + 1] // G
    data[i + 2] = 255 - data[i + 2] // B
    // Keep alpha unchanged
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * Extract first frame from a video URL as a data URL
 */
export async function extractVideoFrame(videoUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.src = videoUrl
    video.muted = true
    video.preload = 'metadata'

    const cleanup = () => {
      video.remove()
    }

    video.onloadeddata = () => {
      video.currentTime = 0
    }

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          cleanup()
          resolve(null)
          return
        }
        ctx.drawImage(video, 0, 0)
        const dataUrl = canvas.toDataURL('image/png')
        cleanup()
        resolve(dataUrl)
      } catch {
        cleanup()
        resolve(null)
      }
    }

    video.onerror = () => {
      cleanup()
      resolve(null)
    }

    // Timeout after 10 seconds
    setTimeout(() => {
      cleanup()
      resolve(null)
    }, 10000)

    video.load()
  })
}

/**
 * Convert canvas to PNG blob
 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to create blob from canvas'))
        }
      },
      'image/png',
      1.0
    )
  })
}

/**
 * Clear canvas to black (mask hidden)
 */
export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}

/**
 * Fill canvas to white (mask revealed)
 */
export function fillCanvasWhite(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}
