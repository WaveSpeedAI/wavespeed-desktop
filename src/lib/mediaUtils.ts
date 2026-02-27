export function isUrl(str: string): boolean {
  return (
    str.startsWith('http://') ||
    str.startsWith('https://') ||
    str.startsWith('local-asset://')
  )
}

export function getUrlExtension(url: string): string | null {
  try {
    // Parse URL and get pathname (ignoring query params)
    const urlObj = new URL(url)
    const pathname = urlObj.pathname.toLowerCase()
    // Get the last segment and extract extension
    const lastSegment = pathname.split('/').pop() || ''
    const match = lastSegment.match(/\.([a-z0-9]+)$/)
    return match ? match[1] : null
  } catch {
    // Fallback for invalid URLs
    const match = url.match(/\.([a-z0-9]+)(?:\?.*)?$/i)
    return match ? match[1].toLowerCase() : null
  }
}

export function isImageUrl(url: string): boolean {
  if (!isUrl(url)) return false
  const ext = getUrlExtension(url)
  return ext !== null && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'].includes(ext)
}

export function isVideoUrl(url: string): boolean {
  if (!isUrl(url)) return false
  const ext = getUrlExtension(url)
  return ext !== null && ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv', 'm4v'].includes(ext)
}

export function isAudioUrl(url: string): boolean {
  if (!isUrl(url)) return false
  const ext = getUrlExtension(url)
  return ext !== null && ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'].includes(ext)
}
