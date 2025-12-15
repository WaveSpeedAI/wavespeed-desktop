export interface DownloadResult {
  success: boolean
  filePath?: string
  error?: string
  canceled?: boolean
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

export interface DeleteAssetsBulkResult {
  success: boolean
  deleted: number
}

export interface SelectDirectoryResult {
  success: boolean
  path?: string
  canceled?: boolean
  error?: string
}

export interface AssetMetadataElectron {
  id: string
  filePath: string
  fileName: string
  type: 'image' | 'video' | 'audio' | 'text' | 'json'
  modelId: string
  modelName: string
  createdAt: string
  fileSize: number
  tags: string[]
  favorite: boolean
  predictionId?: string
  originalUrl?: string
}

export interface UpdateStatus {
  status: string
  version?: string
  releaseNotes?: string | null
  releaseDate?: string
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  message?: string
}

export interface UpdateCheckResult {
  status: string
  updateInfo?: {
    version: string
    releaseNotes?: string | null
  }
  message?: string
}

export interface SDGenerationParams {
  modelPath: string
  llmPath?: string
  vaePath?: string
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  cfgScale: number
  seed?: number
  outputPath: string
}

export interface SDProgressData {
  phase: string
  progress: number
  detail?: {
    current?: number
    total?: number
    unit?: 'bytes' | 'steps' | 'percent'
  }
}

export interface SDModelInfo {
  name: string
  path: string
  size: number
  createdAt: string
}

export interface ElectronAPI {
  getApiKey: () => Promise<string>
  setApiKey: (apiKey: string) => Promise<boolean>
  getSettings: () => Promise<{
    theme: 'light' | 'dark' | 'system'
    defaultPollInterval: number
    defaultTimeout: number
    updateChannel: 'stable' | 'nightly'
    autoCheckUpdate: boolean
  }>
  setSettings: (settings: Record<string, unknown>) => Promise<boolean>
  clearAllData: () => Promise<boolean>
  downloadFile: (url: string, defaultFilename: string) => Promise<DownloadResult>
  openExternal: (url: string) => Promise<void>

  // Auto-updater APIs
  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<UpdateCheckResult>
  downloadUpdate: () => Promise<{ status: string; message?: string }>
  installUpdate: () => void
  setUpdateChannel: (channel: 'stable' | 'nightly') => Promise<boolean>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void

  // Assets APIs
  getAssetsSettings: () => Promise<AssetsSettings>
  setAssetsSettings: (settings: Partial<AssetsSettings>) => Promise<boolean>
  getDefaultAssetsDirectory: () => Promise<string>
  selectDirectory: () => Promise<SelectDirectoryResult>
  saveAsset: (url: string, type: string, fileName: string, subDir: string) => Promise<SaveAssetResult>
  deleteAsset: (filePath: string) => Promise<DeleteAssetResult>
  deleteAssetsBulk: (filePaths: string[]) => Promise<DeleteAssetsBulkResult>
  getAssetsMetadata: () => Promise<AssetMetadataElectron[]>
  saveAssetsMetadata: (metadata: AssetMetadataElectron[]) => Promise<boolean>
  openFileLocation: (filePath: string) => Promise<DeleteAssetResult>
  checkFileExists: (filePath: string) => Promise<boolean>
  openAssetsFolder: () => Promise<{ success: boolean; error?: string }>

  // Stable Diffusion APIs
  sdGetBinaryPath: () => Promise<{ success: boolean; path?: string; error?: string }>
  sdDownloadBinary: () => Promise<{ success: boolean; path?: string; error?: string }>
  sdCancelDownload: () => Promise<{ success: boolean; error?: string }>
  sdCheckAuxiliaryModels: () => Promise<{ success: boolean; llmExists: boolean; vaeExists: boolean; llmPath: string; vaePath: string; error?: string }>
  sdGetDownloadStatus: () => Promise<{ llm: { progress: number; receivedBytes: number; totalBytes: number } | null; vae: { progress: number; receivedBytes: number; totalBytes: number } | null }>
  sdListAuxiliaryModels: () => Promise<{ success: boolean; models?: Array<{ name: string; path: string; size: number; type: 'llm' | 'vae' }>; error?: string }>
  sdDeleteAuxiliaryModel: (type: 'llm' | 'vae') => Promise<{ success: boolean; error?: string }>
  sdDownloadAuxiliaryModel: (type: 'llm' | 'vae', url: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
  sdGenerateImage: (params: SDGenerationParams) => Promise<{ success: boolean; outputPath?: string; error?: string }>
  sdCancelGeneration: () => Promise<{ success: boolean; error?: string }>
  sdSaveModelFromCache: (filename: string, data: Uint8Array, type: 'model' | 'llm' | 'vae') => Promise<{ success: boolean; filePath?: string; error?: string }>
  sdDownloadModel: (url: string, destPath: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
  sdListModels: () => Promise<{ success: boolean; models?: SDModelInfo[]; error?: string }>
  sdDeleteModel: (modelPath: string) => Promise<{ success: boolean; error?: string }>
  sdGetSystemInfo: () => Promise<{ platform: string; acceleration: string; supported: boolean }>
  onSdProgress: (callback: (data: SDProgressData) => void) => () => void
  onSdLog: (callback: (data: { type: 'stdout' | 'stderr'; message: string }) => void) => () => void
  onSdDownloadProgress: (callback: (data: SDProgressData) => void) => () => void
  onSdBinaryDownloadProgress: (callback: (data: SDProgressData) => void) => () => void
  onSdLlmDownloadProgress: (callback: (data: SDProgressData) => void) => () => void
  onSdVaeDownloadProgress: (callback: (data: SDProgressData) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
