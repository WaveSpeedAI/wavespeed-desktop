import { create } from 'zustand'
import { apiClient } from '@/api/client'
import type { Model } from '@/types/model'
import type { PredictionResult } from '@/types/prediction'
import type { FormFieldConfig } from '@/lib/schemaToForm'
import type { BatchConfig, BatchState, BatchResult } from '@/types/batch'
import { DEFAULT_BATCH_CONFIG } from '@/types/batch'

interface PlaygroundTab {
  id: string
  selectedModel: Model | null
  formValues: Record<string, unknown>
  formFields: FormFieldConfig[]
  validationErrors: Record<string, string>
  isRunning: boolean
  currentPrediction: PredictionResult | null
  error: string | null
  outputs: (string | Record<string, unknown>)[]
  // Batch processing
  batchConfig: BatchConfig
  batchState: BatchState | null
  batchResults: BatchResult[]
  // File upload tracking
  uploadingCount: number
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

  // Batch processing actions
  setBatchConfig: (config: Partial<BatchConfig>) => void
  runBatch: () => Promise<void>
  cancelBatch: () => void
  clearBatchResults: () => void
  generateBatchInputs: () => Record<string, unknown>[]

  // File upload tracking
  setUploading: (isUploading: boolean) => void
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
    outputs: [],
    // Batch processing defaults
    batchConfig: { ...DEFAULT_BATCH_CONFIG },
    batchState: null,
    batchResults: [],
    // File upload tracking
    uploadingCount: 0
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
              outputs: [],
              // Reset batch mode when switching models
              batchConfig: { ...DEFAULT_BATCH_CONFIG },
              batchState: null,
              batchResults: []
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

    // Set running state and clear batch results (switching to single mode)
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? { ...tab, isRunning: true, error: null, currentPrediction: null, outputs: [], batchState: null, batchResults: [] }
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
  },

  // Batch processing actions
  setBatchConfig: (config: Partial<BatchConfig>) => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? { ...tab, batchConfig: { ...tab.batchConfig, ...config } }
          : tab
      )
    }))
  },

  generateBatchInputs: () => {
    const activeTab = get().getActiveTab()
    if (!activeTab) return []

    const { formValues, formFields, batchConfig } = activeTab
    const count = batchConfig.repeatCount
    // Only randomize seed if the field exists and is a number type
    const hasSeedField = formFields.some(f => f.name.toLowerCase() === 'seed' && f.type === 'number')

    // Clean input values
    const cleanedBase: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(formValues)) {
      if (value !== '' && value !== undefined && value !== null) {
        cleanedBase[key] = value
      }
    }

    // Generate inputs with incremental seeds
    const inputs: Record<string, unknown>[] = []
    const baseSeed = Math.floor(Math.random() * 65536)

    for (let i = 0; i < count; i++) {
      const input = { ...cleanedBase }
      if (batchConfig.randomizeSeed && hasSeedField) {
        input.seed = (baseSeed + i) % 65536
      }
      inputs.push(input)
    }

    return inputs
  },

  runBatch: async () => {
    const activeTab = get().getActiveTab()
    if (!activeTab) return

    const { selectedModel } = activeTab
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

    // Validate required fields first
    if (!get().validateForm()) {
      return
    }

    // Generate batch inputs
    const inputs = get().generateBatchInputs()
    if (inputs.length === 0) {
      return
    }

    // Initialize batch state
    const queue = inputs.map((input, index) => ({
      id: `batch-${index}`,
      index,
      input,
      status: 'pending' as const
    }))

    const tabId = get().activeTabId

    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? {
              ...tab,
              isRunning: true,
              error: null,
              batchState: {
                isRunning: true,
                queue,
                currentIndex: 0,
                completedCount: 0,
                failedCount: 0,
                cancelRequested: false
              },
              batchResults: []
            }
          : tab
      )
    }))

    // Set all items to running status
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId && tab.batchState
          ? {
              ...tab,
              batchState: {
                ...tab.batchState,
                queue: tab.batchState.queue.map(item => ({ ...item, status: 'running' as const }))
              }
            }
          : tab
      )
    }))

    // Process all requests concurrently
    const results: BatchResult[] = new Array(inputs.length)

    const promises = inputs.map(async (input, i) => {
      const startTime = Date.now()
      try {
        const result = await apiClient.run(selectedModel.model_id, input, {
          enableSyncMode: input.enable_sync_mode as boolean
        })
        const timing = Date.now() - startTime

        results[i] = {
          id: queue[i].id,
          index: i,
          input,
          prediction: result,
          outputs: result.outputs || [],
          error: null,
          timing
        }

        // Update state for this completed item
        set(state => ({
          tabs: state.tabs.map(tab =>
            tab.id === tabId && tab.batchState
              ? {
                  ...tab,
                  batchState: {
                    ...tab.batchState,
                    completedCount: tab.batchState.completedCount + 1,
                    queue: tab.batchState.queue.map((item, idx) =>
                      idx === i ? { ...item, status: 'completed' as const, result } : item
                    )
                  },
                  batchResults: results.filter(Boolean)
                }
              : tab
          )
        }))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to run prediction'
        const timing = Date.now() - startTime

        results[i] = {
          id: queue[i].id,
          index: i,
          input,
          prediction: null,
          outputs: [],
          error: errorMessage,
          timing
        }

        // Update state for this failed item
        set(state => ({
          tabs: state.tabs.map(tab =>
            tab.id === tabId && tab.batchState
              ? {
                  ...tab,
                  batchState: {
                    ...tab.batchState,
                    failedCount: tab.batchState.failedCount + 1,
                    queue: tab.batchState.queue.map((item, idx) =>
                      idx === i ? { ...item, status: 'failed' as const, error: errorMessage } : item
                    )
                  },
                  batchResults: results.filter(Boolean)
                }
              : tab
          )
        }))
      }
    })

    // Wait for all to complete
    await Promise.all(promises)

    // Finalize batch
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? {
              ...tab,
              isRunning: false,
              batchState: tab.batchState
                ? { ...tab.batchState, isRunning: false }
                : null,
              batchResults: results
            }
          : tab
      )
    }))
  },

  cancelBatch: () => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId && tab.batchState
          ? {
              ...tab,
              batchState: { ...tab.batchState, cancelRequested: true }
            }
          : tab
      )
    }))
  },

  clearBatchResults: () => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? {
              ...tab,
              batchState: null,
              batchResults: [],
              error: null
            }
          : tab
      )
    }))
  },

  setUploading: (isUploading: boolean) => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === state.activeTabId
          ? {
              ...tab,
              uploadingCount: Math.max(0, tab.uploadingCount + (isUploading ? 1 : -1))
            }
          : tab
      )
    }))
  }
}))
