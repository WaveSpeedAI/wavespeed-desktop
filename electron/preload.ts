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
  }
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
