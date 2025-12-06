import { create } from 'zustand'

export interface Template {
  id: string
  name: string
  modelId: string
  modelName: string
  values: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

const TEMPLATES_STORAGE_KEY = 'wavespeed_templates'

function loadTemplates(): Template[] {
  try {
    const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.error('Failed to load templates:', e)
  }
  return []
}

function saveTemplates(templates: Template[]) {
  try {
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates))
  } catch (e) {
    console.error('Failed to save templates:', e)
  }
}

function generateId(): string {
  return `tpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Export format version for compatibility
const EXPORT_VERSION = '1.0'

export interface TemplateExport {
  version: string
  exportedAt: string
  templates: Template[]
}

interface TemplateState {
  templates: Template[]
  isLoaded: boolean

  loadTemplates: () => void
  saveTemplate: (name: string, modelId: string, modelName: string, values: Record<string, unknown>) => Template
  updateTemplate: (id: string, updates: Partial<Pick<Template, 'name' | 'values'>>) => void
  deleteTemplate: (id: string) => void
  deleteTemplates: (ids: string[]) => void
  getTemplatesByModel: (modelId: string) => Template[]
  exportTemplates: (templateIds?: string[]) => TemplateExport
  importTemplates: (data: TemplateExport, mode: 'merge' | 'replace') => { imported: number; skipped: number }
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  isLoaded: false,

  loadTemplates: () => {
    const templates = loadTemplates()
    set({ templates, isLoaded: true })
  },

  saveTemplate: (name: string, modelId: string, modelName: string, values: Record<string, unknown>) => {
    const now = new Date().toISOString()
    const template: Template = {
      id: generateId(),
      name,
      modelId,
      modelName,
      values,
      createdAt: now,
      updatedAt: now,
    }

    set(state => {
      const newTemplates = [...state.templates, template]
      saveTemplates(newTemplates)
      return { templates: newTemplates }
    })

    return template
  },

  updateTemplate: (id: string, updates: Partial<Pick<Template, 'name' | 'values'>>) => {
    set(state => {
      const newTemplates = state.templates.map(t =>
        t.id === id
          ? { ...t, ...updates, updatedAt: new Date().toISOString() }
          : t
      )
      saveTemplates(newTemplates)
      return { templates: newTemplates }
    })
  },

  deleteTemplate: (id: string) => {
    set(state => {
      const newTemplates = state.templates.filter(t => t.id !== id)
      saveTemplates(newTemplates)
      return { templates: newTemplates }
    })
  },

  deleteTemplates: (ids: string[]) => {
    const idsSet = new Set(ids)
    set(state => {
      const newTemplates = state.templates.filter(t => !idsSet.has(t.id))
      saveTemplates(newTemplates)
      return { templates: newTemplates }
    })
  },

  getTemplatesByModel: (modelId: string) => {
    return get().templates.filter(t => t.modelId === modelId)
  },

  exportTemplates: (templateIds?: string[]) => {
    const { templates } = get()
    const templatesToExport = templateIds
      ? templates.filter(t => templateIds.includes(t.id))
      : templates

    return {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      templates: templatesToExport,
    }
  },

  importTemplates: (data: TemplateExport, mode: 'merge' | 'replace') => {
    const { templates: currentTemplates } = get()
    let imported = 0
    let skipped = 0

    // Validate import data
    if (!data.templates || !Array.isArray(data.templates)) {
      throw new Error('Invalid import data: missing templates array')
    }

    if (mode === 'replace') {
      // Replace all templates with imported ones
      const newTemplates = data.templates.map(t => ({
        ...t,
        id: generateId(), // Generate new IDs to avoid conflicts
      }))
      saveTemplates(newTemplates)
      set({ templates: newTemplates })
      imported = newTemplates.length
    } else {
      // Merge: add new templates, skip duplicates by name+modelId
      const existingKeys = new Set(
        currentTemplates.map(t => `${t.modelId}:${t.name}`)
      )
      const newTemplates = [...currentTemplates]

      for (const template of data.templates) {
        const key = `${template.modelId}:${template.name}`
        if (existingKeys.has(key)) {
          skipped++
        } else {
          newTemplates.push({
            ...template,
            id: generateId(), // Generate new ID
          })
          existingKeys.add(key)
          imported++
        }
      }

      saveTemplates(newTemplates)
      set({ templates: newTemplates })
    }

    return { imported, skipped }
  },
}))
