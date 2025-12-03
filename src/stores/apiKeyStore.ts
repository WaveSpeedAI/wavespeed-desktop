import { create } from 'zustand'
import { apiClient } from '@/api/client'

const API_KEY_STORAGE_KEY = 'wavespeed_api_key'

interface ApiKeyState {
  apiKey: string
  isLoading: boolean
  isValidating: boolean
  isValidated: boolean
  setApiKey: (apiKey: string) => Promise<void>
  loadApiKey: () => Promise<void>
  validateApiKey: () => Promise<boolean>
}

// Helper to save API key (electron-store or localStorage fallback)
async function saveApiKey(apiKey: string): Promise<void> {
  if (window.electronAPI) {
    await window.electronAPI.setApiKey(apiKey)
  } else {
    // Fallback to localStorage for browser/dev mode
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey)
  }
}

// Helper to load API key (electron-store or localStorage fallback)
async function loadStoredApiKey(): Promise<string | null> {
  if (window.electronAPI) {
    return await window.electronAPI.getApiKey()
  } else {
    // Fallback to localStorage for browser/dev mode
    return localStorage.getItem(API_KEY_STORAGE_KEY)
  }
}

export const useApiKeyStore = create<ApiKeyState>((set, get) => ({
  apiKey: '',
  isLoading: true,
  isValidating: false,
  isValidated: false,

  setApiKey: async (apiKey: string) => {
    apiClient.setApiKey(apiKey)
    set({ apiKey, isValidated: false })

    // Save to storage
    await saveApiKey(apiKey)

    // Validate the new key
    await get().validateApiKey()
  },

  loadApiKey: async () => {
    set({ isLoading: true })
    try {
      const storedKey = await loadStoredApiKey()
      if (storedKey) {
        apiClient.setApiKey(storedKey)
        set({ apiKey: storedKey })
        await get().validateApiKey()
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
