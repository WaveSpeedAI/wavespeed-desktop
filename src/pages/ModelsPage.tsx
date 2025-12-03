import { useNavigate } from 'react-router-dom'
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
import { Search, PlayCircle, Loader2, RefreshCw, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react'
import { usePlaygroundStore } from '@/stores/playgroundStore'

export function ModelsPage() {
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
    models
  } = useModelsStore()
  const { isLoading: isLoadingApiKey, isValidated, apiKey } = useApiKeyStore()
  const { createTab } = usePlaygroundStore()

  const filteredModels = getFilteredModels()

  const handleOpenPlayground = (modelId: string) => {
    navigate(`/playground/${encodeURIComponent(modelId)}`)
  }

  const handleOpenInNewTab = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    const model = models.find(m => m.model_id === modelId)
    createTab(model)
    navigate(`/playground/${encodeURIComponent(modelId)}`)
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
            <CardTitle>Validating API Key...</CardTitle>
            <CardDescription>
              Please wait while we validate your API key.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Models</h1>
            <p className="text-muted-foreground">
              Browse available AI models
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchModels()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Search and Sort */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Sort Controls */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Sort by:</span>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortBy)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sort_order">Popularity</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="price">Price</SelectItem>
                <SelectItem value="type">Type</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={toggleSortOrder}>
              {sortOrder === 'asc' ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" className="mt-4" onClick={() => fetchModels()}>
                Try Again
              </Button>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No models found</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredModels.map((model) => (
                <Card
                  key={model.model_id}
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => handleOpenPlayground(model.model_id)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base break-words">
                          {model.name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground truncate mt-1">
                          {model.model_id}
                        </p>
                      </div>
                      {model.type && (
                        <Badge variant="secondary" className="ml-2 shrink-0">
                          {model.type}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {model.description && (
                      <CardDescription className="line-clamp-2 mb-3">
                        {model.description}
                      </CardDescription>
                    )}
                    <div className="flex items-center justify-between">
                      {model.base_price !== undefined && (
                        <span className="text-sm font-medium text-primary">
                          ${model.base_price.toFixed(4)}/run
                        </span>
                      )}
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost">
                          <PlayCircle className="mr-1 h-4 w-4" />
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => handleOpenInNewTab(e, model.model_id)}
                          title="Open in new tab"
                        >
                          <ExternalLink className="h-4 w-4" />
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
