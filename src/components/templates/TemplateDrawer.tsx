import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { TemplateCard } from './TemplateCard'
import { TemplateSearch } from './TemplateSearch'
import { Loader2, FolderOpen, ExternalLink, Folder, Globe, User, Star } from 'lucide-react'
import { useTemplateStore } from '@/stores/templateStore'
import { cn } from '@/lib/utils'
import type { Template, TemplateFilter } from '@/types/template'

interface TemplateDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templateType: 'playground' | 'workflow'
  onUseTemplate: (template: Template) => void
}

type SourceFilter = 'all' | 'public' | 'custom' | 'favorites'

export function TemplateDrawer({ open, onOpenChange, templateType, onUseTemplate }: TemplateDrawerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [sortBy, setSortBy] = useState<'updatedAt' | 'useCount'>('updatedAt')

  // Use a separate store instance for the drawer to avoid interfering with TemplatesPage
  const [templates, setTemplates] = useState<Template[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const { toggleFavorite, useTemplate: incrementUseCount } = useTemplateStore()

  const loadTemplates = useCallback(async () => {
    setIsLoading(true)
    try {
      const filter: TemplateFilter = {
        templateType,
        search: searchQuery || undefined,
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
  }, [templateType, searchQuery, sortBy, sourceFilter])

  // Load templates when drawer opens or filters change
  useEffect(() => {
    if (open) loadTemplates()
  }, [open, loadTemplates])

  const handleUse = async (template: Template) => {
    await incrementUseCount(template.id)
    onUseTemplate(template)
    onOpenChange(false)
  }

  const handleToggleFavorite = async (template: Template) => {
    await toggleFavorite(template.id)
    // Refresh local list
    setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, isFavorite: !t.isFavorite } : t))
  }

  const handleBrowseAll = () => {
    onOpenChange(false)
    navigate('/templates')
  }

  const sourceOptions: { key: SourceFilter; icon: React.ReactNode; label: string }[] = [
    { key: 'all', icon: <Folder className="h-3 w-3" />, label: t('templates.allSources') },
    { key: 'public', icon: <Globe className="h-3 w-3" />, label: t('templates.public') },
    { key: 'custom', icon: <User className="h-3 w-3" />, label: t('templates.myTemplates') },
    { key: 'favorites', icon: <Star className="h-3 w-3" />, label: t('templates.favorites') },
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col p-0">
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle>{t('templates.title')}</SheetTitle>
          <SheetDescription>{t('templates.drawerDesc', 'Browse and apply templates')}</SheetDescription>
        </SheetHeader>

        {/* Search */}
        <div className="px-5 pb-3">
          <TemplateSearch value={searchQuery} onChange={setSearchQuery} />
        </div>

        {/* Source filter pills */}
        <div className="px-5 pb-2 flex items-center gap-1.5 flex-wrap">
          {sourceOptions.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSourceFilter(opt.key)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors',
                sourceFilter === opt.key
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="px-5 pb-3">
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as 'updatedAt' | 'useCount')}
            className="w-full px-3 py-1.5 text-xs border rounded-md bg-card hover:bg-accent/50 transition-colors cursor-pointer"
          >
            <option value="updatedAt">⏰ {t('templates.sortBy')}: {t('templates.newest')}</option>
            <option value="useCount">🔥 {t('templates.sortBy')}: {t('templates.mostUsed')}</option>
          </select>
        </div>

        {/* Template list */}
        <ScrollArea className="flex-1 px-5">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && templates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FolderOpen className="h-10 w-10 mb-3 text-muted-foreground opacity-50" />
              <p className="text-sm font-medium mb-1">{t('templates.noTemplates')}</p>
              <p className="text-xs text-muted-foreground">{t('templates.noResultsDesc')}</p>
            </div>
          )}

          {!isLoading && templates.length > 0 && (
            <div className="space-y-2 pb-4">
              {templates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onUse={handleUse}
                  onToggleFavorite={handleToggleFavorite}
                  compact
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer — browse all link */}
        <div className="border-t px-5 py-3">
          <Button variant="outline" size="sm" className="w-full" onClick={handleBrowseAll}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            {t('templates.browseAll', 'Browse All Templates')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
