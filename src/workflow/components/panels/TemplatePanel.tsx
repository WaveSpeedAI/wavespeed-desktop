/**
 * TemplatePanel — left sidebar panel for browsing workflow templates.
 * Matches the design of NodePalette and WorkflowList.
 */
import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '../../stores/ui.store'
import { useTemplateStore } from '@/stores/templateStore'
import { Heart, Flame, BarChart3, Play, Sparkles, Workflow } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Template, TemplateFilter } from '@/types/template'

type SourceFilter = 'all' | 'public' | 'custom' | 'favorites'

interface TemplatePanelProps {
  onUseTemplate: (template: Template) => void
}

export function TemplatePanel({ onUseTemplate }: TemplatePanelProps) {
  const { t } = useTranslation()
  const toggleTemplatePanel = useUIStore(s => s.toggleTemplatePanel)
  const width = useUIStore(s => s.sidebarWidth)
  const setSidebarWidth = useUIStore(s => s.setSidebarWidth)
  const { toggleFavorite, useTemplate: incrementUseCount } = useTemplateStore()

  const [templates, setTemplates] = useState<Template[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [sortBy, setSortBy] = useState<'updatedAt' | 'useCount'>('updatedAt')
  const [dragging, setDragging] = useState(false)

  const loadTemplates = useCallback(async () => {
    setIsLoading(true)
    try {
      const filter: TemplateFilter = {
        templateType: 'workflow',
        search: query || undefined,
        sortBy,
        type: sourceFilter === 'public' ? 'public' : sourceFilter === 'custom' ? 'custom' : undefined,
        isFavorite: sourceFilter === 'favorites' ? true : undefined,
      }
      const result = await (window.workflowAPI?.invoke?.('template:query', filter) as Promise<Template[]>)
      setTemplates(result ?? [])
    } catch {
      setTemplates([])
    } finally {
      setIsLoading(false)
    }
  }, [query, sortBy, sourceFilter])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  const handleUse = async (template: Template) => {
    await incrementUseCount(template.id)
    onUseTemplate(template)
  }

  const handleToggleFavorite = async (template: Template) => {
    await toggleFavorite(template.id)
    setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, isFavorite: !t.isFavorite } : t))
  }

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: MouseEvent) => { setSidebarWidth(startWidth + (ev.clientX - startX)) }
    const onUp = () => { setDragging(false); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, setSidebarWidth])

  const sourceOptions: { key: SourceFilter; label: string }[] = [
    { key: 'all', label: t('templates.allSources') },
    { key: 'public', label: t('templates.public') },
    { key: 'custom', label: t('templates.myTemplates') },
    { key: 'favorites', label: '★' },
  ]

  return (
    <div className="border-r border-border bg-card text-card-foreground flex flex-col relative overflow-hidden h-full"
      style={{ width, minWidth: 0 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-semibold text-xs">{t('templates.title')}</span>
        <button onClick={toggleTemplatePanel} className="text-muted-foreground hover:text-foreground text-xs px-1" title={t('common.close', 'Close')}>
          ✕
        </button>
      </div>

      {/* Search */}
      <div className="px-2.5 py-2 border-b border-border">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('templates.searchPlaceholder', 'Search templates...')}
          className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        />
      </div>

      {/* Source filter pills */}
      <div className="px-2.5 py-1.5 border-b border-border flex items-center gap-1 flex-wrap">
        {sourceOptions.map(opt => (
          <button
            key={opt.key}
            onClick={() => setSourceFilter(opt.key)}
            className={cn(
              'px-2 py-0.5 text-[10px] rounded-full border transition-colors',
              sourceFilter === opt.key
                ? 'bg-primary/15 border-primary/30 text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            {opt.label}
          </button>
        ))}
        {/* Sort toggle */}
        <button
          onClick={() => setSortBy(s => s === 'updatedAt' ? 'useCount' : 'updatedAt')}
          className="ml-auto px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title={sortBy === 'updatedAt' ? t('templates.newest') : t('templates.mostUsed')}
        >
          {sortBy === 'updatedAt' ? '⏰' : '🔥'}
        </button>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && templates.length === 0 && (
          <div className="px-3 py-8 text-xs text-muted-foreground text-center">
            {t('templates.noTemplates')}
          </div>
        )}

        {!isLoading && templates.map(template => {
          const tName = template.i18nKey
            ? t(`presetTemplates.${template.i18nKey}.name`, { defaultValue: template.name })
            : template.name
          const tDesc = template.i18nKey && template.description
            ? t(`presetTemplates.${template.i18nKey}.description`, { defaultValue: template.description })
            : template.description
          return (
          <div
            key={template.id}
            className="group mx-1.5 mb-0.5 rounded-md hover:bg-accent transition-colors"
          >
            <div className="flex items-start gap-2 px-2.5 py-2">
              {/* Icon */}
              <div className="w-8 h-8 flex-shrink-0 rounded bg-muted/50 flex items-center justify-center mt-0.5">
                {template.templateType === 'playground'
                  ? <Sparkles className="h-4 w-4 text-muted-foreground/60" />
                  : <Workflow className="h-4 w-4 text-muted-foreground/60" />}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium truncate">{tName}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleFavorite(template) }}
                    className={cn("p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity",
                      template.isFavorite ? "text-red-500 opacity-100" : "text-muted-foreground hover:text-red-500")}
                  >
                    <Heart className={cn("h-3 w-3", template.isFavorite && "fill-current")} />
                  </button>
                </div>
                {tDesc && (
                  <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{tDesc}</p>
                )}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-0.5"><Flame className="h-2.5 w-2.5" />{template.useCount}</span>
                  {template.workflowData && (
                    <span className="flex items-center gap-0.5"><BarChart3 className="h-2.5 w-2.5" />{template.workflowData.nodeCount}</span>
                  )}
                </div>
              </div>
              {/* Use button */}
              <button
                onClick={() => handleUse(template)}
                className="self-center flex-shrink-0 h-6 px-2 rounded text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1 opacity-0 group-hover:opacity-100"
              >
                <Play className="h-2.5 w-2.5" />
                {t('templates.use')}
              </button>
            </div>
          </div>
          )
        })}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onResizeStart}
        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors ${dragging ? 'bg-primary' : 'hover:bg-primary/50'}`}
      />
    </div>
  )
}
