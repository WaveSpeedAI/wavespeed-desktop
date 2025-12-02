import type { SchemaProperty } from '@/types/model'

export interface FormFieldConfig {
  name: string
  type: 'text' | 'textarea' | 'number' | 'slider' | 'boolean' | 'select' | 'file' | 'file-array' | 'size' | 'loras'
  label: string
  required: boolean
  default?: unknown
  min?: number
  max?: number
  step?: number
  options?: string[]
  description?: string
  accept?: string
  maxFiles?: number
  placeholder?: string
}

// Field names that indicate file inputs
const FILE_FIELD_PATTERNS: Record<string, { accept: string; type: 'file' | 'file-array' }> = {
  video: { accept: 'video/*', type: 'file' },
  video_url: { accept: 'video/*', type: 'file' },
  input_video: { accept: 'video/*', type: 'file' },
  image: { accept: 'image/*', type: 'file' },
  image_url: { accept: 'image/*', type: 'file' },
  input_image: { accept: 'image/*', type: 'file' },
  images: { accept: 'image/*', type: 'file-array' },
  image_urls: { accept: 'image/*', type: 'file-array' },
  audio: { accept: 'audio/*', type: 'file' },
  audio_url: { accept: 'audio/*', type: 'file' },
  input_audio: { accept: 'audio/*', type: 'file' },
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
    required,
    default: prop.default,
    description: prop.description,
  }

  // Handle x-ui-component: uploader (for zip files etc.)
  if (prop['x-ui-component'] === 'uploader') {
    return {
      ...baseField,
      type: 'file',
      accept: prop['x-accept'] || '*/*',
      placeholder: prop['x-placeholder'],
    }
  }

  // Check if this is a file input field
  const filePattern = FILE_FIELD_PATTERNS[name.toLowerCase()]
  if (filePattern) {
    return {
      ...baseField,
      type: filePattern.type,
      accept: filePattern.accept,
      maxFiles: prop.maxItems || (filePattern.type === 'file-array' ? 10 : 1),
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

  // Handle loras field specially
  if (name.toLowerCase() === 'loras' && prop.type === 'array') {
    return {
      ...baseField,
      type: 'loras',
      maxFiles: prop.maxItems || 3,
    }
  }

  // Handle array type (could be file array)
  if (prop.type === 'array') {
    // Check if it's an array of strings that looks like URLs/files
    if (name.toLowerCase().includes('image') || name.toLowerCase().includes('video')) {
      return {
        ...baseField,
        type: 'file-array',
        accept: name.toLowerCase().includes('video') ? 'video/*' : 'image/*',
        maxFiles: prop.maxItems || 10,
      }
    }
    // Otherwise skip array types for now
    return null
  }

  // Handle size field specially
  if (name.toLowerCase() === 'size') {
    return {
      ...baseField,
      type: 'size',
      options: prop.enum,  // Pass enum options if available
    }
  }

  // Handle enum type
  if (prop.enum && prop.enum.length > 0) {
    return {
      ...baseField,
      type: 'select',
      options: prop.enum,
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
