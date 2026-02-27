import type { Model, SchemaProperty } from '@/types/model'

export interface FormFieldConfig {
  name: string
  type: 'text' | 'textarea' | 'number' | 'slider' | 'boolean' | 'select' | 'file' | 'file-array' | 'size' | 'loras'
  label: string
  required: boolean
  default?: unknown
  min?: number
  max?: number
  step?: number
  options?: (string | number)[]
  description?: string
  accept?: string
  maxFiles?: number
  placeholder?: string
  hidden?: boolean  // x-hidden fields are optional and hidden by default
  schemaType?: string  // Original schema type (e.g. 'integer' vs 'number')
}

export function validateFormValues(fields: FormFieldConfig[], values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const field of fields) {
    const value = values[field.name]
    const isEmpty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)

    if (field.required && isEmpty) {
      errors[field.name] = `${field.label} is required`
      continue
    }

    if (isEmpty) continue

    if (field.type === 'number' || field.type === 'slider') {
      const num = Number(value)
      if (Number.isNaN(num)) {
        errors[field.name] = `${field.label} must be a number`
        continue
      }
      if (field.min !== undefined && num < field.min) {
        errors[field.name] = `${field.label} must be at least ${field.min}`
      } else if (field.max !== undefined && num > field.max) {
        errors[field.name] = `${field.label} must be at most ${field.max}`
      }
    }

    if (field.type === 'size') {
      const raw = String(value)
      const parts = raw.split('*')
      const w = Number(parts[0])
      const h = Number(parts[1])
      if (parts.length !== 2 || Number.isNaN(w) || Number.isNaN(h)) {
        errors[field.name] = `${field.label} must be in the format WIDTH*HEIGHT`
      } else if (
        (field.min !== undefined && (w < field.min || h < field.min)) ||
        (field.max !== undefined && (w > field.max || h > field.max))
      ) {
        errors[field.name] = `${field.label} must be between ${field.min} and ${field.max}`
      }
    }
  }

  return errors
}

// Detect file input type based on field name patterns
function detectFileType(name: string): { accept: string; type: 'file' | 'file-array' } | null {
  const lowerName = name.toLowerCase()

  // Check for plural forms (arrays)
  if (lowerName.endsWith('images') || lowerName.endsWith('image_urls')) {
    return { accept: 'image/*', type: 'file-array' }
  }
  if (lowerName.endsWith('videos') || lowerName.endsWith('video_urls')) {
    return { accept: 'video/*', type: 'file-array' }
  }
  if (lowerName.endsWith('audios') || lowerName.endsWith('audio_urls')) {
    return { accept: 'audio/*', type: 'file-array' }
  }

  // Check for singular patterns (matches *image, *video, *audio)
  if (lowerName.endsWith('image') || lowerName.endsWith('image_url')) {
    return { accept: 'image/*', type: 'file' }
  }
  if (lowerName.endsWith('video') || lowerName.endsWith('video_url')) {
    return { accept: 'video/*', type: 'file' }
  }
  if (lowerName.endsWith('audio') || lowerName.endsWith('audio_url')) {
    return { accept: 'audio/*', type: 'file' }
  }

  return null
}

// Fields that should use textarea
const TEXTAREA_FIELDS = ['prompt', 'negative_prompt', 'text', 'description', 'content']

// Fields to hide from the form (internal API options)
const HIDDEN_FIELDS = ['enable_base64_output', 'enable_sync_mode']

export function schemaToFormFields(
  properties: Record<string, SchemaProperty>,
  required: string[] = [],
  orderProperties?: string[]
): FormFieldConfig[] {
  const fields: FormFieldConfig[] = []

  for (const [name, prop] of Object.entries(properties)) {
    // Skip hidden fields
    if (HIDDEN_FIELDS.includes(name)) {
      continue
    }
    const field = propertyToField(name, prop, required.includes(name))
    if (field) {
      fields.push(field)
    }
  }

  // Sort fields by x-order-properties if provided
  if (orderProperties && orderProperties.length > 0) {
    return fields.sort((a, b) => {
      const indexA = orderProperties.indexOf(a.name)
      const indexB = orderProperties.indexOf(b.name)
      // Fields not in order array go to the end
      const orderA = indexA === -1 ? Infinity : indexA
      const orderB = indexB === -1 ? Infinity : indexB
      return orderA - orderB
    })
  }

  // Fallback: required first, then prompt, then alphabetically
  return fields.sort((a, b) => {
    if (a.required !== b.required) {
      return a.required ? -1 : 1
    }
    if (a.name === 'prompt') return -1
    if (b.name === 'prompt') return 1
    return a.name.localeCompare(b.name)
  })
}

function propertyToField(
  name: string,
  prop: SchemaProperty,
  required: boolean
): FormFieldConfig | null {
  const baseField = {
    name,
    label: prop.title || formatLabel(name),
    required: prop['x-hidden'] ? false : required,  // x-hidden fields are never required
    default: prop.default,
    description: prop.description,
    hidden: !!prop['x-hidden'],
  }

  // Handle x-ui-component: uploader (for zip files etc.)
  if (prop['x-ui-component'] === 'uploader') {
    // If no x-accept, try to infer from field name
    let fileAccept = prop['x-accept']
    if (!fileAccept) {
      const inferred = detectFileType(name)
      fileAccept = inferred?.accept || '*/*'
    }
    return {
      ...baseField,
      type: 'file',
      accept: fileAccept,
      placeholder: prop['x-placeholder'],
    }
  }

  // Check if this is a file input field (string type with matching name pattern)
  if (prop.type === 'string') {
    const filePattern = detectFileType(name)
    if (filePattern) {
      return {
        ...baseField,
        type: filePattern.type,
        accept: filePattern.accept,
        maxFiles: prop.maxItems || (filePattern.type === 'file-array' ? 10 : 1),
      }
    }
  }

  // Handle 'data' field as file upload (commonly used for training data)
  if (name.toLowerCase() === 'data' && prop.type === 'string') {
    return {
      ...baseField,
      type: 'file',
      accept: prop['x-accept'] || '*/*',
      placeholder: prop['x-placeholder'],
    }
  }

  // Handle loras fields (including high_noise_loras, low_noise_loras)
  if (prop['x-ui-component'] === 'loras' || (name.toLowerCase().includes('lora') && prop.type === 'array')) {
    return {
      ...baseField,
      type: 'loras',
      maxFiles: prop.maxItems || 3,
    }
  }

  // Handle array type (could be file array)
  if (prop.type === 'array') {
    const lowerName = name.toLowerCase()
    // Check if it's an array of strings that looks like URLs/files
    if (lowerName.includes('image') || lowerName.includes('video') || lowerName.includes('audio')) {
      let accept = 'image/*'
      if (lowerName.includes('video')) accept = 'video/*'
      else if (lowerName.includes('audio')) accept = 'audio/*'
      return {
        ...baseField,
        type: 'file-array',
        accept,
        maxFiles: prop.maxItems || 10,
      }
    }
    // Otherwise skip array types for now
    return null
  }

  // Handle enum type (including size with enum)
  if (prop.enum && prop.enum.length > 0) {
    return {
      ...baseField,
      type: 'select',
      options: prop.enum,
    }
  }

  // Handle size field without enum - use custom size selector with min/max
  if (name.toLowerCase() === 'size') {
    return {
      ...baseField,
      type: 'size',
      min: prop.minimum,
      max: prop.maximum,
    }
  }

  // Handle different types
  switch (prop.type) {
    case 'string':
      return {
        ...baseField,
        type: TEXTAREA_FIELDS.some(f => name.toLowerCase().includes(f)) ? 'textarea' : 'text',
      }

    case 'integer':
    case 'number':
      return {
        ...baseField,
        type: prop['x-ui-component'] === 'slider' ? 'slider' : 'number',
        schemaType: prop.type,
        min: prop.minimum,
        max: prop.maximum,
        step: prop.step,
      }

    case 'boolean':
      return {
        ...baseField,
        type: 'boolean',
      }

    default:
      // For unknown types, default to text
      return {
        ...baseField,
        type: 'text',
      }
  }
}

function formatLabel(name: string): string {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function getDefaultValues(fields: FormFieldConfig[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}

  for (const field of fields) {
    // Skip default values for loras - let user add them manually
    if (field.type === 'loras') {
      defaults[field.name] = []
      continue
    }
    if (field.default !== undefined) {
      defaults[field.name] = field.default
    } else if (field.type === 'boolean') {
      defaults[field.name] = false
    } else if (field.type === 'file-array') {
      defaults[field.name] = []
    }
  }

  return defaults
}

export type MediaType = 'image' | 'video' | 'audio'

const MEDIA_KEYS: Record<MediaType, { singular: string; plural: string; url: string; urls: string; suffixSingular: string; suffixPlural: string }> = {
  image: { singular: 'image', plural: 'images', url: 'image_url', urls: 'image_urls', suffixSingular: '_image', suffixPlural: 'images' },
  video: { singular: 'video', plural: 'videos', url: 'video_url', urls: 'video_urls', suffixSingular: '_video', suffixPlural: 'videos' },
  audio: { singular: 'audio', plural: 'audios', url: 'audio_url', urls: 'audio_urls', suffixSingular: '_audio', suffixPlural: 'audios' },
}

/** Get a single media URL from form values. Treats plural (e.g. "images") as singular by taking the first. */
export function getSingleMediaFromValues(
  values: Record<string, unknown> | undefined,
  mediaType: MediaType
): string | undefined {
  if (!values) return undefined
  const keys = MEDIA_KEYS[mediaType]
  const v = values[keys.singular]
  if (typeof v === 'string' && v) return v
  const arr = values[keys.plural]
  if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') return arr[0]
  if (mediaType === 'image') {
    const input = values['input']
    if (typeof input === 'string' && input) return input
  }
  for (const [key, val] of Object.entries(values)) {
    const k = key.toLowerCase()
    if (typeof val === 'string' && val && (k.endsWith(keys.suffixSingular) || k === keys.url)) return val
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string' &&
        (k.endsWith(keys.suffixPlural) || k.endsWith(keys.urls))) return val[0]
  }
  return undefined
}

/** Get media URL array from form values. Treats singular (e.g. "image") as array by wrapping. */
export function getMediaArrayFromValues(
  values: Record<string, unknown> | undefined,
  mediaType: MediaType
): string[] {
  if (!values) return []
  const keys = MEDIA_KEYS[mediaType]
  const arr = values[keys.plural]
  if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string')
  const single = values[keys.singular]
  if (typeof single === 'string' && single) return [single]
  const url = values[keys.url]
  if (typeof url === 'string' && url) return [url]
  const urls = values[keys.urls]
  if (Array.isArray(urls)) return urls.filter((x): x is string => typeof x === 'string')
  for (const [key, val] of Object.entries(values)) {
    const k = key.toLowerCase()
    if (k.endsWith(keys.suffixPlural) && Array.isArray(val)) return val.filter((x): x is string => typeof x === 'string')
    if ((k.endsWith(keys.suffixSingular) || k === keys.url) && typeof val === 'string' && val) return [val]
  }
  return []
}

/** Field names that the API typically expects as arrays (plural / _urls). */
const ARRAY_FIELD_PATTERNS = [
  'images', 'image_urls', 'videos', 'video_urls', 'audios', 'audio_urls'
]

function isArrayFieldName(key: string): boolean {
  const k = key.toLowerCase()
  // Skip fields that are clearly numeric (e.g. num_images, num_videos)
  if (k.startsWith('num_') || k.startsWith('number_') || k.startsWith('count_') || k.startsWith('total_')) return false
  return ARRAY_FIELD_PATTERNS.some(p => k === p || k.endsWith('_images') || k.endsWith('_image_urls') || k.endsWith('_videos') || k.endsWith('_video_urls') || k.endsWith('_audios') || k.endsWith('_audio_urls'))
}

/**
 * Ensure payload values for array-type fields are arrays. APIs often return
 * "value must be an array" when a field like `images` is sent as a string.
 * Use before calling the run/prediction API.
 */
export function normalizePayloadArrays(
  payload: Record<string, unknown>,
  formFields: FormFieldConfig[]
): Record<string, unknown> {
  const out = { ...payload }
  const arrayFieldNames = new Set<string>(
    formFields.filter(f => f.type === 'file-array').map(f => f.name)
  )
  for (const key of Object.keys(out)) {
    if (!arrayFieldNames.has(key) && !isArrayFieldName(key)) continue
    const v = out[key]
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) continue
    out[key] = [v]
  }
  // If API expects "images" but form only has "image", add images array (same for video/audio)
  const singularToPlural: [string, string][] = [['image', 'images'], ['image_url', 'image_urls'], ['video', 'videos'], ['video_url', 'video_urls'], ['audio', 'audios'], ['audio_url', 'audio_urls']]
  for (const [singular, plural] of singularToPlural) {
    if (out[plural] !== undefined) continue
    const single = out[singular]
    if (single === undefined || single === null || single === '') continue
    out[plural] = Array.isArray(single) ? single : [single]
  }
  return out
}

/** @deprecated Use getSingleMediaFromValues(values, 'image') */
export function getSingleImageFromValues(values: Record<string, unknown> | undefined): string | undefined {
  return getSingleMediaFromValues(values, 'image')
}

/** @deprecated Use getMediaArrayFromValues(values, 'image') */
export function getImageArrayFromValues(values: Record<string, unknown> | undefined): string[] {
  return getMediaArrayFromValues(values, 'image')
}

/** @deprecated Use getSingleMediaFromValues(values, 'video') */
export function getSingleVideoFromValues(values: Record<string, unknown> | undefined): string | undefined {
  return getSingleMediaFromValues(values, 'video')
}

/** @deprecated Use getMediaArrayFromValues(values, 'video') */
export function getVideoArrayFromValues(values: Record<string, unknown> | undefined): string[] {
  return getMediaArrayFromValues(values, 'video')
}

/** @deprecated Use getSingleMediaFromValues(values, 'audio') */
export function getSingleAudioFromValues(values: Record<string, unknown> | undefined): string | undefined {
  return getSingleMediaFromValues(values, 'audio')
}

/** @deprecated Use getMediaArrayFromValues(values, 'audio') */
export function getAudioArrayFromValues(values: Record<string, unknown> | undefined): string[] {
  return getMediaArrayFromValues(values, 'audio')
}

/** Extract form fields from a Desktop API Model using the same logic as the Playground (DynamicForm). */
export function getFormFieldsFromModel(model: Model): FormFieldConfig[] {
  const apiSchemas = (model.api_schema as Record<string, unknown> | undefined)?.api_schemas as Array<{
    type: string
    request_schema?: {
      properties?: Record<string, SchemaProperty>
      required?: string[]
      'x-order-properties'?: string[]
    }
  }> | undefined
  const requestSchema = apiSchemas?.find(s => s.type === 'model_run')?.request_schema
  if (!requestSchema?.properties) {
    return []
  }
  return schemaToFormFields(
    requestSchema.properties,
    requestSchema.required ?? [],
    requestSchema['x-order-properties']
  )
}
