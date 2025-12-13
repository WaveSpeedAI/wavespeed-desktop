import { create } from 'zustand'

const SETTINGS_STORAGE_KEY = 'wavespeed_settings'

export interface Settings {
  downloadTimeout: number // in seconds
}

const DEFAULT_SETTINGS: Settings = {
  downloadTimeout: 3600, // 60 minutes
}

function getStoredSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch (e) {
    console.warn('Failed to parse stored settings:', e)
  }
  return DEFAULT_SETTINGS
}

function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

interface SettingsState {
  settings: Settings
  setDownloadTimeout: (timeout: number) => void
  initSettings: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,

  setDownloadTimeout: (timeout: number) => {
    const newSettings = { ...get().settings, downloadTimeout: timeout }
    saveSettings(newSettings)
    set({ settings: newSettings })
  },

  initSettings: () => {
    const settings = getStoredSettings()
    set({ settings })
  },
}))

// Helper to get download timeout in milliseconds (for workers)
export function getDownloadTimeoutMs(): number {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return (parsed.downloadTimeout || DEFAULT_SETTINGS.downloadTimeout) * 1000
    }
  } catch (e) {
    // ignore
  }
  return DEFAULT_SETTINGS.downloadTimeout * 1000
}
