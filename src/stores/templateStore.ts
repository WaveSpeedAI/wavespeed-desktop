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

interface TemplateState {
  templates: Template[]
  isLoaded: boolean

  loadTemplates: () => void
  saveTemplate: (name: string, modelId: string, modelName: string, values: Record<string, unknown>) => Template
  updateTemplate: (id: string, updates: Partial<Pick<Template, 'name' | 'values'>>) => void
  deleteTemplate: (id: string) => void
  getTemplatesByModel: (modelId: string) => Template[]
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

  getTemplatesByModel: (modelId: string) => {
    return get().templates.filter(t => t.modelId === modelId)
  },
}))
