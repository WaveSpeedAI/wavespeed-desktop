/**
 * Model list service — bridges Desktop's renderer-side model store to main process.
 *
 * Instead of re-fetching models independently, we receive the model list from
 * the renderer via IPC (Desktop's modelsStore already fetches & caches them).
 * Main process only needs models for execution lookups (inputSchema etc).
 * Conversion uses shared logic from src/workflow/lib/model-converter.
 */
import type {
  WaveSpeedModel,
  ModelListCache,
} from "../../../src/workflow/types/node-defs";
import type { Model } from "../../../src/types/model";
import { convertDesktopModel } from "../../../src/workflow/lib/model-converter";

let modelCache: ModelListCache | null = null;

/**
 * Sync models from renderer's modelsStore into main process cache.
 * Called via IPC when renderer fetches/refreshes models.
 */
export function syncModelsFromRenderer(desktopModels: Model[]): void {
  const models = desktopModels.map(convertDesktopModel);
  const categories = [...new Set(models.map((m) => m.category))].sort();
  const providers = [...new Set(models.map((m) => m.provider))].sort();
  modelCache = {
    models,
    categories,
    providers,
    fetchedAt: new Date().toISOString(),
    ttlMs: 24 * 60 * 60 * 1000,
  };
}

/** Get cached models (synced from renderer). */
export function getModels(): WaveSpeedModel[] {
  return modelCache?.models ?? [];
}

export function searchModels(
  query: string,
  filters?: { category?: string; provider?: string },
): WaveSpeedModel[] {
  if (!modelCache) return [];
  let results = modelCache.models;
  if (filters?.category)
    results = results.filter((m) => m.category === filters.category);
  if (filters?.provider)
    results = results.filter((m) => m.provider === filters.provider);
  if (query.trim()) {
    const q = query.toLowerCase().trim();
    results = results
      .map((m) => ({ model: m, score: fuzzyScore(m, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.model);
  }
  return results;
}

export function getModelById(modelId: string): WaveSpeedModel | null {
  return modelCache?.models.find((m) => m.modelId === modelId) ?? null;
}

export function getModelFilters(): {
  categories: string[];
  providers: string[];
} {
  return {
    categories: modelCache?.categories ?? [],
    providers: modelCache?.providers ?? [],
  };
}

function fuzzyScore(model: WaveSpeedModel, query: string): number {
  const fields = [
    model.modelId,
    model.displayName,
    model.provider,
    model.category,
  ].map((f) => f.toLowerCase());
  let score = 0;
  for (const field of fields) {
    if (field === query) score += 100;
    else if (field.startsWith(query)) score += 50;
    else if (field.includes(query)) score += 20;
  }
  const words = query.split(/[\s\-_\/]+/).filter(Boolean);
  if (words.length > 1) {
    const allText = fields.join(" ");
    score += words.filter((w) => allText.includes(w)).length * 10;
  }
  return score;
}
