/**
 * ZImage virtual model definition
 * This creates a Model object that can be used with the Playground UI
 * for local AI image generation via sd.cpp
 */

import type { Model } from '@/types/model'
import { PREDEFINED_MODELS } from '@/types/stable-diffusion'

// ZImage model ID prefix for detection
export const ZIMAGE_MODEL_PREFIX = 'local/z-image'

// Check if a model is a ZImage local model
export function isZImageModel(modelId: string): boolean {
  return modelId.startsWith(ZIMAGE_MODEL_PREFIX)
}

// Sampling methods available in sd.cpp
const SAMPLING_METHODS = [
  'euler',
  'euler_a',
  'heun',
  'dpm2',
  'dpm++2s_a',
  'dpm++2m',
  'dpm++2mv2',
  'ipndm',
  'ipndm_v',
  'lcm',
  'ddim_trailing',
  'tcd'
]

// Schedulers available in sd.cpp
const SCHEDULERS = [
  'simple',
  'discrete',
  'karras',
  'exponential',
  'ays',
  'gits',
  'smoothstep',
  'sgm_uniform',
  'lcm'
]

/**
 * Create the ZImage model schema for use with DynamicForm
 */
function createZImageSchema() {
  // Get model options from predefined models
  const modelOptions = PREDEFINED_MODELS.map(m => m.id)

  return {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        title: 'Model',
        description: 'Select a local Z-Image model to use for generation',
        enum: modelOptions,
        default: 'z-image-turbo-q4-k'
      },
      prompt: {
        type: 'string',
        title: 'Prompt',
        description: 'Describe what you want to generate',
        default: ''
      },
      negative_prompt: {
        type: 'string',
        title: 'Negative Prompt',
        description: 'Describe what you want to avoid',
        default: ''
      },
      size: {
        type: 'string',
        title: 'Size',
        description: 'Image dimensions',
        minimum: 256,
        maximum: 1536,
        default: '1024*1024'
      },
      steps: {
        type: 'integer',
        title: 'Steps',
        description: 'Number of sampling steps (4-50)',
        minimum: 4,
        maximum: 50,
        default: 8,
        'x-ui-component': 'slider' as const
      },
      cfg_scale: {
        type: 'number',
        title: 'CFG Scale',
        description: 'Classifier-free guidance scale (1-20)',
        minimum: 1,
        maximum: 20,
        step: 0.5,
        default: 1,
        'x-ui-component': 'slider' as const
      },
      seed: {
        type: 'integer',
        title: 'Seed',
        description: 'Random seed for reproducibility (leave empty for random)'
      },
      sampling_method: {
        type: 'string',
        title: 'Sampling Method',
        description: 'Algorithm for denoising',
        enum: SAMPLING_METHODS,
        default: 'euler'
      },
      scheduler: {
        type: 'string',
        title: 'Scheduler',
        description: 'Noise schedule type',
        enum: SCHEDULERS,
        default: 'simple'
      }
    },
    required: ['model'],
    'x-order-properties': [
      'model',
      'prompt',
      'negative_prompt',
      'size',
      'steps',
      'cfg_scale',
      'sampling_method',
      'scheduler',
      'seed'
    ]
  }
}

/**
 * Create the ZImage Model object for the Playground
 */
export function createZImageModel(): Model {
  const schema = createZImageSchema()

  return {
    model_id: `${ZIMAGE_MODEL_PREFIX}/turbo`,
    name: 'Z-Image (Local)',
    description: 'Run AI image generation locally on your computer using sd.cpp. No API key or internet required.',
    type: 'image',
    base_price: 0, // Free - runs locally
    sort_order: 10000, // Show at top
    api_schema: {
      openapi: '3.0.0',
      info: {
        title: 'Z-Image Local',
        version: '1.0.0'
      },
      paths: {},
      components: {
        schemas: {
          Request: schema
        }
      },
      // This is the format DynamicForm expects
      api_schemas: [{
        type: 'model_run',
        request_schema: schema
      }]
    }
  } as Model
}

/**
 * Default prompts for ZImage
 */
export const ZIMAGE_DEFAULT_PROMPT = 'Portrait of a beautiful woman with elegant features, professional fashion photography, studio lighting, soft focus background, glamorous makeup, flowing hair, confident pose, haute couture dress, sophisticated aesthetic, photorealistic, high detail, 8k quality'
export const ZIMAGE_DEFAULT_NEGATIVE_PROMPT = 'blurry, bad quality, low resolution, watermark, distorted, ugly, deformed, extra limbs, poorly drawn, bad anatomy'
