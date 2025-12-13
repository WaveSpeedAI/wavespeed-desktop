import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { PredictionResult } from '@/types/prediction'
import { useAssetsStore, detectAssetType } from '@/stores/assetsStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { Download, ExternalLink, Copy, Check, AlertTriangle, X, Save, FolderHeart, Gamepad2 } from 'lucide-react'
import { AudioPlayer } from '@/components/shared/AudioPlayer'
import { FlappyBird } from './FlappyBird'
import { toast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'

interface OutputDisplayProps {
  prediction: PredictionResult | null
  outputs: (string | Record<string, unknown>)[]
  error: string | null
  isLoading: boolean
  modelId?: string
  modelName?: string
}

export function OutputDisplay({ prediction, outputs, error, isLoading, modelId, modelName }: OutputDisplayProps) {
  const { t } = useTranslation()
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [fullscreenMedia, setFullscreenMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null)
  const [savedIndexes, setSavedIndexes] = useState<Set<number>>(new Set())
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const autoSavedRef = useRef<string | null>(null)

  // Game state
  const [isGameStarted, setIsGameStarted] = useState(false)
  const [showGame, setShowGame] = useState(true)
  const [gameEndedWithResults, setGameEndedWithResults] = useState(false)
  const prevOutputsLengthRef = useRef(0)

  const { settings, loadSettings, saveAsset, hasAssetForPrediction } = useAssetsStore()

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Track outputs length for other logic
  useEffect(() => {
    prevOutputsLengthRef.current = outputs.length
  }, [outputs.length])

  // Reset game state when outputs are cleared (new run starting)
  useEffect(() => {
    if (outputs.length === 0 && !isLoading && !error) {
      setShowGame(true)
      setGameEndedWithResults(false)
    }
  }, [outputs.length, isLoading, error])

  const handleGameStart = useCallback(() => {
    setIsGameStarted(true)
  }, [])

  const handleGameEnd = useCallback(() => {
    // Game ended - don't auto-switch, let user view results via notification
    setGameEndedWithResults(true)
  }, [])

  // Auto-save outputs when prediction completes
  useEffect(() => {
    if (!settings.autoSaveAssets || !modelId || !modelName || outputs.length === 0) return
    if (!prediction?.id || autoSavedRef.current === prediction.id) return

    // Check if assets already exist for this prediction (prevents duplicate saves on remount)
    if (hasAssetForPrediction(prediction.id)) {
      autoSavedRef.current = prediction.id
      return
    }

    // Mark as auto-saved to prevent duplicate saves
    autoSavedRef.current = prediction.id

    // Auto-save all media outputs
    const saveOutputs = async () => {
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i]
        if (typeof output !== 'string') continue

        const assetType = detectAssetType(output)
        if (!assetType) continue

        try {
          const result = await saveAsset(output, assetType, {
            modelId,
            modelName,
            predictionId: prediction.id,
            originalUrl: output,
            resultIndex: i
          })
          if (result) {
            setSavedIndexes(prev => new Set(prev).add(i))
          }
        } catch (err) {
          console.error('Failed to auto-save asset:', err)
        }
      }

      // Show a brief, unobtrusive notification
      toast({
        description: t('playground.autoSaved'),
        duration: 2000,
      })
    }

    saveOutputs()
  }, [outputs, prediction?.id, modelId, modelName, settings.autoSaveAssets, saveAsset, hasAssetForPrediction, t])

  // Reset saved indexes when outputs change (new prediction)
  useEffect(() => {
    if (prediction?.id && autoSavedRef.current !== prediction.id) {
      setSavedIndexes(new Set())
    }
  }, [prediction?.id])

  const handleSaveToAssets = useCallback(async (url: string, index: number) => {
    if (!modelId || !modelName) return

    const assetType = detectAssetType(url)
    if (!assetType) {
      toast({
        title: t('common.error'),
        description: t('playground.unsupportedFormat'),
        variant: 'destructive',
      })
      return
    }

    setSavingIndex(index)
    try {
      const result = await saveAsset(url, assetType, {
        modelId,
        modelName,
        predictionId: prediction?.id,
        originalUrl: url,
        resultIndex: index
      })

      if (result) {
        setSavedIndexes(prev => new Set(prev).add(index))
        toast({
          title: t('playground.savedToAssets'),
          description: t('playground.savedToAssetsDesc'),
        })
      } else {
        toast({
          title: t('common.error'),
          description: t('playground.saveFailed'),
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: t('common.error'),
        description: t('playground.saveFailed'),
        variant: 'destructive',
      })
    } finally {
      setSavingIndex(null)
    }
  }, [modelId, modelName, prediction?.id, saveAsset, t])

  const handleDownload = async (url: string, index: number) => {
    const extension = getExtensionFromUrl(url) || 'png'
    const filename = `output-${index + 1}.${extension}`

    // Use Electron API if available
    if (window.electronAPI?.downloadFile) {
      const result = await window.electronAPI.downloadFile(url, filename)
      if (!result.success && !result.canceled) {
        console.error('Download failed:', result.error)
      }
    } else {
      // Browser: just open in new tab
      window.open(url, '_blank')
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

  const handleOpenExternal = (url: string) => {
    window.open(url, '_blank')
  }

  if (error) {
    // Try to parse JSON error for better display
    let errorMessage = error
    let errorDetails: Record<string, unknown> | null = null

    try {
      if (error.startsWith('{')) {
        const parsed = JSON.parse(error)
        errorMessage = parsed.message || parsed.error || error
        errorDetails = parsed
      }
    } catch {
      // Keep original error string
    }

    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <div className="text-center max-w-lg space-y-3">
          <p className="text-destructive font-medium">{errorMessage}</p>
          {errorDetails && (
            <details className="text-left">
              <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
                Show details
              </summary>
              <pre className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-auto max-h-48">
                {JSON.stringify(errorDetails, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    )
  }

  // Show game when: no outputs, loading, or user toggled to game view
  const showGameView = outputs.length === 0 || isLoading || (showGame && (gameEndedWithResults || isGameStarted))

  if (showGameView) {
    return (
      <div className="relative h-full">
        <FlappyBird
          onGameStart={handleGameStart}
          onGameEnd={handleGameEnd}
          isTaskRunning={isLoading}
          taskStatus={prediction?.status || t('playground.generating')}
          idleMessage={outputs.length === 0 && !isLoading ? {
            title: t('playground.noOutputs'),
            subtitle: t('playground.configureAndRun')
          } : undefined}
          hasResults={outputs.length > 0 && !isLoading}
          onViewResults={() => setShowGame(false)}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Play game button - top left */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 left-2 z-10 h-8 w-8 opacity-50 hover:opacity-100"
            onClick={() => {
              setShowGame(true)
              setGameEndedWithResults(true)
            }}
          >
            <Gamepad2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('playground.flappyBird.playWhileWaiting', 'Play while waiting')}
        </TooltipContent>
      </Tooltip>

      {/* Outputs - fill remaining space */}
      <div className="flex-1 min-h-0 flex flex-col gap-4">
        {outputs.map((output, index) => {
          const isObject = typeof output === 'object' && output !== null
          const outputStr = isObject ? JSON.stringify(output, null, 2) : String(output)
          const isImage = !isObject && isImageUrl(outputStr)
          const isVideo = !isObject && isVideoUrl(outputStr)
          const isAudio = !isObject && isAudioUrl(outputStr)
          const copyValue = isObject ? outputStr : outputStr

          return (
            <div
              key={index}
              className="relative group rounded-lg border overflow-hidden bg-muted/30 flex-1 min-h-0 flex items-center justify-center"
            >
              {isImage && (
                <img
                  src={outputStr}
                  alt={`Output ${index + 1}`}
                  className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                  loading="lazy"
                  onClick={() => setFullscreenMedia({ url: outputStr, type: 'image' })}
                />
              )}

              {isVideo && (
                <video
                  src={outputStr}
                  controls
                  className="max-w-full max-h-full object-contain"
                  preload="metadata"
                />
              )}

              {isAudio && (
                <AudioPlayer src={outputStr} />
              )}

              {isObject && (
                <div className="p-4 w-full h-full overflow-auto">
                  <pre className="text-sm font-mono whitespace-pre-wrap break-all">
                    {outputStr}
                  </pre>
                </div>
              )}

              {!isImage && !isVideo && !isAudio && !isObject && (
                <div className="p-4">
                  <p className="text-sm break-all">{outputStr}</p>
                </div>
              )}

              {/* Timing overlay */}
              {prediction?.timings?.inference && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1">
                  <Badge variant="secondary" className="text-xs bg-black/60 text-white border-0">
                    {(prediction.timings.inference / 1000).toFixed(2)}s
                  </Badge>
                  {prediction.has_nsfw_contents?.some(Boolean) && (
                    <Badge variant="destructive" className="text-xs">NSFW</Badge>
                  )}
                </div>
              )}

              {/* Actions overlay */}
              <div className={cn(
                "absolute top-2 right-2 flex gap-1 transition-opacity",
                "opacity-0 group-hover:opacity-100"
              )}>
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-8 w-8"
                  onClick={() => handleCopy(copyValue, index)}
                >
                  {copiedIndex === index ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                {!isObject && (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8"
                    onClick={() => handleOpenExternal(outputStr)}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
                {(isImage || isVideo || isAudio) && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          onClick={() => handleSaveToAssets(outputStr, index)}
                          disabled={savedIndexes.has(index) || savingIndex === index || !modelId}
                        >
                          {savedIndexes.has(index) ? (
                            <FolderHeart className="h-4 w-4 text-green-500" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {savedIndexes.has(index) ? t('playground.alreadySaved') : t('playground.saveToAssets')}
                      </TooltipContent>
                    </Tooltip>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-8 w-8"
                      onClick={() => handleDownload(outputStr, index)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Fullscreen Preview Dialog */}
      <Dialog open={!!fullscreenMedia} onOpenChange={() => setFullscreenMedia(null)}>
        <DialogContent className="w-screen h-screen max-w-none max-h-none p-0 border-0 bg-black flex items-center justify-center" hideCloseButton>
          <DialogTitle className="sr-only">Fullscreen Preview</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20 h-10 w-10 [filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))_drop-shadow(0_0_4px_rgba(0,0,0,0.5))]"
            onClick={() => setFullscreenMedia(null)}
          >
            <X className="h-6 w-6" />
          </Button>
          {fullscreenMedia?.type === 'image' && (
            <img
              src={fullscreenMedia.url}
              alt="Fullscreen preview"
              className="max-w-full max-h-full object-contain"
            />
          )}
          {fullscreenMedia?.type === 'video' && (
            <video
              src={fullscreenMedia.url}
              controls
              autoPlay
              className="max-w-full max-h-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
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
