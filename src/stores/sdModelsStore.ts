// Stable Diffusion model management store

import { create } from "zustand";
import type { SDModel } from "@/types/stable-diffusion";
import { PREDEFINED_MODELS } from "@/types/stable-diffusion";
import { formatBytes, type ProgressDetail } from "@/types/progress";

interface AuxiliaryModelStatus {
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
  detail?: ProgressDetail;
}

export interface SDLogEntry {
  id: number;
  type: "stdout" | "stderr";
  message: string;
  timestamp: Date;
}

interface SDModelsState {
  // State
  models: SDModel[];
  selectedModelId: string | null;
  isLoading: boolean;
  error: string | null;

  // Auxiliary models status
  binaryStatus: AuxiliaryModelStatus;
  vaeStatus: AuxiliaryModelStatus;
  llmStatus: AuxiliaryModelStatus;
  modelDownloadStatus: AuxiliaryModelStatus; // Track main model (z-image-turbo) download
  isGenerating: boolean;

  // SD Process logs
  sdLogs: SDLogEntry[];
  addSdLog: (log: Omit<SDLogEntry, "id">) => void;
  clearSdLogs: () => void;

  // Z-Image form state (persist across navigation)
  zImageFormValues: Record<string, unknown>;
  setZImageFormValue: (key: string, value: unknown) => void;
  setZImageFormValues: (values: Record<string, unknown>) => void;

  // Actions
  fetchModels: () => Promise<void>;
  selectModel: (modelId: string) => void;
  importCustomModel: (filePath: string) => Promise<void>;
  setError: (error: string | null) => void;
  clearError: () => void;

  // Auxiliary model actions
  updateBinaryStatus: (status: Partial<AuxiliaryModelStatus>) => void;
  updateVaeStatus: (status: Partial<AuxiliaryModelStatus>) => void;
  updateLlmStatus: (status: Partial<AuxiliaryModelStatus>) => void;
  updateModelDownloadStatus: (status: Partial<AuxiliaryModelStatus>) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  checkAuxiliaryModels: () => Promise<void>;
}

/**
 * Stable Diffusion model management store
 */
export const useSDModelsStore = create<SDModelsState>((set, get) => ({
  // Initial state
  models: PREDEFINED_MODELS.map((model) => ({
    ...model,
    localPath: undefined,
    isDownloaded: false,
    isDownloading: false,
    downloadProgress: 0,
    downloadFailed: false,
  })),
  selectedModelId: "z-image-turbo-q4-k", // Default: Z-Image-Turbo Q4_K (recommended)
  isLoading: false,
  error: null,

  // Auxiliary models initial state
  binaryStatus: {
    downloaded: false,
    downloading: false,
    progress: 0,
    error: null,
  },
  vaeStatus: {
    downloaded: false,
    downloading: false,
    progress: 0,
    error: null,
  },
  llmStatus: {
    downloaded: false,
    downloading: false,
    progress: 0,
    error: null,
  },
  modelDownloadStatus: {
    downloaded: false,
    downloading: false,
    progress: 0,
    error: null,
  },
  isGenerating: false,

  // SD Process logs initial state
  sdLogs: [],

  // Z-Image form state initial
  zImageFormValues: {},
  setZImageFormValue: (key: string, value: unknown) => {
    set((state) => ({
      zImageFormValues: {
        ...state.zImageFormValues,
        [key]: value,
      },
    }));
  },
  setZImageFormValues: (values: Record<string, unknown>) => {
    set({ zImageFormValues: values });
  },

  /**
   * Fetch model list and check which ones are downloaded
   */
  fetchModels: async () => {
    // Check if Electron API is available - silently return in browser mode
    if (!window.electronAPI?.sdListModels) {
      set({ isLoading: false });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      // Get downloaded models list
      const result = await window.electronAPI.sdListModels();

      if (!result.success) {
        throw new Error(result.error || "Failed to fetch model list");
      }

      const downloadedModels = result.models || [];
      const downloadedPaths = new Set(downloadedModels.map((m) => m.path));
      const downloadedNames = new Map(
        downloadedModels.map((m) => [m.name, m.path]),
      );

      // Update model state
      set((state) => ({
        models: state.models.map((model) => {
          // Check if model exists by localPath or by filename
          let isDownloaded = false;
          let actualPath = model.localPath;

          if (model.localPath && downloadedPaths.has(model.localPath)) {
            // Model exists at stored path
            isDownloaded = true;
          } else if (downloadedNames.has(model.name)) {
            // Model exists with matching filename (manually copied)
            isDownloaded = true;
            actualPath = downloadedNames.get(model.name);
          }

          return {
            ...model,
            isDownloaded,
            localPath: actualPath,
            // If previously marked as downloading but now complete, reset state
            isDownloading: isDownloaded ? false : model.isDownloading,
            downloadProgress: isDownloaded ? 100 : model.downloadProgress,
          };
        }),
        isLoading: false,
      }));
    } catch (error) {
      console.error("Failed to fetch models:", error);
      set({
        error: (error as Error).message,
        isLoading: false,
      });
    }
  },

  /**
   * Select model
   */
  selectModel: (modelId: string) => {
    const model = get().models.find((m) => m.id === modelId);

    if (!model) {
      set({ error: "Model does not exist" });
      return;
    }

    // Allow selecting any model (even if not downloaded)
    set({ selectedModelId: modelId, error: null });
  },

  /**
   * Import custom model
   */
  importCustomModel: async (filePath: string) => {
    // Check if Electron API is available - silently return in browser mode
    if (!window.electronAPI?.sdListModels) {
      set({ error: "This feature requires the desktop app" });
      return;
    }

    try {
      // Validate file is .gguf format
      if (!filePath.toLowerCase().endsWith(".gguf")) {
        throw new Error("Only .gguf format model files are supported");
      }

      // Extract filename
      const fileName = filePath.split(/[\\/]/).pop() || "custom-model.gguf";

      // Create custom model entry
      const customModel: SDModel = {
        id: `custom-${Date.now()}`,
        name: fileName,
        displayName: fileName.replace(".gguf", ""),
        description: "Custom imported model",
        size: 0, // Size unknown
        quantization: "Unknown",
        downloadUrl: "",
        localPath: filePath,
        isDownloaded: true,
        isDownloading: false,
        downloadProgress: 100,
      };

      // Add to model list
      set((state) => ({
        models: [...state.models, customModel],
        selectedModelId: customModel.id,
      }));
    } catch (error) {
      console.error("Failed to import custom model:", error);
      set({ error: `Import failed: ${(error as Error).message}` });
    }
  },

  /**
   * Set error
   */
  setError: (error: string | null) => {
    set({ error });
  },

  /**
   * Clear error
   */
  clearError: () => {
    set({ error: null });
  },

  /**
   * Update binary status
   */
  updateBinaryStatus: (status: Partial<AuxiliaryModelStatus>) => {
    set((state) => ({
      binaryStatus: { ...state.binaryStatus, ...status },
    }));
  },

  /**
   * Update VAE status
   */
  updateVaeStatus: (status: Partial<AuxiliaryModelStatus>) => {
    set((state) => ({
      vaeStatus: { ...state.vaeStatus, ...status },
    }));
  },

  /**
   * Update LLM status
   */
  updateLlmStatus: (status: Partial<AuxiliaryModelStatus>) => {
    set((state) => ({
      llmStatus: { ...state.llmStatus, ...status },
    }));
  },

  /**
   * Update model download status
   */
  updateModelDownloadStatus: (status: Partial<AuxiliaryModelStatus>) => {
    set((state) => ({
      modelDownloadStatus: { ...state.modelDownloadStatus, ...status },
    }));
  },

  /**
   * Set generating status
   */
  setIsGenerating: (isGenerating: boolean) => {
    set({ isGenerating });
  },

  /**
   * Check auxiliary models status
   */
  checkAuxiliaryModels: async () => {
    try {
      // Check auxiliary models (LLM and VAE)
      if (window.electronAPI?.sdCheckAuxiliaryModels) {
        const result = await window.electronAPI.sdCheckAuxiliaryModels();
        if (result.success) {
          set((state) => ({
            llmStatus: { ...state.llmStatus, downloaded: result.llmExists },
            vaeStatus: { ...state.vaeStatus, downloaded: result.vaeExists },
          }));
        }
      }

      // Check SD binary
      if (window.electronAPI?.sdGetBinaryPath) {
        const result = await window.electronAPI.sdGetBinaryPath();
        set((state) => ({
          binaryStatus: { ...state.binaryStatus, downloaded: result.success },
        }));
      }
    } catch (error) {
      console.error("Failed to check auxiliary models:", error);
    }
  },

  /**
   * Add SD log entry
   */
  addSdLog: (log: Omit<SDLogEntry, "id">) => {
    set((state) => {
      const MAX_LOGS = 1000;
      const newLog: SDLogEntry = {
        ...log,
        id:
          state.sdLogs.length > 0
            ? state.sdLogs[state.sdLogs.length - 1].id + 1
            : 0,
      };

      const updatedLogs = [...state.sdLogs, newLog];
      // Keep only last MAX_LOGS entries
      if (updatedLogs.length > MAX_LOGS) {
        return { sdLogs: updatedLogs.slice(-MAX_LOGS) };
      }
      return { sdLogs: updatedLogs };
    });
  },

  /**
   * Clear SD logs
   */
  clearSdLogs: () => {
    set({ sdLogs: [] });
  },
}));

/**
 * Helper function: Get selected model
 */
export function useSelectedModel(): SDModel | null {
  const { models, selectedModelId } = useSDModelsStore();
  return models.find((m) => m.id === selectedModelId) || null;
}

/**
 * Helper function: Get downloaded models list
 */
export function useDownloadedModels(): SDModel[] {
  const { models } = useSDModelsStore();
  return models.filter((m) => m.isDownloaded);
}

/**
 * Helper function: Get available models list
 */
export function useAvailableModels(): SDModel[] {
  const { models } = useSDModelsStore();
  return models.filter((m) => !m.isDownloaded && !m.isDownloading);
}

/**
 * Helper function: Check if any model is downloading
 */
export function useHasDownloadingModel(): boolean {
  const { models } = useSDModelsStore();
  return models.some((m) => m.isDownloading);
}

/**
 * Helper function: Format model display information
 */
export function formatModelDisplay(model: SDModel): string {
  const sizeStr = formatBytes(model.size);
  return `${model.displayName} (${model.quantization}, ${sizeStr})`;
}
