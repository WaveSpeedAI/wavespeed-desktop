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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
