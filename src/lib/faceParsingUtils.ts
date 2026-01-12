/**
 * Shared face parsing utilities for face enhancer and face swapper workers
 */

// Face region labels to include in mask (excludes background, hair, hat, ears, neck, cloth, accessories)
export const FACE_LABELS = new Set([
  'skin', 'nose', 'eye_g', 'l_eye', 'r_eye', 'l_brow', 'r_brow', 'mouth', 'u_lip', 'l_lip'
])

/**
 * Apply feathering to mask edges for smoother blending
 */
export function featherMask(mask: Uint8Array, size: number, radius: number): Uint8Array {
  const result = new Uint8Array(mask)

  // Simple box blur for feathering
  for (let pass = 0; pass < 2; pass++) {
    const temp = new Uint8Array(result)

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0
        let count = 0

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx
            const ny = y + dy

            if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
              sum += temp[ny * size + nx]
              count++
            }
          }
        }

        result[y * size + x] = Math.round(sum / count)
      }
    }
  }

  return result
}
