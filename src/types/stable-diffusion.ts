// Stable Diffusion related type definitions

/**
 * Stable Diffusion model information
 */
export interface SDModel {
  /** Model unique ID */
  id: string
  /** Model filename */
  name: string
  /** Display name */
  displayName: string
  /** Model description */
  description: string
  /** File size (bytes) */
  size: number
  /** Quantization type (Q5_K_M, Q8_0, F16, etc.) */
  quantization: string
  /** Download URL */
  downloadUrl: string
  /** Local path (if downloaded) */
  localPath?: string
  /** Whether downloaded */
  isDownloaded: boolean
  /** Whether downloading */
  isDownloading: boolean
  /** Download progress (0-100) */
  downloadProgress: number
  /** Whether download failed */
  downloadFailed?: boolean
}

/**
 * Sampling methods
 */
export type SamplingMethod =
  | 'euler'
  | 'euler_a'
  | 'heun'
  | 'dpm2'
  | 'dpm++2s_a'
  | 'dpm++2m'
  | 'dpm++2mv2'
  | 'ipndm'
  | 'ipndm_v'
  | 'lcm'
  | 'ddim_trailing'
  | 'tcd'

/**
 * Scheduler types
 */
export type Scheduler =
  | 'discrete'
  | 'karras'
  | 'exponential'
  | 'ays'
  | 'gits'
  | 'smoothstep'
  | 'sgm_uniform'
  | 'simple'
  | 'lcm'

/**
 * Image generation parameters
 */
export interface GenerationParams {
  /** Model path */
  modelPath: string
  /** LLM (text encoder) path */
  llmPath?: string
  /** VAE path */
  vaePath?: string
  /** Enable low VRAM mode (CLIP on CPU) */
  lowVramMode?: boolean
  /** Enable VAE tiling for lower VRAM usage */
  vaeTiling?: boolean
  /** Positive prompt */
  prompt: string
  /** Negative prompt */
  negativePrompt?: string
  /** Image width (must be multiple of 64) */
  width: number
  /** Image height (must be multiple of 64) */
  height: number
  /** Sampling steps (10-50) */
  steps: number
  /** CFG Scale (1-20) */
  cfgScale: number
  /** Random seed (optional, for reproducibility) */
  seed?: number
  /** Sampling method */
  samplingMethod?: SamplingMethod
  /** Scheduler */
  scheduler?: Scheduler
  /** Output path */
  outputPath: string
}

/**
 * Image generation result
 */
export interface GenerationResult {
  /** Whether successful */
  success: boolean
  /** Output image path */
  outputPath?: string
  /** Error message */
  error?: string
  /** Generation time (seconds) */
  duration?: number
  /** Parameters used */
  params?: GenerationParams
}

/**
 * System information
 */
export interface SystemInfo {
  /** Platform (darwin, win32, linux) */
  platform: string
  /** Architecture (arm64, x64) */
  arch?: string
  /** Hardware acceleration type */
  acceleration: string
  /** Whether supported */
  supported: boolean
}

/**
 * Binary path result
 */
export interface BinaryPathResult {
  /** Whether successful */
  success: boolean
  /** Binary path */
  path?: string
  /** Error message */
  error?: string
}

/**
 * Models list result
 */
export interface ModelsListResult {
  /** Whether successful */
  success: boolean
  /** Model list */
  models?: Array<{
    name: string
    path: string
    size: number
    createdAt: string
  }>
  /** Error message */
  error?: string
}

/**
 * Download result
 */
export interface DownloadResult {
  /** Whether successful */
  success: boolean
  /** File path */
  filePath?: string
  /** Error message */
  error?: string
}

/**
 * Delete result
 */
export interface DeleteResult {
  /** Whether successful */
  success: boolean
  /** Error message */
  error?: string
}

/**
 * Progress data
 */
export interface ProgressData {
  /** Phase name */
  phase: string
  /** Progress (0-100) */
  progress: number
  /** Detailed information */
  detail?: {
    /** Current value */
    current?: number
    /** Total */
    total?: number
    /** Unit (bytes, steps, percent) */
    unit?: 'bytes' | 'steps' | 'percent'
  }
}

/**
 * Parameter validation result
 */
export interface ValidationResult {
  /** Whether valid */
  valid: boolean
  /** Error message */
  error?: string
}

/**
 * Image size presets
 */
export const IMAGE_SIZE_PRESETS = {
  '512x512': { width: 512, height: 512, label: '512×512 (Square)' },
  '768x768': { width: 768, height: 768, label: '768×768 (Square)' },
  '512x768': { width: 512, height: 768, label: '512×768 (Portrait)' },
  '768x512': { width: 768, height: 512, label: '768×512 (Landscape)' },
  '1024x1024': { width: 1024, height: 1024, label: '1024×1024 (Square)' }
} as const

/**
 * Sampling steps presets
 */
export const STEPS_PRESETS = {
  fast: { value: 15, label: 'Fast (15 steps)' },
  balanced: { value: 20, label: 'Balanced (20 steps)' },
  quality: { value: 30, label: 'Quality (30 steps)' },
  high: { value: 40, label: 'High Quality (40 steps)' }
} as const

/**
 * CFG Scale presets
 */
export const CFG_SCALE_PRESETS = {
  low: { value: 5, label: 'Low (5)' },
  balanced: { value: 7.5, label: 'Balanced (7.5)' },
  high: { value: 10, label: 'High (10)' },
  veryHigh: { value: 15, label: 'Very High (15)' }
} as const

/**
 * Required auxiliary models for Z-Image
 */
export const AUXILIARY_MODELS = {
  llm: {
    name: 'Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf',
    displayName: 'Qwen3-4B Text Encoder',
    description: 'Text encoder model for Z-Image (required)',
    size: 2400000000, // ~2.4GB
    downloadUrl: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf'
  },
  vae: {
    name: 'ae.safetensors',
    displayName: 'FLUX VAE',
    description: 'VAE model for Z-Image (required)',
    size: 335000000, // ~335MB
    downloadUrl: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors'
  }
} as const

/**
 * Predefined model list - Z-Image-Turbo models
 */
export const PREDEFINED_MODELS: Omit<
  SDModel,
  'localPath' | 'isDownloaded' | 'isDownloading' | 'downloadProgress'
>[] = [
  {
    id: 'z-image-turbo-q4-k',
    name: 'z_image_turbo-Q4_K.gguf',
    displayName: 'Z-Image-Turbo (Q4_K)',
    description: 'zImage.models.q4k.description', // i18n key
    size: 2500000000, // ~2.5GB (estimated)
    quantization: 'Q4_K',
    downloadUrl:
      'https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf'
  },
  {
    id: 'z-image-turbo-q6-k',
    name: 'z_image_turbo-Q6_K.gguf',
    displayName: 'Z-Image-Turbo (Q6_K)',
    description: 'zImage.models.q6k.description', // i18n key
    size: 3500000000, // ~3.5GB (estimated)
    quantization: 'Q6_K',
    downloadUrl:
      'https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q6_K.gguf'
  },
  {
    id: 'z-image-turbo-q8-0',
    name: 'z_image_turbo-Q8_0.gguf',
    displayName: 'Z-Image-Turbo (Q8_0)',
    description: 'zImage.models.q8.description', // i18n key
    size: 4000000000, // ~4GB (estimated)
    quantization: 'Q8_0',
    downloadUrl:
      'https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q8_0.gguf'
  },
  {
    id: 'z-image-turbo-q2-k',
    name: 'z_image_turbo-Q2_K.gguf',
    displayName: 'Z-Image-Turbo (Q2_K)',
    description: 'zImage.models.q2k.description', // i18n key
    size: 1500000000, // ~1.5GB (estimated)
    quantization: 'Q2_K',
    downloadUrl:
      'https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q2_K.gguf'
  }
]
