import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useModelsStore, type SortBy } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { ApiKeyRequired } from '@/components/shared/ApiKeyRequired'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { usePlaygroundStore } from '@/stores/playgroundStore'

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
    getFilteredModels,
    fetchModels,
    sortBy,
    sortOrder,
    setSortBy,
    toggleSortOrder,
    models,
    toggleFavorite,
    isFavorite,
    showFavoritesOnly,
    setShowFavoritesOnly,
    selectedType,
    setSelectedType
  } = useModelsStore()
  const { isLoading: isLoadingApiKey, isValidated, apiKey } = useApiKeyStore()
  const { createTab } = usePlaygroundStore()

  // Memoize filtered models to prevent unnecessary recalculations
  const filteredModels = useMemo(() => getFilteredModels(), [models, searchQuery, sortBy, sortOrder, showFavoritesOnly, selectedType])

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

  const handleOpenPlayground = (modelId: string) => {
    navigate(`/playground/${encodeURIComponent(modelId)}`)
  }

  const handleOpenInNewTab = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    const model = models.find(m => m.model_id === modelId)
    createTab(model)
    navigate(`/playground/${encodeURIComponent(modelId)}`)
  }

  const handleToggleFavorite = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    toggleFavorite(modelId)
  }

  // Show loading state while API key is being loaded from storage
  if (isLoadingApiKey) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!apiKey) {
    return <ApiKeyRequired description="Please configure your WaveSpeed API key in Settings to browse available models." />
  }

  if (!isValidated) {
    return (
      <div className="flex h-full items-center justify-center">
        <Card className="max-w-md">
          <CardHeader className="text-center">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" />
            <CardTitle>{t('settings.apiKey.validating')}</CardTitle>
            <CardDescription>
              {t('common.loading')}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-bold">{t('models.title')}</h1>
            <p className="text-muted-foreground text-sm">{t('models.description')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchModels()}>
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
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <span className="text-xs text-muted-foreground shrink-0">{t('models.type')}:</span>
              <Button
                variant={selectedType === null ? "default" : "ghost"}
                size="sm"
                onClick={() => setSelectedType(null)}
                className="shrink-0 h-7 px-2 text-xs"
              >
                {t('common.all')}
              </Button>
              {allTypes.map((type) => (
                <Button
                  key={type}
                  variant={selectedType === type ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedType(selectedType === type ? null : type)}
                  className="shrink-0 h-7 px-2 text-xs capitalize"
                >
                  {type}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-destructive text-sm">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchModels()}>
                {t('errors.tryAgain')}
              </Button>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">{t('models.noResults')}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredModels.map((model) => (
                <Card
                  key={model.model_id}
                  className="cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 overflow-hidden group flex flex-col"
                  onClick={() => handleOpenPlayground(model.model_id)}
                >
                  <div className="card-accent" />
                  <CardHeader className="p-3 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                        {model.name}
                      </CardTitle>
                      {model.type && (
                        <Badge variant="secondary" className="shrink-0 text-xs px-1.5 py-0">
                          {model.type}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 pt-0 mt-auto">
                    <div className="flex items-center justify-between">
                      {model.base_price !== undefined && (
                        <span className="text-xs font-medium text-primary">
                          ${model.base_price.toFixed(4)}
                        </span>
                      )}
                      <div className="flex gap-0.5 ml-auto">
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
                          onClick={(e) => handleToggleFavorite(e, model.model_id)}
                          title={isFavorite(model.model_id) ? t('models.removeFromFavorites') : t('models.addToFavorites')}
                        >
                          <Star className={cn(
                            "h-3.5 w-3.5",
                            isFavorite(model.model_id) && "fill-yellow-400 text-yellow-400"
                          )} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          title={t('common.open')}
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={(e) => handleOpenInNewTab(e, model.model_id)}
                          title={t('models.openInNewTab')}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
