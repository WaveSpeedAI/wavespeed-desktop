export interface ModelSchema {
  type: string
  properties: Record<string, SchemaProperty>
  required?: string[]
}

export interface SchemaProperty {
  type: string
  title?: string
  description?: string
  default?: unknown
  minimum?: number
  maximum?: number
  enum?: string[]
  items?: {
    type: string
    minItems?: number
    maxItems?: number
  }
  minItems?: number
  maxItems?: number
  recommend?: Array<{
    path: string
    scale: number
    cover?: string
  }>
  // Extended UI hints
  step?: number
  'x-ui-component'?: 'slider' | 'uploader' | 'loras' | 'select'
  'x-accept'?: string
  'x-placeholder'?: string
  'x-hidden'?: boolean
  nullable?: boolean
}

export interface Model {
  model_id: string
  name: string
  description?: string
  type?: string
  base_price?: number
  sort_order?: number
  api_schema?: {
    openapi?: string
    info?: Record<string, unknown>
    paths?: Record<string, unknown>
    components?: {
      schemas?: {
        Request?: ModelSchema
        Response?: Record<string, unknown>
      }
    }
  }
}

export interface ModelsResponse {
  code: number
  message: string
  data: Model[]
}
