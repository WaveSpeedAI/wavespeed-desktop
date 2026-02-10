/**
 * Model list service — bridges Desktop's renderer-side model store to main process.
 *
 * Instead of re-fetching models independently, we receive the model list from
 * the renderer via IPC (Desktop's modelsStore already fetches & caches them).
 * Main process only needs models for:
 *   1. Populating node config panels (handled by renderer store directly)
 *   2. Looking up inputSchema during execution (synced here via IPC)
 *
 * This keeps a lightweight cache in main process for execution lookups.
 */
import type { WaveSpeedModel, ModelParamSchema, ModelListCache } from '../../../src/workflow/types/node-defs'
import type { Model } from '../../../src/types/model'

let modelCache: ModelListCache | null = null

/**
 * Convert Desktop's Model type to workflow's WaveSpeedModel type.
 * Reuses Desktop's existing API response format.
 */
export function convertDesktopModel(m: Model): WaveSpeedModel {
  const modelId = m.model_id
  const provider = modelId.split('/')[0] || 'unknown'
  const displayName = m.name || modelId.split('/').pop() || modelId
  const category = m.type || 'other'
  const inputSchema = parseInputSchema(m.api_schema)
  const costPerRun = m.base_price
  return { modelId, provider, displayName, category, inputSchema, costPerRun }
}

/**
 * Sync models from renderer's modelsStore into main process cache.
 * Called via IPC when renderer fetches/refreshes models.
 */
export function syncModelsFromRenderer(desktopModels: Model[]): void {
  const models = desktopModels.map(convertDesktopModel)
  const categories = [...new Set(models.map(m => m.category))].sort()
  const providers = [...new Set(models.map(m => m.provider))].sort()
  modelCache = {
    models,
    categories,
    providers,
    fetchedAt: new Date().toISOString(),
    ttlMs: 24 * 60 * 60 * 1000
  }
}

/** Get cached models (synced from renderer). */
export function getModels(): WaveSpeedModel[] {
  return modelCache?.models ?? []
}

export function searchModels(query: string, filters?: { category?: string; provider?: string }): WaveSpeedModel[] {
  if (!modelCache) return []
  let results = modelCache.models
  if (filters?.category) results = results.filter(m => m.category === filters.category)
  if (filters?.provider) results = results.filter(m => m.provider === filters.provider)
  if (query.trim()) {
    const q = query.toLowerCase().trim()
    results = results
      .map(m => ({ model: m, score: fuzzyScore(m, q) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.model)
  }
  return results
}

export function getModelById(modelId: string): WaveSpeedModel | null {
  return modelCache?.models.find(m => m.modelId === modelId) ?? null
}

export function getModelFilters(): { categories: string[]; providers: string[] } {
  return { categories: modelCache?.categories ?? [], providers: modelCache?.providers ?? [] }
}

function fuzzyScore(model: WaveSpeedModel, query: string): number {
  const fields = [model.modelId, model.displayName, model.provider, model.category].map(f => f.toLowerCase())
  let score = 0
  for (const field of fields) {
    if (field === query) score += 100
    else if (field.startsWith(query)) score += 50
    else if (field.includes(query)) score += 20
  }
  const words = query.split(/[\s\-_\/]+/).filter(Boolean)
  if (words.length > 1) {
    const allText = fields.join(' ')
    score += words.filter(w => allText.includes(w)).length * 10
  }
  return score
}

/**
 * Parse Desktop's api_schema into workflow's ModelParamSchema[].
 *
 * IMPORTANT: The actual API data uses `api_schema.api_schemas[]` (plural),
 * NOT `api_schema.components.schemas.Request`. This matches how
 * DynamicForm.tsx in the playground extracts the schema:
 *   api_schema.api_schemas.find(s => s.type === 'model_run').request_schema
 */
function parseInputSchema(apiSchema: Model['api_schema']): ModelParamSchema[] {
  if (!apiSchema) return []

  // The real path: api_schema.api_schemas[].request_schema (same as DynamicForm)
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
    // Fallback: try the components.schemas.Request path (OpenAPI format)
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

  // Sort by x-order-properties if provided (matches DynamicForm behavior)
  if (orderProperties && orderProperties.length > 0) {
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
  return Object.entries(properties).map(([name, prop]) => {
    const param = parseParam(name, prop)
    if (param && required.includes(name)) param.required = true
    return param
  }).filter((p): p is ModelParamSchema => p !== null)
}

// Fields to always hide (internal API options, same as schemaToForm.ts)
const HIDDEN_FIELDS = new Set(['enable_base64_output', 'enable_sync_mode'])
const TEXTAREA_FIELDS = ['prompt', 'negative_prompt', 'text', 'description', 'content']

function parseParam(name: string, prop: Record<string, unknown>): ModelParamSchema | null {
  if (!name) return null
  if (HIDDEN_FIELDS.has(name)) return null

  const n = name.toLowerCase()
  const uiComponent = prop['x-ui-component'] as string | undefined
  const isHidden = prop['x-hidden'] === true
  const rawType = String(prop.type ?? 'string').toLowerCase()

  // ── LoRA fields — render as inline LoRA editor ──
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

  // ── Array types (non-LoRA) ──
  if (rawType === 'array') {
    // Media arrays by name pattern
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
    // Check for media patterns in name (image, video, audio)
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
    // All other arrays (bbox_condition, etc.) → JSON textarea
    const param: ModelParamSchema = { name, type: 'string' }
    if (prop.description) param.description = String(prop.description)
    if (prop.title) param.label = String(prop.title)
    if (prop.default !== undefined) param.default = prop.default
    if (isHidden) param.hidden = true
    param.fieldType = 'json'
    return param
  }

  // ── Object types → JSON textarea ──
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

  // ── Determine fieldType (matches schemaToForm.ts logic) ──

  // 1. Uploader
  if (uiComponent === 'uploader') {
    param.mediaType = 'image'
    param.fieldType = 'file'
    return param
  }

  // 2. Media fields by name pattern (string type)
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

  // 3. Size field — special selector
  if (n === 'size') {
    param.fieldType = 'size'
    return param
  }

  // 4. Slider
  if (uiComponent === 'slider') {
    param.fieldType = 'slider'
    return param
  }

  // 5. Enum/Select
  if (param.enum && param.enum.length > 0) {
    param.fieldType = 'select'
    return param
  }

  // 6. Boolean
  if (type === 'boolean') {
    param.fieldType = 'boolean'
    return param
  }

  // 7. Number with min/max → slider
  if ((type === 'number' || type === 'integer') && param.min !== undefined && param.max !== undefined) {
    param.fieldType = 'slider'
    return param
  }

  // 8. Plain number
  if (type === 'number' || type === 'integer') {
    param.fieldType = 'number'
    return param
  }

  // 9. Textarea fields
  if (TEXTAREA_FIELDS.some(f => n.includes(f))) {
    param.fieldType = 'textarea'
    return param
  }

  // 10. Default text
  param.fieldType = 'text'
  return param
}
