import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '@/api/client'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import type { HistoryItem } from '@/types/prediction'
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
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
  EyeOff,
  Trash2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AudioPlayer } from '@/components/shared/AudioPlayer'
import { useInView } from '@/hooks/useInView'
import { toast } from '@/hooks/useToast'

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
  const { isLoading: isLoadingApiKey, isValidated, loadApiKey, hasAttemptedLoad } = useApiKeyStore()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null)
  const [copiedId, setCopiedId] = useState(false)
  const [loadPreviews, setLoadPreviews] = useState(true)
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<HistoryItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const pageSize = 50

  const handleCopyId = async (id: string) => {
    await navigator.clipboard.writeText(id)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  const fetchHistory = useCallback(async () => {
    if (!isValidated) return

    setIsLoading(true)
    setError(null)

    try {
      const filters = statusFilter !== 'all'
        ? { status: statusFilter as 'completed' | 'failed' | 'processing' | 'created' }
        : undefined

      const response = await apiClient.getHistory(page, pageSize, filters)
      setItems(response.items || [])
    } catch (err) {
      console.error('History fetch error:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch history')
    } finally {
      setIsLoading(false)
    }
  }, [isValidated, page, pageSize, statusFilter])

  const handleDelete = useCallback(async (item: HistoryItem) => {
    setIsDeleting(true)
    try {
      await apiClient.deletePrediction(item.id)
      setItems(prevItems => prevItems.filter((existing) => existing.id !== item.id))
      if (selectedItem?.id === item.id) {
        setSelectedItem(null)
      }
      toast({
        title: t('history.deleted'),
      })
    } catch (err) {
      toast({
        title: t('common.error'),
        description: err instanceof Error ? err.message : t('history.deleteFailed'),
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
      setDeleteConfirmItem(null)
    }
  }, [selectedItem?.id, t])

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return
    setIsDeleting(true)
    const idsToDelete = Array.from(selectedIds)
    const idsSet = new Set(idsToDelete)
    try {
      await apiClient.deletePredictions(idsToDelete)
      setItems(prevItems => prevItems.filter((existing) => !idsSet.has(existing.id)))
      if (selectedItem && idsSet.has(selectedItem.id)) {
        setSelectedItem(null)
      }
      setSelectedIds(new Set())
      setIsSelectionMode(false)
      toast({
        title: t('history.deletedBulk'),
        description: t('history.deletedBulkDesc', { count: idsToDelete.length }),
      })
    } catch (err) {
      toast({
        title: t('common.error'),
        description: err instanceof Error ? err.message : t('history.deleteFailed'),
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
      setShowBulkDeleteConfirm(false)
    }
  }, [selectedIds, selectedItem, t])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleToggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      const next = !prev
      if (!next) {
        setSelectedIds(new Set())
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(items.map(item => item.id)))
  }, [items])

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  // Load API key on mount
  useEffect(() => {
    loadApiKey()
  }, [loadApiKey])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, statusFilter])

  const maxSelectablePages = 100
  const pageOptions = Array.from({ length: maxSelectablePages }, (_, index) => index + 1)
  const displayStart = items.length === 0 ? 0 : (page - 1) * pageSize + 1
  const displayEnd = items.length === 0 ? 0 : (page - 1) * pageSize + items.length

  useEffect(() => {
    if (page > maxSelectablePages) {
      setPage(maxSelectablePages)
    }
  }, [page, maxSelectablePages])

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

  const HistoryCard = ({ item }: { item: HistoryItem }) => {
    const { ref, isInView } = useInView<HTMLDivElement>()
    const PreviewIcon = getPreviewIcon(item)
    const hasPreview = item.outputs && item.outputs.length > 0
    const firstOutput = item.outputs?.[0]
    const shouldLoad = loadPreviews && isInView

    return (
      <Card
        key={item.id}
        className={cn(
          "overflow-hidden cursor-pointer border hover:shadow-md transition-shadow",
          selectedIds.has(item.id) && "ring-2 ring-primary"
        )}
        onClick={() => isSelectionMode ? handleToggleSelect(item.id) : setSelectedItem(item)}
      >
        {/* Preview */}
        <div ref={ref} className="aspect-square bg-muted relative">
          {isSelectionMode && (
            <div
              className="absolute top-2 left-2 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={selectedIds.has(item.id)}
                onCheckedChange={() => handleToggleSelect(item.id)}
                className="bg-background"
              />
            </div>
          )}
          {shouldLoad && hasPreview && typeof firstOutput === 'string' && firstOutput.match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
            <img
              src={firstOutput}
              alt="Preview"
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : shouldLoad && hasPreview && typeof firstOutput === 'string' && firstOutput.match(/\.(mp4|webm|mov)/i) ? (
            <VideoPreview src={firstOutput} enabled={shouldLoad} />
          ) : shouldLoad && hasPreview && typeof firstOutput === 'string' && firstOutput.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma)/i) ? (
            <div
              className="w-full h-full flex items-center justify-center p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <AudioPlayer src={firstOutput} compact />
            </div>
          ) : shouldLoad && hasPreview && typeof firstOutput === 'object' ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
              <FileJson className="h-6 w-6 text-muted-foreground shrink-0" />
              <pre className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-3">
                {JSON.stringify(firstOutput, null, 0).slice(0, 100)}
              </pre>
            </div>
          ) : shouldLoad && hasPreview && typeof firstOutput === 'string' && !firstOutput.startsWith('http') ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
              <FileText className="h-6 w-6 text-muted-foreground shrink-0" />
              <p className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-3">
                {firstOutput.slice(0, 150)}
              </p>
            </div>
          ) : shouldLoad && hasPreview && typeof firstOutput === 'string' && firstOutput.startsWith('http') ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-1">
              <Link className="h-6 w-6 text-muted-foreground shrink-0" />
              <p className="text-[10px] text-muted-foreground overflow-hidden text-ellipsis w-full text-center line-clamp-2 break-all">
                {firstOutput}
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

        <CardContent className="p-2">
          <p className="text-sm font-medium truncate">{item.model}</p>
          <p className="text-xs text-muted-foreground truncate">{formatDate(item.created_at)}</p>
          {item.execution_time && (
            <p className="text-xs text-muted-foreground">
              {(item.execution_time / 1000).toFixed(2)}s
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

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
      <div className="page-header px-4 md:px-6 py-4 pt-14 md:pt-4 relative z-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">{t('history.title')}</h1>
            <p className="text-muted-foreground text-xs md:text-sm mt-0.5">{t('history.description')}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isSelectionMode && selectedIds.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={isDeleting}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('history.deleteSelected', { count: selectedIds.size })}
              </Button>
            )}
            <Button
              variant={isSelectionMode ? "default" : "outline"}
              size="sm"
              onClick={handleToggleSelectionMode}
              disabled={isDeleting}
            >
              {isSelectionMode ? t('history.selectionDone') : t('history.select')}
            </Button>
            <Button variant="outline" size="sm" onClick={fetchHistory} disabled={isLoading}>
              <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
              {t('common.refresh')}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value)
              setPage(1)
            }}
          >
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
          {isSelectionMode && items.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleSelectAll} disabled={selectedIds.size === items.length}>
                {t('common.selectAll')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleClearSelection} disabled={selectedIds.size === 0}>
                {t('common.clear')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 relative z-10">
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {items.map((item) => (
                <HistoryCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Pagination */}
      {maxSelectablePages > 1 && (
        <div className="border-t p-4 flex items-center justify-between relative z-10">
          <p className="text-sm text-muted-foreground">
            {displayStart} - {displayEnd}
          </p>
          <div className="flex gap-2 items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
              {t('common.previous')}
            </Button>
            <Select
              value={String(page)}
              onValueChange={(value) => setPage(Number(value))}
              disabled={isLoading}
            >
              <SelectTrigger className="w-20 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageOptions.map((pageNumber) => (
                  <SelectItem key={pageNumber} value={String(pageNumber)}>
                    {pageNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= maxSelectablePages || isLoading}
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
              <div className="flex justify-end">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteConfirmItem(selectedItem)}
                  disabled={isDeleting}
                >
                  {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                  {t('common.delete')}
                </Button>
              </div>
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

      <AlertDialog open={!!deleteConfirmItem} onOpenChange={() => setDeleteConfirmItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('history.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('history.deleteConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmItem && handleDelete(deleteConfirmItem)}
              disabled={!deleteConfirmItem || isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('history.bulkDeleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('history.bulkDeleteConfirmDesc', { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isDeleting || selectedIds.size === 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              {t('history.deleteSelected', { count: selectedIds.size })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
