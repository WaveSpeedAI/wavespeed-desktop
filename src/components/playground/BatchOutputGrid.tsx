import { useState, useCallback, useEffect, useRef } from 'react'
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
import { Download, CheckCircle2, XCircle, ExternalLink, Copy, Check, Loader2 } from 'lucide-react'
import { AudioPlayer } from '@/components/shared/AudioPlayer'
import { useAssetsStore, detectAssetType, generateDownloadFilename } from '@/stores/assetsStore'
import { toast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import type { BatchResult, BatchQueueItem } from '@/types/batch'

interface BatchOutputGridProps {
  results: BatchResult[]
  modelId?: string
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

export function BatchOutputGrid({
  results,
  modelId,
  onClear,
  className,
  isRunning,
  totalCount,
  queue
}: BatchOutputGridProps) {
  const { t } = useTranslation()
  const [selectedResult, setSelectedResult] = useState<BatchResult | null>(null)
  const [savedIndexes, setSavedIndexes] = useState<Set<number>>(new Set())
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const autoSavedIndexesRef = useRef<Set<number>>(new Set())

  const { saveAsset, settings, hasAssetForPrediction } = useAssetsStore()

  const completedResults = results.filter(r => !r.error)
  const completedCount = completedResults.length
  const failedCount = results.filter(r => r.error).length
  const total = totalCount || results.length
  const progress = total > 0 ? ((completedCount + failedCount) / total) * 100 : 0

  // Auto-save results as they complete
  useEffect(() => {
    if (!settings.autoSaveAssets || !modelId) return

    const saveNewResults = async () => {
      let newSaveCount = 0

      for (const result of results) {
        // Skip if already auto-saved, has error, or no outputs
        if (autoSavedIndexesRef.current.has(result.index)) continue
        if (result.error || result.outputs.length === 0) continue

        // Check if already saved for this prediction
        if (result.prediction?.id && hasAssetForPrediction(result.prediction.id)) {
          autoSavedIndexesRef.current.add(result.index)
          setSavedIndexes(prev => new Set(prev).add(result.index))
          continue
        }

        // Mark as being saved
        autoSavedIndexesRef.current.add(result.index)

        for (let outputIndex = 0; outputIndex < result.outputs.length; outputIndex++) {
          const output = result.outputs[outputIndex]
          if (typeof output !== 'string') continue

          const assetType = detectAssetType(output)
          if (!assetType) continue

          try {
            // Each batch item has unique predictionId, so just use outputIndex
            const saveResult = await saveAsset(output, assetType, {
              modelId,
              predictionId: result.prediction?.id,
              originalUrl: output,
              resultIndex: outputIndex
            })
            if (saveResult) {
              setSavedIndexes(prev => new Set(prev).add(result.index))
              newSaveCount++
            }
          } catch (err) {
            console.error('Failed to auto-save batch asset:', err)
          }
        }
      }

      if (newSaveCount > 0 && !isRunning) {
        toast({
          description: t('playground.autoSaved'),
          duration: 2000,
        })
      }
    }

    saveNewResults()
  }, [results, modelId, settings.autoSaveAssets, saveAsset, hasAssetForPrediction, isRunning, t])

  // Reset auto-saved tracking when results are cleared
  useEffect(() => {
    if (results.length === 0) {
      autoSavedIndexesRef.current = new Set()
      setSavedIndexes(new Set())
    }
  }, [results.length])

  // Check if truly running in Electron (not web polyfill)
  const isElectron = navigator.userAgent.toLowerCase().includes('electron')

  const handleDownload = async (url: string, predictionId?: string, resultIndex: number = 0) => {
    const filename = generateDownloadFilename({
      modelId,
      url,
      predictionId,
      resultIndex
    })

    if (isElectron && window.electronAPI?.downloadFile) {
      const result = await window.electronAPI.downloadFile(url, filename)
      if (!result.success && !result.canceled) {
        console.error('Download failed:', result.error)
      }
    } else {
      // Web mode: fetch as blob and trigger download
      try {
        const response = await fetch(url)
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(blobUrl)
      } catch (err) {
        console.error('Download failed:', err)
        // Fallback: open in new tab
        window.open(url, '_blank')
      }
    }
  }

  const handleDownloadAll = async () => {
    // Collect all URLs with their metadata
    const downloads: { url: string; predictionId?: string; index: number }[] = []
    for (const result of results) {
      if (result.error) continue
      for (let i = 0; i < result.outputs.length; i++) {
        const output = result.outputs[i]
        if (typeof output === 'string' && isUrl(output)) {
          downloads.push({ url: output, predictionId: result.prediction?.id, index: downloads.length })
        }
      }
    }

    if (downloads.length === 0) return

    toast({
      description: `Downloading ${downloads.length} files...`,
      duration: 2000,
    })

    // Download all with small delay between each
    for (const { url, predictionId, index } of downloads) {
      await handleDownload(url, predictionId, index)
      // Small delay to prevent overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 300))
    }

    toast({
      description: `Downloaded ${downloads.length} files`,
      duration: 2000,
    })
  }


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
            <span className="hidden md:inline">{t('playground.batch.results')}</span> ({completedCount + failedCount}/{total})
          </h3>
          <div className="hidden md:flex items-center gap-2 text-xs">
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
            <Progress value={progress} className="h-2 w-16 md:w-24" />
          )}
        </div>
        <div className="flex items-center gap-1 md:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadAll}
            disabled={completedCount === 0 || isRunning}
            className="text-xs md:text-sm"
          >
            <Download className="h-3 w-3 md:mr-1" />
            <span className="hidden md:inline">{t('playground.batch.downloadAll')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={isRunning}
            className="text-xs md:text-sm"
          >
            <span className="hidden md:inline">{t('playground.batch.clearResults')}</span>
            <span className="md:hidden">Clear</span>
          </Button>
        </div>
      </div>
      {/* Results Grid - dynamic columns based on item count with minimum cell size */}
      <ScrollArea className="flex-1">
        <div className={cn(
          'grid gap-4 p-1',
          // For fewer items, use larger minimum cell sizes
          total <= 2 && 'grid-cols-1 sm:grid-cols-2',
          total === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
          total === 4 && 'grid-cols-2 lg:grid-cols-4',
          total > 4 && 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
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
                    <div key={outputIndex} className="space-y-2">
                      {/* Media content */}
                      <div className="relative">
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
                      </div>

                      {/* Actions - always visible below content */}
                      {!isObject && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownload(outputStr, selectedResult.prediction?.id, outputIndex)}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            {t('common.download')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCopy(outputStr, selectedResult.index * 100 + outputIndex)}
                          >
                            {copiedIndex === selectedResult.index * 100 + outputIndex ? (
                              <Check className="h-4 w-4 mr-2" />
                            ) : (
                              <Copy className="h-4 w-4 mr-2" />
                            )}
                            {copiedIndex === selectedResult.index * 100 + outputIndex ? 'Copied!' : t('common.copy')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => window.open(outputStr, '_blank')}
                          >
                            <ExternalLink className="h-4 w-4 mr-2" />
                            {t('common.openInBrowser')}
                          </Button>
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
