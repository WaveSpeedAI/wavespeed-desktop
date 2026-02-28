/**
 * Shared helpers for classifying and displaying workflow output items.
 * Outputs can be URLs (image, video, audio, 3D, file) or plain text (e.g. from LLM or text-input node).
 */

export type OutputItemType = 'image' | 'video' | 'audio' | '3d' | 'file' | 'text'

/** Classify a single output item (URL or plain text) for display. */
export function getOutputItemType(item: string): OutputItemType {
  const s = item.trim()
  if (!s) return 'text'

  // data: URLs (no file extension in the usual sense)
  if (s.startsWith('data:')) {
    if (s.startsWith('data:image/')) return 'image'
    if (s.startsWith('data:video/')) return 'video'
    if (s.startsWith('data:audio/')) return 'audio'
    if (s.startsWith('data:text/')) return 'text'
    return 'file'
  }

  // blob: URLs — produced by FFmpeg worker (merge / trim / convert).
  // They don't carry an extension, so default to 'video' which covers
  // both video and audio playback via <video> element.
  if (s.startsWith('blob:')) {
    return 'video'
  }

  // Remote or local-asset URLs — use extension
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('local-asset://')) {
    const normalized = s.toLowerCase().split('?')[0]
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/.test(normalized)) return 'image'
    if (/\.(mp4|webm|mov|avi|mkv)$/.test(normalized)) return 'video'
    if (/\.(mp3|wav|ogg|flac|aac|m4a)$/.test(normalized)) return 'audio'
    if (/\.(glb|gltf)$/.test(normalized)) return '3d'
    return 'file'
  }

  // Otherwise treat as plain text (e.g. from text-input node or LLM text output)
  return 'text'
}

/** Return true if the item is a URL we can use for image preview (including data:image). */
export function isImageUrl(url: string): boolean {
  return getOutputItemType(url) === 'image'
}

/** Decode data:text/plain;base64,... to string if possible; otherwise return as-is. */
export function decodeDataText(dataUrl: string): string {
  if (!dataUrl.startsWith('data:text/')) return dataUrl
  const base64 = dataUrl.replace(/^data:text\/[^;]+;base64,/, '')
  if (!base64) return dataUrl
  try {
    return atob(base64)
  } catch {
    return dataUrl
  }
}
