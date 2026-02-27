export type AssetType = 'image' | 'video' | 'audio' | 'text' | 'json'

export type AssetSortBy = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc'

export type AssetSource = 'playground' | 'workflow' | 'free-tool'

export interface AssetMetadata {
  id: string
  filePath: string
  fileName: string
  type: AssetType
  modelId: string
  createdAt: string
  fileSize: number
  tags: string[]
  favorite: boolean
  predictionId?: string
  originalUrl?: string
  source?: AssetSource
  workflowId?: string
  workflowName?: string
  nodeId?: string
  executionId?: string
}

export interface AssetsFilter {
  types?: AssetType[]
  models?: string[]
  dateFrom?: string
  dateTo?: string
  tags?: string[]
  favoritesOnly?: boolean
  search?: string
  sortBy?: AssetSortBy
  sources?: AssetSource[]
}

export interface AssetsSaveOptions {
  modelId: string
  predictionId?: string
  originalUrl?: string
  resultIndex?: number
  source?: AssetSource
  workflowId?: string
  workflowName?: string
  nodeId?: string
  executionId?: string
}

export interface AssetsSettings {
  autoSaveAssets: boolean
  assetsDirectory: string
}

export interface SaveAssetResult {
  success: boolean
  filePath?: string
  fileSize?: number
  error?: string
}

export interface DeleteAssetResult {
  success: boolean
  error?: string
}

export interface SelectDirectoryResult {
  success: boolean
  path?: string
  canceled?: boolean
  error?: string
}
