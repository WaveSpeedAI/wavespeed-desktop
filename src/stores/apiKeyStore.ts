import { create } from 'zustand'
import { apiClient } from '@/api/client'

interface ApiKeyState {
  apiKey: string
  isLoading: boolean
  isValidating: boolean
  isValidated: boolean
  setApiKey: (apiKey: string) => Promise<void>
  loadApiKey: () => Promise<void>
  validateApiKey: () => Promise<boolean>
}

export const useApiKeyStore = create<ApiKeyState>((set, get) => ({
  apiKey: '',
  isLoading: true,
  isValidating: false,
  isValidated: false,

  setApiKey: async (apiKey: string) => {
    apiClient.setApiKey(apiKey)
    set({ apiKey, isValidated: false })

    // Save to electron store
    if (window.electronAPI) {
      await window.electronAPI.setApiKey(apiKey)
    }

    // Validate the new key
    await get().validateApiKey()
  },

  loadApiKey: async () => {
    set({ isLoading: true })
    try {
      if (window.electronAPI) {
        const storedKey = await window.electronAPI.getApiKey()
        if (storedKey) {
          apiClient.setApiKey(storedKey)
          set({ apiKey: storedKey })
          await get().validateApiKey()
        }
      }
    } catch (error) {
      console.error('Failed to load API key:', error)
    } finally {
      set({ isLoading: false })
    }
  },

  validateApiKey: async () => {
    const { apiKey } = get()
    if (!apiKey) {
      set({ isValidated: false, isValidating: false })
      return false
    }

    set({ isValidating: true })
    try {
      // Try to fetch models to validate the key
      await apiClient.listModels()
      set({ isValidated: true, isValidating: false })
      return true
    } catch {
      set({ isValidated: false, isValidating: false })
      return false
    }
  }
}))
