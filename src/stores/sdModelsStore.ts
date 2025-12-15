// Stable Diffusion model management store

import { create } from 'zustand'
import type { SDModel } from '@/types/stable-diffusion'
import { PREDEFINED_MODELS } from '@/types/stable-diffusion'
import { formatBytes } from '@/types/progress'

interface AuxiliaryModelStatus {
  downloaded: boolean
  downloading: boolean
  progress: number
  error: string | null
  detail?: {
    current?: number
    total?: number
    unit?: string
  }
}

export interface SDLogEntry {
  id: number
  type: 'stdout' | 'stderr'
  message: string
  timestamp: Date
}

interface SDModelsState {
  // State
  models: SDModel[]
  selectedModelId: string | null
  isLoading: boolean
  error: string | null

  // Auxiliary models status
  binaryStatus: AuxiliaryModelStatus
  vaeStatus: AuxiliaryModelStatus
  llmStatus: AuxiliaryModelStatus
  modelDownloadStatus: AuxiliaryModelStatus  // Track main model (z-image-turbo) download
  isGenerating: boolean

  // SD Process logs
  sdLogs: SDLogEntry[]
  addSdLog: (log: Omit<SDLogEntry, 'id'>) => void
  clearSdLogs: () => void

  // Actions
  fetchModels: () => Promise<void>
  downloadModel: (modelId: string) => Promise<void>
  deleteModel: (modelId: string) => Promise<void>
  selectModel: (modelId: string) => void
  importCustomModel: (filePath: string) => Promise<void>
  setError: (error: string | null) => void
  clearError: () => void

  // Auxiliary model actions
  updateBinaryStatus: (status: Partial<AuxiliaryModelStatus>) => void
  updateVaeStatus: (status: Partial<AuxiliaryModelStatus>) => void
  updateLlmStatus: (status: Partial<AuxiliaryModelStatus>) => void
  updateModelDownloadStatus: (status: Partial<AuxiliaryModelStatus>) => void
  setIsGenerating: (isGenerating: boolean) => void
  checkAuxiliaryModels: () => Promise<void>
}

/**
 * Stable Diffusion model management store
 */
export const useSDModelsStore = create<SDModelsState>((set, get) => ({
  // Initial state
  models: PREDEFINED_MODELS.map((model) => ({
    ...model,
    localPath: undefined,
    isDownloaded: false,
    isDownloading: false,
    downloadProgress: 0,
    downloadFailed: false
  })),
  selectedModelId: 'z-image-turbo-q4-k', // Default: Z-Image-Turbo Q4_K (recommended)
  isLoading: false,
  error: null,

  // Auxiliary models initial state
  binaryStatus: { downloaded: false, downloading: false, progress: 0, error: null },
  vaeStatus: { downloaded: false, downloading: false, progress: 0, error: null },
  llmStatus: { downloaded: false, downloading: false, progress: 0, error: null },
  modelDownloadStatus: { downloaded: false, downloading: false, progress: 0, error: null },
  isGenerating: false,

  // SD Process logs initial state
  sdLogs: [],

  /**
   * Fetch model list and check which ones are downloaded
   */
  fetchModels: async () => {
    set({ isLoading: true, error: null })

    try {
      // Check if Electron API is available
      if (!window.electronAPI?.sdListModels) {
        throw new Error('Electron API not available')
      }

      // Get downloaded models list
      const result = await window.electronAPI.sdListModels()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch model list')
      }

      const downloadedModels = result.models || []
      const downloadedPaths = new Set(downloadedModels.map((m) => m.path))
      const downloadedNames = new Map(downloadedModels.map((m) => [m.name, m.path]))

      // Update model state
      set((state) => ({
        models: state.models.map((model) => {
          // Check if model exists by localPath or by filename
          let isDownloaded = false
          let actualPath = model.localPath

          if (model.localPath && downloadedPaths.has(model.localPath)) {
            // Model exists at stored path
            isDownloaded = true
          } else if (downloadedNames.has(model.name)) {
            // Model exists with matching filename (manually copied)
            isDownloaded = true
            actualPath = downloadedNames.get(model.name)
          }

          return {
            ...model,
            isDownloaded,
            localPath: actualPath,
            // If previously marked as downloading but now complete, reset state
            isDownloading: isDownloaded ? false : model.isDownloading,
            downloadProgress: isDownloaded ? 100 : model.downloadProgress
          }
        }),
        isLoading: false
      }))
    } catch (error) {
      console.error('Failed to fetch models:', error)
      set({
        error: (error as Error).message,
        isLoading: false
      })
    }
  },

  /**
   * Download model
   */
  downloadModel: async (modelId: string) => {
    const model = get().models.find((m) => m.id === modelId)

    if (!model) {
      set({ error: 'Model does not exist' })
      return
    }

    if (model.isDownloaded) {
      set({ error: 'Model already downloaded' })
      return
    }

    if (model.isDownloading) {
      set({ error: 'Model is currently downloading' })
      return
    }

    // Mark as downloading and clear any previous failure
    set((state) => ({
      models: state.models.map((m) =>
        m.id === modelId
          ? { ...m, isDownloading: true, downloadProgress: 0, downloadFailed: false }
          : m
      ),
      error: null
    }))

    try {
      if (!window.electronAPI?.sdDownloadModel) {
        throw new Error('Electron API not available')
      }

      // Get default assets directory
      const assetsDir = await window.electronAPI.getDefaultAssetsDirectory()
      const modelsDir = `${assetsDir}/../models/stable-diffusion`
      const destPath = `${modelsDir}/${model.name}`

      console.log(`[Frontend] Starting download for model: ${model.name}`)
      console.log(`[Frontend] Download URL: ${model.downloadUrl}`)
      console.log(`[Frontend] Destination path: ${destPath}`)

      // Listen to download progress
      const removeListener = window.electronAPI.onSdDownloadProgress((data) => {
        console.log(`[Frontend] Download progress: ${data.progress}%`, data)
        set((state) => ({
          models: state.models.map((m) =>
            m.id === modelId ? { ...m, downloadProgress: data.progress } : m
          )
        }))
      })

      // Start download
      console.log(`[Frontend] Calling sdDownloadModel...`)
      const result = await window.electronAPI.sdDownloadModel(
        model.downloadUrl,
        destPath
      )
      console.log(`[Frontend] Download result:`, result)

      // Remove progress listener
      removeListener()

      if (!result.success) {
        throw new Error(result.error || 'Download failed')
      }

      // Update model state
      set((state) => ({
        models: state.models.map((m) =>
          m.id === modelId
            ? {
                ...m,
                isDownloaded: true,
                isDownloading: false,
                downloadProgress: 100,
                localPath: result.filePath
              }
            : m
        )
      }))

      // If this is the first downloaded model, auto-select it
      if (!get().selectedModelId || get().selectedModelId === modelId) {
        set({ selectedModelId: modelId })
      }
    } catch (error) {
      console.error('Failed to download model:', error)

      // Mark download as failed
      set((state) => ({
        models: state.models.map((m) =>
          m.id === modelId
            ? { ...m, isDownloading: false, downloadProgress: 0, downloadFailed: true }
            : m
        ),
        error: `Download failed: ${(error as Error).message}`
      }))
    }
  },

  /**
   * Delete model
   */
  deleteModel: async (modelId: string) => {
    const model = get().models.find((m) => m.id === modelId)

    if (!model) {
      set({ error: 'Model does not exist' })
      return
    }

    if (!model.isDownloaded || !model.localPath) {
      set({ error: 'Model not downloaded' })
      return
    }

    try {
      if (!window.electronAPI?.sdDeleteModel) {
        throw new Error('Electron API not available')
      }

      const result = await window.electronAPI.sdDeleteModel(model.localPath)

      if (!result.success) {
        throw new Error(result.error || 'Delete failed')
      }

      // Update model state
      set((state) => ({
        models: state.models.map((m) =>
          m.id === modelId
            ? {
                ...m,
                isDownloaded: false,
                localPath: undefined,
                downloadProgress: 0
              }
            : m
        )
      }))

      // If deleted model was selected, clear selection
      if (get().selectedModelId === modelId) {
        // Try to select first downloaded model
        const firstDownloaded = get().models.find((m) => m.isDownloaded)
        set({ selectedModelId: firstDownloaded?.id || null })
      }
    } catch (error) {
      console.error('Failed to delete model:', error)
      set({ error: `Delete failed: ${(error as Error).message}` })
    }
  },

  /**
   * Select model
   */
  selectModel: (modelId: string) => {
    const model = get().models.find((m) => m.id === modelId)

    if (!model) {
      set({ error: 'Model does not exist' })
      return
    }

    // Allow selecting any model (even if not downloaded)
    set({ selectedModelId: modelId, error: null })
  },

  /**
   * Import custom model
   */
  importCustomModel: async (filePath: string) => {
    try {
      if (!window.electronAPI?.sdListModels) {
        throw new Error('Electron API not available')
      }

      // Validate file is .gguf format
      if (!filePath.toLowerCase().endsWith('.gguf')) {
        throw new Error('Only .gguf format model files are supported')
      }

      // Extract filename
      const fileName = filePath.split(/[\\/]/).pop() || 'custom-model.gguf'

      // Create custom model entry
      const customModel: SDModel = {
        id: `custom-${Date.now()}`,
        name: fileName,
        displayName: fileName.replace('.gguf', ''),
        description: 'Custom imported model',
        size: 0, // Size unknown
        quantization: 'Unknown',
        downloadUrl: '',
        localPath: filePath,
        isDownloaded: true,
        isDownloading: false,
        downloadProgress: 100
      }

      // Add to model list
      set((state) => ({
        models: [...state.models, customModel],
        selectedModelId: customModel.id
      }))
    } catch (error) {
      console.error('Failed to import custom model:', error)
      set({ error: `Import failed: ${(error as Error).message}` })
    }
  },

  /**
   * Set error
   */
  setError: (error: string | null) => {
    set({ error })
  },

  /**
   * Clear error
   */
  clearError: () => {
    set({ error: null })
  },

  /**
   * Update binary status
   */
  updateBinaryStatus: (status: Partial<AuxiliaryModelStatus>) => {
    set((state) => ({
      binaryStatus: { ...state.binaryStatus, ...status }
    }))
  },

  /**
   * Update VAE status
   */
  updateVaeStatus: (status: Partial<AuxiliaryModelStatus>) => {
    set((state) => ({
      vaeStatus: { ...state.vaeStatus, ...status }
    }))
  },

  /**
   * Update LLM status
   */
  updateLlmStatus: (status: Partial<AuxiliaryModelStatus>) => {
    set((state) => ({
      llmStatus: { ...state.llmStatus, ...status }
    }))
  },

  /**
   * Update model download status
   */
  updateModelDownloadStatus: (status: Partial<AuxiliaryModelStatus>) => {
    set((state) => ({
      modelDownloadStatus: { ...state.modelDownloadStatus, ...status }
    }))
  },

  /**
   * Set generating status
   */
  setIsGenerating: (isGenerating: boolean) => {
    set({ isGenerating })
  },

  /**
   * Check auxiliary models status
   */
  checkAuxiliaryModels: async () => {
    try {
      // Check auxiliary models (LLM and VAE)
      if (window.electronAPI?.sdCheckAuxiliaryModels) {
        const result = await window.electronAPI.sdCheckAuxiliaryModels()
        if (result.success) {
          set((state) => ({
            llmStatus: { ...state.llmStatus, downloaded: result.llmExists },
            vaeStatus: { ...state.vaeStatus, downloaded: result.vaeExists }
          }))
        }
      }

      // Check SD binary
      if (window.electronAPI?.sdGetBinaryPath) {
        const result = await window.electronAPI.sdGetBinaryPath()
        set((state) => ({
          binaryStatus: { ...state.binaryStatus, downloaded: result.success }
        }))
      }
    } catch (error) {
      console.error('Failed to check auxiliary models:', error)
    }
  },

  /**
   * Add SD log entry
   */
  addSdLog: (log: Omit<SDLogEntry, 'id'>) => {
    set((state) => {
      const MAX_LOGS = 1000
      const newLog: SDLogEntry = {
        ...log,
        id: state.sdLogs.length > 0 ? state.sdLogs[state.sdLogs.length - 1].id + 1 : 0
      }

      const updatedLogs = [...state.sdLogs, newLog]
      // Keep only last MAX_LOGS entries
      if (updatedLogs.length > MAX_LOGS) {
        return { sdLogs: updatedLogs.slice(-MAX_LOGS) }
      }
      return { sdLogs: updatedLogs }
    })
  },

  /**
   * Clear SD logs
   */
  clearSdLogs: () => {
    set({ sdLogs: [] })
  }
}))

/**
 * Helper function: Get selected model
 */
export function useSelectedModel(): SDModel | null {
  const { models, selectedModelId } = useSDModelsStore()
  return models.find((m) => m.id === selectedModelId) || null
}

/**
 * Helper function: Get downloaded models list
 */
export function useDownloadedModels(): SDModel[] {
  const { models } = useSDModelsStore()
  return models.filter((m) => m.isDownloaded)
}

/**
 * Helper function: Get available models list
 */
export function useAvailableModels(): SDModel[] {
  const { models } = useSDModelsStore()
  return models.filter((m) => !m.isDownloaded && !m.isDownloading)
}

/**
 * Helper function: Check if any model is downloading
 */
export function useHasDownloadingModel(): boolean {
  const { models } = useSDModelsStore()
  return models.some((m) => m.isDownloading)
}

/**
 * Helper function: Format model display information
 */
export function formatModelDisplay(model: SDModel): string {
  const sizeStr = formatBytes(model.size)
  return `${model.displayName} (${model.quantization}, ${sizeStr})`
}
