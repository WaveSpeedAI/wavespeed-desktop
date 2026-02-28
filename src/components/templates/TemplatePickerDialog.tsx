/**
 * TemplatePickerDialog — modal dialog for browsing templates.
 * Reuses TemplateBrowser (same layout as TemplatesPage) without the type tabs.
 * Used by both PlaygroundPage and WorkflowPage.
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { TemplateBrowser } from "@/components/templates/TemplateBrowser";
import {
  TemplateDialog,
  type TemplateFormData,
} from "@/components/templates/TemplateDialog";
import { useTemplateStore } from "@/stores/templateStore";
import { toast } from "@/hooks/useToast";
import type { Template } from "@/types/template";

interface TemplatePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateType: "playground" | "workflow";
  onUseTemplate: (template: Template) => void;
}

export function TemplatePickerDialog({
  open,
  onOpenChange,
  templateType,
  onUseTemplate,
}: TemplatePickerDialogProps) {
  const { t } = useTranslation();
  const { updateTemplate, deleteTemplate, exportTemplates } =
    useTemplateStore();
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(
    null,
  );

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
        await updateTemplate(editingTemplate.id, {
          name: data.name,
          description: data.description,
          tags: data.tags,
          thumbnail: data.thumbnail ?? null,
        });
        toast({
          title: t("templates.templateUpdated"),
          description: t("templates.updatedSuccessfully", { name: data.name }),
        });
        setEditingTemplate(null);
      } catch (error) {
        toast({
          title: t("common.error"),
          description: (error as Error).message,
          variant: "destructive",
        });
      }
    },
    [editingTemplate, updateTemplate, t],
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
    } catch (error) {
      toast({
        title: t("common.error"),
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  }, [deletingTemplate, deleteTemplate, t]);

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

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-[85vw] max-w-[1100px] h-[75vh] rounded-xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
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

        {/* Body — reuse TemplateBrowser */}
        <TemplateBrowser
          templateType={templateType}
          onUseTemplate={handleUse}
          onEditTemplate={setEditingTemplate}
          onDeleteTemplate={setDeletingTemplate}
          onExportTemplate={handleExport}
        />
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
