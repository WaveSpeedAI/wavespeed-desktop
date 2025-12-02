import { useState } from 'react'
import type { PredictionResult } from '@/types/prediction'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Download, ExternalLink, Copy, Check, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OutputDisplayProps {
  prediction: PredictionResult | null
  outputs: string[]
  error: string | null
  isLoading: boolean
}

export function OutputDisplay({ prediction, outputs, error, isLoading }: OutputDisplayProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

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

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-muted rounded-full animate-pulse" />
          <div className="absolute inset-0 w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-muted-foreground">Generating...</p>
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
        <p>No outputs yet</p>
        <p className="text-sm">Configure the model and click Run to generate</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-1">
        {/* Timing info */}
        {prediction?.timings?.inference && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Generated in {(prediction.timings.inference / 1000).toFixed(2)}s</span>
            {prediction.has_nsfw_contents?.some(Boolean) && (
              <Badge variant="warning">NSFW detected</Badge>
            )}
          </div>
        )}

        {/* Outputs */}
        <div className="grid gap-4">
          {outputs.map((output, index) => {
            const isImage = isImageUrl(output)
            const isVideo = isVideoUrl(output)

            return (
              <div
                key={index}
                className="relative group rounded-lg border overflow-hidden bg-muted/30"
              >
                {isImage && (
                  <img
                    src={output}
                    alt={`Output ${index + 1}`}
                    className="w-full h-auto"
                    loading="lazy"
                  />
                )}

                {isVideo && (
                  <video
                    src={output}
                    controls
                    className="w-full h-auto"
                    preload="metadata"
                  />
                )}

                {!isImage && !isVideo && (
                  <div className="p-4">
                    <p className="text-sm break-all">{output}</p>
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
                    onClick={() => handleCopy(output, index)}
                  >
                    {copiedIndex === index ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8"
                    onClick={() => handleOpenExternal(output)}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  {(isImage || isVideo) && (
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-8 w-8"
                      onClick={() => handleDownload(output, index)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </ScrollArea>
  )
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(url) ||
    url.includes('/image') ||
    url.includes('image/')
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(url) ||
    url.includes('/video') ||
    url.includes('video/')
}

function getExtensionFromUrl(url: string): string | null {
  const match = url.match(/\.([a-zA-Z0-9]+)(\?.*)?$/)
  return match ? match[1] : null
}
