/**
 * TemplatePickerDialog — modal dialog for browsing templates.
 * Simple list view matching TemplatesPage style, no category sidebar.
 * Click a row to use the template. Hover to see action buttons.
 * Keyboard: arrow keys to navigate, Enter to use, Escape to close.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  TemplateDialog,
  type TemplateFormData,
} from "@/components/templates/TemplateDialog";
import { useTemplateStore } from "@/stores/templateStore";
import { toast } from "@/hooks/useToast";
import { Search, Pencil, Trash2, Download, FolderOpen } from "lucide-react";
import type { Template } from "@/types/template";

interface TemplatePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateType: "playground" | "workflow";
  onUseTemplate: (template: Template, mode?: "new" | "replace") => void;
}

export function TemplatePickerDialog({
  open,
  onOpenChange,
  templateType,
  onUseTemplate,
}: TemplatePickerDialogProps) {
  const { t } = useTranslation();
  const { loadTemplates, updateTemplate, deleteTemplate, exportTemplates } =
    useTemplateStore();
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [localTemplates, setLocalTemplates] = useState<Template[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load templates when dialog opens
  useEffect(() => {
    if (!open) return;
    setSearchQuery("");
    setSelectedIndex(0);
    let cancelled = false;
    loadTemplates({ templateType }).then(() => {
      if (!cancelled) {
        const storeTemplates = useTemplateStore.getState().templates;
        setLocalTemplates(
          storeTemplates.filter((t) => t.templateType === templateType),
        );
      }
    });
    // Focus search input when dialog opens
    setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateType]);

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

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredTemplates.length]);

  const reload = useCallback(() => {
    loadTemplates({ templateType }).then(() => {
      const storeTemplates = useTemplateStore.getState().templates;
      setLocalTemplates(
        storeTemplates.filter((t) => t.templateType === templateType),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateType]);

  const handleUse = useCallback(
    (template: Template) => {
      onUseTemplate(template);
      onOpenChange(false);
    },
    [onUseTemplate, onOpenChange],
  );

  const handleSaveEdit = useCallback(
    async (data: TemplateFormData) => {
      if (!editingTemplate) return;
      try {
        await updateTemplate(editingTemplate.id, { name: data.name });
        toast({
          title: t("templates.templateUpdated"),
          description: t("templates.updatedSuccessfully", { name: data.name }),
        });
        setEditingTemplate(null);
        reload();
      } catch (error) {
        toast({
          title: t("common.error"),
          description: (error as Error).message,
          variant: "destructive",
        });
      }
    },
    [editingTemplate, updateTemplate, t, reload],
  );

  const handleDeleteConfirm = useCallback(async () => {
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
      reload();
    } catch (error) {
      toast({
        title: t("common.error"),
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  }, [deletingTemplate, deleteTemplate, t, reload]);

  const handleExport = useCallback(
    async (template: Template) => {
      try {
        await exportTemplates([template.id]);
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
    },
    [exportTemplates, t],
  );

  // Keyboard navigation: arrows, Enter, Escape
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingTemplate || deletingTemplate) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredTemplates.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const tpl = filteredTemplates[selectedIndex];
        if (tpl) handleUse(tpl);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    },
    [
      filteredTemplates,
      selectedIndex,
      handleUse,
      onOpenChange,
      editingTemplate,
      deletingTemplate,
    ],
  );

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-[70vw] max-w-[800px] h-[70vh] rounded-xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold">{t("templates.title")}</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground transition-colors text-sm px-2 py-1"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border/50">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("templates.searchPlaceholder")}
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>

        {/* Template List */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-3">
          {filteredTemplates.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <FolderOpen className="h-10 w-10 mb-2 opacity-40" />
              <p className="text-sm">{t("templates.noTemplates")}</p>
            </div>
          )}

          {filteredTemplates.map((tpl, index) => {
            const displayName = tpl.i18nKey
              ? t(`presetTemplates.${tpl.i18nKey}.name`, {
                  defaultValue: tpl.name,
                })
              : tpl.name;
            const isCustom = tpl.type === "custom";
            const isSelected = index === selectedIndex;
            return (
              <div
                key={tpl.id}
                data-index={index}
                onClick={() => handleUse(tpl)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`group flex items-center gap-3 mb-1 px-3 py-2.5 rounded-md border transition-colors cursor-pointer ${
                  isSelected
                    ? "border-primary/40 bg-primary/5"
                    : "border-transparent hover:bg-primary/5"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <span
                    className={`text-sm font-medium truncate block transition-colors ${isSelected ? "text-primary" : "group-hover:text-primary"}`}
                  >
                    {displayName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("templates.lastUpdated")}: {formatDate(tpl.updatedAt)}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isCustom && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTemplate(tpl);
                      }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      title={t("common.edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExport(tpl);
                    }}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title={t("templates.export")}
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  {isCustom && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingTemplate(tpl);
                      }}
                      className="p-1.5 rounded-md text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title={t("common.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Dialog */}
      <TemplateDialog
        open={!!editingTemplate}
        onOpenChange={(o) => !o && setEditingTemplate(null)}
        template={editingTemplate}
        onSave={handleSaveEdit}
        mode="edit"
      />

      {/* Delete Confirmation */}
      {deletingTemplate && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
          onClick={() => setDeletingTemplate(null)}
        >
          <div
            className="w-[340px] rounded-xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-1">
              {t("templates.deleteTemplate")}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {t("templates.deleteConfirm", { name: deletingTemplate.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeletingTemplate(null)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-1.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
