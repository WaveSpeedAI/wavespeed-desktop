// Web 版本的 electronAPI mock 实现
// 用于在浏览器环境中提供与 Electron API 兼容的接口

import type { ElectronAPI } from '@/types/electron'

// 检查是否在浏览器环境
const isBrowser = typeof window !== 'undefined' && !window.electronAPI

// 使用 localStorage 存储 API key
const API_KEY_STORAGE_KEY = 'wavespeed_api_key'
const SETTINGS_STORAGE_KEY = 'wavespeed_settings'
const ASSETS_METADATA_STORAGE_KEY = 'wavespeed_assets_metadata'
const ASSETS_SETTINGS_STORAGE_KEY = 'wavespeed_assets_settings'

// 默认设置
const DEFAULT_SETTINGS = {
  theme: 'system' as const,
  defaultPollInterval: 2000,
  defaultTimeout: 30000,
  updateChannel: 'stable' as const,
  autoCheckUpdate: false,
}

// Web 版本的 electronAPI 实现
export const electronAPIWeb: ElectronAPI = {
  // API Key 管理
  getApiKey: async (): Promise<string> => {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || ''
  },

  setApiKey: async (apiKey: string): Promise<boolean> => {
    try {
      localStorage.setItem(API_KEY_STORAGE_KEY, apiKey)
      return true
    } catch {
      return false
    }
  },

  // 设置管理
  getSettings: async () => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
      }
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS
  },

  setSettings: async (settings: Record<string, unknown>): Promise<boolean> => {
    try {
      const current = await electronAPIWeb.getSettings()
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...current, ...settings }))
      return true
    } catch {
      return false
    }
  },

  clearAllData: async (): Promise<boolean> => {
    try {
      localStorage.removeItem(API_KEY_STORAGE_KEY)
      localStorage.removeItem(SETTINGS_STORAGE_KEY)
      localStorage.removeItem(ASSETS_METADATA_STORAGE_KEY)
      localStorage.removeItem(ASSETS_SETTINGS_STORAGE_KEY)
      return true
    } catch {
      return false
    }
  },

  // 文件下载（使用浏览器下载）
  downloadFile: async (url: string, defaultFilename: string) => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = defaultFilename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(downloadUrl)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  },

  openExternal: async (url: string): Promise<void> => {
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  // 应用信息
  getAppVersion: async (): Promise<string> => {
    return '1.0.0-web'
  },

  getLogFilePath: async (): Promise<string> => {
    return ''
  },

  openLogDirectory: async () => {
    return { success: false, path: '' }
  },

  // 更新相关（Web 版本不支持）
  checkForUpdates: async () => {
    return { status: 'not-available', message: 'Updates are not available in web version' }
  },

  downloadUpdate: async () => {
    return { status: 'not-available', message: 'Updates are not available in web version' }
  },

  installUpdate: (): void => {
    // no-op
  },

  setUpdateChannel: async (): Promise<boolean> => {
    return false
  },

  onUpdateStatus: () => {
    return () => {
      // no-op
    }
  },

  // Assets 管理（使用 IndexedDB 或 localStorage）
  getAssetsSettings: async () => {
    try {
      const stored = localStorage.getItem(ASSETS_SETTINGS_STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch {
      // ignore
    }
    return {
      autoSaveAssets: false,
      assetsDirectory: '',
    }
  },

  setAssetsSettings: async (settings: Partial<{ autoSaveAssets: boolean; assetsDirectory: string }>): Promise<boolean> => {
    try {
      const current = await electronAPIWeb.getAssetsSettings()
      localStorage.setItem(ASSETS_SETTINGS_STORAGE_KEY, JSON.stringify({ ...current, ...settings }))
      return true
    } catch {
      return false
    }
  },

  getDefaultAssetsDirectory: async (): Promise<string> => {
    return ''
  },

  getZImageOutputPath: async (): Promise<string> => {
    return ''
  },

  selectDirectory: async () => {
    return { success: false, canceled: true, error: 'Directory selection not available in web version' }
  },

  saveAsset: async () => {
    return { success: false, error: 'Asset saving not available in web version' }
  },

  deleteAsset: async () => {
    return { success: false, error: 'Asset deletion not available in web version' }
  },

  deleteAssetsBulk: async () => {
    return { success: false, deleted: 0 }
  },

  getAssetsMetadata: async () => {
    try {
      const stored = localStorage.getItem(ASSETS_METADATA_STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch {
      // ignore
    }
    return []
  },

  saveAssetsMetadata: async (metadata: unknown[]): Promise<boolean> => {
    try {
      localStorage.setItem(ASSETS_METADATA_STORAGE_KEY, JSON.stringify(metadata))
      return true
    } catch {
      return false
    }
  },

  openFileLocation: async () => {
    return { success: false, error: 'File location not available in web version' }
  },

  checkFileExists: async (): Promise<boolean> => {
    return false
  },

  openAssetsFolder: async () => {
    return { success: false, error: 'Assets folder not available in web version' }
  },

  scanAssetsDirectory: async () => {
    return []
  },

  // Stable Diffusion APIs（Web 版本不支持）
  sdGetBinaryPath: async () => {
    return { success: false, error: 'Stable Diffusion not available in web version' }
  },

  sdCheckAuxiliaryModels: async () => {
    return { success: false, llmExists: false, vaeExists: false, llmPath: '', vaePath: '', error: 'Not available in web version' }
  },

  sdListAuxiliaryModels: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  sdDeleteAuxiliaryModel: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  sdGenerateImage: async () => {
    return { success: false, error: 'Stable Diffusion not available in web version' }
  },

  sdCancelGeneration: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  sdSaveModelFromCache: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  sdListModels: async () => {
    return { success: false, error: 'Stable Diffusion not available in web version' }
  },

  sdDeleteModel: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  sdDeleteBinary: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  getFileSize: async (): Promise<number> => {
    return 0
  },

  sdGetSystemInfo: async () => {
    return {
      platform: 'web',
      arch: 'unknown',
      acceleration: 'webgpu',
      supported: false,
    }
  },

  onSdProgress: () => {
    return () => {
      // no-op
    }
  },

  onSdLog: () => {
    return () => {
      // no-op
    }
  },

  onSdDownloadProgress: () => {
    return () => {
      // no-op
    }
  },

  onSdBinaryDownloadProgress: () => {
    return () => {
      // no-op
    }
  },

  onSdLlmDownloadProgress: () => {
    return () => {
      // no-op
    }
  },

  onSdVaeDownloadProgress: () => {
    return () => {
      // no-op
    }
  },

  // 文件操作（Web 版本不支持）
  fileGetSize: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  fileAppendChunk: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  fileRename: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  fileDelete: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  // SD 下载路径辅助函数
  sdGetBinaryDownloadPath: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  sdGetAuxiliaryModelDownloadPath: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  sdGetModelsDir: async () => {
    return { success: false, error: 'Not available in web version' }
  },

  sdExtractBinary: async () => {
    return { success: false, error: 'Not available in web version' }
  },
}

// 在浏览器环境中注入 electronAPI
if (isBrowser) {
  ;(window as Window & { electronAPI: ElectronAPI }).electronAPI = electronAPIWeb
}

