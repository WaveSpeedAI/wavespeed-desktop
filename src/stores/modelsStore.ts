import { create } from 'zustand'
import { apiClient } from '@/api/client'
import type { Model } from '@/types/model'
import { fuzzySearch } from '@/lib/fuzzySearch'

export type SortBy = 'name' | 'price' | 'type' | 'sort_order'
export type SortOrder = 'asc' | 'desc'

interface ModelsState {
  models: Model[]
  isLoading: boolean
  error: string | null
  searchQuery: string
  selectedType: string | null
  sortBy: SortBy
  sortOrder: SortOrder
  fetchModels: () => Promise<void>
  setSearchQuery: (query: string) => void
  setSelectedType: (type: string | null) => void
  setSortBy: (sortBy: SortBy) => void
  setSortOrder: (sortOrder: SortOrder) => void
  toggleSortOrder: () => void
  getFilteredModels: () => Model[]
  getModelById: (modelId: string) => Model | undefined
}

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  isLoading: false,
  error: null,
  searchQuery: '',
  selectedType: null,
  sortBy: 'sort_order',
  sortOrder: 'desc',

  fetchModels: async () => {
    set({ isLoading: true, error: null })
    try {
      const models = await apiClient.listModels()
      set({ models, isLoading: false })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch models',
        isLoading: false
      })
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query })
  },

  setSelectedType: (type: string | null) => {
    set({ selectedType: type })
  },

  setSortBy: (sortBy: SortBy) => {
    set({ sortBy })
  },

  setSortOrder: (sortOrder: SortOrder) => {
    set({ sortOrder })
  },

  toggleSortOrder: () => {
    set((state) => ({ sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' }))
  },

  getFilteredModels: () => {
    const { models, searchQuery, selectedType, sortBy, sortOrder } = get()

    // First filter by type if selected
    let filtered = selectedType
      ? models.filter(m => m.type === selectedType)
      : [...models]

    // Then apply fuzzy search
    if (searchQuery.trim()) {
      const results = fuzzySearch(filtered, searchQuery, (model) => [
        model.name,
        model.model_id,
        model.description || '',
        model.type || ''
      ])
      filtered = results.map(r => r.item)
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'price':
          comparison = (a.base_price ?? 0) - (b.base_price ?? 0)
          break
        case 'type':
          comparison = (a.type || '').localeCompare(b.type || '')
          break
        case 'sort_order':
          comparison = (a.sort_order ?? 0) - (b.sort_order ?? 0)
          break
      }
      return sortOrder === 'asc' ? comparison : -comparison
    })

    return sorted
  },

  getModelById: (modelId: string) => {
    return get().models.find(m => m.model_id === modelId)
  }
}))
