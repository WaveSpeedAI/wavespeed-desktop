/**
 * Node type definition types — port schemas, parameter schemas, and node type metadata.
 */

export type PortDataType = 'text' | 'image' | 'video' | 'audio' | 'url' | 'any' | 'boolean'

export interface PortDefinition {
  key: string
  label: string
  dataType: PortDataType
  required: boolean
}

export type ParamType = 'string' | 'number' | 'boolean' | 'select' | 'file' | 'textarea' | 'slider'

export interface ParamDefinition {
  key: string
  label: string
  type: ParamType
  default?: unknown
  options?: { label: string; value: string }[]
  validation?: { min?: number; max?: number; step?: number; pattern?: string }
  dataType?: PortDataType
  connectable?: boolean
  description?: string
}

export type NodeCategory = 'input' | 'ai-task' | 'ai-generation' | 'free-tool' | 'processing' | 'control' | 'output'

export interface NodeTypeDefinition {
  type: string
  category: NodeCategory
  label: string
  inputs: PortDefinition[]
  outputs: PortDefinition[]
  params: ParamDefinition[]
  costPerExecution?: number
}

export interface ModelParamSchema {
  name: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'enum'
  label?: string
  description?: string
  default?: unknown
  required?: boolean
  enum?: string[]
  min?: number
  max?: number
  step?: number
  mediaType?: 'image' | 'video' | 'audio'
  /** Specific UI control type — matched from x-ui-component or field name patterns */
  fieldType?: 'text' | 'textarea' | 'number' | 'slider' | 'boolean' | 'select' | 'file' | 'file-array' | 'size' | 'loras' | 'json'
  /** Whether this field is hidden by default (x-hidden) */
  hidden?: boolean
  /** File accept filter from x-accept */
  accept?: string
  /** Placeholder text from x-placeholder */
  placeholder?: string
  /** Max items for array fields (loras, file-array) */
  maxItems?: number
}

export type ModelCategory = string

export interface WaveSpeedModel {
  modelId: string
  provider: string
  displayName: string
  category: ModelCategory
  inputSchema: ModelParamSchema[]
  costPerRun?: number
}

export interface ModelListCache {
  models: WaveSpeedModel[]
  categories: string[]
  providers: string[]
  fetchedAt: string
  ttlMs: number
}
