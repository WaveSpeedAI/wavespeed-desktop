import { create } from 'zustand'
import { apiClient } from '@/api/client'
import type { Model } from '@/types/model'
import type { PredictionResult } from '@/types/prediction'
import type { FormFieldConfig } from '@/lib/schemaToForm'

interface PlaygroundTab {
  id: string
  selectedModel: Model | null
  formValues: Record<string, unknown>
  formFields: FormFieldConfig[]
  validationErrors: Record<string, string>
  isRunning: boolean
  currentPrediction: PredictionResult | null
  error: string | null
  outputs: string[]
}

interface PlaygroundState {
  tabs: PlaygroundTab[]
  activeTabId: string | null

  // Tab management
  createTab: (model?: Model) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void

  // Current tab accessors (for convenience)
  getActiveTab: () => PlaygroundTab | null

  // Actions on active tab
  setSelectedModel: (model: Model | null) => void
  setFormValue: (key: string, value: unknown) => void
  setFormValues: (values: Record<string, unknown>) => void
  setFormFields: (fields: FormFieldConfig[]) => void
  validateForm: () => boolean
  clearValidationError: (key: string) => void
  resetForm: () => void
  runPrediction: () => Promise<void>
  clearOutput: () => void
}

// Check if a value is considered "empty"
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}

function createEmptyTab(id: string, model?: Model): PlaygroundTab {
  return {
    id,
    selectedModel: model || null,
    formValues: {},
    formFields: [],
    validationErrors: {},
    isRunning: false,
    currentPrediction: null,
    error: null,
    outputs: []
  }
}

let tabCounter = 0

export const usePlaygroundStore = create<PlaygroundState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  createTab: (model?: Model) => {
    const id = `tab-${++tabCounter}`
    const newTab = createEmptyTab(id, model)
    set(state => ({
      tabs: [...state.tabs, newTab],
      activeTabId: id
    }))
    return id
  },

  closeTab: (tabId: string) => {
    set(state => {
      const newTabs = state.tabs.filter(t => t.id !== tabId)
      let newActiveTabId = state.activeTabId

      // If we're closing the active tab, switch to another
      if (state.activeTabId === tabId) {
        const closedIndex = state.tabs.findIndex(t => t.id === tabId)
        if (newTabs.length > 0) {
          // Try to select the tab to the left, or the first one
          const newIndex = Math.min(closedIndex, newTabs.length - 1)
          newActiveTabId = newTabs[newIndex].id
        } else {
          newActiveTabId = null
        }
      }

      return { tabs: newTabs, activeTabId: newActiveTabId }
    })
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId })
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find(t => t.id === activeTabId) || null
  },

  setSelectedModel: (model: Model | null) => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? {
              ...tab,
              selectedModel: model,
              formValues: {},
              formFields: [],
              validationErrors: {},
              currentPrediction: null,
              error: null,
              outputs: []
            }
          : tab
      )
    }))
  },

  setFormValue: (key: string, value: unknown) => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? {
              ...tab,
              formValues: { ...tab.formValues, [key]: value },
              validationErrors: { ...tab.validationErrors, [key]: '' }
            }
          : tab
      )
    }))
  },

  setFormValues: (values: Record<string, unknown>) => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? { ...tab, formValues: values, validationErrors: {} }
          : tab
      )
    }))
  },

  setFormFields: (fields: FormFieldConfig[]) => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? { ...tab, formFields: fields }
          : tab
      )
    }))
  },

  validateForm: () => {
    const activeTab = get().getActiveTab()
    if (!activeTab) return false

    const errors: Record<string, string> = {}
    let isValid = true

    for (const field of activeTab.formFields) {
      if (field.required && isEmpty(activeTab.formValues[field.name])) {
        errors[field.name] = `${field.label} is required`
        isValid = false
      }
    }

    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? { ...tab, validationErrors: errors }
          : tab
      )
    }))

    return isValid
  },

  clearValidationError: (key: string) => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? { ...tab, validationErrors: { ...tab.validationErrors, [key]: '' } }
          : tab
      )
    }))
  },

  resetForm: () => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? {
              ...tab,
              formValues: {},
              validationErrors: {},
              currentPrediction: null,
              error: null,
              outputs: []
            }
          : tab
      )
    }))
  },

  runPrediction: async () => {
    const activeTab = get().getActiveTab()
    if (!activeTab) return

    const { selectedModel, formValues } = activeTab
    if (!selectedModel) {
      set(state => ({
        tabs: state.tabs.map(tab =>
          tab.id === state.activeTabId
            ? { ...tab, error: 'No model selected' }
            : tab
        )
      }))
      return
    }

    // Validate required fields
    if (!get().validateForm()) {
      return
    }

    // Set running state
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? { ...tab, isRunning: true, error: null, currentPrediction: null, outputs: [] }
          : tab
      )
    }))

    const tabId = get().activeTabId

    try {
      // Clean up form values - remove empty strings and undefined
      const cleanedInput: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(formValues)) {
        if (value !== '' && value !== undefined && value !== null) {
          cleanedInput[key] = value
        }
      }

      const result = await apiClient.run(selectedModel.model_id, cleanedInput, {
        enableSyncMode: cleanedInput.enable_sync_mode as boolean
      })

      // Update the specific tab (it might not be active anymore)
      set(state => ({
        tabs: state.tabs.map(tab =>
          tab.id === tabId
            ? {
                ...tab,
                currentPrediction: result,
                outputs: result.outputs || [],
                isRunning: false
              }
            : tab
        )
      }))
    } catch (error) {
      set(state => ({
        tabs: state.tabs.map(tab =>
          tab.id === tabId
            ? {
                ...tab,
                error: error instanceof Error ? error.message : 'Failed to run prediction',
                isRunning: false
              }
            : tab
        )
      }))
    }
  },

  clearOutput: () => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? { ...tab, currentPrediction: null, outputs: [], error: null }
          : tab
      )
    }))
  }
}))
