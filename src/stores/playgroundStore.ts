import { create } from 'zustand'
import { apiClient } from '@/api/client'
import type { Model } from '@/types/model'
import type { PredictionResult } from '@/types/prediction'
import type { FormFieldConfig } from '@/lib/schemaToForm'

interface PlaygroundState {
  selectedModel: Model | null
  formValues: Record<string, unknown>
  formFields: FormFieldConfig[]
  validationErrors: Record<string, string>
  isRunning: boolean
  currentPrediction: PredictionResult | null
  error: string | null
  outputs: string[]

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

export const usePlaygroundStore = create<PlaygroundState>((set, get) => ({
  selectedModel: null,
  formValues: {},
  formFields: [],
  validationErrors: {},
  isRunning: false,
  currentPrediction: null,
  error: null,
  outputs: [],

  setSelectedModel: (model: Model | null) => {
    set({
      selectedModel: model,
      formValues: {},
      formFields: [],
      validationErrors: {},
      currentPrediction: null,
      error: null,
      outputs: []
    })
  },

  setFormValue: (key: string, value: unknown) => {
    set(state => ({
      formValues: { ...state.formValues, [key]: value },
      // Clear validation error when value is set
      validationErrors: { ...state.validationErrors, [key]: '' }
    }))
  },

  setFormValues: (values: Record<string, unknown>) => {
    set({ formValues: values, validationErrors: {} })
  },

  setFormFields: (fields: FormFieldConfig[]) => {
    set({ formFields: fields })
  },

  validateForm: () => {
    const { formFields, formValues } = get()
    const errors: Record<string, string> = {}
    let isValid = true

    for (const field of formFields) {
      if (field.required && isEmpty(formValues[field.name])) {
        errors[field.name] = `${field.label} is required`
        isValid = false
      }
    }

    set({ validationErrors: errors })
    return isValid
  },

  clearValidationError: (key: string) => {
    set(state => ({
      validationErrors: { ...state.validationErrors, [key]: '' }
    }))
  },

  resetForm: () => {
    set({
      formValues: {},
      validationErrors: {},
      currentPrediction: null,
      error: null,
      outputs: []
    })
  },

  runPrediction: async () => {
    const { selectedModel, formValues, validateForm } = get()
    if (!selectedModel) {
      set({ error: 'No model selected' })
      return
    }

    // Validate required fields
    if (!validateForm()) {
      return
    }

    set({ isRunning: true, error: null, currentPrediction: null, outputs: [] })

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

      set({
        currentPrediction: result,
        outputs: result.outputs || [],
        isRunning: false
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to run prediction',
        isRunning: false
      })
    }
  },

  clearOutput: () => {
    set({ currentPrediction: null, outputs: [], error: null })
  }
}))
