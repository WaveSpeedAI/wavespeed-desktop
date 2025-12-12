import { create } from 'zustand'
import type { AssetMetadata, AssetType, AssetsFilter, AssetsSaveOptions, AssetsSettings } from '@/types/asset'

const METADATA_STORAGE_KEY = 'wavespeed_assets_metadata'
const SETTINGS_STORAGE_KEY = 'wavespeed_assets_settings'

// Helper to generate unique ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

// Helper to get file extension from URL
function getExtensionFromUrl(url: string): string | null {
  const match = url.match(/\.([a-zA-Z0-9]+)(\?.*)?$/)
  return match ? match[1].toLowerCase() : null
}

// Helper to get default extension for asset type
function getDefaultExtension(type: AssetType): string {
  switch (type) {
    case 'image': return 'png'
    case 'video': return 'mp4'
    case 'audio': return 'mp3'
    case 'text': return 'txt'
    case 'json': return 'json'
  }
}

// Helper to get subdirectory for asset type
function getSubDir(type: AssetType): string {
  switch (type) {
    case 'image': return 'images'
    case 'video': return 'videos'
    case 'audio': return 'audio'
    case 'text':
    case 'json': return 'text'
  }
}

// Helper to detect asset type from URL
export function detectAssetType(url: string): AssetType | null {
  const ext = getExtensionFromUrl(url)
  if (!ext) return null

  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']
  const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv']
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma']

  if (imageExts.includes(ext)) return 'image'
  if (videoExts.includes(ext)) return 'video'
  if (audioExts.includes(ext)) return 'audio'

  return null
}

// Helper to generate filename: model_predictionid_resultindex.ext
function generateFileName(modelName: string, type: AssetType, url: string, predictionId?: string, resultIndex: number = 0): string {
  const slug = modelName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().replace(/-+/g, '-')
  const id = predictionId || (Date.now().toString(36) + Math.random().toString(36).substring(2, 6))
  const ext = getExtensionFromUrl(url) || getDefaultExtension(type)
  return `${slug}_${id}_${resultIndex}.${ext}`
}

interface AssetsState {
  assets: AssetMetadata[]
  isLoaded: boolean
  settings: AssetsSettings

  // Data loading
  loadAssets: () => Promise<void>
  loadSettings: () => Promise<void>

  // Asset operations
  saveAsset: (url: string, type: AssetType, options: AssetsSaveOptions) => Promise<AssetMetadata | null>
  deleteAsset: (id: string) => Promise<boolean>
  deleteAssets: (ids: string[]) => Promise<number>
  updateAsset: (id: string, updates: Partial<Pick<AssetMetadata, 'tags' | 'favorite'>>) => Promise<void>

  // Filtering
  getFilteredAssets: (filter: AssetsFilter) => AssetMetadata[]

  // Tag operations
  getAllTags: () => string[]
  getAllModels: () => { modelId: string; modelName: string }[]

  // Settings
  setAutoSave: (enabled: boolean) => Promise<void>
  setAssetsDirectory: (path: string) => Promise<void>

  // Utilities
  openAssetLocation: (id: string) => Promise<void>
  getAssetById: (id: string) => AssetMetadata | undefined
  hasAssetForPrediction: (predictionId: string) => boolean
  validateAssets: () => Promise<void>
}

export const useAssetsStore = create<AssetsState>((set, get) => ({
  assets: [],
  isLoaded: false,
  settings: {
    autoSaveAssets: true,
    assetsDirectory: ''
  },

  loadAssets: async () => {
    if (window.electronAPI?.getAssetsMetadata) {
      const metadata = await window.electronAPI.getAssetsMetadata()
      set({ assets: metadata as AssetMetadata[], isLoaded: true })
    } else {
      // Browser fallback - limited functionality
      const stored = localStorage.getItem(METADATA_STORAGE_KEY)
      set({
        assets: stored ? JSON.parse(stored) : [],
        isLoaded: true
      })
    }
  },

  loadSettings: async () => {
    if (window.electronAPI?.getAssetsSettings) {
      const settings = await window.electronAPI.getAssetsSettings()
      set({ settings })
    } else {
      // Browser fallback
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
      if (stored) {
        set({ settings: JSON.parse(stored) })
      }
    }
  },

  saveAsset: async (url, type, options) => {
    const fileName = generateFileName(options.modelName, type, url, options.predictionId, options.resultIndex ?? 0)

    // Desktop mode: save file to disk
    if (window.electronAPI?.saveAsset) {
      const subDir = getSubDir(type)
      const result = await window.electronAPI.saveAsset(url, type, fileName, subDir)

      if (result.success && result.filePath) {
        const metadata: AssetMetadata = {
          id: generateId(),
          filePath: result.filePath,
          fileName,
          type,
          modelId: options.modelId,
          modelName: options.modelName,
          createdAt: new Date().toISOString(),
          fileSize: result.fileSize || 0,
          tags: [],
          favorite: false,
          predictionId: options.predictionId,
          originalUrl: url
        }

        set(state => {
          const newAssets = [metadata, ...state.assets]
          if (window.electronAPI?.saveAssetsMetadata) {
            window.electronAPI.saveAssetsMetadata(newAssets as Parameters<typeof window.electronAPI.saveAssetsMetadata>[0])
          }
          return { assets: newAssets }
        })

        return metadata
      }
      return null
    }

    // Browser fallback: store URL reference only
    const metadata: AssetMetadata = {
      id: generateId(),
      filePath: '', // No local file in browser mode
      fileName,
      type,
      modelId: options.modelId,
      modelName: options.modelName,
      createdAt: new Date().toISOString(),
      fileSize: 0,
      tags: [],
      favorite: false,
      predictionId: options.predictionId,
      originalUrl: url
    }

    set(state => {
      const newAssets = [metadata, ...state.assets]
      localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets))
      return { assets: newAssets }
    })

    return metadata
  },

  deleteAsset: async (id) => {
    const { assets } = get()
    const asset = assets.find(a => a.id === id)
    if (!asset) return false

    if (window.electronAPI?.deleteAsset) {
      const result = await window.electronAPI.deleteAsset(asset.filePath)
      if (!result.success) {
        console.error('Failed to delete asset file:', result.error)
      }
    }

    set(state => {
      const newAssets = state.assets.filter(a => a.id !== id)
      if (window.electronAPI?.saveAssetsMetadata) {
        window.electronAPI.saveAssetsMetadata(newAssets as Parameters<typeof window.electronAPI.saveAssetsMetadata>[0])
      } else {
        localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets))
      }
      return { assets: newAssets }
    })

    return true
  },

  deleteAssets: async (ids) => {
    const { assets } = get()
    const toDelete = assets.filter(a => ids.includes(a.id))

    if (window.electronAPI?.deleteAssetsBulk) {
      const filePaths = toDelete.map(a => a.filePath)
      await window.electronAPI.deleteAssetsBulk(filePaths)
    }

    set(state => {
      const newAssets = state.assets.filter(a => !ids.includes(a.id))
      if (window.electronAPI?.saveAssetsMetadata) {
        window.electronAPI.saveAssetsMetadata(newAssets as Parameters<typeof window.electronAPI.saveAssetsMetadata>[0])
      } else {
        localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets))
      }
      return { assets: newAssets }
    })

    return toDelete.length
  },

  updateAsset: async (id, updates) => {
    set(state => {
      const newAssets = state.assets.map(a =>
        a.id === id ? { ...a, ...updates } : a
      )
      if (window.electronAPI?.saveAssetsMetadata) {
        window.electronAPI.saveAssetsMetadata(newAssets as Parameters<typeof window.electronAPI.saveAssetsMetadata>[0])
      } else {
        localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets))
      }
      return { assets: newAssets }
    })
  },

  getFilteredAssets: (filter) => {
    const { assets } = get()
    let filtered = [...assets]

    // Filter by types
    if (filter.types && filter.types.length > 0) {
      filtered = filtered.filter(a => filter.types!.includes(a.type))
    }

    // Filter by models
    if (filter.models && filter.models.length > 0) {
      filtered = filtered.filter(a => filter.models!.includes(a.modelId))
    }

    // Filter by date range
    if (filter.dateFrom) {
      const from = new Date(filter.dateFrom)
      filtered = filtered.filter(a => new Date(a.createdAt) >= from)
    }
    if (filter.dateTo) {
      const to = new Date(filter.dateTo)
      to.setHours(23, 59, 59, 999)
      filtered = filtered.filter(a => new Date(a.createdAt) <= to)
    }

    // Filter by tags
    if (filter.tags && filter.tags.length > 0) {
      filtered = filtered.filter(a =>
        filter.tags!.some(tag => a.tags.includes(tag))
      )
    }

    // Filter favorites only
    if (filter.favoritesOnly) {
      filtered = filtered.filter(a => a.favorite)
    }

    // Search
    if (filter.search && filter.search.trim()) {
      const search = filter.search.toLowerCase()
      filtered = filtered.filter(a =>
        a.fileName.toLowerCase().includes(search) ||
        a.modelName.toLowerCase().includes(search) ||
        a.tags.some(t => t.toLowerCase().includes(search))
      )
    }

    // Sort
    const sortBy = filter.sortBy || 'date-desc'
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'date-asc':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        case 'name-asc':
          return a.fileName.localeCompare(b.fileName)
        case 'name-desc':
          return b.fileName.localeCompare(a.fileName)
        case 'size-desc':
          return b.fileSize - a.fileSize
        case 'size-asc':
          return a.fileSize - b.fileSize
        default:
          return 0
      }
    })

    return filtered
  },

  getAllTags: () => {
    const { assets } = get()
    const tagsSet = new Set<string>()
    assets.forEach(a => a.tags.forEach(t => tagsSet.add(t)))
    return Array.from(tagsSet).sort()
  },

  getAllModels: () => {
    const { assets } = get()
    const modelsMap = new Map<string, string>()
    assets.forEach(a => {
      if (!modelsMap.has(a.modelId)) {
        modelsMap.set(a.modelId, a.modelName)
      }
    })
    return Array.from(modelsMap.entries()).map(([modelId, modelName]) => ({
      modelId,
      modelName
    }))
  },

  setAutoSave: async (enabled) => {
    const newSettings = { ...get().settings, autoSaveAssets: enabled }
    if (window.electronAPI?.setAssetsSettings) {
      await window.electronAPI.setAssetsSettings({ autoSaveAssets: enabled })
    } else {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings))
    }
    set({ settings: newSettings })
  },

  setAssetsDirectory: async (path) => {
    const newSettings = { ...get().settings, assetsDirectory: path }
    if (window.electronAPI?.setAssetsSettings) {
      await window.electronAPI.setAssetsSettings({ assetsDirectory: path })
    } else {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings))
    }
    set({ settings: newSettings })
  },

  openAssetLocation: async (id) => {
    const asset = get().assets.find(a => a.id === id)
    if (asset && window.electronAPI?.openFileLocation) {
      await window.electronAPI.openFileLocation(asset.filePath)
    }
  },

  getAssetById: (id) => {
    return get().assets.find(a => a.id === id)
  },

  hasAssetForPrediction: (predictionId: string) => {
    return get().assets.some(a => a.predictionId === predictionId)
  },

  validateAssets: async () => {
    if (!window.electronAPI?.checkFileExists) return

    const { assets } = get()
    const validAssets: AssetMetadata[] = []

    for (const asset of assets) {
      const exists = await window.electronAPI.checkFileExists(asset.filePath)
      if (exists) {
        validAssets.push(asset)
      }
    }

    if (validAssets.length !== assets.length) {
      set({ assets: validAssets })
      if (window.electronAPI?.saveAssetsMetadata) {
        window.electronAPI.saveAssetsMetadata(validAssets as Parameters<typeof window.electronAPI.saveAssetsMetadata>[0])
      }
    }
  }
}))
