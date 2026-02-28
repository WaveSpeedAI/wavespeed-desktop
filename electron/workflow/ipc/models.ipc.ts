/**
 * Models IPC handlers — bridges Desktop's renderer model store to workflow engine.
 *
 * Instead of fetching models independently, the renderer syncs its model list
 * to main process when it loads. This reuses Desktop's existing apiClient and
 * modelsStore, avoiding duplicate API calls and API key management.
 */
import { ipcMain } from "electron";
import {
  getModels,
  searchModels,
  getModelById,
  syncModelsFromRenderer,
} from "../services/model-list";
import type { WaveSpeedModel } from "../../../src/workflow/types/node-defs";
import type { Model } from "../../../src/types/model";

export function registerModelsIpc(): void {
  /**
   * Renderer calls this after modelsStore.fetchModels() completes,
   * syncing the full model list to main process for workflow execution.
   */
  ipcMain.handle(
    "models:sync",
    async (_event, models: Model[]): Promise<void> => {
      syncModelsFromRenderer(models);
    },
  );

  /** Get cached models (must be synced first via models:sync). */
  ipcMain.handle("models:list", async (): Promise<WaveSpeedModel[]> => {
    try {
      return getModels();
    } catch (err) {
      console.error("models:list error:", err);
      return [];
    }
  });

  ipcMain.handle(
    "models:search",
    async (
      _event,
      args: { query: string; category?: string; provider?: string },
    ): Promise<WaveSpeedModel[]> => {
      return searchModels(args.query, {
        category: args.category,
        provider: args.provider,
      });
    },
  );

  ipcMain.handle(
    "models:get-schema",
    async (
      _event,
      args: { modelId: string },
    ): Promise<WaveSpeedModel | null> => {
      return getModelById(args.modelId);
    },
  );
}
