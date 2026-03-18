/**
 * Storyboard model configuration — single source of truth.
 *
 * All model capability constraints (duration, aspect ratio, resolution)
 * are defined HERE and referenced everywhere else. Change once, propagate everywhere.
 *
 * Values sourced from WaveSpeed API schema:
 *   POST /api/v3/bytedance/seedance-v1.5-pro/image-to-video
 *   Input.properties.duration: { minimum: 4, maximum: 12, step: 1, default: 5 }
 *   Input.properties.aspect_ratio: { enum: ["21:9","16:9","4:3","1:1","3:4","9:16"] }
 *   Input.properties.resolution: { enum: ["480p","720p","1080p"], default: "720p" }
 */

export type ModelCategory = "video" | "image" | "tts" | "llm";

export interface ModelOption {
  id: string;
  name: string;
  category: ModelCategory;
  modelId: string;
  description: string;
  defaultParams: Record<string, unknown>;
}

/* ══════════════════════════════════════════════════════════
 * VIDEO MODEL CAPABILITIES — from real API schema
 * This is the SINGLE SOURCE OF TRUTH for all duration/format
 * constraints. Every other file imports from here.
 * ══════════════════════════════════════════════════════════ */

export interface VideoModelCapabilities {
  /** API minimum duration (seconds). Requests below this → 400 error. */
  minDuration: number;
  /** API maximum duration (seconds). Requests above this → 400 error. */
  maxDuration: number;
  /** API duration step size (integer seconds only). */
  durationStep: number;
  /** API default duration when not specified. */
  defaultDuration: number;
  /** Quality sweet spot range — best visual results. */
  sweetSpotMin: number;
  sweetSpotMax: number;
  /** Supported aspect ratios from API enum. */
  aspectRatios: readonly string[];
  /** Supported resolutions from API enum. */
  resolutions: readonly string[];
  /** Default resolution. */
  defaultResolution: string;
}

/**
 * Seedance V1.5 Pro — sourced from WaveSpeed API schema.
 * POST /api/v3/bytedance/seedance-v1.5-pro/image-to-video
 */
export const VIDEO_MODEL_CAPABILITIES: VideoModelCapabilities = {
  minDuration: 4,
  maxDuration: 12,
  durationStep: 1,
  defaultDuration: 5,
  sweetSpotMin: 5,
  sweetSpotMax: 8,
  aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  resolutions: ["480p", "720p", "1080p"],
  defaultResolution: "720p",
} as const;

/**
 * Clamp a duration to the model's valid range and snap to step.
 * This is the last line of defense before an API call.
 */
export function clampDuration(duration: number): number {
  const { minDuration, maxDuration, durationStep } = VIDEO_MODEL_CAPABILITIES;
  const rounded = Math.round(duration / durationStep) * durationStep;
  return Math.max(minDuration, Math.min(maxDuration, rounded));
}

/** Check if a duration is within the model's valid range. */
export function isDurationValid(duration: number): boolean {
  const { minDuration, maxDuration } = VIDEO_MODEL_CAPABILITIES;
  return duration >= minDuration && duration <= maxDuration;
}

/**
 * Build a human-readable constraint string for LLM prompts.
 * Called by prompts.ts so the LLM always sees the real limits.
 */
export function getDurationConstraintText(): string {
  const { minDuration, maxDuration, sweetSpotMin, sweetSpotMax } = VIDEO_MODEL_CAPABILITIES;
  return `MINIMUM ${minDuration} seconds, MAXIMUM ${maxDuration} seconds (HARD API limit — the video model REJECTS any value outside ${minDuration}-${maxDuration}s). Optimal quality: ${sweetSpotMin}-${sweetSpotMax}s.`;
}

/**
 * Build shot duration guideline text for LLM prompts, derived from model caps.
 */
export function getShotDurationGuidelinesText(): string {
  const { minDuration, maxDuration } = VIDEO_MODEL_CAPABILITIES;
  return [
    `- micro (≤15s): ${minDuration}-${minDuration + 1}s per shot, fast cuts (2-4 shots)`,
    `- short (15-45s): ${minDuration}-${Math.min(minDuration + 2, maxDuration)}s per shot, mix of fast and medium (4-10 shots)`,
    `- medium (45-90s): ${minDuration}-${Math.min(8, maxDuration)}s per shot, varied rhythm (8-18 shots)`,
    `- full (90-120s): ${minDuration}-${maxDuration}s per shot, full dynamic range (12-25 shots)`,
  ].join("\n");
}

/**
 * Threshold for optional segmentation (P5 path).
 * Shots above this duration get split into segments for quality.
 * Derived from model capabilities: ~58% of maxDuration.
 */
export function getSegmentationThreshold(): number {
  return Math.round(VIDEO_MODEL_CAPABILITIES.maxDuration * 0.58);
}

/**
 * Threshold for 3-segment split (vs 2-segment).
 * Derived from model capabilities: ~75% of maxDuration.
 */
export function getTripleSegmentThreshold(): number {
  return Math.round(VIDEO_MODEL_CAPABILITIES.maxDuration * 0.75);
}

/* ══════════════════════════════════════════════════════════
 * MODEL PRESETS — default model selections per category
 *
 * Uses the existing WaveSpeed API models (see src/lib/smartFormConfig.ts):
 * - Video: Seedance V1.5 Pro (bytedance)
 * - Image: Seedream 4.5 (bytedance)
 * - TTS: InfiniteTalk (wavespeed-ai)
 * ══════════════════════════════════════════════════════════ */

/** Default model selections for each category */
export const DEFAULT_MODELS: Record<ModelCategory, ModelOption> = {
  video: {
    id: "seedance-v1.5-pro-fast",
    name: "Seedance V1.5 Pro Fast",
    category: "video",
    modelId: "bytedance/seedance-v1.5-pro/text-to-video-fast",
    description: "快速文本生成视频，适合快速出片",
    defaultParams: {
      seed: 0,
    },
  },
  image: {
    id: "seedream-4.5",
    name: "Seedream 4.5",
    category: "image",
    modelId: "bytedance/seedream-v4.5",
    description: "高质量文本生成图片，用于角色和场景参考图",
    defaultParams: {
      image_size: "1024x1024",
      seed: 0,
    },
  },
  tts: {
    id: "infinitetalk",
    name: "InfiniteTalk",
    category: "tts",
    modelId: "wavespeed-ai/infinitetalk-fast",
    description: "快速语音合成",
    defaultParams: {},
  },
  llm: {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    category: "llm",
    modelId: "deepseek-chat",
    description: "大语言模型，用于剧本创作和意图解析",
    defaultParams: {
      temperature: 0.7,
      max_tokens: 8192,
    },
  },
};

/**
 * Image-to-video variant (when we have a reference image for the shot).
 */
export const VIDEO_I2V_MODEL: ModelOption = {
  id: "seedance-v1.5-pro-i2v-fast",
  name: "Seedance V1.5 Pro I2V Fast",
  category: "video",
  modelId: "bytedance/seedance-v1.5-pro/image-to-video-fast",
  description: "图片生成视频，用于有参考图的镜头",
  defaultParams: {
    seed: 0,
  },
};

/**
 * Image edit variant (when editing existing character/scene images).
 */
export const IMAGE_EDIT_MODEL: ModelOption = {
  id: "seedream-4.5-edit",
  name: "Seedream 4.5 Edit",
  category: "image",
  modelId: "bytedance/seedream-v4.5/edit",
  description: "图片编辑，用于修改角色和场景参考图",
  defaultParams: {
    image_size: "1024x1024",
    seed: 0,
  },
};

/** All available model options by category */
export const MODEL_OPTIONS: Record<ModelCategory, ModelOption[]> = {
  video: [
    DEFAULT_MODELS.video,
    VIDEO_I2V_MODEL,
    {
      id: "seedance-v1.5-pro-t2v",
      name: "Seedance V1.5 Pro (标准)",
      category: "video",
      modelId: "bytedance/seedance-v1.5-pro/text-to-video",
      description: "标准质量文本生成视频",
      defaultParams: { seed: 0 },
    },
  ],
  image: [
    DEFAULT_MODELS.image,
    IMAGE_EDIT_MODEL,
  ],
  tts: [
    DEFAULT_MODELS.tts,
    {
      id: "infinitetalk-normal",
      name: "InfiniteTalk (标准)",
      category: "tts",
      modelId: "wavespeed-ai/infinitetalk",
      description: "标准质量语音合成",
      defaultParams: {},
    },
  ],
  llm: [
    DEFAULT_MODELS.llm,
  ],
};
