import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePredictionInputsStore } from '@mobile/stores/predictionInputsStore'

describe('predictionInputsStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    usePredictionInputsStore.setState({
      entries: new Map(),
      isLoaded: false
    })
    // Clear localStorage mock
    vi.mocked(localStorage.getItem).mockReturnValue(null)
    vi.mocked(localStorage.setItem).mockClear()
    vi.mocked(localStorage.removeItem).mockClear()
  })

  describe('load', () => {
    it('should load entries from localStorage', () => {
      const mockEntries = [
        {
          predictionId: 'pred-1',
          modelId: 'model-1',
          modelName: 'Test Model',
          inputs: { prompt: 'test prompt' },
          createdAt: new Date().toISOString()
        }
      ]
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(mockEntries))

      const store = usePredictionInputsStore.getState()
      store.load()

      const state = usePredictionInputsStore.getState()
      expect(state.isLoaded).toBe(true)
      expect(state.entries.size).toBe(1)
      expect(state.entries.get('pred-1')).toBeDefined()
    })

    it('should handle empty localStorage', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null)

      const store = usePredictionInputsStore.getState()
      store.load()

      const state = usePredictionInputsStore.getState()
      expect(state.isLoaded).toBe(true)
      expect(state.entries.size).toBe(0)
    })

    it('should handle invalid JSON in localStorage', () => {
      vi.mocked(localStorage.getItem).mockReturnValue('invalid json')

      const store = usePredictionInputsStore.getState()
      store.load()

      const state = usePredictionInputsStore.getState()
      expect(state.isLoaded).toBe(true)
      expect(state.entries.size).toBe(0)
    })
  })

  describe('save', () => {
    it('should save a new entry', () => {
      const store = usePredictionInputsStore.getState()

      store.save('pred-1', 'model-1', 'Test Model', { prompt: 'test' })

      const state = usePredictionInputsStore.getState()
      expect(state.entries.size).toBe(1)
      expect(state.entries.get('pred-1')).toMatchObject({
        predictionId: 'pred-1',
        modelId: 'model-1',
        modelName: 'Test Model',
        inputs: { prompt: 'test' }
      })
    })

    it('should persist to localStorage', () => {
      const store = usePredictionInputsStore.getState()

      store.save('pred-1', 'model-1', 'Test Model', { prompt: 'test' })

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'wavespeed_prediction_inputs',
        expect.any(String)
      )
    })

    it('should overwrite existing entry with same predictionId', () => {
      const store = usePredictionInputsStore.getState()

      store.save('pred-1', 'model-1', 'Test Model', { prompt: 'first' })
      store.save('pred-1', 'model-1', 'Test Model', { prompt: 'second' })

      const state = usePredictionInputsStore.getState()
      expect(state.entries.size).toBe(1)
      expect(state.entries.get('pred-1')?.inputs).toEqual({ prompt: 'second' })
    })
  })

  describe('get', () => {
    it('should return entry by predictionId', () => {
      const store = usePredictionInputsStore.getState()
      store.save('pred-1', 'model-1', 'Test Model', { prompt: 'test' })

      const entry = store.get('pred-1')
      expect(entry).toBeDefined()
      expect(entry?.predictionId).toBe('pred-1')
    })

    it('should return undefined for non-existent predictionId', () => {
      const store = usePredictionInputsStore.getState()

      const entry = store.get('non-existent')
      expect(entry).toBeUndefined()
    })
  })

  describe('getArchived', () => {
    it('should return entries older than archive age', () => {
      const store = usePredictionInputsStore.getState()

      // Add an old entry (8 days ago)
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 8)

      // Set entries directly for testing
      usePredictionInputsStore.setState({
        entries: new Map([
          ['old-pred', {
            predictionId: 'old-pred',
            modelId: 'model-1',
            modelName: 'Test Model',
            inputs: { prompt: 'old' },
            createdAt: oldDate.toISOString()
          }],
          ['new-pred', {
            predictionId: 'new-pred',
            modelId: 'model-1',
            modelName: 'Test Model',
            inputs: { prompt: 'new' },
            createdAt: new Date().toISOString()
          }]
        ]),
        isLoaded: true
      })

      const archived = usePredictionInputsStore.getState().getArchived()
      expect(archived.length).toBe(1)
      expect(archived[0].predictionId).toBe('old-pred')
    })
  })

  describe('clear', () => {
    it('should clear all entries', () => {
      const store = usePredictionInputsStore.getState()
      store.save('pred-1', 'model-1', 'Test Model', { prompt: 'test' })

      store.clear()

      const state = usePredictionInputsStore.getState()
      expect(state.entries.size).toBe(0)
      expect(localStorage.removeItem).toHaveBeenCalledWith('wavespeed_prediction_inputs')
    })
  })
})
