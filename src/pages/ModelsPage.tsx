import { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useModelsStore, type SortBy } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, PlayCircle, Loader2, RefreshCw, ArrowUp, ArrowDown, ExternalLink, Star, X, Info } from 'lucide-react'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'
import { fuzzySearch } from '@/lib/fuzzySearch'
import { usePlaygroundStore } from '@/stores/playgroundStore'
import type { Model } from '@/types/model'

// Get accent color class based on model type (3 categories: image, video, other)
function getTypeAccentClass(type?: string): string {
  const baseClasses = 'bg-[length:200%_100%] animate-gradient'

  if (!type) return `${baseClasses} bg-gradient-to-r from-emerald-400 via-teal-500 to-emerald-400`

  const normalizedType = type.toLowerCase()

  // Video related types
  if (normalizedType.includes('video')) {
    return `${baseClasses} bg-gradient-to-r from-purple-500 via-violet-500 to-purple-500`
  }

  // Image related types
  if (normalizedType.includes('image')) {
    return `${baseClasses} bg-gradient-to-r from-sky-400 via-blue-400 to-sky-400`
  }

  // Other types
  return `${baseClasses} bg-gradient-to-r from-emerald-400 via-teal-500 to-emerald-400`
}

// Memoized model card component
const ModelCard = memo(function ModelCard({
  model,
  isFavorite,
  onOpenPlayground,
  onOpenInNewTab,
  onToggleFavorite,
  t
}: {
  model: Model
  isFavorite: boolean
  onOpenPlayground: (modelId: string) => void
  onOpenInNewTab: (e: React.MouseEvent, modelId: string) => void
  onToggleFavorite: (e: React.MouseEvent, modelId: string) => void
  t: (key: string) => string
}) {
  return (
    <Card
      className="cursor-pointer card-elevated overflow-hidden group flex flex-col h-full border-transparent hover:border-primary/20"
      onClick={() => onOpenPlayground(model.model_id)}
    >
      <div className={cn("h-[3px]", getTypeAccentClass(model.type))} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {model.name}
          </CardTitle>
          {model.type && (
            <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0 font-medium">
              {model.type}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 mt-auto">
        <div className="flex items-center justify-between">
          {model.base_price !== undefined && (
            <span className="text-sm font-bold text-primary">
              ${model.base_price.toFixed(4)}
            </span>
          )}
          <div className="flex gap-0.5 ml-auto opacity-60 group-hover:opacity-100 transition-opacity">
            <HoverCard openDelay={200} closeDelay={100}>
              <HoverCardTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={(e) => e.stopPropagation()}
                  title="More info"
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
              </HoverCardTrigger>
              <HoverCardContent className="w-72" side="top" align="end">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">{model.name}</h4>
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    {model.model_id}
                  </p>
                  {model.description && (
                    <p className="text-xs text-muted-foreground">
                      {model.description}
                    </p>
                  )}
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
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={(e) => onToggleFavorite(e, model.model_id)}
              title={isFavorite ? t('models.removeFromFavorites') : t('models.addToFavorites')}
            >
              <Star className={cn(
                "h-3.5 w-3.5",
                isFavorite && "fill-yellow-400 text-yellow-400"
              )} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title={t('common.open')}
              onClick={(e) => {
                e.stopPropagation()
                onOpenPlayground(model.model_id)
              }}
            >
              <PlayCircle className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={(e) => onOpenInNewTab(e, model.model_id)}
              title={t('models.openInNewTab')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
})

// Separate component to prevent parent re-renders during typing
const SearchInput = memo(function SearchInput({
  value,
  onChange,
  onClear,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  placeholder: string
}) {
  const [localValue, setLocalValue] = useState(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onChange(localValue)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [localValue, onChange])

  // Sync when external value changes (e.g., clear button from parent)
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  return (
    <div className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        className={cn("pl-10", localValue && "pr-10")}
      />
      {localValue && (
        <button
          onClick={() => {
            setLocalValue('')
            onClear()
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
})

export function ModelsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    fetchModels,
    sortBy,
    sortOrder,
    setSortBy,
    toggleSortOrder,
    models,
    toggleFavorite,
    isFavorite,
    favorites,
    showFavoritesOnly,
    setShowFavoritesOnly,
    selectedType,
    setSelectedType
  } = useModelsStore()
  const { isLoading: isLoadingApiKey, isValidated, loadApiKey, hasAttemptedLoad } = useApiKeyStore()
  const { createTab, tabs, setActiveTab, setSelectedModel } = usePlaygroundStore()

  // Load API key and fetch models on mount
  useEffect(() => {
    loadApiKey()
  }, [loadApiKey])

  useEffect(() => {
    if (isValidated) {
      fetchModels()
    }
  }, [isValidated, fetchModels])

  // Memoize filtered models with proper dependencies
  const filteredModels = useMemo(() => {
    // First filter by favorites if enabled
    let filtered = showFavoritesOnly
      ? models.filter(m => favorites.has(m.model_id))
      : [...models]

    // Then filter by type if selected
    if (selectedType) {
      filtered = filtered.filter(m => m.type === selectedType)
    }

    // Then apply fuzzy search
    if (searchQuery.trim()) {
      const results = fuzzySearch(filtered, searchQuery, (model) => [
        model.name,
        model.model_id,
        model.description || '',
        model.type || ''
      ])
      return results.map(r => r.item)
    }

    // Apply sorting only when not searching
    return [...filtered].sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'price':
          comparison = (a.base_price ?? 0) - (b.base_price ?? 0)
          break
        case 'type':
          comparison = (a.type || '').localeCompare(b.type || '')
          break
        case 'sort_order':
          comparison = (a.sort_order ?? 0) - (b.sort_order ?? 0)
          break
      }
      return sortOrder === 'asc' ? comparison : -comparison
    })
  }, [models, searchQuery, sortBy, sortOrder, showFavoritesOnly, selectedType, favorites])

  // Extract unique types from all models for the tag filter
  const allTypes = useMemo(() => {
    const types = new Set<string>()
    models.forEach(model => {
      if (model.type) {
        types.add(model.type)
      }
    })
    return Array.from(types).sort()
  }, [models])

  // Grid virtualization
  const parentRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(4)

  // Calculate columns based on container width (mobile-first breakpoints)
  useEffect(() => {
    const updateColumns = () => {
      if (parentRef.current) {
        const width = parentRef.current.offsetWidth
        if (width >= 1024) setColumns(4)
        else if (width >= 768) setColumns(3)
        else if (width >= 480) setColumns(2)
        else setColumns(1)
      }
    }

    updateColumns()
    const resizeObserver = new ResizeObserver(updateColumns)
    if (parentRef.current) {
      resizeObserver.observe(parentRef.current)
    }
    return () => resizeObserver.disconnect()
  }, [])

  // Group models into rows
  const rows = useMemo(() => {
    const result: Model[][] = []
    for (let i = 0; i < filteredModels.length; i += columns) {
      result.push(filteredModels.slice(i, i + columns))
    }
    return result
  }, [filteredModels, columns])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110, // Estimated row height
    overscan: 3,
  })

  // Memoized handlers
  const handleOpenPlayground = useCallback((modelId: string) => {
    const model = models.find(m => m.model_id === modelId)
    if (tabs.length === 1 && tabs[0].selectedModel == null) {
      setActiveTab(tabs[0].id)
      setSelectedModel(model || null)
    } else {
      createTab(model)
    }
    navigate(`/playground/${encodeURIComponent(modelId)}`)
  }, [models, tabs, setActiveTab, setSelectedModel, createTab, navigate])

  const handleOpenInNewTab = useCallback((e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    const model = models.find(m => m.model_id === modelId)
    createTab(model)
    navigate(`/playground/${encodeURIComponent(modelId)}`)
  }, [models, createTab, navigate])

  const handleToggleFavorite = useCallback((e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    toggleFavorite(modelId)
  }, [toggleFavorite])

  // Show loading state while API key is being loaded from storage
  if (isLoadingApiKey || !hasAttemptedLoad) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-cyan-500/5" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-primary/10 to-transparent rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-gradient-to-tr from-cyan-500/10 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      
      {/* Header */}
      <div className="page-header px-6 py-4 relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{t('models.title')}</h1>
            <p className="text-muted-foreground text-sm hidden md:block">{t('models.description')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchModels(true)} className="electron-safe-right">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('common.refresh')}
          </Button>
        </div>

        {/* Search, Filters and Sort */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            onClear={() => setSearchQuery('')}
            placeholder={t('models.searchPlaceholder')}
          />

          {/* Favorites Filter */}
          <Button
            variant={showFavoritesOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            title={showFavoritesOnly ? t('models.showAll') : t('models.showFavoritesOnly')}
          >
            <Star className={cn("h-4 w-4", showFavoritesOnly && "fill-current")} />
          </Button>

          {/* Sort Controls */}
          <div className="flex items-center gap-1">
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortBy)}>
              <SelectTrigger className="w-[110px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sort_order">{t('models.popularity')}</SelectItem>
                <SelectItem value="name">{t('models.name')}</SelectItem>
                <SelectItem value="price">{t('models.price')}</SelectItem>
                <SelectItem value="type">{t('models.type')}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={toggleSortOrder}>
              {sortOrder === 'asc' ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Tag Filter Bar - inline */}
          {allTypes.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
              <span className="text-sm text-muted-foreground shrink-0">{t('models.type')}:</span>
              <Button
                variant={selectedType === null ? "default" : "ghost"}
                size="sm"
                onClick={() => setSelectedType(null)}
                className="shrink-0 h-8 px-3 text-sm"
              >
                {t('common.all')}
              </Button>
              {allTypes.map((type) => (
                <Button
                  key={type}
                  variant={selectedType === type ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedType(selectedType === type ? null : type)}
                  className="shrink-0 h-8 px-3 text-sm capitalize"
                >
                  {type}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content - Virtualized Grid */}
      <div ref={parentRef} className="flex-1 overflow-auto px-6 py-5 relative z-10">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-destructive text-sm">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchModels(true)}>
              {t('errors.tryAgain')}
            </Button>
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground text-sm">{t('models.noResults')}</p>
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const rowModels = rows[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                    {rowModels.map((model) => (
                      <ModelCard
                        key={model.model_id}
                        model={model}
                        isFavorite={isFavorite(model.model_id)}
                        onOpenPlayground={handleOpenPlayground}
                        onOpenInNewTab={handleOpenInNewTab}
                        onToggleFavorite={handleToggleFavorite}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
