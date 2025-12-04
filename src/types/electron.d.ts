export interface DownloadResult {
  success: boolean
  filePath?: string
  error?: string
  canceled?: boolean
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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
