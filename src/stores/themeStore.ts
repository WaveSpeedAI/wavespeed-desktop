import { create } from 'zustand'

export type Theme = 'auto' | 'dark' | 'light'

const THEME_STORAGE_KEY = 'wavespeed_theme'

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'dark' || stored === 'light' || stored === 'auto') {
    return stored
  }
  return 'dark' // Default to dark theme
}

function applyTheme(theme: Theme) {
  const root = document.documentElement

  if (theme === 'auto') {
    // Follow system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  } else if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  initTheme: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'auto',

  setTheme: (theme: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },

  initTheme: () => {
    const theme = getStoredTheme()
    applyTheme(theme)
    set({ theme })

    // Listen for system theme changes when in auto mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (get().theme === 'auto') {
        applyTheme('auto')
      }
    }
    mediaQuery.addEventListener('change', handleChange)
  },
}))
