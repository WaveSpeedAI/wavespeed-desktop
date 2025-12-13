import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useBackgroundRemoverWorker } from '@/hooks/useBackgroundRemoverWorker'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { ProcessingProgress } from '@/components/shared/ProcessingProgress'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { ArrowLeft, Upload, Download, Loader2, Eraser, X, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type ModelType = 'isnet_quint8' | 'isnet_fp16' | 'isnet'

interface ResultImages {
  foreground: string | null
  background: string | null
  mask: string | null
}

// Phase configuration for background remover
const PHASES = [
  { id: 'download', labelKey: 'freeTools.progress.downloading', weight: 0.1 },
  { id: 'process', labelKey: 'freeTools.progress.processing', weight: 0.9 }
]

export function BackgroundRemoverPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRefs = {
    foreground: useRef<HTMLCanvasElement>(null),
    background: useRef<HTMLCanvasElement>(null),
    mask: useRef<HTMLCanvasElement>(null)
  }
  const dragCounterRef = useRef(0)

  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [originalBlob, setOriginalBlob] = useState<Blob | null>(null)
  const [resultImages, setResultImages] = useState<ResultImages>({
    foreground: null,
    background: null,
    mask: null
  })
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingKey, setProcessingKey] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [originalSize, setOriginalSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [model, setModel] = useState<ModelType>('isnet_fp16')
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpeg' | 'webp'>(
    'png'
  )
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [showBackWarning, setShowBackWarning] = useState(false)

  // Multi-phase progress tracking
  const {
    progress,
    startPhase,
    updatePhase,
    reset: resetProgress,
    resetAndStart,
    complete: completeAllPhases
  } = useMultiPhaseProgress({ phases: PHASES })

  const [error, setError] = useState<string | null>(null)

  const { removeBackgroundAll, dispose, retryWorker, hasFailed } = useBackgroundRemoverWorker({
    onPhase: (phase) => {
      // Start the corresponding phase when worker reports it
      if (phase === 'download') {
        startPhase('download')
      } else if (phase === 'process') {
        startPhase('process')
      }
    },
    onProgress: (phase, progressValue, detail) => {
      // Update the phase that worker reports
      const phaseId = phase === 'download' ? 'download' : 'process'
      updatePhase(phaseId, progressValue, detail)
    },
    onError: (err) => {
      console.error('Worker error:', err)
      setError(err)
      setIsProcessing(false)
    }
  })

  const handleRetry = useCallback(() => {
    setError(null)
    retryWorker()
  }, [retryWorker])

  const handleBack = useCallback(() => {
    if (isProcessing) {
      setShowBackWarning(true)
    } else {
      dispose()
      navigate('/free-tools')
    }
  }, [isProcessing, dispose, navigate])

  const handleConfirmBack = useCallback(() => {
    setShowBackWarning(false)
    dispose()
    navigate('/free-tools')
  }, [dispose, navigate])

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return

    // Store the original blob for processing
    setOriginalBlob(file)

    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setOriginalImage(dataUrl)
      setResultImages({ foreground: null, background: null, mask: null })
      resetProgress()

      // Get original dimensions
      const img = new Image()
      img.onload = () => {
        setOriginalSize({ width: img.width, height: img.height })
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }, [resetProgress])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragging(false)
      if (isProcessing) return
      const file = e.dataTransfer.files[0]
      if (file) handleFileSelect(file)
    },
    [handleFileSelect, isProcessing]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleRemoveBackground = async () => {
    if (!originalBlob) return

    setIsProcessing(true)
    setProcessingKey((k) => k + 1)
    resetAndStart('process')

    try {
      // Process all three outputs in worker
      const results = await removeBackgroundAll(originalBlob, model)

      // Convert blobs to data URLs for display
      const foregroundUrl = URL.createObjectURL(results.foreground)
      const backgroundUrl = URL.createObjectURL(results.background)
      const maskUrl = URL.createObjectURL(results.mask)

      setResultImages({
        foreground: foregroundUrl,
        background: backgroundUrl,
        mask: maskUrl
      })

      // Draw to canvases for download format conversion
      const drawToCanvas = async (
        blob: Blob,
        canvas: HTMLCanvasElement | null
      ) => {
        if (!canvas) return
        const url = URL.createObjectURL(blob)
        const img = new Image()
        await new Promise<void>((resolve) => {
          img.onload = () => {
            canvas.width = img.width
            canvas.height = img.height
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0)
            URL.revokeObjectURL(url)
            resolve()
          }
          img.src = url
        })
      }

      await Promise.all([
        drawToCanvas(results.foreground, canvasRefs.foreground.current),
        drawToCanvas(results.background, canvasRefs.background.current),
        drawToCanvas(results.mask, canvasRefs.mask.current)
      ])

      completeAllPhases()
    } catch (error) {
      console.error('Background removal failed:', error)
    } finally {
      setIsProcessing(false)
      dispose()
    }
  }

  const handleDownload = (type: 'foreground' | 'background' | 'mask') => {
    const canvas = canvasRefs[type].current
    if (!canvas) return

    const mimeType = `image/${downloadFormat}`
    // For PNG, maintain full quality for transparency; for JPEG/WebP, use high quality
    const quality = downloadFormat === 'png' ? undefined : 0.95

    let dataUrl: string

    // For JPEG with foreground/background (which have transparency), fill with white background
    if (downloadFormat === 'jpeg' && (type === 'foreground' || type === 'background')) {
      // Create a temporary canvas with white background
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = canvas.width
      tempCanvas.height = canvas.height
      const tempCtx = tempCanvas.getContext('2d')!
      // Fill with white
      tempCtx.fillStyle = '#ffffff'
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height)
      // Draw the original image on top
      tempCtx.drawImage(canvas, 0, 0)
      dataUrl = tempCanvas.toDataURL(mimeType, quality)
    } else {
      dataUrl = canvas.toDataURL(mimeType, quality)
    }

    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `${type}-${Date.now()}.${downloadFormat}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const hasResults = resultImages.foreground || resultImages.background || resultImages.mask

  return (
    <div
      className="p-8 relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Hidden canvases for processing */}
      <canvas ref={canvasRefs.foreground} className="hidden" />
      <canvas ref={canvasRefs.background} className="hidden" />
      <canvas ref={canvasRefs.mask} className="hidden" />

      {/* Drag overlay for inner page */}
      {isDragging && originalImage && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-4">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium">
              {t('freeTools.backgroundRemover.orDragDrop')}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {t('freeTools.backgroundRemover.title')}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('freeTools.backgroundRemover.description')}
          </p>
        </div>
      </div>

      {/* Upload area */}
      {!originalImage && (
        <Card
          className={cn(
            'border-2 border-dashed cursor-pointer transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50'
          )}
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
        >
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium">
              {t('freeTools.backgroundRemover.selectImage')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('freeTools.backgroundRemover.orDragDrop')}
            </p>
          </CardContent>
        </Card>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFileSelect(file)
        }}
      />

      {/* Preview area */}
      {originalImage && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.backgroundRemover.selectImage')}
            </Button>

            <Select
              value={model}
              onValueChange={(v) => setModel(v as ModelType)}
              disabled={isProcessing}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="isnet_quint8">
                  {t('freeTools.backgroundRemover.modelFast')}
                </SelectItem>
                <SelectItem value="isnet_fp16">
                  {t('freeTools.backgroundRemover.modelBalanced')}
                </SelectItem>
                <SelectItem value="isnet">
                  {t('freeTools.backgroundRemover.modelQuality')}
                </SelectItem>
              </SelectContent>
            </Select>

            <Button
              onClick={handleRemoveBackground}
              disabled={isProcessing}
              className="gradient-bg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('freeTools.backgroundRemover.processing')}
                </>
              ) : (
                <>
                  <Eraser className="h-4 w-4 mr-2" />
                  {t('freeTools.backgroundRemover.remove')}
                </>
              )}
            </Button>

            {hasResults && (
              <Select
                value={downloadFormat}
                onValueChange={(v) =>
                  setDownloadFormat(v as 'png' | 'jpeg' | 'webp')
                }
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="jpeg">JPEG</SelectItem>
                  <SelectItem value="webp">WebP</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Progress display */}
          <ProcessingProgress
            key={processingKey}
            progress={progress}
            showPhases={true}
            showOverall={true}
            showEta={true}
          />

          {/* Error with retry button */}
          {error && hasFailed() && !isProcessing && (
            <div className="flex items-center justify-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <span className="text-sm text-destructive">{t('common.downloadFailed')}</span>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.retry')}
              </Button>
            </div>
          )}

          {/* Original + Results grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Original */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {t('freeTools.backgroundRemover.original')}
                  </span>
                  {originalSize && (
                    <span className="text-xs text-muted-foreground">
                      {originalSize.width} x {originalSize.height}
                    </span>
                  )}
                </div>
                <div className="relative aspect-square bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                  <img
                    src={originalImage}
                    alt="Original"
                    className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setPreviewImage(originalImage)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Foreground */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {t('freeTools.backgroundRemover.outputForeground')}
                  </span>
                  {resultImages.foreground && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleDownload('foreground')}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="relative aspect-square bg-muted rounded-lg overflow-hidden flex items-center justify-center checkered-bg">
                  {resultImages.foreground ? (
                    <img
                      src={resultImages.foreground}
                      alt="Foreground"
                      className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setPreviewImage(resultImages.foreground)}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      {isProcessing ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                      ) : (
                        <span className="text-sm">—</span>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Background */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {t('freeTools.backgroundRemover.outputBackground')}
                  </span>
                  {resultImages.background && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleDownload('background')}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="relative aspect-square bg-muted rounded-lg overflow-hidden flex items-center justify-center checkered-bg">
                  {resultImages.background ? (
                    <img
                      src={resultImages.background}
                      alt="Background"
                      className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setPreviewImage(resultImages.background)}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      {isProcessing ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                      ) : (
                        <span className="text-sm">—</span>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Mask */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {t('freeTools.backgroundRemover.outputMask')}
                  </span>
                  {resultImages.mask && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleDownload('mask')}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="relative aspect-square bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                  {resultImages.mask ? (
                    <img
                      src={resultImages.mask}
                      alt="Mask"
                      className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setPreviewImage(resultImages.mask)}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      {isProcessing ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                      ) : (
                        <span className="text-sm">—</span>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Fullscreen Preview Dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent
          className="w-screen h-screen max-w-none max-h-none p-0 border-0 bg-black flex items-center justify-center"
          hideCloseButton
        >
          <DialogTitle className="sr-only">Fullscreen Preview</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20 h-10 w-10 [filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))_drop-shadow(0_0_4px_rgba(0,0,0,0.5))]"
            onClick={() => setPreviewImage(null)}
          >
            <X className="h-6 w-6" />
          </Button>
          {previewImage && (
            <img
              src={previewImage}
              alt="Fullscreen preview"
              className="max-w-full max-h-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Back Warning Dialog */}
      <AlertDialog open={showBackWarning} onOpenChange={setShowBackWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('freeTools.backWarning.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('freeTools.backWarning.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('freeTools.backWarning.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmBack}>
              {t('freeTools.backWarning.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
