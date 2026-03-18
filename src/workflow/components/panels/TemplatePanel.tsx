/**
 * TemplatePanel — left sidebar panel for browsing workflow templates.
 * Simple list view, no category grouping.
 */
import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../../stores/ui.store";
import { useTemplateStore } from "@/stores/templateStore";
import { Search, Download, FolderOpen } from "lucide-react";
import type { Template, TemplateFilter } from "@/types/template";

interface TemplatePanelProps {
  onUseTemplate: (template: Template) => void;
  onClose?: () => void;
}

export function TemplatePanel({ onUseTemplate, onClose }: TemplatePanelProps) {
  const { t } = useTranslation();
  const width = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const { useTemplate: incrementUseCount, exportTemplates } =
    useTemplateStore();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);

  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const filter: TemplateFilter = {
        templateType: "workflow",
        search: query || undefined,
      };
      const result = await (window.workflowAPI?.invoke?.(
        "template:query",
        filter,
      ) as Promise<Template[]>);
      setTemplates(result ?? []);
    } catch {
      setTemplates([]);
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleUse = async (template: Template) => {
    await incrementUseCount(template.id);
    onUseTemplate(template);
  };

  const handleExport = async (template: Template) => {
    try {
      await exportTemplates([template.id]);
    } catch {
      // silent
    }
  };

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: MouseEvent) => {
        setSidebarWidth(startWidth + (ev.clientX - startX));
      };
      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, setSidebarWidth],
  );

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  };

  return (
    <div
      className="border-r border-border bg-card text-card-foreground flex flex-col relative overflow-hidden h-full"
      style={{ width, minWidth: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-semibold text-xs">{t("templates.title")}</span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-xs px-1"
          title={t("common.close")}
        >
          ✕
        </button>
      </div>

      {/* Search */}
      <div className="px-2.5 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("templates.searchPlaceholder")}
            className="w-full pl-7 pr-2 py-1.5 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && templates.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <FolderOpen className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-xs">{t("templates.noTemplates")}</p>
          </div>
        )}

        {!isLoading &&
          templates.map((template) => {
            const tName = template.i18nKey
              ? t(`presetTemplates.${template.i18nKey}.name`, {
                  defaultValue: template.name,
                })
              : template.name;
            return (
              <div
                key={template.id}
                onClick={() => handleUse(template)}
                className="group flex items-center gap-2 mx-1.5 mb-1 px-2.5 py-2 rounded-md border border-border/30 hover:bg-primary/5 hover:border-primary/30 transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium truncate block group-hover:text-primary transition-colors">
                    {tName}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("templates.lastUpdated")}:{" "}
                    {formatDate(template.updatedAt)}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExport(template);
                    }}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title={t("templates.export")}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onResizeStart}
        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors ${dragging ? "bg-primary" : "hover:bg-primary/50"}`}
      />
    </div>
  );
}
