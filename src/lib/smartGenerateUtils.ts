import JSZip from 'jszip'
import { apiClient } from '@/api/client'
import type { PredictionResult } from '@/types/prediction'
import { useModelsStore } from '@/stores/modelsStore'
import i18n from '@/i18n'

// ─── Types ───────────────────────────────────────────────────────────────────

export type SmartMode = 'text-to-image' | 'image-edit' | 'text-to-video' | 'image-to-video' | 'lora-trainer'

export interface ExtraConfigField {
  fieldName: string
  labelKey: string       // i18n key
  type: 'enum' | 'lora'
  options?: string[]     // for 'enum' type
  default?: string       // for 'enum' type
}

export interface LoraItem {
  path: string
  scale: number
}

export interface ModelAdapter {
  modelId: string
  label: string
  tag: string // 推荐 / 性价比 / 极致 / 快速 / 极速 / 旗舰 / 高端 / 中文优 / 细节 / 理解力
  price: number
  promptField: string
  imageField?: string
  extraDefaults?: Record<string, unknown>
  supportsChinesePrompt: boolean
  estimatedTime: { min: number; max: number }
  seedField?: string
  extraConfigFields?: ExtraConfigField[]  // model-specific configurable fields
}

export interface GenerationAttempt {
  id: string
  roundIndex: number
  variantIndex: number
  modelId: string
  promptUsed: string
  outputUrl: string | null
  tier1Score: number | null
  tier2Score: number | null
  tier2Analysis: string | null
  moderationPassed: boolean | null
  status: 'generating' | 'scoring' | 'complete' | 'failed'
  cost: number
  inferenceTime: number | null
  timestamp: number
  isUpscaled?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// ─── Model Configs (25 models, hardcoded) ────────────────────────────────────

export const TEXT_TO_IMAGE_MODELS: ModelAdapter[] = [
  { modelId: 'google/nano-banana-pro/text-to-image', label: 'NB Pro', tag: 'recommended', price: 0.14, promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 5, max: 15 }, seedField: 'seed' },
  { modelId: 'google/nano-banana/text-to-image', label: 'NB', tag: 'value', price: 0.038, promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 5, max: 15 } },
  { modelId: 'wavespeed-ai/qwen-image/text-to-image-2512', label: 'Qwen 2512', tag: 'value', price: 0.02, promptField: 'prompt', supportsChinesePrompt: true, estimatedTime: { min: 5, max: 15 }, seedField: 'seed' },
  { modelId: 'wavespeed-ai/qwen-image/text-to-image', label: 'Qwen', tag: 'value', price: 0.02, promptField: 'prompt', supportsChinesePrompt: true, estimatedTime: { min: 5, max: 15 }, seedField: 'seed' },
  {
    modelId: 'wavespeed-ai/qwen-image/text-to-image-2512-lora', label: 'Qwen 2512 LoRA', tag: 'lora', price: 0.02,
    promptField: 'prompt', supportsChinesePrompt: true, estimatedTime: { min: 5, max: 15 }, seedField: 'seed',
    extraConfigFields: [{ fieldName: 'loras', labelKey: 'smartGenerate.config.loras', type: 'lora' }],
  },
  {
    modelId: 'wavespeed-ai/qwen-image/text-to-image-lora', label: 'Qwen LoRA', tag: 'lora', price: 0.02,
    promptField: 'prompt', supportsChinesePrompt: true, estimatedTime: { min: 5, max: 15 }, seedField: 'seed',
    extraConfigFields: [{ fieldName: 'loras', labelKey: 'smartGenerate.config.loras', type: 'lora' }],
  },
  { modelId: 'wavespeed-ai/z-image/turbo', label: 'Z-Image Turbo', tag: 'turbo', price: 0.005, promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 1, max: 5 }, seedField: 'seed' },
  {
    modelId: 'wavespeed-ai/z-image/turbo-lora', label: 'Z-Image Turbo LoRA', tag: 'lora', price: 0.005,
    promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 1, max: 5 }, seedField: 'seed',
    extraConfigFields: [{ fieldName: 'loras', labelKey: 'smartGenerate.config.loras', type: 'lora' }],
  },
  { modelId: 'bytedance/seedream-v4.5', label: 'Seedream', tag: 'recommended', price: 0.04, promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 5, max: 15 }, seedField: 'seed' },
  { modelId: 'wavespeed-ai/flux-2-dev/text-to-image', label: 'Flux 2 Dev', tag: 'detail', price: 0.012, promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 5, max: 15 }, seedField: 'seed' },
  {
    modelId: 'wavespeed-ai/flux-2-dev/text-to-image-lora', label: 'Flux 2 Dev LoRA', tag: 'lora', price: 0.012,
    promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 5, max: 15 }, seedField: 'seed',
    extraConfigFields: [{ fieldName: 'loras', labelKey: 'smartGenerate.config.loras', type: 'lora' }],
  },
  { modelId: 'alibaba/wan-2.6/text-to-image', label: 'Wan 2.6', tag: 'chinese', price: 0.03, promptField: 'prompt', supportsChinesePrompt: true, estimatedTime: { min: 5, max: 15 }, seedField: 'seed' },
]

export const IMAGE_EDIT_MODELS: ModelAdapter[] = [
  { modelId: 'google/nano-banana-pro/edit', label: 'NB Pro Edit', tag: 'recommended', price: 0.14, promptField: 'prompt', imageField: 'images', supportsChinesePrompt: false, estimatedTime: { min: 5, max: 15 } },
  { modelId: 'google/nano-banana/edit', label: 'NB Edit', tag: 'value', price: 0.038, promptField: 'prompt', imageField: 'images', supportsChinesePrompt: false, estimatedTime: { min: 5, max: 15 } },
  { modelId: 'wavespeed-ai/qwen-image/edit-2511', label: 'Qwen Edit 2511', tag: 'value', price: 0.02, promptField: 'prompt', imageField: 'images', supportsChinesePrompt: true, estimatedTime: { min: 5, max: 15 } },
  { modelId: 'wavespeed-ai/qwen-image/edit-plus', label: 'Qwen Edit Plus', tag: 'value', price: 0.02, promptField: 'prompt', imageField: 'images', supportsChinesePrompt: true, estimatedTime: { min: 5, max: 15 } },
  {
    modelId: 'wavespeed-ai/qwen-image/edit-2511-lora', label: 'Qwen Edit LoRA', tag: 'lora', price: 0.02,
    promptField: 'prompt', imageField: 'images', supportsChinesePrompt: true, estimatedTime: { min: 5, max: 15 }, seedField: 'seed',
    extraConfigFields: [{ fieldName: 'loras', labelKey: 'smartGenerate.config.loras', type: 'lora' }],
  },
  {
    modelId: 'wavespeed-ai/flux-2-dev/edit-lora', label: 'Flux 2 Dev Edit LoRA', tag: 'lora', price: 0.012,
    promptField: 'prompt', imageField: 'images', supportsChinesePrompt: false, estimatedTime: { min: 5, max: 15 }, seedField: 'seed',
    extraConfigFields: [{ fieldName: 'loras', labelKey: 'smartGenerate.config.loras', type: 'lora' }],
  },
  { modelId: 'bytedance/seedream-v4.5/edit', label: 'Seedream Edit', tag: 'recommended', price: 0.04, promptField: 'prompt', imageField: 'images', supportsChinesePrompt: false, estimatedTime: { min: 5, max: 15 } },
  { modelId: 'openai/gpt-image-1', label: 'GPT Image 1', tag: 'understanding', price: 0.042, promptField: 'prompt', imageField: 'image', supportsChinesePrompt: true, estimatedTime: { min: 8, max: 20 } },
]

export const TEXT_TO_VIDEO_MODELS: ModelAdapter[] = [
  {
    modelId: 'bytedance/seedance-v1.5-pro/text-to-video', label: 'Seedance Pro', tag: 'recommended', price: 0.26,
    promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 30, max: 90 },
    extraDefaults: { duration: 5 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['5', '8', '12'], default: '5' },
    ],
  },
  {
    modelId: 'bytedance/seedance-v1.5-pro/text-to-video-fast', label: 'Seedance Fast', tag: 'fast', price: 0.20,
    promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 15, max: 60 }, seedField: 'seed',
    extraDefaults: { duration: 5 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['5', '8', '12'], default: '5' },
    ],
  },
  {
    modelId: 'openai/sora-2/text-to-video', label: 'Sora 2', tag: 'flagship', price: 0.40,
    promptField: 'prompt', supportsChinesePrompt: true, estimatedTime: { min: 30, max: 120 },
    extraDefaults: { duration: 4 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['4', '8', '12'], default: '4' },
    ],
  },
  {
    modelId: 'google/veo3.1-fast/text-to-video', label: 'Veo 3.1 Fast', tag: 'premium', price: 1.20,
    promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 30, max: 90 },
    extraDefaults: { duration: 8 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['4', '6', '8'], default: '8' },
    ],
  },
  {
    modelId: 'google/veo3.1/text-to-video', label: 'Veo 3.1', tag: 'ultimate', price: 3.20,
    promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 60, max: 180 },
    extraDefaults: { duration: 8 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['4', '6', '8'], default: '8' },
    ],
  },
  {
    modelId: 'alibaba/wan-2.6/text-to-video', label: 'Wan 2.6', tag: 'chinese', price: 0.50,
    promptField: 'prompt', supportsChinesePrompt: true, estimatedTime: { min: 30, max: 120 }, seedField: 'seed',
    extraDefaults: { duration: 5 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['5', '10', '15'], default: '5' },
    ],
  },
  {
    modelId: 'wavespeed-ai/wan-2.2/t2v-720p-lora-ultra-fast', label: 'Wan 2.2 LoRA', tag: 'lora', price: 0.15,
    promptField: 'prompt', supportsChinesePrompt: true, estimatedTime: { min: 10, max: 40 }, seedField: 'seed',
    extraDefaults: { duration: 5 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['5', '8'], default: '5' },
      { fieldName: 'loras', labelKey: 'smartGenerate.config.loras', type: 'lora' },
    ],
  },
]

export const IMAGE_TO_VIDEO_MODELS: ModelAdapter[] = [
  {
    modelId: 'bytedance/seedance-v1.5-pro/image-to-video', label: 'Seedance', tag: 'recommended', price: 0.26,
    promptField: 'prompt', imageField: 'image', supportsChinesePrompt: false, estimatedTime: { min: 30, max: 90 },
    extraDefaults: { duration: 5 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['5', '8', '12'], default: '5' },
    ],
  },
  {
    modelId: 'bytedance/seedance-v1.5-pro/image-to-video-fast', label: 'Seedance Fast', tag: 'fast', price: 0.20,
    promptField: 'prompt', imageField: 'image', supportsChinesePrompt: false, estimatedTime: { min: 15, max: 60 }, seedField: 'seed',
    extraDefaults: { duration: 5 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['5', '8', '12'], default: '5' },
    ],
  },
  {
    modelId: 'openai/sora-2/image-to-video', label: 'Sora 2', tag: 'flagship', price: 0.40,
    promptField: 'prompt', imageField: 'image', supportsChinesePrompt: true, estimatedTime: { min: 30, max: 120 },
    extraDefaults: { duration: 4 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['4', '8', '12'], default: '4' },
    ],
  },
  {
    modelId: 'google/veo3.1-fast/image-to-video', label: 'Veo 3.1 Fast', tag: 'premium', price: 1.20,
    promptField: 'prompt', imageField: 'image', supportsChinesePrompt: false, estimatedTime: { min: 30, max: 90 },
    extraDefaults: { duration: 8 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['4', '6', '8'], default: '8' },
    ],
  },
  {
    modelId: 'alibaba/wan-2.6/image-to-video-pro', label: 'Wan 2.6 Pro', tag: 'chinese', price: 0.50,
    promptField: 'prompt', imageField: 'image', supportsChinesePrompt: true, estimatedTime: { min: 30, max: 120 },
    extraDefaults: { duration: 5, enable_prompt_expansion: false },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['5', '10', '15'], default: '5' },
    ],
  },
  {
    modelId: 'alibaba/wan-2.6/image-to-video-spicy', label: 'Wan 2.6 Spicy', tag: 'unrestricted', price: 0.50,
    promptField: 'prompt', imageField: 'image', supportsChinesePrompt: true, estimatedTime: { min: 30, max: 120 },
    extraDefaults: { duration: 5, enable_prompt_expansion: false },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['5', '10', '15'], default: '5' },
    ],
  },
  {
    modelId: 'wavespeed-ai/wan-2.2-spicy/image-to-video', label: 'Wan Spicy', tag: 'value', price: 0.15,
    promptField: 'prompt', imageField: 'image', supportsChinesePrompt: true, estimatedTime: { min: 15, max: 60 }, seedField: 'seed',
    extraDefaults: { duration: 5 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['5', '8'], default: '5' },
    ],
  },
  {
    modelId: 'wavespeed-ai/wan-2.2-spicy/image-to-video-lora', label: 'Spicy LoRA', tag: 'lora', price: 0.20,
    promptField: 'prompt', imageField: 'image', supportsChinesePrompt: true, estimatedTime: { min: 15, max: 60 }, seedField: 'seed',
    extraDefaults: { duration: 5 },
    extraConfigFields: [
      { fieldName: 'duration', labelKey: 'smartGenerate.config.duration', type: 'enum', options: ['5', '8'], default: '5' },
      { fieldName: 'loras', labelKey: 'smartGenerate.config.loras', type: 'lora' },
    ],
  },
]

// ─── Trainer Models ──────────────────────────────────────────────────────────

export interface TrainerAdapter {
  modelId: string
  label: string
  tag: string
  defaults: { steps: number; learningRate: number; loraRank: number }
  stepRange: { min: number; max: number }
  rankRange: { min: number; max: number }
}

export const TRAINER_MODELS: TrainerAdapter[] = [
  { modelId: 'wavespeed-ai/z-image/base-lora-trainer', label: 'Z-Image Base', tag: 'recommended', defaults: { steps: 1000, learningRate: 0.0001, loraRank: 16 }, stepRange: { min: 100, max: 5000 }, rankRange: { min: 4, max: 64 } },
  { modelId: 'wavespeed-ai/z-image/lora-trainer', label: 'Z-Image', tag: 'value', defaults: { steps: 1000, learningRate: 0.0001, loraRank: 16 }, stepRange: { min: 100, max: 5000 }, rankRange: { min: 4, max: 64 } },
  { modelId: 'wavespeed-ai/qwen-image-lora-trainer', label: 'Qwen Image', tag: 'value', defaults: { steps: 1000, learningRate: 0.0004, loraRank: 16 }, stepRange: { min: 100, max: 5000 }, rankRange: { min: 4, max: 64 } },
  { modelId: 'wavespeed-ai/qwen-image-2512-lora-trainer', label: 'Qwen 2512', tag: 'value', defaults: { steps: 1000, learningRate: 0.0004, loraRank: 16 }, stepRange: { min: 100, max: 5000 }, rankRange: { min: 4, max: 64 } },
  { modelId: 'wavespeed-ai/wan-2.2-image-lora-trainer', label: 'Wan 2.2 Image', tag: 'chinese', defaults: { steps: 1000, learningRate: 0.0002, loraRank: 32 }, stepRange: { min: 100, max: 5000 }, rankRange: { min: 4, max: 128 } },
]

export function isTrainerMode(mode: SmartMode): boolean {
  return mode === 'lora-trainer'
}

export function getTrainerAdapter(modelId: string): TrainerAdapter | undefined {
  return TRAINER_MODELS.find(m => m.modelId === modelId)
}

export async function buildTrainingZip(files: File[]): Promise<File> {
  const zip = new JSZip()
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = file.name.includes('.') ? file.name.split('.').pop()! : 'jpg'
    zip.file(`${i + 1}.${ext}`, file)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], 'training_data.zip', { type: 'application/zip' })
}

// ─── Fallback Chains ────────────────────────────────────────────────────────

const T2I_FALLBACK = [
  'wavespeed-ai/z-image/turbo',              // $0.005
  'wavespeed-ai/flux-2-dev/text-to-image',   // $0.012
  'wavespeed-ai/qwen-image/text-to-image-2512', // $0.02
  'alibaba/wan-2.6/text-to-image',           // $0.03
  'google/nano-banana/text-to-image',        // $0.038
  'bytedance/seedream-v4.5',                 // $0.04
  'google/nano-banana-pro/text-to-image',    // $0.14
]

const EDIT_FALLBACK = [
  'wavespeed-ai/qwen-image/edit-2511',       // $0.02
  'google/nano-banana/edit',                  // $0.038
  'bytedance/seedream-v4.5/edit',             // $0.04
  'openai/gpt-image-1',                      // $0.042
  'google/nano-banana-pro/edit',              // $0.14
]

const T2V_FALLBACK = [
  'bytedance/seedance-v1.5-pro/text-to-video-fast', // $0.20
  'bytedance/seedance-v1.5-pro/text-to-video',      // $0.26
  'openai/sora-2/text-to-video',                     // $0.40
  'alibaba/wan-2.6/text-to-video',                   // $0.50
  'google/veo3.1-fast/text-to-video',                // $1.20
]

const I2V_FALLBACK = [
  'wavespeed-ai/wan-2.2-spicy/image-to-video',      // $0.15
  'bytedance/seedance-v1.5-pro/image-to-video-fast', // $0.20
  'bytedance/seedance-v1.5-pro/image-to-video',      // $0.26
  'openai/sora-2/image-to-video',                     // $0.40
  'alibaba/wan-2.6/image-to-video-spicy',             // $0.50
  'alibaba/wan-2.6/image-to-video-pro',               // $0.50
  'google/veo3.1-fast/image-to-video',                // $1.20
]

// NSFW fallback chains — prioritize models tolerant of mature content
const T2I_NSFW_FALLBACK = [
  'alibaba/wan-2.6/text-to-image',              // $0.03
  'bytedance/seedream-v4.5',                     // $0.04
  'wavespeed-ai/z-image/turbo',                  // $0.005
  'wavespeed-ai/flux-2-dev/text-to-image',       // $0.012
  'wavespeed-ai/qwen-image/text-to-image-2512',  // $0.02
  'google/nano-banana/text-to-image',            // $0.038
  'google/nano-banana-pro/text-to-image',        // $0.14
]

const EDIT_NSFW_FALLBACK = [
  'bytedance/seedream-v4.5/edit',                // $0.04
  'wavespeed-ai/qwen-image/edit-2511',           // $0.02
  'google/nano-banana/edit',                      // $0.038
  'openai/gpt-image-1',                          // $0.042
  'google/nano-banana-pro/edit',                  // $0.14
]

const T2V_NSFW_FALLBACK = [
  'bytedance/seedance-v1.5-pro/text-to-video',      // $0.26
  'alibaba/wan-2.6/text-to-video',                   // $0.50
  'bytedance/seedance-v1.5-pro/text-to-video-fast',  // $0.20
  'openai/sora-2/text-to-video',                     // $0.40
  'google/veo3.1-fast/text-to-video',                // $1.20
]

const I2V_NSFW_FALLBACK = [
  'alibaba/wan-2.6/image-to-video-spicy',             // $0.50 — most tolerant
  'wavespeed-ai/wan-2.2-spicy/image-to-video',      // $0.15
  'alibaba/wan-2.6/image-to-video-pro',               // $0.50
  'bytedance/seedance-v1.5-pro/image-to-video-fast', // $0.20
  'bytedance/seedance-v1.5-pro/image-to-video',      // $0.26
  'openai/sora-2/image-to-video',                     // $0.40
  'google/veo3.1-fast/image-to-video',                // $1.20
]

const TOP_MODELS: Partial<Record<SmartMode, string[]>> = {
  'text-to-image': ['google/nano-banana-pro/text-to-image'],
  'image-edit': ['google/nano-banana-pro/edit'],
  'text-to-video': ['google/veo3.1/text-to-video'],
  'image-to-video': ['google/veo3.1-fast/image-to-video'],
}

// ─── Model Helpers ───────────────────────────────────────────────────────────

export function getModelsForMode(mode: SmartMode): ModelAdapter[] {
  switch (mode) {
    case 'text-to-image': return TEXT_TO_IMAGE_MODELS
    case 'image-edit': return IMAGE_EDIT_MODELS
    case 'text-to-video': return TEXT_TO_VIDEO_MODELS
    case 'image-to-video': return IMAGE_TO_VIDEO_MODELS
    case 'lora-trainer': return [] // trainer uses TrainerAdapter, not ModelAdapter
  }
}

export function getDefaultModel(mode: SmartMode): ModelAdapter {
  const models = getModelsForMode(mode)
  if (models.length === 0) {
    // lora-trainer mode has no ModelAdapters — return a safe dummy
    return { modelId: '', label: '', tag: '', price: 0, promptField: 'prompt', supportsChinesePrompt: false, estimatedTime: { min: 0, max: 0 } }
  }
  // T2I defaults to Z-Image Turbo (cheap & fast), others use first 'recommended'
  if (mode === 'text-to-image') {
    return models.find(m => m.modelId === 'wavespeed-ai/z-image/turbo') || models[0]
  }
  return models.find(m => m.tag === 'recommended') || models[0]
}

export function getModelAdapter(modelId: string): ModelAdapter | undefined {
  const all = [...TEXT_TO_IMAGE_MODELS, ...IMAGE_EDIT_MODELS, ...TEXT_TO_VIDEO_MODELS, ...IMAGE_TO_VIDEO_MODELS]
  const adapter = all.find(m => m.modelId === modelId)
  if (!adapter) return undefined
  // Use dynamic price from API if available, fallback to hardcoded
  const liveModel = useModelsStore.getState().models.find(m => m.model_id === modelId)
  if (liveModel?.base_price != null) {
    return { ...adapter, price: liveModel.base_price }
  }
  return adapter
}

function getFallbackChain(mode: SmartMode, isNsfw = false): string[] {
  switch (mode) {
    case 'text-to-image': return isNsfw ? T2I_NSFW_FALLBACK : T2I_FALLBACK
    case 'image-edit': return isNsfw ? EDIT_NSFW_FALLBACK : EDIT_FALLBACK
    case 'text-to-video': return isNsfw ? T2V_NSFW_FALLBACK : T2V_FALLBACK
    case 'image-to-video': return isNsfw ? I2V_NSFW_FALLBACK : I2V_FALLBACK
    case 'lora-trainer': return [] // no fallback for trainer
  }
}

export function isTopModel(mode: SmartMode, modelId: string): boolean {
  // LoRA models should never fallback — user's LoRA is model-specific
  const adapter = getModelAdapter(modelId)
  if (adapter?.tag === 'lora') return true
  return TOP_MODELS[mode]?.includes(modelId) ?? false
}

export function getNextFallbackModel(mode: SmartMode, failedModels: string[], currentModel: string, isNsfw = false): string | null {
  if (isTopModel(mode, currentModel)) return null
  const chain = getFallbackChain(mode, isNsfw)
  const currentIdx = chain.indexOf(currentModel)
  // Try models after current in chain, skipping failed ones
  for (let i = currentIdx + 1; i < chain.length; i++) {
    if (!failedModels.includes(chain[i])) return chain[i]
  }
  // Try models before current (wrap around)
  for (let i = 0; i < currentIdx; i++) {
    if (!failedModels.includes(chain[i]) && chain[i] !== currentModel) return chain[i]
  }
  return null
}

// ─── Size/Aspect Ratio Detection (from model API schema) ─────────────────────

export interface SizeFieldConfig {
  fieldName: string          // e.g. 'size', 'aspect_ratio', 'image_size'
  type: 'dimensions' | 'enum'  // dimensions = SizeSelector ("1024*1024"), enum = dropdown
  options?: string[]         // for enum type, e.g. ["1:1", "16:9", "9:16"]
  default?: string           // default value
  min?: number               // for dimensions type, min dimension
  max?: number               // for dimensions type, max dimension
}

const SIZE_FIELD_NAMES = ['size', 'image_size', 'aspect_ratio']  // 'resolution' handled separately

/**
 * Extract size/aspect_ratio field from a model's API schema.
 * Returns null if the model doesn't have a size field (e.g. edit/I2V models).
 */
export function getSizeFieldConfig(modelId: string): SizeFieldConfig | null {
  const model = useModelsStore.getState().models.find(m => m.model_id === modelId)
  if (!model?.api_schema) return null

  // Navigate to request schema properties
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiSchemas = (model.api_schema as any)?.api_schemas as Array<{
    type: string
    request_schema?: {
      properties?: Record<string, { type?: string; enum?: string[]; default?: unknown; minimum?: number; maximum?: number }>
    }
  }> | undefined

  const requestSchema = apiSchemas?.find(s => s.type === 'model_run')?.request_schema
  if (!requestSchema?.properties) return null

  // Find size-related field
  for (const [name, prop] of Object.entries(requestSchema.properties)) {
    if (SIZE_FIELD_NAMES.includes(name.toLowerCase())) {
      if (prop.enum && prop.enum.length > 0) {
        // Enum type (e.g. aspect_ratio: ["1:1", "16:9", "9:16"])
        return {
          fieldName: name,
          type: 'enum',
          options: prop.enum,
          default: prop.default as string | undefined,
        }
      }
      if (name.toLowerCase() === 'size') {
        // Dimensions type (e.g. size: "1024*1024" with min/max)
        // Default max=1536: most image models cap at 1536 per dimension
        return {
          fieldName: name,
          type: 'dimensions',
          default: (prop.default as string) || '1024*1024',
          min: prop.minimum || 256,
          max: prop.maximum || 1536,
        }
      }
    }
  }

  return null
}

/**
 * Get resolution field config (e.g. Nano Banana's "1k"/"2k"/"4k" selector).
 * Separate from getSizeFieldConfig which returns the primary size/aspect_ratio field.
 */
export function getResolutionFieldConfig(modelId: string): SizeFieldConfig | null {
  const model = useModelsStore.getState().models.find(m => m.model_id === modelId)
  if (!model?.api_schema) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiSchemas = (model.api_schema as any)?.api_schemas as Array<{
    type: string
    request_schema?: {
      properties?: Record<string, { type?: string; enum?: string[]; default?: unknown }>
    }
  }> | undefined

  const requestSchema = apiSchemas?.find(s => s.type === 'model_run')?.request_schema
  if (!requestSchema?.properties) return null

  const prop = requestSchema.properties['resolution']
  if (!prop || !prop.enum || prop.enum.length === 0) return null

  return {
    fieldName: 'resolution',
    type: 'enum',
    options: prop.enum,
    default: prop.default as string | undefined,
  }
}

// ─── Output type helpers ─────────────────────────────────────────────────────

export function isVideoMode(mode: SmartMode): boolean {
  return mode === 'text-to-video' || mode === 'image-to-video'
}

export function isImageMode(mode: SmartMode): boolean {
  return mode === 'text-to-image' || mode === 'image-edit'
}

export function needsSourceImage(mode: SmartMode): boolean {
  return mode === 'image-edit' || mode === 'image-to-video'
}

export function extractTrainingOutput(result: PredictionResult): string | null {
  if (!result.outputs || result.outputs.length === 0) return null
  const out = result.outputs[0]
  if (typeof out === 'string') return out
  if (typeof out === 'object' && out !== null) {
    const obj = out as Record<string, unknown>
    // Training API may return lora_url, url, output, or diffusers_lora_file
    if (typeof obj.lora_url === 'string') return obj.lora_url
    if (typeof obj.diffusers_lora_file === 'string') return obj.diffusers_lora_file
    if (typeof obj.url === 'string') return obj.url
    if (typeof obj.output === 'string') return obj.output
  }
  return null
}

// ─── API Wrappers ────────────────────────────────────────────────────────────

function extractOutput(result: PredictionResult): string | null {
  if (!result.outputs || result.outputs.length === 0) return null
  const out = result.outputs[0]
  if (typeof out === 'string') return out
  // Handle { url: '...' } or { image: '...' } or { video: '...' }
  if (typeof out === 'object' && out !== null) {
    const obj = out as Record<string, unknown>
    if (typeof obj.url === 'string') return obj.url
    if (typeof obj.image === 'string') return obj.image
    if (typeof obj.video === 'string') return obj.video
    if (typeof obj.output === 'string') return obj.output
  }
  return null
}

export async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const result = await apiClient.run('wavespeed-ai/any-llm', {
    system_prompt: systemPrompt,
    prompt: userPrompt,
  }, { enableSyncMode: true })
  return extractOutput(result) || ''
}

export async function callVisionLLM(imageUrls: string[], prompt: string): Promise<string> {
  const result = await apiClient.run('wavespeed-ai/any-llm/vision', {
    images: imageUrls,
    prompt,
  })
  return extractOutput(result) || ''
}

export async function callImageQA(imageUrls: string[], question: string): Promise<string> {
  const result = await apiClient.run('wavespeed-ai/molmo2/image-qa', {
    images: imageUrls,
    question,
  }, { enableSyncMode: true })
  return extractOutput(result) || ''
}

export async function callVideoQA(videoUrl: string, question: string): Promise<string> {
  const result = await apiClient.run('wavespeed-ai/molmo2/video-qa', {
    video: videoUrl,
    text: question,
  })
  return extractOutput(result) || ''
}

export async function callImageCaptioner(imageUrl: string, detail: string = 'detailed'): Promise<string> {
  const result = await apiClient.run('wavespeed-ai/molmo2/image-captioner', {
    image: imageUrl,
    detail,
  }, { enableSyncMode: true })
  return extractOutput(result) || ''
}

export async function callVideoCaptioner(videoUrl: string, detail: string = 'detailed'): Promise<string> {
  const result = await apiClient.run('wavespeed-ai/molmo2/video-captioner', {
    video: videoUrl,
    detail,
  })
  return extractOutput(result) || ''
}

// ─── NSFW Detection (content-moderator/text) ─────────────────────────────────

/**
 * Detect NSFW/unsafe content using content-moderator/text API.
 * Returns structured categories: { sexual, harassment, hate, violence, sexual/minors }
 * If any category is true → content is flagged.
 */
export async function detectNSFW(text: string): Promise<boolean> {
  try {
    const result = await apiClient.run('wavespeed-ai/content-moderator/text', { text })
    const out = result.outputs?.[0]
    if (typeof out === 'object' && out !== null) {
      const obj = out as Record<string, unknown>
      // Check all moderation categories
      return (
        obj.sexual === true ||
        obj.harassment === true ||
        obj.hate === true ||
        obj.violence === true ||
        obj['sexual/minors'] === true
      )
    }
    return false
  } catch {
    return false // fail open — assume safe if detection fails
  }
}

// ─── Prompt Optimizer (handles NSFW-safe rewriting) ──────────────────────────

export async function callPromptOptimizer(
  text: string,
  mode: SmartMode,
  sourceImage?: string,
): Promise<string> {
  const optimizerMode = isVideoMode(mode) ? 'video' : 'image'
  const input: Record<string, unknown> = {
    text,
    mode: optimizerMode,
    style: 'default',
  }
  if (sourceImage) {
    input.image = sourceImage
  }
  const result = await apiClient.run('wavespeed-ai/prompt-optimizer', input)
  const out = extractOutput(result)
  return out || text // fallback to original if optimizer returns nothing
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function getUILanguage(): string {
  const lang = i18n.language
  if (lang.startsWith('zh')) return 'Chinese'
  if (lang.startsWith('ja')) return 'Japanese'
  if (lang.startsWith('ko')) return 'Korean'
  if (lang.startsWith('de')) return 'German'
  if (lang.startsWith('fr')) return 'French'
  if (lang.startsWith('es')) return 'Spanish'
  if (lang.startsWith('pt')) return 'Portuguese'
  if (lang.startsWith('id')) return 'Indonesian'
  if (lang.startsWith('ar')) return 'Arabic'
  if (lang.startsWith('hi')) return 'Hindi'
  if (lang.startsWith('ru')) return 'Russian'
  if (lang.startsWith('it')) return 'Italian'
  if (lang.startsWith('th')) return 'Thai'
  if (lang.startsWith('vi')) return 'Vietnamese'
  if (lang.startsWith('tr')) return 'Turkish'
  if (lang.startsWith('ms')) return 'Malay'
  return 'English'
}

const TIER1_SCORING_PROMPT = `Rate this AI-generated image/video on a scale of 0.0 to 10.0 (one decimal place). Consider:
- How well it matches the prompt (most important)
- Visual quality and clarity
- Composition and aesthetics
- Anatomical defects (ANY of these → score below 4.0):
  · Extra/missing/fused limbs, fingers, arms, legs
  · Deformed, webbed, or claw-like hands/fingers; floating or disconnected body parts
  · Distorted, asymmetrical, or double faces; mutated facial features
  · Impossible body proportions; stretched, melted, or misaligned body parts
- Structural defects (heavily reduce score):
  · Melted or merged objects; duplicated/cloned elements
  · Impossible geometry, crooked perspective, misaligned edges
  · Garbled, unreadable, or phantom text; watermarks, signatures, logos
  · Unnatural skin texture (waxy, plastic); uncanny valley effect
- Quality defects (reduce score):
  · Blurry, pixelated, or noisy regions; compression artifacts
  · Overexposed/underexposed areas; inconsistent lighting/shadows
  · Weird double edges; unfinished or low-detail areas

Prompt: "{prompt}"

Reply with ONLY a JSON object, no other text: {"score": <0.0-10.0>, "brief": "<one sentence>"}
Example: {"score": 2.1, "brief": "Person has six fingers and a third arm — severe anatomical defects"}`

// Relaxed scoring for VIDEO — molmo2 video-qa tends to under-score generated videos
const TIER1_VIDEO_SCORING_PROMPT = `Rate this AI-generated video on a scale of 0.0 to 10.0 (one decimal place).
Video generation models produce lower fidelity than image models — be lenient on quality.

Score primarily based on:
1. Prompt match (most important): Does the video show what was requested?
   · Core subject/action clearly present → 6.0+
   · Subject present but wrong action or scene → 4.0-6.0
   · Completely unrelated content → below 4.0

2. Motion & temporal coherence:
   · Smooth, natural motion → bonus
   · Severe flickering, frozen frames, or visual glitches throughout → reduce score
   · Minor jitter or brief artifacts are acceptable for AI video

3. Critical defects ONLY (score below 4.0):
   · Extra/missing limbs on human subjects
   · Video is mostly black, solid color, or garbled noise
   · Subject completely melts or disintegrates mid-video

Do NOT heavily penalize:
- Slight blur or softness (normal for AI video)
- Minor lighting inconsistencies
- Brief face distortion in a few frames
- Lower resolution or compression artifacts

If the video clearly shows the requested subject/action with no critical defects → 6.0 or above.

Prompt: "{prompt}"

Reply with ONLY a JSON object, no other text: {"score": <0.0-10.0>, "brief": "<one sentence>"}
Example: {"score": 7.0, "brief": "Video shows requested scene with smooth motion, minor softness"}`

// Relaxed scoring for NSFW content — only checks subject presence + limb integrity
const TIER1_NSFW_SCORING_PROMPT = `Rate this AI-generated image/video on a scale of 0.0 to 10.0 (one decimal place).
You are evaluating TECHNICAL quality ONLY. Do NOT penalize for any mature/adult content. Focus ONLY on:

1. Subject presence (most important): Does the output contain the main subject described in the prompt? (person, character, scene elements)
   · Subject clearly present and recognizable → 6.0+
   · Subject missing or completely wrong → below 4.0

2. Limb & body integrity (critical):
   · Extra limbs (3+ arms, 3+ legs) → score below 4.0
   · Missing limbs (0 arms when should have 2) → score below 4.0
   · Fused/merged body parts → score below 4.0
   · Normal anatomy with minor imperfections → 6.0+

3. Basic visual coherence:
   · Image/video is not a black screen, solid color, or garbled noise
   · Main subject is not completely melted or unrecognizable

If subject is present AND no extra/missing limbs → score 6.0 or above.
Minor quality issues (lighting, blur, small artifacts) should NOT reduce score below 6.0.

Prompt: "{prompt}"

Reply with ONLY a JSON object, no other text: {"score": <0.0-10.0>, "brief": "<one sentence>"}
Example: {"score": 7.5, "brief": "Subject present with correct anatomy, minor lighting issues"}`

const TIER2_ANALYSIS_PROMPT = `You are a professional content quality analyst. Look at this AI-generated image/video carefully and analyze it in detail.

Original prompt: "{prompt}"

Score each dimension on a 0.0-10.0 scale (one decimal place) and provide overall analysis:
1. Clarity & sharpness (blurry regions, pixelation, noise, compression artifacts, unfinished details)
2. Composition & aesthetics (crooked perspective, misaligned edges, cluttered/duplicated elements, bad framing)
3. Prompt adherence
4. Color & lighting (overexposed/underexposed, washed-out, inconsistent shadows, unnatural reflections, color banding)
5. Anatomical & structural correctness — CRITICAL, check ALL of:
   · Extra/missing/fused limbs, fingers, arms, legs; floating or disconnected body parts
   · Deformed, webbed, or claw-like hands; wrong finger count
   · Distorted, asymmetrical, or double faces; mutated or misplaced facial features
   · Impossible body proportions; stretched, melted, or misaligned body parts
   · Melted/merged objects; garbled/phantom text; watermarks, signatures, logos
   · Unnatural skin (waxy, plastic); uncanny valley effect; weird double edges
   ANY anatomical or severe structural defect → anatomy score ≤ 4.0, totalScore capped at 4.0
6. Overall impression

Reply in {language}. Respond with JSON:
{
  "scores": {"clarity": <0.0-10.0>, "composition": <n>, "adherence": <n>, "color": <n>, "anatomy": <n>, "overall": <n>},
  "totalScore": <0.0-10.0>,
  "analysis": "<detailed analysis>",
  "improvements": ["<suggestion1>", "<suggestion2>", "<suggestion3>"],
  "quickFeedback": ["<feedback option 1>", "<feedback option 2>", "<feedback option 3>"]
}`

// Race a promise against a timeout (ms). Rejects with 'timeout' on expiry.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

const SCORING_TIMEOUT_MS = 20_000

export async function quickScore(outputUrl: string, prompt: string, mode: SmartMode, isNsfw = false): Promise<{ score: number; brief: string }> {
  const template = isNsfw
    ? TIER1_NSFW_SCORING_PROMPT
    : isVideoMode(mode)
      ? TIER1_VIDEO_SCORING_PROMPT
      : TIER1_SCORING_PROMPT
  const question = template.replace('{prompt}', () => prompt)
  try {
    const raw = await withTimeout(
      isVideoMode(mode)
        ? callVideoQA(outputUrl, question)
        : callVisionLLM([outputUrl], question),
      SCORING_TIMEOUT_MS,
    )
    const result = parseScoreResponse(raw)
    // NSFW bonus: +10 base score so borderline content (50+) can pass the 60 threshold
    if (isNsfw) {
      result.score = Math.min(100, result.score + 10)
    }
    return result
  } catch (err) {
    // Timeout or API error → default score: images 60, videos 50
    const defaultScore = isVideoMode(mode) ? 50 : 60
    return { score: defaultScore, brief: 'Scoring timeout' }
  }
}

export async function deepAnalyze(
  outputUrl: string,
  prompt: string,
  mode: SmartMode
): Promise<{ totalScore: number; analysis: string; improvements: string[]; quickFeedback: string[] }> {
  try {
    const lang = getUILanguage()
    const analysisPrompt = TIER2_ANALYSIS_PROMPT
      .replace('{prompt}', () => prompt)
      .replace('{language}', lang)

    // Vision model looks at the image/video directly for accurate defect detection
    const raw = await withTimeout(
      isVideoMode(mode)
        ? callVideoQA(outputUrl, analysisPrompt)
        : callVisionLLM([outputUrl], analysisPrompt),
      SCORING_TIMEOUT_MS,
    )
    return parseTier2Response(raw)
  } catch (err) {
    // Timeout or API error → default score: images 60, videos 50
    const defaultScore = isVideoMode(mode) ? 50 : 60
    return { totalScore: defaultScore, analysis: 'Analysis timeout', improvements: [], quickFeedback: [] }
  }
}

export async function verifyFeedback(outputUrl: string, question: string, mode: SmartMode): Promise<string> {
  try {
    return isVideoMode(mode)
      ? await callVideoQA(outputUrl, question)
      : await callVisionLLM([outputUrl], question)
  } catch {
    return 'Verification failed'
  }
}

// ─── Prompt Optimization ─────────────────────────────────────────────────────

const PROMPT_OPTIMIZE_SYSTEM = `You are a creative prompt engineer for AI image/video generation. Your task is to take a user's prompt and create {count} diverse, high-quality prompt variants that will produce different but excellent results.

Rules:
1. Each variant should explore a different creative angle (composition, style, mood, perspective)
2. Preserve the core intent of the original prompt
3. Be specific and descriptive - add details about lighting, composition, style, colors
4. {langRule}
5. If image context is provided, incorporate it naturally
6. Reply in {language}

Respond ONLY with a JSON array of strings: ["variant1", "variant2", ...]`

export async function optimizePrompt(
  prompt: string,
  count: number,
  mode: SmartMode,
  modelAdapter: ModelAdapter,
  imageDescription?: string,
): Promise<string[]> {
  const langRule = modelAdapter.supportsChinesePrompt
    ? 'Keep the prompt in the same language as the user input'
    : 'Always write prompts in English, translating if needed'
  const lang = getUILanguage()

  const system = PROMPT_OPTIMIZE_SYSTEM
    .replace('{count}', String(count))
    .replace('{langRule}', langRule)
    .replace('{language}', lang)

  let userMsg = `Mode: ${mode}\nOriginal prompt: "${prompt}"`
  if (imageDescription) {
    userMsg += `\nSource image description: "${imageDescription}"`
  }

  try {
    // Pre-check: if prompt is NSFW, skip LLM (it will refuse) and use prompt-optimizer
    const nsfw = await detectNSFW(prompt)
    if (nsfw) {
      const safePrompt = await callPromptOptimizer(prompt, mode)
      return [safePrompt]
    }

    const raw = await callLLM(system, userMsg)
    const variants = parseJsonArray(raw)
    if (variants.length > 0) return variants.slice(0, count)
    // Fallback: return original prompt
    return [prompt]
  } catch {
    return [prompt]
  }
}

// ─── Chat ────────────────────────────────────────────────────────────────────

const CHAT_SYSTEM_PROMPT = `You are a helpful assistant for an AI image/video generation tool. The user is refining their generated content.

Context:
- Mode: {mode}
- Original prompt: "{prompt}"
- Best score: {score}/100
- Analysis: {analysis}
- User preferences: {preferences}
{imageContext}
Help the user refine their prompt or suggest improvements.
Reply in {language}.

IMPORTANT: When suggesting an improved prompt, ALWAYS use this exact JSON format on its own line:
{"action": "regenerate", "prompt": "<the full improved prompt>"}

You can include a brief explanation before the JSON. If the user is just chatting or asking questions (not requesting changes), respond normally without JSON.`

export function buildChatSystemPrompt(
  mode: SmartMode,
  prompt: string,
  score: number,
  analysis: string,
  preferences: string,
  imageDescription?: string,
): string {
  const lang = getUILanguage()
  const isVideo = isVideoMode(mode)
  const imageContext = imageDescription
    ? `- ${isVideo ? 'Generated video' : 'Source image'} description: "${imageDescription}"\n`
    : ''
  return CHAT_SYSTEM_PROMPT
    .replace('{mode}', mode)
    .replace('{prompt}', () => prompt)
    .replace('{score}', String(score))
    .replace('{analysis}', () => analysis)
    .replace('{preferences}', () => preferences || 'None')
    .replace('{imageContext}', () => imageContext)
    .replace('{language}', lang)
}

// ─── Context Memory ──────────────────────────────────────────────────────────

const COMPRESS_PROMPT = `Summarize the user's preferences and style requirements from the conversation messages and their current prompt into a concise paragraph. The current prompt reflects the user's LATEST intent and should take priority over older messages. Focus on:
- Preferred visual styles, colors, moods
- Quality expectations
- Common feedback patterns
- Specific likes/dislikes

Reply in {language}.
Current prompt: {currentPrompt}
Recent messages: {messages}`

export async function compressMemory(messages: ChatMessage[], currentPrompt?: string): Promise<string> {
  const lang = getUILanguage()
  const msgJson = JSON.stringify(messages.slice(-10).map(m => ({ role: m.role, content: m.content })))
  const prompt = COMPRESS_PROMPT
    .replace('{language}', lang)
    .replace('{currentPrompt}', () => currentPrompt || '(none)')
    .replace('{messages}', () => msgJson)

  try {
    return await callLLM('You are a concise summarizer.', prompt)
  } catch {
    return ''
  }
}

const LAYER2_STORAGE_KEY = 'wavespeed_smart_generate_preferences'

export function loadLayer2(): string {
  try {
    return localStorage.getItem(LAYER2_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveLayer2(summary: string): void {
  try {
    localStorage.setItem(LAYER2_STORAGE_KEY, summary)
  } catch {
    // ignore
  }
}

// ─── Cost Estimation ─────────────────────────────────────────────────────────

const AUXILIARY_COST_PER_ROUND = 0.025 // LLM + QA + captioner + moderator

export function estimateCost(modelId: string, parallelCount: number, rounds: number = 3): { min: number; max: number } {
  const adapter = getModelAdapter(modelId)
  if (!adapter) return { min: 0, max: 0 }
  const perRound = adapter.price * parallelCount + AUXILIARY_COST_PER_ROUND
  return {
    min: perRound, // 1 round
    max: perRound * rounds,
  }
}

export function getRecommendedBudget(modelId: string): { min: number; max: number } {
  const adapter = getModelAdapter(modelId)
  if (!adapter) return { min: 0.50, max: 5.00 }
  // Budget enough for 3-5 rounds of 2 variants
  const perRound = adapter.price * 2 + AUXILIARY_COST_PER_ROUND
  return {
    min: Math.max(0.10, +(perRound * 2).toFixed(2)),
    max: +(perRound * 5).toFixed(2),
  }
}

export async function checkBalance(): Promise<{ sufficient: boolean; balance: number; minCost: number }> {
  const balance = await apiClient.getBalance()
  const minCost = 0.05 // minimum to even start
  return { sufficient: balance >= minCost, balance, minCost }
}

// ─── Score Parsing ───────────────────────────────────────────────────────────

// Convert 10-point score to 0-100 internal scale
function toHundred(score10: number): number {
  return Math.min(100, Math.max(0, Math.round(score10 * 10)))
}

export function parseScoreResponse(raw: string): { score: number; brief: string } {
  // Try JSON parse first
  try {
    const json = extractJson(raw)
    if (json && !Array.isArray(json) && typeof (json as Record<string, unknown>).score === 'number') {
      const obj = json as Record<string, unknown>
      const rawScore = obj.score as number
      // Score is on 0-10 scale, convert to 0-100
      const score = rawScore <= 10 ? toHundred(rawScore) : Math.min(100, Math.max(0, Math.round(rawScore)))
      return { score, brief: (obj.brief as string) || '' }
    }
  } catch {
    // regex fallback
  }
  // Regex fallback: look for decimal number like "7.3" or "8.5" first
  const decimalMatch = raw.match(/(\d+\.\d+)/)
  if (decimalMatch) {
    const val = parseFloat(decimalMatch[1])
    if (val <= 10) return { score: toHundred(val), brief: '' }
    return { score: Math.min(100, Math.max(0, Math.round(val))), brief: '' }
  }
  // Fallback: find any number
  const intMatch = raw.match(/\b(\d{1,3})\b/)
  if (intMatch) {
    const val = parseInt(intMatch[1])
    if (val <= 10) return { score: toHundred(val), brief: '' }
    return { score: Math.min(100, Math.max(0, val)), brief: '' }
  }
  console.warn('[SmartGen] Could not parse score from:', raw.substring(0, 100))
  return { score: 50, brief: '' }
}

function parseTier2Response(raw: string): { totalScore: number; analysis: string; improvements: string[]; quickFeedback: string[] } {
  try {
    const json = extractJson(raw)
    if (json && !Array.isArray(json)) {
      const obj = json as Record<string, unknown>
      if (typeof obj.totalScore === 'number') {
        const rawScore = obj.totalScore as number
        const totalScore = rawScore <= 10 ? toHundred(rawScore) : Math.min(100, Math.max(0, Math.round(rawScore)))
        return {
          totalScore,
          analysis: (obj.analysis as string) || '',
          improvements: Array.isArray(obj.improvements) ? obj.improvements as string[] : [],
          quickFeedback: Array.isArray(obj.quickFeedback) ? obj.quickFeedback as string[] : [],
        }
      }
    }
  } catch {
    // fallback
  }
  return { totalScore: 50, analysis: raw, improvements: [], quickFeedback: [] }
}

function parseJsonArray(raw: string): string[] {
  try {
    const json = extractJson(raw)
    if (Array.isArray(json)) return json.filter(s => typeof s === 'string')
  } catch {
    // fallback
  }
  // Try regex: find strings in brackets
  const matches = raw.match(/"([^"]+)"/g)
  if (matches) return matches.map(m => m.replace(/^"|"$/g, ''))
  return []
}

function extractJson(raw: string): Record<string, unknown> | unknown[] | null {
  // Try direct parse
  try {
    return JSON.parse(raw)
  } catch {
    // Try extracting JSON from markdown code block
    const codeMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeMatch) {
      try {
        return JSON.parse(codeMatch[1].trim())
      } catch {
        // fall through
      }
    }
    // Try finding first { or [
    const startObj = raw.indexOf('{')
    const startArr = raw.indexOf('[')
    const start = startObj >= 0 && startArr >= 0 ? Math.min(startObj, startArr) : Math.max(startObj, startArr)
    if (start >= 0) {
      const isArray = raw[start] === '['
      const end = raw.lastIndexOf(isArray ? ']' : '}')
      if (end > start) {
        try {
          return JSON.parse(raw.substring(start, end + 1))
        } catch {
          // give up
        }
      }
    }
  }
  return null
}

// ─── Score Labels ────────────────────────────────────────────────────────────

export function getScoreLabel(score: number): string {
  if (score >= 95) return 'smartGenerate.score.perfect'
  if (score >= 85) return 'smartGenerate.score.excellent'
  if (score >= 75) return 'smartGenerate.score.good'
  if (score >= 60) return 'smartGenerate.score.fair'
  return 'smartGenerate.score.needsWork'
}

export function getScoreColor(score: number): string {
  if (score >= 95) return '#10b981' // emerald
  if (score >= 85) return '#22c55e' // green
  if (score >= 75) return '#3b82f6' // blue
  if (score >= 60) return '#f59e0b' // amber
  return '#ef4444' // red
}

// ─── Tag Labels ──────────────────────────────────────────────────────────────

export function getTagLabelKey(tag: string): string {
  const map: Record<string, string> = {
    recommended: 'smartGenerate.tag.recommended',
    ultimate: 'smartGenerate.tag.ultimate',
    value: 'smartGenerate.tag.value',
    fast: 'smartGenerate.tag.fast',
    turbo: 'smartGenerate.tag.turbo',
    flagship: 'smartGenerate.tag.flagship',
    premium: 'smartGenerate.tag.premium',
    chinese: 'smartGenerate.tag.chinese',
    detail: 'smartGenerate.tag.detail',
    understanding: 'smartGenerate.tag.understanding',
    lora: 'smartGenerate.tag.lora',
  }
  return map[tag] || tag
}

// ─── Error Classification ────────────────────────────────────────────────────

export function isPermanentError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return msg.includes('model not found') ||
      msg.includes('invalid input') ||
      msg.includes('not supported') ||
      msg.includes('deprecated') ||
      msg.includes('cannot fetch content') ||
      msg.includes('[404]') ||
      msg.includes('[422]')
  }
  return false
}

export function isContentPolicyError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return msg.includes('content policy') ||
      msg.includes('nsfw') ||
      msg.includes('safety') ||
      msg.includes('inappropriate') ||
      msg.includes('moderation') ||
      msg.includes('violat') ||
      msg.includes('prohibited') ||
      msg.includes('blocked')
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('429') || error.message.toLowerCase().includes('rate limit')
  }
  return false
}

// ─── Run Generation ──────────────────────────────────────────────────────────

export async function runGeneration(
  modelId: string,
  prompt: string,
  _mode: SmartMode,
  sourceImages?: string[],
  seed?: number,
  sizeValue?: string,
  resolutionValue?: string,
  extraConfigValues?: Record<string, unknown>,
): Promise<PredictionResult> {
  const adapter = getModelAdapter(modelId)
  if (!adapter) throw new Error(`Unknown model: ${modelId}`)

  const input: Record<string, unknown> = {
    [adapter.promptField]: prompt,
    ...adapter.extraDefaults,
  }

  if (adapter.imageField && sourceImages && sourceImages.length > 0) {
    // Plural field names (e.g. 'images') expect an array; singular expects single URL
    input[adapter.imageField] = adapter.imageField.endsWith('s')
      ? sourceImages
      : sourceImages[0]
  }

  if (seed !== undefined && adapter.seedField) {
    input[adapter.seedField] = seed
  }

  // Add size/aspect_ratio if provided
  if (sizeValue) {
    const sizeConfig = getSizeFieldConfig(modelId)
    if (sizeConfig) {
      input[sizeConfig.fieldName] = sizeValue
    }
  }

  // Add resolution if provided (e.g. "1k"/"2k"/"4k")
  if (resolutionValue) {
    const resConfig = getResolutionFieldConfig(modelId)
    if (resConfig) {
      input[resConfig.fieldName] = resolutionValue
    }
  }

  // Apply extra config values from model-specific fields (duration, resolution override, loras, etc.)
  if (extraConfigValues) {
    for (const [key, value] of Object.entries(extraConfigValues)) {
      if (value !== undefined && value !== null && value !== '') {
        // For 'duration', convert string to number
        if (key === 'duration' && typeof value === 'string') {
          input[key] = parseInt(value, 10)
        } else {
          input[key] = value
        }
      }
    }
  }

  return apiClient.run(modelId, input)
}

export function generateRandomSeed(): number {
  return Math.floor(Math.random() * 65536)
}

/**
 * Upscale an image to 2K using WaveSpeed's upscaler API.
 * Used when a model (e.g. Seedream Edit) requires a minimum source image size.
 */
const UPSCALER_MODEL = 'wavespeed-ai/ultimate-image-upscaler'

export async function upscaleImage(imageUrl: string): Promise<string> {
  const result = await apiClient.run(UPSCALER_MODEL, {
    image: imageUrl,
    target_resolution: '4k',
    output_format: 'jpeg',
    enable_base64_output: false,
  })
  const output = extractOutput(result)
  if (!output) throw new Error('Upscaler returned no output')
  return output
}

/**
 * Check if a model requires minimum source image pixels.
 * Returns the min pixel count from schema, or 0 if no minimum.
 */
export function getModelMinPixels(modelId: string): number {
  const cfg = getSizeFieldConfig(modelId)
  if (!cfg || cfg.type !== 'dimensions') return 0
  const minDim = cfg.min || 0
  return minDim * minDim
}

export { extractOutput }
