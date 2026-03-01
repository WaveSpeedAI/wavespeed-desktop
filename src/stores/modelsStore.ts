import { create } from "zustand";
import { apiClient } from "@/api/client";
import type { Model } from "@/types/model";
import { fuzzySearch } from "@/lib/fuzzySearch";

export type SortBy = "name" | "price" | "type" | "sort_order";
export type SortOrder = "asc" | "desc";

const FAVORITES_STORAGE_KEY = "wavespeed_favorites";

function loadFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch (e) {
    console.error("Failed to load favorites:", e);
  }
  return new Set();
}

function saveFavorites(favorites: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favorites]));
  } catch (e) {
    console.error("Failed to save favorites:", e);
  }
}

interface ModelsState {
  models: Model[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  selectedType: string | null;
  sortBy: SortBy;
  sortOrder: SortOrder;
  favorites: Set<string>;
  showFavoritesOnly: boolean;
  hasFetched: boolean;
  fetchModels: (force?: boolean) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedType: (type: string | null) => void;
  setSortBy: (sortBy: SortBy) => void;
  setSortOrder: (sortOrder: SortOrder) => void;
  toggleSortOrder: () => void;
  toggleFavorite: (modelId: string) => void;
  isFavorite: (modelId: string) => boolean;
  setShowFavoritesOnly: (show: boolean) => void;
  getFilteredModels: () => Model[];
  getModelById: (modelId: string) => Model | undefined;
}

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  isLoading: false,
  error: null,
  searchQuery: "",
  selectedType: null,
  sortBy: "sort_order",
  sortOrder: "desc",
  favorites: loadFavorites(),
  showFavoritesOnly: false,
  hasFetched: false,

  fetchModels: async (force = false) => {
    // Skip if already fetched (unless forced)
    if (get().hasFetched && !force) {
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const raw = await apiClient.listModels();
      // Deduplicate by model_id (API may return duplicates)
      const seen = new Set<string>();
      const models = raw.filter((m) => {
        if (seen.has(m.model_id)) return false;
        seen.add(m.model_id);
        return true;
      });
      set({ models, isLoading: false, hasFetched: true });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to fetch models",
        isLoading: false,
      });
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  setSelectedType: (type: string | null) => {
    set({ selectedType: type });
  },

  setSortBy: (sortBy: SortBy) => {
    set({ sortBy });
  },

  setSortOrder: (sortOrder: SortOrder) => {
    set({ sortOrder });
  },

  toggleSortOrder: () => {
    set((state) => ({ sortOrder: state.sortOrder === "asc" ? "desc" : "asc" }));
  },

  toggleFavorite: (modelId: string) => {
    const { favorites } = get();
    const newFavorites = new Set(favorites);
    if (newFavorites.has(modelId)) {
      newFavorites.delete(modelId);
    } else {
      newFavorites.add(modelId);
    }
    saveFavorites(newFavorites);
    set({ favorites: newFavorites });
  },

  isFavorite: (modelId: string) => {
    return get().favorites.has(modelId);
  },

  setShowFavoritesOnly: (show: boolean) => {
    set({ showFavoritesOnly: show });
  },

  getFilteredModels: () => {
    const {
      models,
      searchQuery,
      selectedType,
      sortBy,
      sortOrder,
      favorites,
      showFavoritesOnly,
    } = get();

    // First filter by favorites if enabled
    let filtered = showFavoritesOnly
      ? models.filter((m) => favorites.has(m.model_id))
      : [...models];

    // Then filter by type if selected
    if (selectedType) {
      filtered = filtered.filter((m) => m.type === selectedType);
    }

    // Then apply fuzzy search
    if (searchQuery.trim()) {
      const results = fuzzySearch(filtered, searchQuery, (model) => [
        model.name,
        model.model_id,
        model.description || "",
        model.type || "",
      ]);
      // Return results sorted by match relevance (fuzzySearch already sorts by score)
      return results.map((r) => r.item);
    }

    // Apply sorting only when not searching
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "price":
          comparison = (a.base_price ?? 0) - (b.base_price ?? 0);
          break;
        case "type":
          comparison = (a.type || "").localeCompare(b.type || "");
          break;
        case "sort_order":
          comparison = (a.sort_order ?? 0) - (b.sort_order ?? 0);
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return sorted;
  },

  getModelById: (modelId: string) => {
    return get().models.find((m) => m.model_id === modelId);
  },
}));
