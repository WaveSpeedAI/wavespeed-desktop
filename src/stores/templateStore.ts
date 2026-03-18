import { create } from "zustand";
import type {
  Template,
  TemplateFilter,
  CreateTemplateInput,
  TemplateExport,
} from "../types/template";

const TEMPLATES_STORAGE_KEY = "wavespeed_templates";
const MIGRATION_FLAG_KEY = "wavespeed_templates_migrated";

/** True when running in Electron with full template IPC. */
function hasTemplateIpc(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as { workflowAPI?: { invoke?: unknown } }).workflowAPI
        ?.invoke,
    )
  );
}

function readTemplatesFromStorage(): Template[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (t): t is Template =>
            t && typeof t === "object" && typeof t.id === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writeTemplatesToStorage(templates: Template[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
}

function applyFilter(
  templates: Template[],
  filter?: TemplateFilter,
): Template[] {
  if (!filter) return [...templates];
  let out = templates;
  if (filter.templateType)
    out = out.filter((t) => t.templateType === filter.templateType);
  if (filter.type) out = out.filter((t) => t.type === filter.type);
  if (filter.isFavorite !== undefined)
    out = out.filter((t) => t.isFavorite === filter.isFavorite);
  if (filter.category && filter.templateType === "workflow") {
    out = out.filter(
      (t) =>
        (t.workflowData as { category?: string } | null)?.category ===
        filter.category,
    );
  }
  if (filter.search?.trim()) {
    const q = filter.search.trim().toLowerCase();
    out = out.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q)) ||
        (t.playgroundData?.modelId ?? "").toLowerCase().includes(q) ||
        (t.playgroundData?.modelName ?? "").toLowerCase().includes(q) ||
        (t.workflowData?.category ?? "").toLowerCase().includes(q) ||
        (t._searchText ?? "").toLowerCase().includes(q),
    );
  }
  if (filter.sortBy === "useCount")
    out = [...out].sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0));
  else
    out = [...out].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  return out;
}

async function browserTemplateInvoke<T = unknown>(
  channel: string,
  args?: unknown,
): Promise<T> {
  const templates = readTemplatesFromStorage();
  const now = new Date().toISOString();

  switch (channel) {
    case "template:migrate": {
      const { legacyTemplatesJson } = (args ?? {}) as {
        legacyTemplatesJson?: string;
      };
      if (!legacyTemplatesJson) return { migrated: 0, skipped: 0 } as T;
      try {
        const legacy = JSON.parse(legacyTemplatesJson) as
          | Record<string, unknown>[]
          | unknown;
        const arr = Array.isArray(legacy) ? legacy : [];
        let migrated = 0;
        for (const item of arr) {
          if (!item || typeof item !== "object") continue;
          const o = item as Record<string, unknown>;
          const name = String(o.name ?? "Untitled");
          const id = `custom-${Date.now()}-${migrated}`;
          const hasLegacyPlayground =
            o.modelId != null && o.modelName != null && o.values != null;
          const template: Template = {
            id,
            name,
            description: o.description != null ? String(o.description) : null,
            tags: Array.isArray(o.tags)
              ? o.tags.filter((x): x is string => typeof x === "string")
              : [],
            type: "custom",
            templateType: hasLegacyPlayground
              ? "playground"
              : ((o.templateType as "playground" | "workflow") ?? "workflow"),
            isFavorite: false,
            createdAt: (o.createdAt as string) ?? now,
            updatedAt: (o.updatedAt as string) ?? now,
            author: null,
            useCount: 0,
            thumbnail: o.thumbnail != null ? String(o.thumbnail) : null,
            playgroundData: hasLegacyPlayground
              ? {
                  modelId: String(o.modelId),
                  modelName: String(o.modelName),
                  values: (o.values as Record<string, unknown>) ?? {},
                }
              : ((o.playgroundData as Template["playgroundData"]) ?? null),
            workflowData: (o.workflowData as Template["workflowData"]) ?? null,
          };
          templates.push(template);
          migrated++;
        }
        writeTemplatesToStorage(templates);
        localStorage.setItem(MIGRATION_FLAG_KEY, "true");
        return { migrated, skipped: 0 } as T;
      } catch {
        return { migrated: 0, skipped: 0 } as T;
      }
    }
    case "template:query": {
      const filter = (args ?? {}) as TemplateFilter | undefined;
      return applyFilter(templates, filter) as T;
    }
    case "template:create": {
      const input = args as CreateTemplateInput;
      const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const template: Template = {
        id,
        name: input.name,
        i18nKey: input.i18nKey,
        _searchText: input._searchText,
        description: input.description ?? null,
        tags: input.tags ?? [],
        type: input.type ?? "custom",
        templateType: input.templateType,
        isFavorite: false,
        createdAt: now,
        updatedAt: now,
        author: input.author ?? null,
        useCount: 0,
        thumbnail: input.thumbnail ?? null,
        playgroundData: input.playgroundData ?? null,
        workflowData: input.workflowData ?? null,
      };
      templates.unshift(template);
      writeTemplatesToStorage(templates);
      return template as T;
    }
    case "template:update": {
      const { id, updates } = (args ?? {}) as {
        id: string;
        updates: Partial<Template>;
      };
      const idx = templates.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error(`Template ${id} not found`);
      templates[idx] = { ...templates[idx], ...updates, updatedAt: now };
      writeTemplatesToStorage(templates);
      return undefined as T;
    }
    case "template:delete": {
      const { id } = (args ?? {}) as { id: string };
      const next = templates.filter((t) => t.id !== id);
      writeTemplatesToStorage(next);
      return undefined as T;
    }
    case "template:deleteMany": {
      const { ids } = (args ?? {}) as { ids: string[] };
      const set = new Set(ids);
      const next = templates.filter((t) => !set.has(t.id));
      writeTemplatesToStorage(next);
      return undefined as T;
    }
    case "template:toggleFavorite": {
      const { id } = (args ?? {}) as { id: string };
      const idx = templates.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error(`Template ${id} not found`);
      templates[idx] = {
        ...templates[idx],
        isFavorite: !templates[idx].isFavorite,
        updatedAt: now,
      };
      writeTemplatesToStorage(templates);
      return undefined as T;
    }
    case "template:incrementUseCount": {
      const { id } = (args ?? {}) as { id: string };
      const idx = templates.findIndex((t) => t.id === id);
      if (idx !== -1) {
        templates[idx] = {
          ...templates[idx],
          useCount: (templates[idx].useCount ?? 0) + 1,
          updatedAt: now,
        };
        writeTemplatesToStorage(templates);
      }
      return undefined as T;
    }
    case "template:queryNames": {
      const { templateType: tType } = (args ?? {}) as { templateType?: string };
      let names = templates.map((t) => t.name);
      if (tType)
        names = templates
          .filter((t) => t.templateType === tType)
          .map((t) => t.name);
      return [...new Set(names)] as T;
    }
    case "template:export": {
      const { ids } = (args ?? {}) as { ids?: string[] };
      const list = ids
        ? templates.filter((t) => ids.includes(t.id))
        : [...templates];
      const data: TemplateExport = {
        version: "1",
        exportedAt: now,
        templates: list,
      };
      return data as T;
    }
    case "template:import": {
      const { data, mode } = (args ?? {}) as {
        data: TemplateExport;
        mode: "merge" | "replace" | "rename";
      };
      if (!data?.templates || !Array.isArray(data.templates))
        throw new Error("Invalid import data");

      let next: Template[];
      let replaced = 0;

      if (mode === "replace") {
        // Replace: delete existing custom templates that have the same name+type as imports
        const importedTypes = new Set(
          data.templates.map((t) => t.templateType),
        );
        const importNamesByType: Record<string, Set<string>> = {};
        for (const t of data.templates) {
          if (!importNamesByType[t.templateType])
            importNamesByType[t.templateType] = new Set();
          importNamesByType[t.templateType].add(t.name);
        }
        next = templates.filter((t) => {
          if (t.type !== "custom" || !importedTypes.has(t.templateType))
            return true;
          const names = importNamesByType[t.templateType];
          if (names?.has(t.name)) {
            replaced++;
            return false;
          }
          return true;
        });
      } else {
        next = [...templates];
      }

      // Build live name sets per type
      const namesByType: Record<string, Set<string>> = {};
      for (const t of next) {
        if (!namesByType[t.templateType])
          namesByType[t.templateType] = new Set();
        namesByType[t.templateType].add(t.name);
      }

      let imported = 0;
      let skipped = 0;
      for (const t of data.templates) {
        const typeNames = namesByType[t.templateType] ?? new Set();
        let finalName = t.name;

        if (typeNames.has(t.name)) {
          if (mode === "merge") {
            skipped++;
            continue;
          }
          if (mode === "rename") {
            let counter = 2;
            while (typeNames.has(`${t.name} (${counter})`)) counter++;
            finalName = `${t.name} (${counter})`;
          }
        }

        const id = `custom-${Date.now()}-${imported}-${Math.random().toString(36).slice(2, 9)}`;
        next.push({
          ...t,
          id,
          name: finalName,
          type: "custom",
          createdAt: now,
          updatedAt: now,
          useCount: 0,
        });
        typeNames.add(finalName);
        if (!namesByType[t.templateType])
          namesByType[t.templateType] = typeNames;
        imported++;
      }
      writeTemplatesToStorage(next);
      return { imported, skipped, replaced } as T;
    }
    default:
      throw new Error(`Unknown template channel: ${channel}`);
  }
}

function invokeTemplateIpc<T = unknown>(
  channel: string,
  args?: unknown,
): Promise<T> {
  if (hasTemplateIpc()) {
    return (
      window as unknown as {
        workflowAPI: { invoke: (ch: string, a?: unknown) => Promise<T> };
      }
    ).workflowAPI.invoke(channel, args);
  }
  return browserTemplateInvoke<T>(channel, args);
}

interface TemplateState {
  templates: Template[];
  isLoading: boolean;
  error: string | null;

  // CRUD operations
  loadTemplates: (filter?: TemplateFilter) => Promise<void>;
  createTemplate: (input: CreateTemplateInput) => Promise<Template>;
  updateTemplate: (
    id: string,
    updates: Partial<Template>,
  ) => Promise<Partial<Template>>;
  deleteTemplate: (id: string) => Promise<void>;
  deleteTemplates: (ids: string[]) => Promise<void>;

  // Special operations
  toggleFavorite: (id: string) => Promise<void>;
  useTemplate: (id: string) => Promise<void>;

  // Import/Export
  exportTemplates: (ids?: string[], exportAll?: boolean) => Promise<void>;
  exportSingleTemplate: (
    id: string,
    defaultName: string,
  ) => Promise<{ success: boolean; canceled?: boolean }>;
  exportBatchTemplates: (
    ids: string[],
  ) => Promise<{ success: boolean; count?: number; canceled?: boolean }>;
  exportMergedTemplates: (
    ids: string[],
    defaultName: string,
  ) => Promise<{ success: boolean; canceled?: boolean }>;
  importTemplates: (
    file: File,
    mode: "merge" | "replace" | "rename",
  ) => Promise<{ imported: number; skipped: number; replaced: number }>;
  pickAndImportTemplates: (mode: "merge" | "replace" | "rename") => Promise<{
    imported: number;
    skipped: number;
    replaced: number;
    canceled?: boolean;
  }>;

  // Query existing names for uniqueness checks
  queryTemplateNames: (templateType?: string) => Promise<string[]>;

  // Filters
  currentFilter: TemplateFilter;
  setFilter: (filter: TemplateFilter) => void;

  // Migration
  migrateFromLocalStorage: () => Promise<void>;
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  isLoading: false,
  error: null,
  currentFilter: {},

  migrateFromLocalStorage: async () => {
    try {
      const migrationComplete =
        localStorage.getItem(MIGRATION_FLAG_KEY) === "true";
      if (migrationComplete) {
        console.log("[Template Store] Migration already completed");
        return;
      }

      const legacyTemplatesJson = localStorage.getItem(TEMPLATES_STORAGE_KEY);
      if (!legacyTemplatesJson) {
        console.log("[Template Store] No legacy templates to migrate");
        localStorage.setItem(MIGRATION_FLAG_KEY, "true");
        return;
      }

      const result = await invokeTemplateIpc<{
        migrated: number;
        skipped: number;
      }>("template:migrate", {
        legacyTemplatesJson,
        migrationComplete,
      });

      console.log(
        `[Template Store] Migration complete: ${result.migrated} migrated, ${result.skipped} skipped`,
      );
      localStorage.setItem(MIGRATION_FLAG_KEY, "true");

      // Reload templates after migration using current filter
      await get().loadTemplates(get().currentFilter);
    } catch (error) {
      console.error("[Template Store] Migration failed:", error);
    }
  },

  loadTemplates: async (filter?: TemplateFilter) => {
    const activeFilter = filter ?? get().currentFilter;
    set({ isLoading: true, error: null });
    try {
      const templates = await invokeTemplateIpc<Template[]>(
        "template:query",
        activeFilter,
      );
      set({ templates, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  createTemplate: async (input: CreateTemplateInput) => {
    set({ isLoading: true, error: null });
    try {
      // Auto-rename if name already exists for this templateType
      let finalName = input.name;
      try {
        const existingNames = await get().queryTemplateNames(
          input.templateType,
        );
        const nameSet = new Set(existingNames);
        if (nameSet.has(finalName)) {
          let counter = 2;
          while (nameSet.has(`${input.name} (${counter})`)) counter++;
          finalName = `${input.name} (${counter})`;
        }
      } catch {
        // If queryNames fails (e.g. IPC not available), proceed with original name
      }

      const template = await invokeTemplateIpc<Template>("template:create", {
        ...input,
        name: finalName,
      });
      set((state) => ({
        templates: [template, ...state.templates],
        isLoading: false,
      }));
      return template;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  updateTemplate: async (id: string, updates: Partial<Template>) => {
    // If renaming, auto-rename to avoid conflicts
    if (updates.name) {
      const current = get().templates.find((t) => t.id === id);
      if (current) {
        try {
          const existingNames = await get().queryTemplateNames(
            current.templateType,
          );
          const nameSet = new Set(existingNames);
          nameSet.delete(current.name);
          let finalName = updates.name;
          if (nameSet.has(finalName)) {
            let counter = 2;
            while (nameSet.has(`${updates.name} (${counter})`)) counter++;
            finalName = `${updates.name} (${counter})`;
          }
          updates = { ...updates, name: finalName };
        } catch {
          // If queryNames fails, proceed with original name
        }
      }
    }

    // Optimistic update
    set((state) => ({
      templates: state.templates.map((t) =>
        t.id === id
          ? { ...t, ...updates, updatedAt: new Date().toISOString() }
          : t,
      ),
    }));

    try {
      await invokeTemplateIpc("template:update", { id, updates });
      return updates;
    } catch (error) {
      // Revert on error
      await get().loadTemplates(get().currentFilter);
      set({ error: (error as Error).message });
      throw error;
    }
  },

  deleteTemplate: async (id: string) => {
    // Optimistic delete
    set((state) => ({
      templates: state.templates.filter((t) => t.id !== id),
    }));

    try {
      await invokeTemplateIpc("template:delete", { id });
    } catch (error) {
      // Revert on error
      await get().loadTemplates(get().currentFilter);
      set({ error: (error as Error).message });
      throw error;
    }
  },

  deleteTemplates: async (ids: string[]) => {
    const idsSet = new Set(ids);
    set((state) => ({
      templates: state.templates.filter((t) => !idsSet.has(t.id)),
    }));

    try {
      await invokeTemplateIpc("template:deleteMany", { ids });
    } catch (error) {
      await get().loadTemplates(get().currentFilter);
      set({ error: (error as Error).message });
      throw error;
    }
  },

  toggleFavorite: async (id: string) => {
    // Optimistic toggle
    set((state) => ({
      templates: state.templates.map((t) =>
        t.id === id ? { ...t, isFavorite: !t.isFavorite } : t,
      ),
    }));

    try {
      await invokeTemplateIpc("template:toggleFavorite", { id });
    } catch (error) {
      await get().loadTemplates(get().currentFilter);
      set({ error: (error as Error).message });
      throw error;
    }
  },

  useTemplate: async (id: string) => {
    try {
      await invokeTemplateIpc("template:incrementUseCount", { id });
      // Update local state
      set((state) => ({
        templates: state.templates.map((t) =>
          t.id === id ? { ...t, useCount: t.useCount + 1 } : t,
        ),
      }));
    } catch (error) {
      console.error("Failed to increment use count:", error);
    }
  },

  exportTemplates: async (ids?: string[], exportAll?: boolean) => {
    try {
      const data = await invokeTemplateIpc<TemplateExport>("template:export", {
        ids,
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const tpls = data.templates ?? [];
      const types = new Set(tpls.map((t: Template) => t.templateType));
      const typePrefix = types.size === 1 ? [...types][0] : "mixed";
      let namePrefix: string;
      if (tpls.length === 1) {
        namePrefix = tpls[0].name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_");
      } else if (exportAll) {
        namePrefix = `export_all_${tpls.length}`;
      } else {
        namePrefix = `export_${tpls.length}`;
      }
      a.download = `${typePrefix}_${namePrefix}_${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  exportSingleTemplate: async (id: string, defaultName: string) => {
    try {
      const result = await invokeTemplateIpc<{
        success: boolean;
        filePath?: string;
        canceled?: boolean;
      }>("template:exportSingle", { id, defaultName });
      return result;
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  exportBatchTemplates: async (ids: string[]) => {
    try {
      const result = await invokeTemplateIpc<{
        success: boolean;
        count?: number;
        folderPath?: string;
        canceled?: boolean;
      }>("template:exportBatch", { ids });
      return result;
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  exportMergedTemplates: async (ids: string[], defaultName: string) => {
    try {
      const result = await invokeTemplateIpc<{
        success: boolean;
        filePath?: string;
        canceled?: boolean;
      }>("template:exportMerged", { ids, defaultName });
      return result;
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },
  importTemplates: async (file: File, mode: "merge" | "replace" | "rename") => {
    set({ isLoading: true, error: null });
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await invokeTemplateIpc<{
        imported: number;
        skipped: number;
        replaced: number;
      }>("template:import", { data, mode });
      await get().loadTemplates(get().currentFilter);
      set({ isLoading: false });
      return result;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  pickAndImportTemplates: async (mode: "merge" | "replace" | "rename") => {
    try {
      const pickResult = await invokeTemplateIpc<{
        canceled: boolean;
        templates?: TemplateExport[];
      }>("template:importPick");

      if (pickResult.canceled || !pickResult.templates?.length) {
        return { imported: 0, skipped: 0, replaced: 0, canceled: true };
      }

      set({ isLoading: true, error: null });

      // Merge all templates from all selected files into one import
      const allTemplates: Template[] = [];
      for (const data of pickResult.templates) {
        if (data.templates) {
          allTemplates.push(...data.templates);
        }
      }

      const mergedData: TemplateExport = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        templates: allTemplates,
      };

      const result = await invokeTemplateIpc<{
        imported: number;
        skipped: number;
        replaced: number;
      }>("template:import", { data: mergedData, mode });

      await get().loadTemplates(get().currentFilter);
      set({ isLoading: false });
      return result;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  queryTemplateNames: async (templateType?: string) => {
    return invokeTemplateIpc<string[]>("template:queryNames", { templateType });
  },

  setFilter: (filter: TemplateFilter) => {
    set({ currentFilter: filter });
    get().loadTemplates(filter);
  },
}));
