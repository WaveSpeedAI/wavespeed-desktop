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

// Check if running in Capacitor native environment
const isCapacitorNative = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(window as any).Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

// Mobile download helper using Capacitor
const mobileDownload = async (url: string, filename: string): Promise<{ success: boolean; error?: string }> => {
  try {
    // Dynamic imports for Capacitor modules (vite-ignore to prevent desktop build errors)
    const { CapacitorHttp } = await import(/* @vite-ignore */ '@capacitor/core')
    const { Filesystem, Directory } = await import(/* @vite-ignore */ '@capacitor/filesystem')

    // Fetch file using CapacitorHttp (bypasses CORS)
    const response = await CapacitorHttp.get({
      url,
      responseType: 'blob'
    })

    if (response.status !== 200) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    // Create Downloads directory
    const directory = 'Downloads'
    try {
      await Filesystem.mkdir({
        path: directory,
        directory: Directory.Documents,
        recursive: true
      })
    } catch {
      // Directory might already exist
    }

    // Save file
    const filePath = `${directory}/${filename}`
    await Filesystem.writeFile({
      path: filePath,
      data: response.data as string,
      directory: Directory.Documents
    })

    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

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

function getUrlExtension(url: string): string | null {
  try {
    // Parse URL and get pathname (ignoring query params)
    const urlObj = new URL(url)
    const pathname = urlObj.pathname.toLowerCase()
    // Get the last segment and extract extension
    const lastSegment = pathname.split('/').pop() || ''
    const match = lastSegment.match(/\.([a-z0-9]+)$/)
    return match ? match[1] : null
  } catch {
    // Fallback for invalid URLs
    const match = url.match(/\.([a-z0-9]+)(?:\?.*)?$/i)
    return match ? match[1].toLowerCase() : null
  }
}

function isImageUrl(url: string): boolean {
  if (!isUrl(url)) return false
  const ext = getUrlExtension(url)
  return ext !== null && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'].includes(ext)
}

function isVideoUrl(url: string): boolean {
  if (!isUrl(url)) return false
  const ext = getUrlExtension(url)
  return ext !== null && ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv', 'm4v'].includes(ext)
}

function isAudioUrl(url: string): boolean {
  if (!isUrl(url)) return false
  const ext = getUrlExtension(url)
  return ext !== null && ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'].includes(ext)
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

  const handleDownload = async (url: string, predictionId?: string, resultIndex: number = 0) => {
    const filename = generateDownloadFilename({
      modelId,
      url,
      predictionId,
      resultIndex
    })

    // Use Electron API if available (desktop)
    if (window.electronAPI?.downloadFile) {
      const result = await window.electronAPI.downloadFile(url, filename)
      if (!result.success && !result.canceled) {
        console.error('Download failed:', result.error)
      }
      return
    }

    // Use Capacitor if available (mobile native)
    if (isCapacitorNative()) {
      const result = await mobileDownload(url, filename)
      if (result.success) {
        toast({
          title: t('common.success'),
          description: t('freeTools.downloadSuccess')
        })
      } else {
        console.error('Mobile download failed:', result.error)
        toast({
          title: t('common.error'),
          description: result.error || 'Download failed',
          variant: 'destructive'
        })
      }
      return
    }

    // Browser fallback: open in new tab
    window.open(url, '_blank')
  }

  const handleDownloadAll = async () => {
    for (const result of results) {
      if (result.error) continue
      for (let outputIndex = 0; outputIndex < result.outputs.length; outputIndex++) {
        const output = result.outputs[outputIndex]
        if (typeof output === 'string' && isUrl(output)) {
          await handleDownload(output, result.prediction?.id, outputIndex)
        }
      }
    }
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
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={isRunning}
          >
            {t('playground.batch.clearResults')}
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
                      playsInline
                      preload="auto"
                      onLoadedData={(e) => {
                        // Seek to first frame to show preview
                        const video = e.currentTarget
                        video.currentTime = 0.1
                      }}
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
                          playsInline
                          preload="auto"
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
                                onClick={() => handleDownload(outputStr, selectedResult.prediction?.id, outputIndex)}
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
