import { useState, useMemo, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useModelsStore } from '@/stores/modelsStore'
import { usePlaygroundStore } from '@/stores/playgroundStore'
import { fuzzySearch } from '@/lib/fuzzySearch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { PlayCircle, ExternalLink, Star, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Color mapping for model type tags */
function getTypeColor(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('video')) return 'bg-purple-500/15 text-purple-400'
  if (t.includes('image')) return 'bg-blue-500/15 text-blue-400'
  if (t.includes('audio')) return 'bg-amber-500/15 text-amber-400'
  if (t.includes('portrait')) return 'bg-pink-500/15 text-pink-400'
  if (t.includes('text')) return 'bg-cyan-500/15 text-cyan-400'
  return 'bg-emerald-500/15 text-emerald-400'
}

interface ExplorePanelProps {
  onSelectModel: (modelId: string) => void
  externalSearch?: string
}

/** Memoized model card to avoid re-rendering all cards on filter change */
const ModelCard = memo(function ModelCard({
  model,
  isFav,
  onSelect,
  onToggleFav,
  onNewTab,
}: {
  model: { model_id: string; name: string; type?: string; base_price?: number; description?: string }
  isFav: boolean
  onSelect: (id: string) => void
  onToggleFav: (e: React.MouseEvent, id: string) => void
  onNewTab: (e: React.MouseEvent, id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      onClick={() => onSelect(model.model_id)}
      className="cursor-pointer rounded-lg border border-border/50 bg-card/50 hover:bg-accent/50 hover:border-primary/30 transition-all group overflow-hidden"
    >
      <div className={cn('h-[2px]', getTypeColor(model.type || ''))} />
      <div className="p-2.5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors flex-1 min-w-0">
            {model.name}
          </p>
          {model.type && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 whitespace-nowrap', getTypeColor(model.type))}>
              {model.type}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          {model.base_price !== undefined && (
            <span className="text-xs font-semibold text-primary">${model.base_price.toFixed(4)}</span>
          )}
          <div className="flex gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            <HoverCard openDelay={200} closeDelay={100}>
              <HoverCardTrigger asChild>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => e.stopPropagation()}>
                  <Info className="h-3 w-3" />
                </Button>
              </HoverCardTrigger>
              <HoverCardContent className="w-64" side="top" align="end">
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-sm">{model.name}</h4>
                  <p className="text-xs text-muted-foreground font-mono break-all">{model.model_id}</p>
                  {model.description && <p className="text-xs text-muted-foreground">{model.description}</p>}
                  {model.type && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{t('models.type')}:</span>
                      <Badge variant="secondary" className="text-xs">{model.type}</Badge>
                    </div>
                  )}
                  {model.base_price !== undefined && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{t('models.basePrice')}:</span>
                      <span className="font-medium text-primary">${model.base_price.toFixed(4)}</span>
                    </div>
                  )}
                </div>
              </HoverCardContent>
            </HoverCard>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => onToggleFav(e, model.model_id)}>
              <Star className={cn('h-3 w-3', isFav && 'fill-yellow-400 text-yellow-400')} />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); onSelect(model.model_id) }}>
              <PlayCircle className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => onNewTab(e, model.model_id)}>
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
})

export function ExplorePanel({ onSelectModel, externalSearch }: ExplorePanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { models, toggleFavorite, isFavorite } = useModelsStore()
  const { createTab } = usePlaygroundStore()
  const search = externalSearch ?? ''
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  const allTypes = useMemo(() => {
    const typeSet = new Set<string>()
    models.forEach(m => { if (m.type) typeSet.add(m.type) })
    return Array.from(typeSet).sort()
  }, [models])

  const filteredModels = useMemo(() => {
    let result = models
    if (typeFilter) result = result.filter(m => m.type === typeFilter)
    if (search.trim()) {
      return fuzzySearch(result, search, (m) => [m.name, m.model_id, m.description || '']).map(r => r.item)
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [models, search, typeFilter])

  const handleToggleFavorite = useCallback((e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    toggleFavorite(modelId)
  }, [toggleFavorite])

  const handleOpenInNewTab = useCallback((e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    const model = models.find(m => m.model_id === modelId)
    createTab(model)
    navigate(`/playground/${encodeURIComponent(modelId)}`)
  }, [models, createTab, navigate])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="px-4 pb-6 pt-3">
          {/* All Models heading */}
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {search
              ? t('playground.explore.searchResults', '{{count}} results', { count: filteredModels.length })
              : t('playground.explore.allModels', 'All Models')}
          </h3>

          {/* Category tags — wrap to show all */}
          <div className="flex gap-1.5 flex-wrap mb-3">
              <button
                onClick={() => setTypeFilter(null)}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors whitespace-nowrap',
                  !typeFilter ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                {t('playground.explore.all', 'All')}
              </button>
              {allTypes.map(type => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors whitespace-nowrap',
                    typeFilter === type
                      ? 'ring-1 ring-current ' + getTypeColor(type)
                      : getTypeColor(type) + ' hover:opacity-80'
                  )}
                >
                  {type}
                </button>
              ))}
          </div>

          {/* Models grid — 2 columns fixed to prevent horizontal overflow */}
          <div className="grid grid-cols-2 gap-2">
            {filteredModels.map((model) => (
              <ModelCard
                key={model.model_id}
                model={model}
                isFav={isFavorite(model.model_id)}
                onSelect={onSelectModel}
                onToggleFav={handleToggleFavorite}
                onNewTab={handleOpenInNewTab}
              />
            ))}
          </div>
          {filteredModels.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t('models.noResults', 'No models found')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
