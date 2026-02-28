export interface VideoFormat {
  id: string;
  ext: string;
  label: string;
  codec: string;
  mimeType: string;
}

export interface AudioFormat {
  id: string;
  ext: string;
  label: string;
  codec: string;
  mimeType: string;
}

export interface ImageFormat {
  id: string;
  ext: string;
  label: string;
  mimeType: string;
  supportsQuality: boolean;
}

export interface QualityPreset {
  id: string;
  label: string;
  videoBitrate: string;
  audioBitrate: string;
}

export interface ResolutionPreset {
  id: string;
  label: string;
  value: string; // 'original' or 'WxH'
}

export const VIDEO_FORMATS: VideoFormat[] = [
  {
    id: "mp4-h264",
    ext: "mp4",
    label: "MP4 (H.264)",
    codec: "libx264",
    mimeType: "video/mp4",
  },
  {
    id: "mp4-h265",
    ext: "mp4",
    label: "MP4 (H.265/HEVC)",
    codec: "libx265",
    mimeType: "video/mp4",
  },
  {
    id: "webm-vp9",
    ext: "webm",
    label: "WebM (VP9)",
    codec: "libvpx-vp9",
    mimeType: "video/webm",
  },
  {
    id: "webm-vp8",
    ext: "webm",
    label: "WebM (VP8)",
    codec: "libvpx",
    mimeType: "video/webm",
  },
  {
    id: "mov",
    ext: "mov",
    label: "MOV",
    codec: "libx264",
    mimeType: "video/quicktime",
  },
  {
    id: "avi",
    ext: "avi",
    label: "AVI",
    codec: "libx264",
    mimeType: "video/x-msvideo",
  },
  {
    id: "mkv",
    ext: "mkv",
    label: "MKV",
    codec: "libx264",
    mimeType: "video/x-matroska",
  },
];

export const AUDIO_FORMATS: AudioFormat[] = [
  {
    id: "mp3",
    ext: "mp3",
    label: "MP3",
    codec: "libmp3lame",
    mimeType: "audio/mpeg",
  },
  {
    id: "aac",
    ext: "m4a",
    label: "AAC (M4A)",
    codec: "aac",
    mimeType: "audio/mp4",
  },
  {
    id: "opus",
    ext: "ogg",
    label: "Opus (OGG)",
    codec: "libopus",
    mimeType: "audio/ogg",
  },
  {
    id: "vorbis",
    ext: "ogg",
    label: "Vorbis (OGG)",
    codec: "libvorbis",
    mimeType: "audio/ogg",
  },
  {
    id: "flac",
    ext: "flac",
    label: "FLAC (Lossless)",
    codec: "flac",
    mimeType: "audio/flac",
  },
  {
    id: "wav",
    ext: "wav",
    label: "WAV (Uncompressed)",
    codec: "pcm_s16le",
    mimeType: "audio/wav",
  },
];

export const IMAGE_FORMATS: ImageFormat[] = [
  {
    id: "jpg",
    ext: "jpg",
    label: "JPEG",
    mimeType: "image/jpeg",
    supportsQuality: true,
  },
  {
    id: "png",
    ext: "png",
    label: "PNG",
    mimeType: "image/png",
    supportsQuality: false,
  },
  {
    id: "webp",
    ext: "webp",
    label: "WebP",
    mimeType: "image/webp",
    supportsQuality: true,
  },
  {
    id: "gif",
    ext: "gif",
    label: "GIF",
    mimeType: "image/gif",
    supportsQuality: false,
  },
  {
    id: "bmp",
    ext: "bmp",
    label: "BMP",
    mimeType: "image/bmp",
    supportsQuality: false,
  },
];

export const QUALITY_PRESETS: QualityPreset[] = [
  { id: "low", label: "Low (Fast)", videoBitrate: "1M", audioBitrate: "96k" },
  { id: "medium", label: "Medium", videoBitrate: "5M", audioBitrate: "128k" },
  { id: "high", label: "High", videoBitrate: "10M", audioBitrate: "192k" },
  { id: "ultra", label: "Ultra", videoBitrate: "20M", audioBitrate: "320k" },
];

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: "original", label: "Original", value: "original" },
  { id: "4k", label: "4K (3840x2160)", value: "3840x2160" },
  { id: "1080p", label: "1080p (1920x1080)", value: "1920x1080" },
  { id: "720p", label: "720p (1280x720)", value: "1280x720" },
  { id: "480p", label: "480p (854x480)", value: "854x480" },
  { id: "360p", label: "360p (640x360)", value: "640x360" },
];

export const AUDIO_BITRATES = [
  { id: "64k", label: "64 kbps", value: "64k" },
  { id: "96k", label: "96 kbps", value: "96k" },
  { id: "128k", label: "128 kbps", value: "128k" },
  { id: "192k", label: "192 kbps", value: "192k" },
  { id: "256k", label: "256 kbps", value: "256k" },
  { id: "320k", label: "320 kbps", value: "320k" },
];

// Helper to get format by ID
export function getVideoFormat(id: string): VideoFormat | undefined {
  return VIDEO_FORMATS.find((f) => f.id === id);
}

export function getAudioFormat(id: string): AudioFormat | undefined {
  return AUDIO_FORMATS.find((f) => f.id === id);
}

export function getImageFormat(id: string): ImageFormat | undefined {
  return IMAGE_FORMATS.find((f) => f.id === id);
}

// Detect media type from file
export function getMediaType(
  file: File,
): "video" | "audio" | "image" | "unknown" {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";

  // Fallback to extension
  const ext = file.name.split(".").pop()?.toLowerCase();
  const videoExts = ["mp4", "webm", "mov", "avi", "mkv", "m4v", "wmv", "flv"];
  const audioExts = ["mp3", "m4a", "ogg", "wav", "flac", "aac", "wma"];
  const imageExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"];

  if (ext && videoExts.includes(ext)) return "video";
  if (ext && audioExts.includes(ext)) return "audio";
  if (ext && imageExts.includes(ext)) return "image";

  return "unknown";
}

// Format duration as HH:MM:SS
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Parse duration string to seconds
export function parseDurationString(str: string): number {
  const parts = str.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

// Note: formatFileSize has been moved to @/types/progress as formatBytes()
// to avoid duplication across the codebase
