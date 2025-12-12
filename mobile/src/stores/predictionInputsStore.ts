import { create } from 'zustand'

const STORAGE_KEY = 'wavespeed_prediction_inputs'
const MAX_ENTRIES = 10000 // Keep last 10000 predictions
const ARCHIVE_AGE_DAYS = 7 // Entries older than 7 days are considered archived

interface PredictionInputEntry {
  predictionId: string
  modelId: string
  modelName: string
  inputs: Record<string, unknown>
  createdAt: string
}

interface PredictionInputsState {
  entries: Map<string, PredictionInputEntry>
  isLoaded: boolean

  load: () => void
  save: (predictionId: string, modelId: string, modelName: string, inputs: Record<string, unknown>) => void
  get: (predictionId: string) => PredictionInputEntry | undefined
  getArchived: () => PredictionInputEntry[]
  clear: () => void
}

function isArchived(createdAt: string): boolean {
  const created = new Date(createdAt).getTime()
  const now = Date.now()
  const archiveAge = ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000
  return now - created > archiveAge
}

function loadFromStorage(): Map<string, PredictionInputEntry> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    console.log('[PredictionInputsStore] Loading from storage, raw:', stored?.substring(0, 200))
    if (stored) {
      const entries = JSON.parse(stored) as PredictionInputEntry[]
      console.log('[PredictionInputsStore] Parsed entries count:', entries.length)
      if (entries.length > 0) {
        console.log('[PredictionInputsStore] First entry predictionId:', entries[0].predictionId)
      }
      return new Map(entries.map(e => [e.predictionId, e]))
    }
    console.log('[PredictionInputsStore] No stored data found')
  } catch (e) {
    console.error('Failed to load prediction inputs:', e)
  }
  return new Map()
}

function saveToStorage(entries: Map<string, PredictionInputEntry>) {
  try {
    // Convert to array, sort by date (newest first), limit count
    const array = Array.from(entries.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, MAX_ENTRIES) // Keep only last MAX_ENTRIES

    localStorage.setItem(STORAGE_KEY, JSON.stringify(array))
  } catch (e) {
    console.error('Failed to save prediction inputs:', e)
  }
}

export const usePredictionInputsStore = create<PredictionInputsState>((set, get) => ({
  entries: new Map(),
  isLoaded: false,

  load: () => {
    console.log('[PredictionInputsStore] load() called')
    const entries = loadFromStorage()
    console.log('[PredictionInputsStore] Loaded entries Map size:', entries.size)
    set({ entries, isLoaded: true })
  },

  save: (predictionId: string, modelId: string, modelName: string, inputs: Record<string, unknown>) => {
    console.log('[PredictionInputsStore] save() called:', { predictionId, modelId, modelName, inputKeys: Object.keys(inputs) })
    const entry: PredictionInputEntry = {
      predictionId,
      modelId,
      modelName,
      inputs,
      createdAt: new Date().toISOString()
    }

    set(state => {
      const newEntries = new Map(state.entries)
      newEntries.set(predictionId, entry)
      console.log('[PredictionInputsStore] Saving to storage, new size:', newEntries.size)
      saveToStorage(newEntries)
      return { entries: newEntries }
    })
  },

  get: (predictionId: string) => {
    const entries = get().entries
    console.log('[PredictionInputsStore] get() called for:', predictionId, 'entries size:', entries.size)
    const result = entries.get(predictionId)
    console.log('[PredictionInputsStore] get() result:', result ? 'found' : 'not found')
    return result
  },

  getArchived: () => {
    const entries = get().entries
    const archived = Array.from(entries.values())
      .filter(e => isArchived(e.createdAt))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return archived
  },

  clear: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({ entries: new Map() })
  }
}))
