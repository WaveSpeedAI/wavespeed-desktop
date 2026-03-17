import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTemplateStore } from "@/stores/templateStore";
import { useModelsStore } from "@/stores/modelsStore";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import {
  Upload,
  Download,
  Plus,
  Search,
  SquarePen,
  Trash2,
  PlayCircle,
  FolderOpen,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import type { Template, TemplateExport } from "@/types/template";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function TemplatesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    loadTemplates,
    updateTemplate,
    deleteTemplate,
    deleteTemplates,
    exportTemplates,
    exportSingleTemplate,
    exportBatchTemplates,
    exportMergedTemplates,
    importTemplates,
    pickAndImportTemplates,
    useTemplate,
    queryTemplateNames,
  } = useTemplateStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [templateType, setTemplateType] = useState<"playground" | "workflow">(
    "playground",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(
    null,
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [localTemplates, setLocalTemplates] = useState<Template[]>([]);
  const [loadCounter, setLoadCounter] = useState(0);

  // Clear search when switching tabs
  const handleSetTemplateType = (type: "playground" | "workflow") => {
    setSearchQuery("");
    setSelectedIds(new Set());
    setTemplateType(type);
  };

  // Reload helper â€?bumps counter to trigger re-fetch
  const reloadTemplates = () => setLoadCounter((c) => c + 1);

  // Load templates for the current type directly into local state
  useEffect(() => {
    let cancelled = false;
    loadTemplates({ templateType }).then(() => {
      if (!cancelled) {
        const storeTemplates = useTemplateStore.getState().templates;
        // Filter to current type in case another load overwrote the store
        setLocalTemplates(
          storeTemplates.filter((t) => t.templateType === templateType),
        );
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateType, loadCounter]);

  // Local search filtering (supports modelId, modelName, name, description, tags, i18n)
  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return localTemplates;
    const q = searchQuery.trim().toLowerCase();
    return localTemplates.filter((tpl) => {
      const i18nName = tpl.i18nKey
        ? t(`presetTemplates.${tpl.i18nKey}.name`, { defaultValue: "" })
        : "";
      const i18nDesc = tpl.i18nKey
        ? t(`presetTemplates.${tpl.i18nKey}.description`, { defaultValue: "" })
        : "";
      return (
        tpl.name.toLowerCase().includes(q) ||
        (tpl.description ?? "").toLowerCase().includes(q) ||
        (tpl.tags ?? []).some((tag) => tag.toLowerCase().includes(q)) ||
        (tpl.playgroundData?.modelId ?? "").toLowerCase().includes(q) ||
        (tpl.playgroundData?.modelName ?? "").toLowerCase().includes(q) ||
        (tpl.workflowData?.category ?? "").toLowerCase().includes(q) ||
        (tpl._searchText ?? "").toLowerCase().includes(q) ||
        i18nName.toLowerCase().includes(q) ||
        i18nDesc.toLowerCase().includes(q)
      );
    });
  }, [localTemplates, searchQuery, t]);

  // Group playground templates by modelId; workflow templates are flat (no grouping)
  const grouped = useMemo(() => {
    if (templateType === "workflow") {
      // No grouping for workflow â€?single flat list
      if (filteredTemplates.length === 0) return [];
      return [["workflow", filteredTemplates] as [string, Template[]]];
    }
    const groups: Record<string, Template[]> = {};
    for (const tpl of filteredTemplates) {
      const key = tpl.playgroundData?.modelId || "other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(tpl);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTemplates, templateType]);

  const allIds = useMemo(
    () => filteredTemplates.map((t) => t.id),
    [filteredTemplates],
  );
  const allSelected =
    filteredTemplates.length > 0 &&
    selectedIds.size === filteredTemplates.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const handleUseTemplate = async (template: Template) => {
    await useTemplate(template.id);
    if (template.playgroundData) {
      const { modelId, values } = template.playgroundData;
      const model = useModelsStore
        .getState()
        .models.find((m) => m.model_id === modelId);
      if (model) {
        usePlaygroundStore.getState().createTab(model, values);
      }
      navigate(`/playground/${encodeURIComponent(modelId)}`);
    } else if (template.workflowData) {
      navigate(`/workflow?template=${template.id}`);
    }
  };

  const startRename = (tpl: Template) => {
    setEditingId(tpl.id);
    setEditingName(tpl.name);
  };

  const commitRename = async () => {
    if (!editingId) return;
    const trimmed = editingName.trim();
    const tpl = localTemplates.find((t) => t.id === editingId);
    if (!trimmed || !tpl || trimmed === tpl.name) {
      setEditingId(null);
      return;
    }
    try {
      const finalUpdates = await updateTemplate(editingId, { name: trimmed });
      const finalName = finalUpdates.name ?? trimmed;
      if (finalName !== trimmed) {
        toast({
          title: t("templates.templateUpdated"),
          description: t("templates.autoRenamed", {
            original: trimmed,
            renamed: finalName,
          }),
        });
      } else {
        toast({
          title: t("templates.templateUpdated"),
          description: t("templates.updatedSuccessfully", { name: finalName }),
        });
      }
      reloadTemplates();
    } catch (error) {
      toast({
        title: t("common.error"),
        description: (error as Error).message,
        variant: "destructive",
      });
    }
    setEditingId(null);
  };

  const cancelRename = () => {
    setEditingId(null);
  };

  // JSON editor state
  const [jsonEditTemplate, setJsonEditTemplate] = useState<Template | null>(
    null,
  );
  const [jsonEditValue, setJsonEditValue] = useState("");
  const [jsonEditError, setJsonEditError] = useState<string | null>(null);
  const [jsonSaving, setJsonSaving] = useState(false);

  const openJsonEditor = (tpl: Template) => {
    // Show the editable data portion (playgroundData or workflowData)
    const editableData = tpl.playgroundData
      ? { name: tpl.name, playgroundData: tpl.playgroundData }
      : { name: tpl.name, workflowData: tpl.workflowData };
    setJsonEditValue(JSON.stringify(editableData, null, 2));
    setJsonEditError(null);
    setJsonEditTemplate(tpl);
  };

  const handleJsonSave = async () => {
    if (!jsonEditTemplate) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonEditValue);
    } catch (e) {
      setJsonEditError((e as Error).message);
      return;
    }
    setJsonSaving(true);
    try {
      const updates: Partial<Template> = {};
      if (parsed.name && typeof parsed.name === "string") {
        updates.name = parsed.name;
      }
      if (parsed.playgroundData) {
        updates.playgroundData =
          parsed.playgroundData as Template["playgroundData"];
      }
      if (parsed.workflowData) {
        updates.workflowData = parsed.workflowData as Template["workflowData"];
      }
      const requestedName = updates.name;
      const finalUpdates = await updateTemplate(jsonEditTemplate.id, updates);
      const finalName =
        finalUpdates.name ?? requestedName ?? jsonEditTemplate.name;
      if (requestedName && finalName !== requestedName) {
        toast({
          title: t("templates.templateUpdated"),
          description: t("templates.autoRenamed", {
            original: requestedName,
            renamed: finalName,
          }),
        });
      } else {
        toast({
          title: t("templates.templateUpdated"),
          description: t("templates.updatedSuccessfully", { name: finalName }),
        });
      }
      setJsonEditTemplate(null);
      reloadTemplates();
    } catch (error) {
      toast({
        title: t("common.error"),
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setJsonSaving(false);
    }
  };

  // Keyboard shortcut: F2 (Windows/Linux) or Enter (Mac) to rename focused template
  const isMac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingId) return;
      if (jsonEditTemplate) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const triggerRename = isMac ? e.key === "Enter" : e.key === "F2";
      if (triggerRename && focusedId) {
        const tpl = localTemplates.find((t) => t.id === focusedId);
        if (tpl?.type === "custom") {
          e.preventDefault();
          startRename(tpl);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusedId, editingId, jsonEditTemplate, localTemplates, isMac]);

  const handleDeleteTemplate = async () => {
    if (!deletingTemplate) return;
    try {
      await deleteTemplate(deletingTemplate.id);
      toast({
        title: t("templates.templateDeleted"),
        description: t("templates.deletedSuccessfully", {
          name: deletingTemplate.name,
        }),
      });
      setDeletingTemplate(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deletingTemplate.id);
        return next;
      });
      reloadTemplates();
    } catch (error) {
      toast({
        title: t("common.error"),
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    try {
      await deleteTemplates(Array.from(selectedIds));
      toast({
        title: t("templates.templatesDeleted"),
        description: t("templates.deletedCount", {
          count: selectedIds.size,
        }),
      });
      setSelectedIds(new Set());
      reloadTemplates();
    } catch (error) {
      toast({
        title: t("common.error"),
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  const handleExportTemplate = async (template: Template) => {
    try {
      const result = await exportSingleTemplate(template.id, template.name);
      if (result.canceled) return;
      toast({
        title: t("templates.templateExported"),
        description: t("templates.exportedSuccessfully", {
          name: template.name,
        }),
      });
    } catch (error) {
      toast({
        title: t("common.error"),
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  const handleExportAll = async () => {
    try {
      // No selection â†?export all to one merged file
      if (selectedIds.size === 0) {
        const allIds = localTemplates.map((t) => t.id);
        if (allIds.length === 0) return;
        const result = await exportMergedTemplates(
          allIds,
          t("templates.allTemplates", "All Templates"),
        );
        if (result.canceled) return;
        toast({
          title: t("templates.templatesExported"),
          description: t("templates.exportedCount", { count: allIds.length }),
        });
        return;
      }

      const ids = Array.from(selectedIds);

      // Single selected â†?save dialog with template name
      if (ids.length === 1) {
        const tpl = localTemplates.find((t) => t.id === ids[0]);
        if (tpl) {
          const result = await exportSingleTemplate(tpl.id, tpl.name);
          if (result.canceled) return;
          toast({
            title: t("templates.templateExported"),
            description: t("templates.exportedSuccessfully", {
              name: tpl.name,
            }),
          });
        }
        return;
      }

      // Multiple selected â†?folder picker, one file per template
      const result = await exportBatchTemplates(ids);
      if (result.canceled) return;
      toast({
        title: t("templates.templatesExported"),
        description: t("templates.exportedCount", {
          count: result.count || ids.length,
        }),
      });
    } catch (error) {
      toast({
        title: t("common.error"),
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{
    count: number;
    exportedAt: string;
    conflicts: number;
  } | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace" | "rename">(
    "merge",
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const allTemplates = data?.templates ?? [];

      // Filter templates to match the current tab's templateType
      const templates = allTemplates.filter(
        (t: Template) => t.templateType === templateType,
      );
      const skippedOtherType = allTemplates.length - templates.length;
      const count = templates.length;
      const exportedAt = data?.exportedAt ?? "";

      if (count === 0) {
        toast({
          title: t("templates.importFailed"),
          description:
            skippedOtherType > 0
              ? t("templates.noMatchingTypeTemplates", {
                  type:
                    templateType === "workflow"
                      ? t("templates.workflow")
                      : t("templates.playground"),
                })
              : t("common.error"),
          variant: "destructive",
        });
        return;
      }

      // Build a filtered file with only matching templates
      const filteredData = { ...data, templates };
      const filteredFile = new File([JSON.stringify(filteredData)], file.name, {
        type: file.type,
      });

      // Check for name conflicts
      const importTypes = [
        ...new Set(templates.map((t: Template) => t.templateType)),
      ] as string[];
      const existingNamesByType: Record<string, Set<string>> = {};
      for (const tType of importTypes) {
        const names = await queryTemplateNames(tType);
        existingNamesByType[tType] = new Set(names);
      }
      let conflicts = 0;
      for (const tpl of templates) {
        const typeNames = existingNamesByType[tpl.templateType];
        if (typeNames?.has(tpl.name)) conflicts++;
      }

      if (count === 1 && conflicts === 0) {
        // Single template, no conflict â€?import directly
        const result = await importTemplates(filteredFile, "merge");
        toast({
          title: t("templates.templatesImported"),
          description: t("templates.importedSuccessfully", {
            imported: result.imported,
            skipped: result.skipped,
          }),
        });
        reloadTemplates();
      } else if (conflicts === 0) {
        // Multiple templates, no conflicts â€?import directly
        const result = await importTemplates(filteredFile, "merge");
        toast({
          title: t("templates.templatesImported"),
          description: t("templates.importedSuccessfully", {
            imported: result.imported,
            skipped: result.skipped,
          }),
        });
        reloadTemplates();
      } else {
        // Has conflicts â€?show dialog
        setImportFile(filteredFile);
        setImportPreview({ count, exportedAt, conflicts });
        setImportMode("rename");
      }
    } catch {
      toast({
        title: t("templates.importFailed"),
        description: t("common.error"),
        variant: "destructive",
      });
    }
  };

  const handleImportConfirm = async () => {
    if (!importFile) return;
    try {
      const result = await importTemplates(importFile, importMode);
      toast({
        title: t("templates.templatesImported"),
        description: t("templates.importedSuccessfully", {
          imported: result.imported,
          skipped: result.skipped,
        }),
      });
      reloadTemplates();
    } catch (err) {
      toast({
        title: t("templates.importFailed"),
        description: err instanceof Error ? err.message : t("common.error"),
        variant: "destructive",
      });
    } finally {
      setImportFile(null);
      setImportPreview(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header: Title + Playground/Workflow tabs */}
      <div className="px-4 md:px-6 py-4 pt-14 md:pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
        <div className="flex items-center gap-4">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            {t("templates.title")}
          </h1>
          <div className="flex items-center rounded-full p-1 border border-border/60">
            <button
              onClick={() => handleSetTemplateType("playground")}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${
                templateType === "playground"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("templates.playground")}
            </button>
            <button
              onClick={() => handleSetTemplateType("workflow")}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${
                templateType === "workflow"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("templates.workflow")}
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mx-4 md:mx-6 mt-2 mb-3 flex items-center gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both" style={{ animationDelay: "60ms" }}>
        <label className="flex items-center gap-2 pl-2 text-sm cursor-pointer select-none whitespace-nowrap flex-shrink-0">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            className="rounded border-border"
          />
          {t("common.selectAll")}
        </label>

        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("templates.searchPlaceholder")}
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-border/60 bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          className="hidden"
        />

        {selectedIds.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="flex-shrink-0 h-9 px-4 animate-in fade-in slide-in-from-left-2 duration-200"
            onClick={handleDeleteSelected}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            {t("templates.deleteSelected", { count: selectedIds.size })}
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          className="flex-shrink-0 h-9 px-4"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4 mr-1.5" />
          {t("templates.import")}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className={`flex-shrink-0 h-9 px-4 transition-all duration-200 ${
            selectedIds.size > 0
              ? "border-primary/60 text-primary bg-primary/5"
              : ""
          }`}
          onClick={handleExportAll}
        >
          <Download className="h-4 w-4 mr-1.5" />
          {selectedIds.size > 0
            ? `${t("templates.export")} (${selectedIds.size})`
            : t("templates.exportAll")}
        </Button>

        <Button
          size="sm"
          className="flex-shrink-0 h-9 px-4"
          onClick={() =>
            navigate(
              templateType === "playground" ? "/playground" : "/workflow",
            )
          }
        >
          <Plus className="h-4 w-4 mr-1.5" />
          {t("templates.newTemplate")}
        </Button>
      </div>

      {/* Template List */}
      <div key={templateType} className="flex-1 overflow-y-auto animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-both">
        {filteredTemplates.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <FolderOpen className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-sm">{t("templates.noTemplates")}</p>
          </div>
        )}

        {grouped.map(([groupKey, groupTemplates]) => {
          const isCollapsed = collapsedGroups.has(groupKey);
          const showGroupHeader = templateType === "playground";
          return (
            <div
              key={groupKey}
              className={
                templateType === "playground"
                  ? "mx-4 md:mx-6 mt-4 rounded-lg border border-border/50 overflow-hidden"
                  : "mx-4 md:mx-6 mt-4"
              }
            >
              {/* Group Header â€?only for playground */}
              {showGroupHeader && (
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-full flex items-center px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-semibold truncate">{groupKey}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("templates.templateCount", {
                        count: groupTemplates.length,
                      })}
                    </div>
                  </div>
                  {isCollapsed ? (
                    <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  )}
                </button>
              )}

              {/* Template Rows */}
              {(!showGroupHeader || !isCollapsed) &&
                groupTemplates.map((tpl) => {
                  const displayName = tpl.i18nKey
                    ? t(`presetTemplates.${tpl.i18nKey}.name`, {
                        defaultValue: tpl.name,
                      })
                    : tpl.name;
                  const isCustom = tpl.type === "custom";
                  const isEditing = editingId === tpl.id;
                  return (
                    <div
                      key={tpl.id}
                      onClick={() => setFocusedId(tpl.id)}
                      className={`flex items-center gap-3 mx-3 mb-2 px-3 py-2.5 rounded-md border transition-colors cursor-default ${
                        focusedId === tpl.id
                          ? "border-primary/50 bg-primary/5"
                          : "border-border/30 hover:bg-accent/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(tpl.id)}
                        onChange={() => toggleSelect(tpl.id)}
                        className="rounded border-border flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitRename();
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelRename();
                              }
                            }}
                            autoFocus
                            onFocus={(e) => e.target.select()}
                            className="text-sm font-medium w-full bg-transparent border-b border-primary outline-none py-0.5"
                          />
                        ) : (
                          <span
                            className={`text-sm font-medium truncate block ${isCustom ? "cursor-text" : ""}`}
                            onDoubleClick={() => isCustom && startRename(tpl)}
                          >
                            {displayName}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {t("templates.lastUpdated")}:{" "}
                          {formatDate(tpl.updatedAt)}
                        </span>
                      </div>
                      {/* Always-visible action buttons */}
                      <div className="flex items-center gap-5 flex-shrink-0">
                        <Button
                          size="sm"
                          className="h-8 px-4 text-xs rounded-lg"
                          onClick={() => handleUseTemplate(tpl)}
                        >
                          <PlayCircle className="h-4 w-4 mr-1.5" />
                          {t("templates.use")}
                        </Button>
                        <div className="h-5 w-px bg-border/60" />
                        {isCustom && (
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => openJsonEditor(tpl)}
                                className="p-2.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                              >
                                <SquarePen className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{t("common.edit")}</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleExportTemplate(tpl)}
                              className="p-2.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{t("templates.export")}</TooltipContent>
                        </Tooltip>
                        {isCustom && (
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => setDeletingTemplate(tpl)}
                                className="p-2.5 rounded-md text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{t("common.delete")}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>

      {/* JSON Editor Dialog */}
      <Dialog
        open={!!jsonEditTemplate}
        onOpenChange={(open) => {
          if (!open) setJsonEditTemplate(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("templates.editTemplate")}</DialogTitle>
            <DialogDescription>{jsonEditTemplate?.name}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            <textarea
              value={jsonEditValue}
              onChange={(e) => {
                setJsonEditValue(e.target.value);
                setJsonEditError(null);
              }}
              spellCheck={false}
              className="flex-1 min-h-[300px] w-full rounded-md border border-border bg-muted/30 p-3 text-sm font-mono leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            {jsonEditError && (
              <p className="text-xs text-destructive px-1">
                JSON Error: {jsonEditError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setJsonEditTemplate(null)}
              disabled={jsonSaving}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleJsonSave} disabled={jsonSaving}>
              {jsonSaving ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Conflict Dialog */}
      <Dialog
        open={!!importPreview}
        onOpenChange={(open) => {
          if (!open) {
            setImportFile(null);
            setImportPreview(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("templates.importTemplates")}</DialogTitle>
            <DialogDescription>
              {t("templates.foundTemplates", {
                count: importPreview?.count ?? 0,
              })}
              {importPreview?.conflicts ? (
                <>
                  <br />
                  {t("templates.conflictCount", {
                    count: importPreview.conflicts,
                  })}
                </>
              ) : null}
              {importPreview?.exportedAt && (
                <>
                  <br />
                  {t("templates.exportedOn", {
                    date: new Date(importPreview.exportedAt).toLocaleString(),
                  })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm font-medium">
              {t("templates.importConflictAction")}
            </p>
            <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer hover:bg-accent/30 transition-colors">
              <input
                type="radio"
                name="importMode"
                checked={importMode === "rename"}
                onChange={() => setImportMode("rename")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">
                  {t("templates.autoRename")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("templates.autoRenameDesc")}
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer hover:bg-accent/30 transition-colors">
              <input
                type="radio"
                name="importMode"
                checked={importMode === "replace"}
                onChange={() => setImportMode("replace")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">
                  {t("templates.replaceAll")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("templates.replaceConflictsDesc")}
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer hover:bg-accent/30 transition-colors">
              <input
                type="radio"
                name="importMode"
                checked={importMode === "merge"}
                onChange={() => setImportMode("merge")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">
                  {t("templates.skipConflicts")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("templates.skipConflictsDesc")}
                </p>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportFile(null);
                setImportPreview(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleImportConfirm}>
              <Upload className="h-4 w-4 mr-1" />
              {t("templates.import")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deletingTemplate}
        onOpenChange={(open) => !open && setDeletingTemplate(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("templates.deleteTemplate")}</DialogTitle>
            <DialogDescription>
              {t("templates.deleteConfirm", { name: deletingTemplate?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingTemplate(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDeleteTemplate}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
