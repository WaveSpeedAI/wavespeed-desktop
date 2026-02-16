/**
 * Converts Desktop API Model type to workflow WaveSpeedModel.
 * Shared by renderer (workflow UI) and electron main (execution).
 * Keeps workflow model list in sync with Models browser / Playground (same API source).
 */
import type { Model } from '@/types/model'
import type { FormFieldConfig } from '@/lib/schemaToForm'
import type { WaveSpeedModel, ModelParamSchema } from '@/workflow/types/node-defs'

const HIDDEN_FIELDS = new Set(['enable_base64_output', 'enable_sync_mode'])
const TEXTAREA_FIELDS = ['prompt', 'negative_prompt', 'text', 'description', 'content']

export function convertDesktopModel(m: Model): WaveSpeedModel {
  const modelId = m.model_id
  const provider = modelId.split('/')[0] || 'unknown'
  const displayName = m.name || modelId.split('/').pop() || modelId
  const category = m.type || 'other'
  const inputSchema = parseInputSchema(m.api_schema)
  const costPerRun = m.base_price
  return { modelId, provider, displayName, category, inputSchema, costPerRun }
}

function parseInputSchema(apiSchema: Model['api_schema']): ModelParamSchema[] {
  if (!apiSchema) return []

  const apiSchemas = (apiSchema as Record<string, unknown>).api_schemas as Array<{
    type: string
    request_schema?: {
      properties?: Record<string, unknown>
      required?: string[]
      'x-order-properties'?: string[]
    }
  }> | undefined

  const requestSchema = apiSchemas?.find(s => s.type === 'model_run')?.request_schema
  if (!requestSchema?.properties) {
    const components = apiSchema.components
    if (components?.schemas?.Request?.properties) {
      const properties = components.schemas.Request.properties
      const required = components.schemas.Request.required ?? []
      return parseProperties(properties as Record<string, Record<string, unknown>>, required)
    }
    return []
  }

  const properties = requestSchema.properties
  const required = requestSchema.required ?? []
  const orderProperties = requestSchema['x-order-properties']

  let result = parseProperties(properties as Record<string, Record<string, unknown>>, required)

  if (orderProperties?.length) {
    result = result.sort((a, b) => {
      const idxA = orderProperties.indexOf(a.name)
      const idxB = orderProperties.indexOf(b.name)
      return (idxA === -1 ? Infinity : idxA) - (idxB === -1 ? Infinity : idxB)
    })
  }

  return result
}

function parseProperties(
  properties: Record<string, Record<string, unknown>>,
  required: string[]
): ModelParamSchema[] {
  return Object.entries(properties)
    .map(([name, prop]) => {
      const param = parseParam(name, prop)
      if (param && required.includes(name)) param.required = true
      return param
    })
    .filter((p): p is ModelParamSchema => p !== null)
}

function parseParam(name: string, prop: Record<string, unknown>): ModelParamSchema | null {
  if (!name || HIDDEN_FIELDS.has(name)) return null

  const n = name.toLowerCase()
  const uiComponent = prop['x-ui-component'] as string | undefined
  const isHidden = prop['x-hidden'] === true
  const rawType = String(prop.type ?? 'string').toLowerCase()

  if (uiComponent === 'loras' || (n === 'loras' && rawType === 'array') || (n.endsWith('_loras') && rawType === 'array')) {
    const param: ModelParamSchema = { name, type: 'string' }
    if (prop.description) param.description = String(prop.description)
    if (prop.title) param.label = String(prop.title)
    if (prop.default !== undefined) param.default = prop.default
    if (isHidden) param.hidden = true
    param.fieldType = 'loras'
    param.maxItems = typeof prop.maxItems === 'number' ? prop.maxItems : 3
    return param
  }

  if (rawType === 'array') {
    if (n.endsWith('images') || n.endsWith('image_urls') || n.endsWith('videos') || n.endsWith('video_urls') || n.endsWith('audios') || n.endsWith('audio_urls')) {
      const param: ModelParamSchema = { name, type: 'string' }
      if (prop.description) param.description = String(prop.description)
      if (prop.title) param.label = String(prop.title)
      if (prop.default !== undefined) param.default = prop.default
      if (isHidden) param.hidden = true
      if (n.includes('image')) param.mediaType = 'image'
      else if (n.includes('video')) param.mediaType = 'video'
      else param.mediaType = 'audio'
      param.fieldType = 'file-array'
      return param
    }
    if (n.includes('image') || n.includes('video') || n.includes('audio')) {
      const param: ModelParamSchema = { name, type: 'string' }
      if (prop.description) param.description = String(prop.description)
      if (prop.title) param.label = String(prop.title)
      if (prop.default !== undefined) param.default = prop.default
      if (isHidden) param.hidden = true
      if (n.includes('image')) param.mediaType = 'image'
      else if (n.includes('video')) param.mediaType = 'video'
      else param.mediaType = 'audio'
      param.fieldType = 'file-array'
      return param
    }
    const param: ModelParamSchema = { name, type: 'string' }
    if (prop.description) param.description = String(prop.description)
    if (prop.title) param.label = String(prop.title)
    if (prop.default !== undefined) param.default = prop.default
    if (isHidden) param.hidden = true
    param.fieldType = 'json'
    return param
  }

  if (rawType === 'object') {
    const param: ModelParamSchema = { name, type: 'string' }
    if (prop.description) param.description = String(prop.description)
    if (prop.title) param.label = String(prop.title)
    if (prop.default !== undefined) param.default = prop.default
    if (isHidden) param.hidden = true
    param.fieldType = 'json'
    return param
  }

  let type: ModelParamSchema['type'] = 'string'
  if (rawType === 'number' || rawType === 'float' || rawType === 'double') type = 'number'
  else if (rawType === 'integer' || rawType === 'int') type = 'integer'
  else if (rawType === 'boolean' || rawType === 'bool') type = 'boolean'
  else if (Array.isArray(prop.enum)) type = 'enum'

  const param: ModelParamSchema = { name, type }
  if (prop.description) param.description = String(prop.description)
  if (prop.title) param.label = String(prop.title)
  if (prop.default !== undefined) param.default = prop.default
  if (Array.isArray(prop.enum)) param.enum = prop.enum.map(String)
  if (typeof prop.minimum === 'number') param.min = prop.minimum
  if (typeof prop.maximum === 'number') param.max = prop.maximum
  if (typeof prop.step === 'number') param.step = prop.step
  if (isHidden) param.hidden = true
  if (prop['x-accept']) param.accept = String(prop['x-accept'])
  if (prop['x-placeholder']) param.placeholder = String(prop['x-placeholder'])

  if (uiComponent === 'uploader') {
    param.mediaType = 'image'
    param.fieldType = 'file'
    return param
  }
  if (n.endsWith('images') || n.endsWith('image_urls') || n.endsWith('videos') || n.endsWith('video_urls') || n.endsWith('audios') || n.endsWith('audio_urls')) {
    if (n.includes('image')) param.mediaType = 'image'
    else if (n.includes('video')) param.mediaType = 'video'
    else param.mediaType = 'audio'
    param.fieldType = 'file-array'
    return param
  }
  if (n.endsWith('image') || n.endsWith('image_url')) { param.mediaType = 'image'; param.fieldType = 'file'; return param }
  if (n.endsWith('video') || n.endsWith('video_url')) { param.mediaType = 'video'; param.fieldType = 'file'; return param }
  if (n.endsWith('audio') || n.endsWith('audio_url')) { param.mediaType = 'audio'; param.fieldType = 'file'; return param }
  if (n === 'size') { param.fieldType = 'size'; return param }
  if (uiComponent === 'slider') { param.fieldType = 'slider'; return param }
  if (param.enum?.length) { param.fieldType = 'select'; return param }
  if (type === 'boolean') { param.fieldType = 'boolean'; return param }
  if ((type === 'number' || type === 'integer') && param.min !== undefined && param.max !== undefined) { param.fieldType = 'slider'; return param }
  if (type === 'number' || type === 'integer') { param.fieldType = 'number'; return param }
  if (TEXTAREA_FIELDS.some(f => n.includes(f))) { param.fieldType = 'textarea'; return param }

  param.fieldType = 'text'
  return param
}

/** Map Playground form fields (from schemaToForm) to workflow ModelParamSchema for node display. */
export function formFieldsToModelParamSchema(fields: FormFieldConfig[]): ModelParamSchema[] {
  return fields.map(f => {
    const base: ModelParamSchema = {
      name: f.name,
      label: f.label,
      description: f.description,
      default: f.default,
      required: f.required,
      hidden: f.hidden,
      accept: f.accept,
      placeholder: f.placeholder,
      min: f.min,
      max: f.max,
      step: f.step,
    }
    switch (f.type) {
      case 'text':
        return { ...base, type: 'string', fieldType: 'text' }
      case 'textarea':
        return { ...base, type: 'string', fieldType: 'textarea' }
      case 'number':
        return { ...base, type: 'number', fieldType: 'number' }
      case 'slider':
        return { ...base, type: 'number', fieldType: 'slider' }
      case 'boolean':
        return { ...base, type: 'boolean', fieldType: 'boolean' }
      case 'select':
        return {
          ...base,
          type: 'enum',
          fieldType: 'select',
          enum: (f.options ?? []).map(String),
        }
      case 'file': {
        const media = f.accept?.startsWith('image') ? 'image' : f.accept?.startsWith('video') ? 'video' : f.accept?.startsWith('audio') ? 'audio' : undefined
        return { ...base, type: 'string', fieldType: 'file', mediaType: media }
      }
      case 'file-array': {
        const media = f.accept?.includes('image') ? 'image' as const : f.accept?.includes('video') ? 'video' as const : f.accept?.includes('audio') ? 'audio' as const : undefined
        return { ...base, type: 'string', fieldType: 'file-array', mediaType: media, maxItems: f.maxFiles }
      }
      case 'size':
        return { ...base, type: 'string', fieldType: 'size' }
      case 'loras':
        return { ...base, type: 'string', fieldType: 'loras', maxItems: f.maxFiles }
      default:
        return { ...base, type: 'string', fieldType: 'text' }
    }
  })
}
