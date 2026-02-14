import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  
  if (compact) {
    return (
      <Card className="group relative overflow-hidden hover:shadow-md transition-all duration-200">
        <div className="flex gap-3 p-3">
          {/* Compact thumbnail */}
          <div className="relative w-16 h-16 flex-shrink-0 rounded-md bg-gradient-to-br from-muted/50 to-muted overflow-hidden">
            {template.thumbnail && !imageError ? (
              <img src={template.thumbnail} alt={template.name} className="w-full h-full object-cover" onError={() => setImageError(true)} />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {isPlayground ? <Sparkles className="h-6 w-6 text-muted-foreground/50" /> : <Workflow className="h-6 w-6 text-muted-foreground/50" />}
              </div>
            )}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{template.name}</span>
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
            {template.description && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{template.description}</p>}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
              {isPlayground && template.playgroundData && <span className="truncate">{template.playgroundData.modelName}</span>}
              {!isPlayground && template.workflowData && <span className="flex items-center gap-0.5"><BarChart3 className="h-3 w-3" />{template.workflowData.nodeCount} nodes</span>}
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

      {/* Custom template menu */}
      {isCustom && (onEdit || onDelete || onExport) && (
        <div className="absolute top-2.5 left-2.5 z-10 opacity-0 group-hover:opacity-100 transition-all" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button className={cn(
                "p-2 rounded-full transition-all duration-200",
                "hover:scale-110 active:scale-95",
                "text-white/80 bg-black/30 backdrop-blur-md hover:bg-black/40"
              )}>
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="z-[10001]" onCloseAutoFocus={(e) => e.preventDefault()}>
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(template)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t('common.edit')}
                </DropdownMenuItem>
              )}
              {onExport && (
                <DropdownMenuItem onClick={() => onExport(template)}>
                  <Download className="mr-2 h-4 w-4" />
                  {t('templates.export')}
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(template)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('common.delete')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Thumbnail */}
      <div className="relative aspect-[3/4] bg-gradient-to-br from-muted/50 to-muted overflow-hidden">
        {template.thumbnail && !imageError ? (
          <img
            src={template.thumbnail}
            alt={template.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <div className="mb-2 flex items-center justify-center">
                {isPlayground ? (
                  <Sparkles className="h-12 w-12 text-muted-foreground/30" />
                ) : (
                  <Workflow className="h-12 w-12 text-muted-foreground/30" />
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Tags at bottom of image — ComfyUI style */}
        <div className="absolute bottom-0 left-0 right-0 p-2 flex flex-wrap gap-1 bg-gradient-to-t from-black/60 to-transparent">
          <Badge variant="secondary" className="text-[11px] bg-background/70 backdrop-blur-sm">
            {isPlayground
              ? (template.playgroundData?.modelName || t('templates.playground'))
              : (template.workflowData ? `${template.workflowData.nodeCount} nodes` : t('templates.workflow'))}
          </Badge>
          {template.tags && template.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[11px] bg-background/70 backdrop-blur-sm">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      {/* Title + Description */}
      <div className="p-3">
        <h3 className="text-sm font-semibold truncate">{template.name}</h3>
        {template.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
            {template.description}
          </p>
        )}
      </div>
    </Card>
  )
}
