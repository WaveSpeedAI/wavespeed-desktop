/**
 * Media utility functions for type detection and URL validation
 */

export type MediaType = "image" | "video" | "audio" | "unknown";

// MIME type mappings
const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "ico",
  "avif",
];
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "avi", "mkv", "ogv", "m4v"];
const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "ogg",
  "flac",
  "aac",
  "m4a",
  "wma",
  "opus",
];

const MIME_TYPE_MAP: Record<string, MediaType> = {
  // Images
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/bmp": "image",
  "image/svg+xml": "image",
  "image/avif": "image",
  "image/x-icon": "image",
  // Videos
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "video/x-msvideo": "video",
  "video/x-matroska": "video",
  "video/ogg": "video",
  // Audio
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/ogg": "audio",
  "audio/flac": "audio",
  "audio/aac": "audio",
  "audio/mp4": "audio",
  "audio/x-ms-wma": "audio",
  "audio/opus": "audio",
};

/**
 * Detect media type from URL extension
 * @param url The URL to check
 * @returns The detected media type
 */
export function getMediaTypeFromUrl(url: string): MediaType {
  if (!url) return "unknown";

  try {
    // Extract path from URL, handling query strings
    const urlObj = new URL(url, "https://example.com");
    const pathname = urlObj.pathname.toLowerCase();
    const ext = pathname.split(".").pop();

    if (!ext) return "unknown";

    if (IMAGE_EXTENSIONS.includes(ext)) return "image";
    if (VIDEO_EXTENSIONS.includes(ext)) return "video";
    if (AUDIO_EXTENSIONS.includes(ext)) return "audio";

    return "unknown";
  } catch {
    // Fallback for invalid URLs - try simple extension extraction
    const match = url.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
    if (match) {
      const ext = match[1].toLowerCase();
      if (IMAGE_EXTENSIONS.includes(ext)) return "image";
      if (VIDEO_EXTENSIONS.includes(ext)) return "video";
      if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
    }
    return "unknown";
  }
}

/**
 * Detect media type from MIME type
 * @param mimeType The MIME type string
 * @returns The detected media type
 */
export function getMediaTypeFromMime(mimeType: string): MediaType {
  if (!mimeType) return "unknown";
  return MIME_TYPE_MAP[mimeType.toLowerCase()] || "unknown";
}

/**
 * Check if URL is a valid HTTPS URL (security)
 * @param url The URL to validate
 * @returns Whether the URL is HTTPS
 */
export function isSecureUrl(url: string): boolean {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === "https:";
  } catch {
    return url.toLowerCase().startsWith("https://");
  }
}

/**
 * Check if URL is a valid HTTP(S) URL
 * @param url The URL to validate
 * @returns Whether the URL is HTTP or HTTPS
 */
export function isHttpUrl(url: string): boolean {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === "http:" || urlObj.protocol === "https:";
  } catch {
    return (
      url.toLowerCase().startsWith("http://") ||
      url.toLowerCase().startsWith("https://")
    );
  }
}

/**
 * Check if string is a data URL
 * @param str The string to check
 * @returns Whether the string is a data URL
 */
export function isDataUrl(str: string): boolean {
  return str?.startsWith("data:") ?? false;
}

/**
 * Check if string is a blob URL
 * @param str The string to check
 * @returns Whether the string is a blob URL
 */
export function isBlobUrl(str: string): boolean {
  return str?.startsWith("blob:") ?? false;
}

/**
 * Get MIME type from data URL
 * @param dataUrl The data URL
 * @returns The MIME type or null
 */
export function getMimeFromDataUrl(dataUrl: string): string | null {
  if (!isDataUrl(dataUrl)) return null;
  const match = dataUrl.match(/^data:([^;,]+)/);
  return match ? match[1] : null;
}

/**
 * Validate and classify a media URL
 * @param url The URL to validate
 * @returns Object with validation results
 */
export function validateMediaUrl(url: string): {
  isValid: boolean;
  isSecure: boolean;
  mediaType: MediaType;
  error?: string;
} {
  if (!url) {
    return {
      isValid: false,
      isSecure: false,
      mediaType: "unknown",
      error: "URL is empty",
    };
  }

  // Data URLs are always valid and secure
  if (isDataUrl(url)) {
    const mime = getMimeFromDataUrl(url);
    return {
      isValid: true,
      isSecure: true,
      mediaType: mime ? getMediaTypeFromMime(mime) : "unknown",
    };
  }

  // Blob URLs are valid and secure
  if (isBlobUrl(url)) {
    return { isValid: true, isSecure: true, mediaType: "unknown" };
  }

  // HTTP(S) URLs
  if (isHttpUrl(url)) {
    return {
      isValid: true,
      isSecure: isSecureUrl(url),
      mediaType: getMediaTypeFromUrl(url),
    };
  }

  return {
    isValid: false,
    isSecure: false,
    mediaType: "unknown",
    error: "Invalid URL format",
  };
}
