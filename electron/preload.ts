import { contextBridge, ipcRenderer } from 'electron'

interface Settings {
  theme: 'light' | 'dark' | 'system'
  defaultPollInterval: number
  defaultTimeout: number
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
    ipcRenderer.invoke('download-file', url, defaultFilename)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error - fallback for non-isolated context
  window.electronAPI = electronAPI
}
