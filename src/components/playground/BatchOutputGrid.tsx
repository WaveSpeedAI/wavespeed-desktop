import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Download, CheckCircle2, XCircle, Save, ExternalLink, Copy, Check, Loader2 } from 'lucide-react'
import { AudioPlayer } from '@/components/shared/AudioPlayer'
import { useAssetsStore, detectAssetType } from '@/stores/assetsStore'
import { toast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import type { BatchResult, BatchQueueItem } from '@/types/batch'

interface BatchOutputGridProps {
  results: BatchResult[]
  modelId?: string
  modelName?: string
  onClear: () => void
  className?: string
  isRunning?: boolean
  totalCount?: number
  queue?: BatchQueueItem[]
}

function isUrl(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://')
}

function isImageUrl(url: string): boolean {
  return isUrl(url) && /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(url)
}

function isVideoUrl(url: string): boolean {
  return isUrl(url) && /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(url)
}

function isAudioUrl(url: string): boolean {
  return isUrl(url) && /\.(mp3|wav|ogg|flac|aac|m4a|wma)(\?.*)?$/i.test(url)
}

function getExtensionFromUrl(url: string): string | null {
  const match = url.match(/\.([a-zA-Z0-9]+)(\?.*)?$/)
  return match ? match[1] : null
}

export function BatchOutputGrid({
  results,
  modelId,
  modelName,
  onClear,
  className,
  isRunning,
  totalCount,
  queue
}: BatchOutputGridProps) {
  const { t } = useTranslation()
  const [selectedResult, setSelectedResult] = useState<BatchResult | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [savedIndexes, setSavedIndexes] = useState<Set<number>>(new Set())
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  const { saveAsset } = useAssetsStore()

  const completedCount = results.filter(r => !r.error).length
  const failedCount = results.filter(r => r.error).length
  const total = totalCount || results.length
  const progress = total > 0 ? ((completedCount + failedCount) / total) * 100 : 0

  const handleDownload = async (url: string, index: number) => {
    const extension = getExtensionFromUrl(url) || 'png'
    const filename = `batch-${index + 1}.${extension}`

    if (window.electronAPI?.downloadFile) {
      const result = await window.electronAPI.downloadFile(url, filename)
      if (!result.success && !result.canceled) {
        console.error('Download failed:', result.error)
      }
    } else {
      window.open(url, '_blank')
    }
  }

  const handleDownloadAll = async () => {
    for (const result of results) {
      if (result.error) continue
      for (const output of result.outputs) {
        if (typeof output === 'string' && isUrl(output)) {
          await handleDownload(output, result.index)
        }
      }
    }
  }

  const handleSaveAll = useCallback(async () => {
    if (!modelId || !modelName) return

    setSavingAll(true)
    let savedCount = 0

    for (const result of results) {
      if (result.error) continue

      for (const output of result.outputs) {
        if (typeof output !== 'string') continue

        const assetType = detectAssetType(output)
        if (!assetType) continue

        try {
          const saveResult = await saveAsset(output, assetType, {
            modelId,
            modelName,
            predictionId: result.prediction?.id,
            originalUrl: output
          })
          if (saveResult) {
            savedCount++
            setSavedIndexes(prev => new Set(prev).add(result.index))
          }
        } catch (err) {
          console.error('Failed to save asset:', err)
        }
      }
    }

    setSavingAll(false)
    toast({
      title: t('playground.batch.savedAll'),
      description: t('playground.batch.savedAllDesc', { count: savedCount }),
    })
  }, [modelId, modelName, results, saveAsset, t])

  const handleCopy = async (url: string, index: number) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }

  // Get first media output for thumbnail
  const getFirstMedia = (result: BatchResult) => {
    for (const output of result.outputs) {
      if (typeof output === 'string') {
        if (isImageUrl(output)) return { url: output, type: 'image' as const }
        if (isVideoUrl(output)) return { url: output, type: 'video' as const }
        if (isAudioUrl(output)) return { url: output, type: 'audio' as const }
      }
    }
    return null
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            {isRunning && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('playground.batch.results')} ({completedCount + failedCount}/{total})
          </h3>
          <div className="flex items-center gap-2 text-xs">
            {completedCount > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-3 w-3" />
                {completedCount}
              </span>
            )}
            {failedCount > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="h-3 w-3" />
                {failedCount}
              </span>
            )}
          </div>
          {isRunning && (
            <Progress value={progress} className="h-2 w-24" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadAll}
            disabled={completedCount === 0 || isRunning}
          >
            <Download className="h-3 w-3 mr-1" />
            {t('playground.batch.downloadAll')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveAll}
            disabled={completedCount === 0 || savingAll || !modelId || isRunning}
          >
            {savingAll ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            {t('playground.batch.saveAllToAssets')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={isRunning}
          >
            {t('playground.batch.clearResults')}
          </Button>
        </div>
      </div>

      {/* Results Grid - auto-adjust columns based on item count, max 4 per row */}
      <ScrollArea className="flex-1">
        <div className={cn(
          'grid gap-3 p-1',
          total <= 2 && 'grid-cols-2',
          total === 3 && 'grid-cols-3',
          total >= 4 && 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
        )}>
          {Array.from({ length: total }, (_, index) => {
            const result = results.find(r => r.index === index)
            const queueItem = queue?.find(q => q.index === index)
            const media = result ? getFirstMedia(result) : null
            const hasError = result?.error
            const isPending = !result
            // Get seed from result or queue item
            const seed = result?.input?.seed ?? queueItem?.input?.seed

            return (
              <div
                key={index}
                onClick={() => result && !hasError && setSelectedResult(result)}
                className={cn(
                  'relative border rounded-lg overflow-hidden bg-card transition-all',
                  isPending
                    ? 'cursor-default'
                    : hasError
                      ? 'border-destructive/50 opacity-70 cursor-default'
                      : 'hover:border-primary hover:shadow-md cursor-pointer',
                  result && savedIndexes.has(result.index) && 'ring-1 ring-green-500/50'
                )}
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-muted flex items-center justify-center">
                  {isPending && isRunning ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : isPending ? (
                    <div className="w-full h-full bg-muted/50" />
                  ) : hasError ? (
                    <div className="flex flex-col items-center gap-1 text-destructive p-2">
                      <XCircle className="h-6 w-6" />
                      <span className="text-xs text-center line-clamp-2">{result.error}</span>
                    </div>
                  ) : media?.type === 'image' ? (
                    <img
                      src={media.url}
                      alt={`Result ${index + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : media?.type === 'video' ? (
                    <video
                      src={media.url}
                      className="w-full h-full object-cover"
                      muted
                      preload="metadata"
                    />
                  ) : media?.type === 'audio' ? (
                    <div className="text-muted-foreground text-xs">Audio</div>
                  ) : (
                    <div className="text-muted-foreground text-xs">Output</div>
                  )}
                </div>

                {/* Footer */}
                <div className="p-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">#{index + 1}</span>
                    {seed !== undefined && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {String(seed)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {result && !hasError && result.timing && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        {(result.timing / 1000).toFixed(1)}s
                      </Badge>
                    )}
                    {result && !hasError && (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    )}
                  </div>
                </div>

                {/* Saved indicator */}
                {result && savedIndexes.has(result.index) && (
                  <div className="absolute top-1 right-1">
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-green-500/80 text-white">
                      {t('playground.batch.saved')}
                    </Badge>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>

      {/* Detail Dialog */}
      <Dialog open={!!selectedResult} onOpenChange={() => setSelectedResult(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogTitle>
            {t('playground.batch.result')} #{selectedResult?.index !== undefined ? selectedResult.index + 1 : ''}
          </DialogTitle>
          {selectedResult && (
            <div className="flex-1 overflow-auto">
              <div className="space-y-4">
                {selectedResult.outputs.map((output, outputIndex) => {
                  const isObject = typeof output === 'object' && output !== null
                  const outputStr = isObject ? JSON.stringify(output, null, 2) : String(output)
                  const isImage = !isObject && isImageUrl(outputStr)
                  const isVideo = !isObject && isVideoUrl(outputStr)
                  const isAudio = !isObject && isAudioUrl(outputStr)

                  return (
                    <div key={outputIndex} className="relative group">
                      {isImage && (
                        <img
                          src={outputStr}
                          alt={`Output ${outputIndex + 1}`}
                          className="max-w-full rounded-lg"
                        />
                      )}
                      {isVideo && (
                        <video
                          src={outputStr}
                          controls
                          className="max-w-full rounded-lg"
                        />
                      )}
                      {isAudio && (
                        <AudioPlayer src={outputStr} />
                      )}
                      {isObject && (
                        <pre className="p-4 bg-muted rounded-lg text-sm overflow-auto max-h-96">
                          {outputStr}
                        </pre>
                      )}
                      {!isImage && !isVideo && !isAudio && !isObject && (
                        <p className="text-sm break-all">{outputStr}</p>
                      )}

                      {/* Actions */}
                      {!isObject && (
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="secondary"
                                className="h-8 w-8"
                                onClick={() => handleCopy(outputStr, selectedResult.index * 100 + outputIndex)}
                              >
                                {copiedIndex === selectedResult.index * 100 + outputIndex ? (
                                  <Check className="h-4 w-4" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('common.copy')}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="secondary"
                                className="h-8 w-8"
                                onClick={() => window.open(outputStr, '_blank')}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('common.openInBrowser')}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="secondary"
                                className="h-8 w-8"
                                onClick={() => handleDownload(outputStr, selectedResult.index)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('common.download')}</TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Input details */}
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    {t('playground.batch.inputDetails')}
                  </summary>
                  <pre className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-auto max-h-48">
                    {JSON.stringify(selectedResult.input, null, 2)}
                  </pre>
                </details>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
