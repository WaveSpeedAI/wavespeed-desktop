import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Heart, Play, Pencil, Trash2, Download, MoreVertical, Sparkles, Workflow, BarChart3 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Template } from '@/types/template'
import { cn } from '@/lib/utils'

interface TemplateCardProps {
  template: Template
  onUse: (template: Template) => void
  onEdit?: (template: Template) => void
  onDelete?: (template: Template) => void
  onExport?: (template: Template) => void
  onToggleFavorite: (template: Template) => void
  compact?: boolean
}

export function TemplateCard({
  template,
  onUse,
  onEdit,
  onDelete,
  onExport,
  onToggleFavorite,
  compact = false
}: TemplateCardProps) {
  const { t } = useTranslation()
  const [imageError, setImageError] = useState(false)
  
  const isCustom = template.type === 'custom'
  const isPlayground = template.templateType === 'playground'
  const isFileTemplate = template.id.startsWith('file-')

  // Resolve i18n name/description for file templates with i18nKey
  const displayName = template.i18nKey
    ? t(`presetTemplates.${template.i18nKey}.name`, { defaultValue: template.name })
    : template.name
  const displayDesc = template.i18nKey && template.description
    ? t(`presetTemplates.${template.i18nKey}.description`, { defaultValue: template.description })
    : template.description
  
  if (compact) {
    return (
      <Card className="group relative overflow-hidden hover:shadow-md transition-all duration-200">
        <div className="flex gap-3 p-3">
          {/* Compact thumbnail */}
          <div className="relative w-16 h-16 flex-shrink-0 rounded-md bg-gradient-to-br from-muted/50 to-muted overflow-hidden">
            {template.thumbnail && !imageError ? (
              <img src={template.thumbnail} alt={displayName} className="w-full h-full object-cover" onError={() => setImageError(true)} />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {isPlayground ? <Sparkles className="h-6 w-6 text-muted-foreground/50" /> : <Workflow className="h-6 w-6 text-muted-foreground/50" />}
              </div>
            )}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{displayName}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(template) }}
                className={cn(
                  "p-0.5 rounded-full transition-all duration-200 hover:scale-110 active:scale-95",
                  template.isFavorite ? "text-rose-500" : "text-muted-foreground/50 hover:text-rose-400"
                )}
              >
                <Heart className={cn("h-3.5 w-3.5 transition-all duration-200", template.isFavorite && "fill-current drop-shadow-[0_0_3px_rgba(244,63,94,0.4)]")} />
              </button>
            </div>
            {displayDesc && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{displayDesc}</p>}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
              {isPlayground && template.playgroundData && <span className="truncate">{template.playgroundData.modelName}</span>}
              {!isPlayground && template.workflowData && <span className="flex items-center gap-0.5"><BarChart3 className="h-3 w-3" />{template.workflowData.nodeCount} {t('templates.nodes')}</span>}
            </div>
          </div>
          {/* Use button */}
          <Button size="sm" variant="outline" className="self-center flex-shrink-0 h-7 text-xs" onClick={() => onUse(template)}>
            <Play className="mr-1 h-3 w-3" />
            {t('templates.use')}
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="group relative overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer" onClick={() => onUse(template)}>
      {/* Favorite Button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite(template)
        }}
        className={cn(
          "absolute top-2.5 right-2.5 z-10 p-2 rounded-full transition-all duration-200",
          "hover:scale-110 active:scale-95",
          template.isFavorite
            ? "opacity-100 text-rose-500 bg-rose-500/15 backdrop-blur-md hover:bg-rose-500/25"
            : "opacity-0 group-hover:opacity-100 text-white/80 bg-black/30 backdrop-blur-md hover:text-rose-400 hover:bg-black/40"
        )}
        title={template.isFavorite ? t('templates.unfavorite') : t('templates.favorite')}
      >
        <Heart className={cn("h-4 w-4 transition-all duration-200", template.isFavorite && "fill-current drop-shadow-[0_0_4px_rgba(244,63,94,0.5)]")} />
      </button>

      {/* Thumbnail */}
      <div className="relative h-40 bg-gradient-to-br from-muted/50 to-muted overflow-hidden">
        {template.thumbnail && !imageError ? (
          <img src={template.thumbnail} alt={displayName} className="w-full h-full object-cover" onError={() => setImageError(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {isPlayground ? <Sparkles className="h-12 w-12 text-muted-foreground/30" /> : <Workflow className="h-12 w-12 text-muted-foreground/30" />}
          </div>
        )}
        {/* Type Badge */}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-sm line-clamp-1 flex-1">{displayName}</h3>
          {(onEdit || onDelete || onExport) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEdit && !isFileTemplate && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(template) }}>
                    <Pencil className="mr-2 h-4 w-4" />
                    {t('common.edit')}
                  </DropdownMenuItem>
                )}
                {onExport && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onExport(template) }}>
                    <Download className="mr-2 h-4 w-4" />
                    {t('templates.export')}
                  </DropdownMenuItem>
                )}
                {onDelete && !isFileTemplate && isCustom && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(template) }} className="text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('common.delete')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {displayDesc && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{displayDesc}</p>
        )}

        {/* Meta Info */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {isPlayground && template.playgroundData && (
              <span className="truncate max-w-[150px]">{template.playgroundData.modelName}</span>
            )}
            {!isPlayground && template.workflowData && (
              <span className="flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                {template.workflowData.nodeCount} {t('templates.nodes')}
              </span>
            )}
          </div>
          {template.useCount > 0 && (
            <span>{template.useCount} {t('templates.uses')}</span>
          )}
        </div>
      </div>
    </Card>
  )
}
