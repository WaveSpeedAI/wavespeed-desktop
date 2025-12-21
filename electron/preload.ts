import { contextBridge, ipcRenderer } from 'electron'

interface Settings {
  theme: 'light' | 'dark' | 'system'
  defaultPollInterval: number
  defaultTimeout: number
  updateChannel: 'stable' | 'nightly'
  autoCheckUpdate: boolean
}

interface UpdateStatus {
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

interface UpdateCheckResult {
  status: string
  updateInfo?: {
    version: string
    releaseNotes?: string | null
  }
  message?: string
}

interface DownloadResult {
  success: boolean
  filePath?: string
  error?: string
  canceled?: boolean
}

interface AssetsSettings {
  autoSaveAssets: boolean
  assetsDirectory: string
}

interface SaveAssetResult {
  success: boolean
  filePath?: string
  fileSize?: number
  error?: string
}

interface DeleteAssetResult {
  success: boolean
  error?: string
}

interface DeleteAssetsBulkResult {
  success: boolean
  deleted: number
}

interface SelectDirectoryResult {
  success: boolean
  path?: string
  canceled?: boolean
  error?: string
}

interface AssetMetadata {
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

const electronAPI = {
  getApiKey: (): Promise<string> => ipcRenderer.invoke('get-api-key'),
  setApiKey: (apiKey: string): Promise<boolean> => ipcRenderer.invoke('set-api-key', apiKey),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('get-settings'),
  setSettings: (settings: Partial<Settings>): Promise<boolean> => ipcRenderer.invoke('set-settings', settings),
  clearAllData: (): Promise<boolean> => ipcRenderer.invoke('clear-all-data'),
  downloadFile: (url: string, defaultFilename: string): Promise<DownloadResult> =>
    ipcRenderer.invoke('download-file', url, defaultFilename),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),

  // Auto-updater APIs
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getLogFilePath: (): Promise<string> => ipcRenderer.invoke('get-log-file-path'),
  openLogDirectory: (): Promise<{ success: boolean; path: string }> =>
    ipcRenderer.invoke('open-log-directory'),
  checkForUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: (): Promise<{ status: string; message?: string }> => ipcRenderer.invoke('download-update'),
  installUpdate: (): void => {
    ipcRenderer.invoke('install-update')
  },
  setUpdateChannel: (channel: 'stable' | 'nightly'): Promise<boolean> =>
    ipcRenderer.invoke('set-update-channel', channel),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const handler = (_: unknown, status: UpdateStatus) => callback(status)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },

  // Assets APIs
  getAssetsSettings: (): Promise<AssetsSettings> => ipcRenderer.invoke('get-assets-settings'),
  setAssetsSettings: (settings: Partial<AssetsSettings>): Promise<boolean> =>
    ipcRenderer.invoke('set-assets-settings', settings),
  getDefaultAssetsDirectory: (): Promise<string> => ipcRenderer.invoke('get-default-assets-directory'),
  getZImageOutputPath: (): Promise<string> => ipcRenderer.invoke('get-zimage-output-path'),
  selectDirectory: (): Promise<SelectDirectoryResult> => ipcRenderer.invoke('select-directory'),
  saveAsset: (url: string, type: string, fileName: string, subDir: string): Promise<SaveAssetResult> =>
    ipcRenderer.invoke('save-asset', url, type, fileName, subDir),
  deleteAsset: (filePath: string): Promise<DeleteAssetResult> => ipcRenderer.invoke('delete-asset', filePath),
  deleteAssetsBulk: (filePaths: string[]): Promise<DeleteAssetsBulkResult> =>
    ipcRenderer.invoke('delete-assets-bulk', filePaths),
  getAssetsMetadata: (): Promise<AssetMetadata[]> => ipcRenderer.invoke('get-assets-metadata'),
  saveAssetsMetadata: (metadata: AssetMetadata[]): Promise<boolean> =>
    ipcRenderer.invoke('save-assets-metadata', metadata),
  openFileLocation: (filePath: string): Promise<DeleteAssetResult> =>
    ipcRenderer.invoke('open-file-location', filePath),
  checkFileExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('check-file-exists', filePath),
  openAssetsFolder: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-assets-folder'),
  scanAssetsDirectory: (): Promise<Array<{
    filePath: string
    fileName: string
    type: 'image' | 'video' | 'audio' | 'text'
    fileSize: number
    createdAt: string
  }>> => ipcRenderer.invoke('scan-assets-directory'),

  // Stable Diffusion APIs
  sdGetBinaryPath: (): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('sd-get-binary-path'),
  sdGetSystemInfo: (): Promise<{ platform: string; arch: string; acceleration: string; supported: boolean }> =>
    ipcRenderer.invoke('sd-get-system-info'),
  sdCheckAuxiliaryModels: (): Promise<{ success: boolean; llmExists: boolean; vaeExists: boolean; llmPath: string; vaePath: string; error?: string }> =>
    ipcRenderer.invoke('sd-check-auxiliary-models'),
  sdListAuxiliaryModels: (): Promise<{ success: boolean; models?: Array<{ name: string; path: string; size: number; type: 'llm' | 'vae' }>; error?: string }> =>
    ipcRenderer.invoke('sd-list-auxiliary-models'),
  sdDeleteAuxiliaryModel: (type: 'llm' | 'vae'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('sd-delete-auxiliary-model', type),
  sdGenerateImage: (params: {
    modelPath: string
    llmPath?: string
    vaePath?: string
    lowVramMode?: boolean
    prompt: string
    negativePrompt?: string
    width: number
    height: number
    steps: number
    cfgScale: number
    seed?: number
    outputPath: string
  }): Promise<{ success: boolean; outputPath?: string; error?: string }> =>
    ipcRenderer.invoke('sd-generate-image', params),
  sdCancelGeneration: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('sd-cancel-generation'),
  sdSaveModelFromCache: (filename: string, data: Uint8Array, type: 'model' | 'llm' | 'vae'): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('sd-save-model-from-cache', filename, data, type),
  sdListModels: (): Promise<{
    success: boolean
    models?: Array<{ name: string; path: string; size: number; createdAt: string }>
    error?: string
  }> => ipcRenderer.invoke('sd-list-models'),
  sdDeleteModel: (modelPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('sd-delete-model', modelPath),
  sdDeleteBinary: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('sd-delete-binary'),
  getFileSize: (filePath: string): Promise<number> =>
    ipcRenderer.invoke('get-file-size', filePath),
  onSdProgress: (callback: (data: { phase: string; progress: number; detail?: unknown }) => void): (() => void) => {
    const handler = (_: unknown, data: unknown) => callback(data as { phase: string; progress: number; detail?: unknown })
    ipcRenderer.on('sd-progress', handler)
    return () => ipcRenderer.removeListener('sd-progress', handler)
  },
  onSdLog: (callback: (data: { type: 'stdout' | 'stderr'; message: string }) => void): (() => void) => {
    const handler = (_: unknown, data: unknown) => callback(data as { type: 'stdout' | 'stderr'; message: string })
    ipcRenderer.on('sd-log', handler)
    return () => ipcRenderer.removeListener('sd-log', handler)
  },
  onSdDownloadProgress: (callback: (data: { phase: string; progress: number; detail?: unknown }) => void): (() => void) => {
    const handler = (_: unknown, data: unknown) => callback(data as { phase: string; progress: number; detail?: unknown })
    ipcRenderer.on('sd-download-progress', handler)
    return () => ipcRenderer.removeListener('sd-download-progress', handler)
  },
  onSdBinaryDownloadProgress: (callback: (data: { phase: string; progress: number; detail?: unknown }) => void): (() => void) => {
    const handler = (_: unknown, data: unknown) => callback(data as { phase: string; progress: number; detail?: unknown })
    ipcRenderer.on('sd-binary-download-progress', handler)
    return () => ipcRenderer.removeListener('sd-binary-download-progress', handler)
  },
  onSdLlmDownloadProgress: (callback: (data: { phase: string; progress: number; detail?: unknown }) => void): (() => void) => {
    const handler = (_: unknown, data: unknown) => callback(data as { phase: string; progress: number; detail?: unknown })
    ipcRenderer.on('sd-llm-download-progress', handler)
    return () => ipcRenderer.removeListener('sd-llm-download-progress', handler)
  },
  onSdVaeDownloadProgress: (callback: (data: { phase: string; progress: number; detail?: unknown }) => void): (() => void) => {
    const handler = (_: unknown, data: unknown) => callback(data as { phase: string; progress: number; detail?: unknown })
    ipcRenderer.on('sd-vae-download-progress', handler)
    return () => ipcRenderer.removeListener('sd-vae-download-progress', handler)
  },

  // File operations for chunked downloads
  fileGetSize: (filePath: string): Promise<{ success: boolean; size?: number; error?: string }> =>
    ipcRenderer.invoke('file-get-size', filePath),
  fileAppendChunk: (filePath: string, chunk: ArrayBuffer): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('file-append-chunk', filePath, chunk),
  fileRename: (oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('file-rename', oldPath, newPath),
  fileDelete: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('file-delete', filePath),

  // SD download path helpers for chunked downloads
  sdGetBinaryDownloadPath: (): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('sd-get-binary-download-path'),
  sdGetAuxiliaryModelDownloadPath: (type: 'llm' | 'vae'): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('sd-get-auxiliary-model-download-path', type),
  sdGetModelsDir: (): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('sd-get-models-dir'),
  sdExtractBinary: (zipPath: string, destPath: string): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('sd-extract-binary', zipPath, destPath)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore - fallback for non-isolated context
  window.electronAPI = electronAPI
}
