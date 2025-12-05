import { useState, useEffect } from 'react'
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
  Clock,
  AlertCircle,
  Copy,
  Check
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function HistoryPage() {
  const { isLoading: isLoadingApiKey, isValidated, apiKey } = useApiKeyStore()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null)
  const [copiedId, setCopiedId] = useState(false)
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
        return <Badge variant="success">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'processing':
        return <Badge variant="warning">Processing</Badge>
      case 'created':
        return <Badge variant="info">Created</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const getPreviewIcon = (item: HistoryItem) => {
    const firstOutput = item.outputs?.[0]
    if (typeof firstOutput === 'string' && firstOutput.match(/\.(mp4|webm|mov)/i)) {
      return Video
    }
    return Image
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
      <div className="border-b p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold">History</h1>
            <p className="text-muted-foreground text-sm">View your recent predictions (last 24 hours)</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchHistory} disabled={isLoading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-4">
          <div className="w-48">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="created">Created</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          {isLoading && items.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              {error.includes('404') || error.includes('page not found') || error.includes('504') || error.includes('timeout') || error.includes('Gateway') ? (
                <>
                  <p className="text-lg font-medium">History Not Available</p>
                  <p className="text-muted-foreground mt-2">
                    The prediction history API is not available at this time.
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    You can still run predictions in the Playground.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-destructive">{error}</p>
                  <Button variant="outline" className="mt-4" onClick={fetchHistory}>
                    Try Again
                  </Button>
                </>
              )}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No predictions found</p>
              <p className="text-sm text-muted-foreground mt-2">
                Run some predictions in the Playground to see them here
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
                      {hasPreview && typeof item.outputs![0] === 'string' && item.outputs![0].match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
                        <img
                          src={item.outputs![0]}
                          alt="Preview"
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <PreviewIcon className="h-12 w-12 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute top-2 right-2">
                        {getStatusBadge(item.status)}
                      </div>
                    </div>

                    <CardContent className="p-4">
                      <p className="font-medium text-sm truncate">{item.model}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDate(item.created_at)}
                      </p>
                      {item.execution_time && (
                        <p className="text-xs text-muted-foreground">
                          {(item.execution_time / 1000).toFixed(2)}s
                        </p>
                      )}
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
            Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages || isLoading}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Generation Details</DialogTitle>
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
                  <p className="text-muted-foreground">Model</p>
                  <p className="font-medium">{selectedItem.model}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <div>{getStatusBadge(selectedItem.status)}</div>
                </div>
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-medium">{formatDate(selectedItem.created_at)}</p>
                </div>
                {selectedItem.execution_time && (
                  <div>
                    <p className="text-muted-foreground">Execution Time</p>
                    <p className="font-medium">{(selectedItem.execution_time / 1000).toFixed(2)}s</p>
                  </div>
                )}
                <div className="col-span-2">
                  <p className="text-muted-foreground">Prediction ID</p>
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
