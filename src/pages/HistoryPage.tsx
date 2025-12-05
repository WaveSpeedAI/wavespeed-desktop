import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '@/api/client'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import type { HistoryItem } from '@/types/prediction'
import { ApiKeyRequired } from '@/components/shared/ApiKeyRequired'
import { OutputDisplay } from '@/components/playground/OutputDisplay'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Image,
  Video,
  Music,
  Clock,
  FileText,
  FileJson,
  Link,
  File,
  AlertCircle,
  Copy,
  Check,
  Eye,
  EyeOff
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AudioPlayer } from '@/components/shared/AudioPlayer'

// Video preview component - shows first frame, plays on hover
function VideoPreview({ src, enabled }: { src: string; enabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  const handleMouseEnter = () => {
    if (videoRef.current && isLoaded && enabled) {
      videoRef.current.play().catch(() => {
        // Ignore autoplay errors
      })
    }
  }

  const handleMouseLeave = () => {
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  // Show placeholder if disabled or error
  if (!enabled || hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Video className="h-12 w-12 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      className="w-full h-full relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
          <Video className="h-12 w-12 text-muted-foreground" />
        </div>
      )}
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-cover"
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
      />
    </div>
  )
}

export function HistoryPage() {
  const { t } = useTranslation()
  const { isLoading: isLoadingApiKey, isValidated, apiKey } = useApiKeyStore()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null)
  const [copiedId, setCopiedId] = useState(false)
  const [loadPreviews, setLoadPreviews] = useState(true)
  const pageSize = 20

  const handleCopyId = async (id: string) => {
    await navigator.clipboard.writeText(id)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  const fetchHistory = async () => {
    if (!isValidated) return

    setIsLoading(true)
    setError(null)

    try {
      const filters = statusFilter !== 'all'
        ? { status: statusFilter as 'completed' | 'failed' | 'processing' | 'created' }
        : undefined

      const response = await apiClient.getHistory(page, pageSize, filters)
      setItems(response.items)
      setTotal(response.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch history')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [isValidated, page, statusFilter])

  const totalPages = Math.ceil(total / pageSize)

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="success">{t('history.status.completed')}</Badge>
      case 'failed':
        return <Badge variant="destructive">{t('history.status.failed')}</Badge>
      case 'processing':
        return <Badge variant="warning">{t('history.status.processing')}</Badge>
      case 'created':
        return <Badge variant="info">{t('history.status.created')}</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const getOutputType = (output: unknown): 'image' | 'video' | 'audio' | 'url' | 'json' | 'text' => {
    if (typeof output === 'object' && output !== null) {
      return 'json'
    }
    if (typeof output === 'string') {
      if (output.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i)) return 'image'
      if (output.match(/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i)) return 'video'
      if (output.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma)(\?.*)?$/i)) return 'audio'
      if (output.startsWith('http://') || output.startsWith('https://')) return 'url'
    }
    return 'text'
  }

  const getPreviewIcon = (item: HistoryItem) => {
    const firstOutput = item.outputs?.[0]
    const type = getOutputType(firstOutput)
    switch (type) {
      case 'image': return Image
      case 'video': return Video
      case 'audio': return Music
      case 'url': return Link
      case 'json': return FileJson
      case 'text': return FileText
      default: return File
    }
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
    return <ApiKeyRequired description="Please configure your WaveSpeed API key in Settings to view history." />
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-bold">{t('history.title')}</h1>
            <p className="text-muted-foreground text-sm">{t('history.description')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchHistory} disabled={isLoading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
            {t('common.refresh')}
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue placeholder={t('history.status.all')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('history.status.all')}</SelectItem>
              <SelectItem value="completed">{t('history.status.completed')}</SelectItem>
              <SelectItem value="failed">{t('history.status.failed')}</SelectItem>
              <SelectItem value="processing">{t('history.status.processing')}</SelectItem>
              <SelectItem value="created">{t('history.status.created')}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={loadPreviews ? "default" : "outline"}
            size="sm"
            onClick={() => setLoadPreviews(!loadPreviews)}
            title={loadPreviews ? t('history.disablePreviews') : t('history.loadPreviews')}
          >
            {loadPreviews ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading && items.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              {error.includes('404') || error.includes('page not found') || error.includes('504') || error.includes('timeout') || error.includes('Gateway') ? (
                <>
                  <p className="text-base font-medium">{t('history.notAvailable')}</p>
                  <p className="text-muted-foreground text-sm mt-1">
                    {t('history.notAvailableDesc')}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-destructive text-sm">{error}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={fetchHistory}>
                    {t('errors.tryAgain')}
                  </Button>
                </>
              )}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">{t('history.noHistory')}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => {
                const PreviewIcon = getPreviewIcon(item)
                const hasPreview = item.outputs && item.outputs.length > 0

                return (
                  <Card
                    key={item.id}
                    className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setSelectedItem(item)}
                  >
                    {/* Preview */}
                    <div className="aspect-video bg-muted relative">
                      {loadPreviews && hasPreview && typeof item.outputs![0] === 'string' && item.outputs![0].match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
                        <img
                          src={item.outputs![0]}
                          alt="Preview"
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : loadPreviews && hasPreview && typeof item.outputs![0] === 'string' && item.outputs![0].match(/\.(mp4|webm|mov)/i) ? (
                        <VideoPreview src={item.outputs![0]} enabled={loadPreviews} />
                      ) : loadPreviews && hasPreview && typeof item.outputs![0] === 'string' && item.outputs![0].match(/\.(mp3|wav|ogg|flac|aac|m4a|wma)/i) ? (
                        <div
                          className="w-full h-full flex items-center justify-center p-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <AudioPlayer src={item.outputs![0]} compact />
                        </div>
                      ) : hasPreview && typeof item.outputs![0] === 'object' ? (
                        <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
                          <FileJson className="h-6 w-6 text-muted-foreground shrink-0" />
                          <pre className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-3">
                            {JSON.stringify(item.outputs![0], null, 0).slice(0, 100)}
                          </pre>
                        </div>
                      ) : hasPreview && typeof item.outputs![0] === 'string' && !item.outputs![0].startsWith('http') ? (
                        <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
                          <FileText className="h-6 w-6 text-muted-foreground shrink-0" />
                          <p className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-3">
                            {item.outputs![0].slice(0, 150)}
                          </p>
                        </div>
                      ) : hasPreview && typeof item.outputs![0] === 'string' && item.outputs![0].startsWith('http') ? (
                        <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
                          <Link className="h-6 w-6 text-muted-foreground shrink-0" />
                          <p className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-2 break-all">
                            {item.outputs![0]}
                          </p>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <PreviewIcon className="h-10 w-10 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute top-1.5 right-1.5">
                        {getStatusBadge(item.status)}
                      </div>
                    </div>

                    <CardContent className="p-2.5">
                      <p className="font-medium text-xs truncate">{item.model}</p>
                      <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                        <span>{formatDate(item.created_at)}</span>
                        {item.execution_time && (
                          <span>{(item.execution_time / 1000).toFixed(2)}s</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="border-t p-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} / {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages || isLoading}
            >
              {t('common.next')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('history.generationDetails')}</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="flex-1 overflow-y-auto space-y-4">
              {/* Preview using OutputDisplay */}
              {selectedItem.outputs && selectedItem.outputs.length > 0 && (
                <div className="h-[400px]">
                  <OutputDisplay
                    prediction={{
                      id: selectedItem.id,
                      model: selectedItem.model,
                      status: selectedItem.status,
                      outputs: selectedItem.outputs,
                      has_nsfw_contents: selectedItem.has_nsfw_contents,
                      timings: selectedItem.execution_time
                        ? { inference: selectedItem.execution_time }
                        : undefined
                    }}
                    outputs={selectedItem.outputs}
                    error={null}
                    isLoading={false}
                  />
                </div>
              )}

              {/* Details */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">{t('history.model')}</p>
                  <p className="font-medium">{selectedItem.model}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('history.status.all').replace('All ', '')}</p>
                  <div>{getStatusBadge(selectedItem.status)}</div>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('history.created')}</p>
                  <p className="font-medium">{formatDate(selectedItem.created_at)}</p>
                </div>
                {selectedItem.execution_time && (
                  <div>
                    <p className="text-muted-foreground">{t('history.executionTime')}</p>
                    <p className="font-medium">{(selectedItem.execution_time / 1000).toFixed(2)}s</p>
                  </div>
                )}
                <div className="col-span-2">
                  <p className="text-muted-foreground">{t('history.predictionId')}</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
                      {selectedItem.id}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCopyId(selectedItem.id)}
                    >
                      {copiedId ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
