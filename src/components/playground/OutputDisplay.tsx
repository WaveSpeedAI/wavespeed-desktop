import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PredictionResult } from '@/types/prediction'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Download, Link, Copy, Check, AlertTriangle, X } from 'lucide-react'
import { AudioPlayer } from '@/components/shared/AudioPlayer'
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

export function OutputDisplay({ prediction, outputs, error, isLoading }: OutputDisplayProps) {
  const { t } = useTranslation()
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [fullscreenMedia, setFullscreenMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null)

  // Copy URL/content to clipboard
  const handleCopyUrl = async (url: string, index: number) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
      toast({
        description: t('playground.urlCopied'),
      })
    } catch (err) {
      console.error('Copy failed:', err)
      toast({
        title: t('common.error'),
        description: t('playground.copyFailed'),
        variant: 'destructive',
      })
    }
  }

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

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-muted rounded-full animate-pulse" />
          <div className="absolute inset-0 w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-muted-foreground">{t('playground.generating')}</p>
        {prediction?.status && (
          <Badge variant="secondary">{prediction.status}</Badge>
        )}
      </div>
    )
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

  if (outputs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <p>{t('playground.noOutputs')}</p>
        <p className="text-sm">{t('playground.configureAndRun')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Outputs - fill remaining space */}
      <div className="flex-1 min-h-0 flex flex-col gap-4">
        {outputs.map((output, index) => {
          const isObject = typeof output === 'object' && output !== null
          const outputStr = isObject ? JSON.stringify(output, null, 2) : String(output)
          const isImage = !isObject && isImageUrl(outputStr)
          const isVideo = !isObject && isVideoUrl(outputStr)
          const isAudio = !isObject && isAudioUrl(outputStr)
          const isMedia = isImage || isVideo || isAudio
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

              {/* Actions overlay - always visible on hover, stays visible after click */}
              <div className={cn(
                "absolute top-2 right-2 flex gap-1 transition-opacity",
                "opacity-100 md:opacity-0 md:group-hover:opacity-100"
              )}>
                {/* Button 1: Copy URL (for media) or Copy content (for text/object) */}
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopyUrl(copyValue, index)
                  }}
                >
                  {copiedIndex === index ? (
                    <Check className="h-4 w-4" />
                  ) : isMedia ? (
                    <Link className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>

                {/* Button 2: Download (only for media) */}
                {isMedia && (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDownload(outputStr, index)
                    }}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
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
          <DialogDescription className="sr-only">View media in fullscreen mode</DialogDescription>
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
