import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Heart,
  Play,
  Pencil,
  Trash2,
  Download,
  MoreVertical,
  Sparkles,
  Workflow,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Template } from "@/types/template";
import { cn } from "@/lib/utils";

interface TemplateCardProps {
  template: Template;
  onUse: (template: Template, mode?: "new" | "replace") => void;
  onEdit?: (template: Template) => void;
  onDelete?: (template: Template) => void;
  onExport?: (template: Template) => void;
  onToggleFavorite: (template: Template) => void;
  compact?: boolean;
}

export function TemplateCard({
  template,
  onUse,
  onEdit,
  onDelete,
  onExport,
  onToggleFavorite,
  compact: _compact,
}: TemplateCardProps) {
  const { t } = useTranslation();
  const [imageError, setImageError] = useState(false);

  const isCustom = template.type === "custom";
  const isPlayground = template.templateType === "playground";
  const isFileTemplate = template.id.startsWith("file-");

  const displayName = template.i18nKey
    ? t(`presetTemplates.${template.i18nKey}.name`, {
        defaultValue: template.name,
      })
    : template.name;
  const displayDesc =
    template.i18nKey && template.description
      ? t(`presetTemplates.${template.i18nKey}.description`, {
          defaultValue: template.description,
        })
      : template.description;

  return (
    <TooltipProvider delayDuration={200}>
      <Card
        className="group relative overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer"
        onClick={() => onUse(template)}
      >
        {/* Favorite Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(template);
          }}
          className={cn(
            "absolute top-2.5 right-2.5 z-10 p-2 rounded-full transition-all duration-200",
            "hover:scale-110 active:scale-95",
            template.isFavorite
              ? "opacity-100 text-rose-500 bg-rose-500/15 backdrop-blur-md hover:bg-rose-500/25"
              : "opacity-0 group-hover:opacity-100 text-white/80 bg-black/30 backdrop-blur-md hover:text-rose-400 hover:bg-black/40",
          )}
        >
          <Heart
            className={cn(
              "h-4 w-4 transition-all duration-200",
              template.isFavorite &&
                "fill-current drop-shadow-[0_0_4px_rgba(244,63,94,0.5)]",
            )}
          />
        </button>

        {/* Thumbnail */}
        <div className="relative aspect-square bg-gradient-to-br from-muted/50 to-muted overflow-hidden">
          {template.thumbnail && !imageError ? (
            <img
              src={template.thumbnail}
              alt={displayName}
              className="w-full h-full object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {isPlayground ? (
                <Sparkles className="h-12 w-12 text-muted-foreground/30" />
              ) : (
                <Workflow className="h-12 w-12 text-muted-foreground/30" />
              )}
            </div>
          )}
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-200 opacity-0 group-hover:opacity-100">
            {/* Center: New tab button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUse(template, "new");
                  }}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-gray-800 flex items-center justify-center shadow-lg transition-transform hover:scale-110"
                >
                  <Play className="h-5 w-5 ml-0.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("models.openInNewTab")}
              </TooltipContent>
            </Tooltip>
            {/* Bottom-left: Replace current tab */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUse(template, "replace");
              }}
              className="absolute bottom-2 left-2 px-2 py-1 rounded-md text-[11px] font-medium bg-black/50 text-white/90 hover:bg-black/70 backdrop-blur-sm transition-colors flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              {t("models.replaceCurrentTab")}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-3 py-2">
          <div className="flex items-center justify-between gap-2 mb-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <h3 className="font-semibold text-xs truncate flex-1">
                  {displayName}
                </h3>
              </TooltipTrigger>
              <TooltipContent side="bottom">{displayName}</TooltipContent>
            </Tooltip>
            {(onEdit || onDelete || onExport) && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  asChild
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onEdit && !isFileTemplate && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(template);
                      }}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      {t("common.edit")}
                    </DropdownMenuItem>
                  )}
                  {onExport && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onExport(template);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {t("templates.export")}
                    </DropdownMenuItem>
                  )}
                  {onDelete && !isFileTemplate && isCustom && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(template);
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("common.delete")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {displayDesc && (
            <p className="text-[11px] text-muted-foreground truncate mb-1">
              {displayDesc}
            </p>
          )}

          {/* Meta Info */}
          <div className="flex items-center text-[11px] text-muted-foreground min-w-0">
            <div className="flex-1 min-w-0">
              {isPlayground && template.playgroundData && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block truncate">
                      {template.playgroundData.modelName}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {template.playgroundData.modelName}
                  </TooltipContent>
                </Tooltip>
              )}
              {!isPlayground && template.workflowData && (
                <span className="flex items-center gap-1">
                  <BarChart3 className="h-3 w-3 flex-shrink-0" />
                  {template.workflowData.nodeCount} {t("templates.nodes")}
                </span>
              )}
            </div>
            {template.useCount > 0 && (
              <span className="flex-shrink-0 ml-2 whitespace-nowrap">
                {template.useCount} {t("templates.uses")}
              </span>
            )}
          </div>
        </div>
      </Card>
    </TooltipProvider>
  );
}
