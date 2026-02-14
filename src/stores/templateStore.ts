import { create } from 'zustand'
import type { Template, TemplateFilter, CreateTemplateInput } from '../types/template'

const TEMPLATES_STORAGE_KEY = 'wavespeed_templates'
const MIGRATION_FLAG_KEY = 'wavespeed_templates_migrated'

function invokeTemplateIpc<T = unknown>(channel: string, args?: unknown): Promise<T> {
  if (!window.workflowAPI?.invoke) {
    throw new Error('Template service is unavailable in this runtime')
  }
  return window.workflowAPI.invoke(channel, args) as Promise<T>
}

interface TemplateState {
  templates: Template[]
  isLoading: boolean
  error: string | null
  
  // CRUD operations
  loadTemplates: (filter?: TemplateFilter) => Promise<void>
  createTemplate: (input: CreateTemplateInput) => Promise<Template>
  updateTemplate: (id: string, updates: Partial<Template>) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  deleteTemplates: (ids: string[]) => Promise<void>
  
  // Special operations
  toggleFavorite: (id: string) => Promise<void>
  useTemplate: (id: string) => Promise<void>
  
  // Import/Export
  exportTemplates: (ids?: string[]) => Promise<void>
  importTemplates: (file: File, mode: 'merge' | 'replace') => Promise<{ imported: number; skipped: number }>
  
  // Filters
  currentFilter: TemplateFilter
  setFilter: (filter: TemplateFilter) => void
  
  // Migration
  migrateFromLocalStorage: () => Promise<void>
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  isLoading: false,
  error: null,
  currentFilter: {},
  
  migrateFromLocalStorage: async () => {
    try {
      const migrationComplete = localStorage.getItem(MIGRATION_FLAG_KEY) === 'true'
      if (migrationComplete) {
        console.log('[Template Store] Migration already completed')
        return
      }
      
      const legacyTemplatesJson = localStorage.getItem(TEMPLATES_STORAGE_KEY)
      if (!legacyTemplatesJson) {
        console.log('[Template Store] No legacy templates to migrate')
        localStorage.setItem(MIGRATION_FLAG_KEY, 'true')
        return
      }
      
      const result = await invokeTemplateIpc<{ migrated: number; skipped: number }>('template:migrate', {
        legacyTemplatesJson,
        migrationComplete
      })
      
      console.log(`[Template Store] Migration complete: ${result.migrated} migrated, ${result.skipped} skipped`)
      localStorage.setItem(MIGRATION_FLAG_KEY, 'true')
      
      // Reload templates after migration using current filter
      await get().loadTemplates(get().currentFilter)
    } catch (error) {
      console.error('[Template Store] Migration failed:', error)
    }
  },
  
  loadTemplates: async (filter?: TemplateFilter) => {
    const activeFilter = filter ?? get().currentFilter
    set({ isLoading: true, error: null })
    try {
      const templates = await invokeTemplateIpc<Template[]>('template:query', activeFilter)
      set({ templates, isLoading: false })
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false })
    }
  },
  
  createTemplate: async (input: CreateTemplateInput) => {
    set({ isLoading: true, error: null })
    try {
      const template = await invokeTemplateIpc<Template>('template:create', input)
      set(state => ({
        templates: [template, ...state.templates],
        isLoading: false
      }))
      return template
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false })
      throw error
    }
  },
  
  updateTemplate: async (id: string, updates: Partial<Template>) => {
    // Optimistic update
    set(state => ({
      templates: state.templates.map(t => 
        t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
      )
    }))
    
    try {
      await invokeTemplateIpc('template:update', { id, updates })
    } catch (error) {
      // Revert on error
      await get().loadTemplates(get().currentFilter)
      set({ error: (error as Error).message })
      throw error
    }
  },
  
  deleteTemplate: async (id: string) => {
    // Optimistic delete
    set(state => ({
      templates: state.templates.filter(t => t.id !== id)
    }))
    
    try {
      await invokeTemplateIpc('template:delete', { id })
    } catch (error) {
      // Revert on error
      await get().loadTemplates(get().currentFilter)
      set({ error: (error as Error).message })
      throw error
    }
  },
  
  deleteTemplates: async (ids: string[]) => {
    const idsSet = new Set(ids)
    set(state => ({
      templates: state.templates.filter(t => !idsSet.has(t.id))
    }))
    
    try {
      await invokeTemplateIpc('template:deleteMany', { ids })
    } catch (error) {
      await get().loadTemplates(get().currentFilter)
      set({ error: (error as Error).message })
      throw error
    }
  },
  
  toggleFavorite: async (id: string) => {
    // Optimistic toggle
    set(state => ({
      templates: state.templates.map(t =>
        t.id === id ? { ...t, isFavorite: !t.isFavorite } : t
      )
    }))
    
    try {
      await invokeTemplateIpc('template:toggleFavorite', { id })
    } catch (error) {
      await get().loadTemplates(get().currentFilter)
      set({ error: (error as Error).message })
      throw error
    }
  },
  
  useTemplate: async (id: string) => {
    try {
      await invokeTemplateIpc('template:incrementUseCount', { id })
      // Update local state
      set(state => ({
        templates: state.templates.map(t =>
          t.id === id ? { ...t, useCount: t.useCount + 1 } : t
        )
      }))
    } catch (error) {
      console.error('Failed to increment use count:', error)
    }
  },
  
  exportTemplates: async (ids?: string[]) => {
    try {
      const data = await invokeTemplateIpc('template:export', { ids })
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `templates-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      set({ error: (error as Error).message })
      throw error
    }
  },
  
  importTemplates: async (file: File, mode: 'merge' | 'replace') => {
    set({ isLoading: true, error: null })
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const result = await invokeTemplateIpc<{ imported: number; skipped: number }>('template:import', { data, mode })
      await get().loadTemplates(get().currentFilter)
      set({ isLoading: false })
      return result
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false })
      throw error
    }
  },
  
  setFilter: (filter: TemplateFilter) => {
    set({ currentFilter: filter })
    get().loadTemplates(filter)
  }
}))
