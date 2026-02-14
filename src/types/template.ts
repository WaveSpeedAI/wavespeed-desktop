export interface Template {
  id: string
  name: string
  i18nKey?: string
  _searchText?: string
  description: string | null
  tags: string[]
  type: 'public' | 'custom'
  templateType: 'playground' | 'workflow'
  isFavorite: boolean
  createdAt: string
  updatedAt: string
  author: string | null
  useCount: number
  thumbnail: string | null
  
  // Type-specific data
  playgroundData: PlaygroundTemplateData | null
  workflowData: WorkflowTemplateData | null
}

export interface PlaygroundTemplateData {
  modelId: string
  modelName: string
  values: Record<string, unknown>
}

export interface WorkflowTemplateData {
  category: string
  graphDefinition: any  // GraphDefinition from workflow types
  nodeTypes: string[]
  nodeCount: number
  useCases: string[]
}

export interface CreateTemplateInput {
  name: string
  i18nKey?: string
  _searchText?: string
  description?: string | null
  tags?: string[]
  type: 'public' | 'custom'
  templateType: 'playground' | 'workflow'
  author?: string | null
  thumbnail?: string | null
  playgroundData?: PlaygroundTemplateData | null
  workflowData?: WorkflowTemplateData | null
}

export interface TemplateFilter {
  templateType?: 'playground' | 'workflow'
  type?: 'public' | 'custom'
  isFavorite?: boolean
  category?: string
  search?: string
  sortBy?: 'updatedAt' | 'useCount'
}

export interface TemplateExport {
  version: string
  exportedAt: string
  templates: Template[]
}
