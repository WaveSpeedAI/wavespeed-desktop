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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
