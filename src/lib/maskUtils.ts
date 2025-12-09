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

/**
 * Compute distance to nearest edge (outside pixel) for each inside pixel
 * Uses a brute-force approach with limited search radius for performance
 */
function computeDistanceToEdge(
  binary: Uint8Array,
  width: number,
  height: number,
  searchRadius: number
): Float32Array {
  const dist = new Float32Array(width * height)

  // For each inside pixel, find distance to nearest outside pixel
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (binary[idx] === 0) {
        dist[idx] = 0
        continue
      }

      // Check if this is an edge pixel (adjacent to outside)
      let minDist = searchRadius + 1 // Default to max if no edge found

      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            // Treat out-of-bounds as outside
            const d = Math.sqrt(dx * dx + dy * dy)
            if (d < minDist) minDist = d
          } else if (binary[ny * width + nx] === 0) {
            const d = Math.sqrt(dx * dx + dy * dy)
            if (d < minDist) minDist = d
          }
        }
      }

      dist[idx] = minDist
    }
  }

  return dist
}

/**
 * Apply feathering to a mask canvas to create smooth edges
 * Creates a soft alpha gradient at mask boundaries
 *
 * @param maskCanvas - Canvas with mask (alpha channel used for mask detection)
 * @param featherRadius - Number of pixels for the feather falloff (default: 4)
 * @returns New canvas with feathered mask
 */
export function featherMask(
  maskCanvas: HTMLCanvasElement,
  featherRadius: number = 4
): HTMLCanvasElement {
  const width = maskCanvas.width
  const height = maskCanvas.height

  const ctx = maskCanvas.getContext('2d')
  if (!ctx) return maskCanvas

  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  // Step 1: Create binary mask array (1 = inside, 0 = outside)
  const binary = new Uint8Array(width * height)
  for (let i = 0; i < binary.length; i++) {
    binary[i] = data[i * 4 + 3] > 0 ? 1 : 0
  }

  // Step 2: Calculate distance to nearest edge for each pixel
  const searchRadius = Math.max(featherRadius, 8)
  const distances = computeDistanceToEdge(binary, width, height, searchRadius)

  // Step 3: Apply feathering - pixels within featherRadius get soft alpha
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === 1) {
      const dist = distances[i]
      if (dist < featherRadius) {
        // Smooth falloff from edge using ease-in-out curve
        const t = dist / featherRadius
        const smoothT = t * t * (3 - 2 * t) // Smoothstep function
        data[i * 4 + 3] = Math.round(smoothT * 255)
      } else {
        data[i * 4 + 3] = 255 // Fully opaque inside
      }
    } else {
      data[i * 4 + 3] = 0 // Fully transparent outside
    }
  }

  // Create a new canvas for the result
  const resultCanvas = document.createElement('canvas')
  resultCanvas.width = width
  resultCanvas.height = height
  const resultCtx = resultCanvas.getContext('2d')!
  resultCtx.putImageData(imageData, 0, 0)

  return resultCanvas
}
