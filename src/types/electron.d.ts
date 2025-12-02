export interface DownloadResult {
  success: boolean
  filePath?: string
  error?: string
  canceled?: boolean
}

export interface ElectronAPI {
  getApiKey: () => Promise<string>
  setApiKey: (apiKey: string) => Promise<boolean>
  getSettings: () => Promise<{
    theme: 'light' | 'dark' | 'system'
    defaultPollInterval: number
    defaultTimeout: number
  }>
  setSettings: (settings: Record<string, unknown>) => Promise<boolean>
  clearAllData: () => Promise<boolean>
  downloadFile: (url: string, defaultFilename: string) => Promise<DownloadResult>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
