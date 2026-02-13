import { useState, useRef, useCallback, useContext } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { PageResetContext } from '@/components/layout/PageResetContext'
import { useTranslation } from 'react-i18next'
import { generateFreeToolFilename } from '@/stores/assetsStore'
import { useFaceEnhancerWorker } from '@/hooks/useFaceEnhancerWorker'
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
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  Sparkles,
  X,
  Columns2,
  SplitSquareHorizontal,
  RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'

type ViewMode = 'sideBySide' | 'comparison'
type ScaleType = '1x' | '2x' | '3x' | '4x'

// Phase configuration for face enhancer
const PHASES = [
  { id: 'download', labelKey: 'freeTools.progress.downloading', weight: 0.2 },
  { id: 'loading', labelKey: 'freeTools.progress.loading', weight: 0.1 },
  { id: 'detect', labelKey: 'freeTools.faceEnhancer.detecting', weight: 0.1 },
  { id: 'enhance', labelKey: 'freeTools.faceEnhancer.enhancing', weight: 0.6 }
]

export function FaceEnhancerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { resetPage } = useContext(PageResetContext)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragCounterRef = useRef(0)

  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [enhancedImage, setEnhancedImage] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [originalSize, setOriginalSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [faceCount, setFaceCount] = useState<number>(0)
  const [scale, setScale] = useState<ScaleType>('1x')
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpeg' | 'webp'>(
    'jpeg'
  )
  const [enhancedSize, setEnhancedSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [showBackWarning, setShowBackWarning] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('sideBySide')
  const [sliderPosition, setSliderPosition] = useState(50)
  const comparisonRef = useRef<HTMLDivElement>(null)
  const isDraggingSlider = useRef(false)

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

  const { initModel, enhance, dispose, hasFailed, retryWorker } = useFaceEnhancerWorker({
    onPhase: (phase) => {
      if (phase === 'download') {
        startPhase('download')
      } else if (phase === 'loading') {
        startPhase('loading')
      } else if (phase === 'detect') {
        startPhase('detect')
      } else if (phase === 'enhance') {
        startPhase('enhance')
      }
    },
    onProgress: (phase, progressValue, detail) => {
      const phaseId =
        phase === 'download'
          ? 'download'
          : phase === 'loading'
            ? 'loading'
            : phase === 'detect'
              ? 'detect'
              : 'enhance'
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
      resetPage(location.pathname)
      navigate('/free-tools')
    }
  }, [isProcessing, dispose, resetPage, location.pathname, navigate])

  const handleConfirmBack = useCallback(() => {
    setShowBackWarning(false)
    dispose()
    resetPage(location.pathname)
    navigate('/free-tools')
  }, [dispose, resetPage, location.pathname, navigate])

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return

      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        setError(null)
        setOriginalImage(dataUrl)
        setEnhancedImage(null)
        setEnhancedSize(null)
        setFaceCount(0)
        resetProgress()

        // Get original dimensions
        const img = new Image()
        img.onload = () => {
          setOriginalSize({ width: img.width, height: img.height })
        }
        img.src = dataUrl
      }
      reader.readAsDataURL(file)
    },
    [resetProgress]
  )

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

  // Comparison slider handlers
  const handleSliderMove = useCallback((clientX: number) => {
    if (!comparisonRef.current) return
    const rect = comparisonRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setSliderPosition(percentage)
  }, [])

  const handleSliderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingSlider.current = true
      handleSliderMove(e.clientX)

      const handleMouseMove = (e: MouseEvent) => {
        if (isDraggingSlider.current) {
          handleSliderMove(e.clientX)
        }
      }

      const handleMouseUp = () => {
        isDraggingSlider.current = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [handleSliderMove]
  )

  const handleSliderTouchStart = useCallback(
    (e: React.TouchEvent) => {
      isDraggingSlider.current = true
      handleSliderMove(e.touches[0].clientX)

      const handleTouchMove = (e: TouchEvent) => {
        if (isDraggingSlider.current) {
          handleSliderMove(e.touches[0].clientX)
        }
      }

      const handleTouchEnd = () => {
        isDraggingSlider.current = false
        document.removeEventListener('touchmove', handleTouchMove)
        document.removeEventListener('touchend', handleTouchEnd)
      }

      document.addEventListener('touchmove', handleTouchMove)
      document.addEventListener('touchend', handleTouchEnd)
    },
    [handleSliderMove]
  )

  const handleEnhance = async () => {
    if (!originalImage || !originalSize || !canvasRef.current) return

    setIsProcessing(true)
    setError(null)
    resetAndStart('download')

    try {
      // Initialize models (cached after first download)
      await initModel()

      // Create source image
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = originalImage
      })

      // Calculate output size based on scale
      const scaleFactor = parseInt(scale)
      const outputWidth = originalSize.width * scaleFactor
      const outputHeight = originalSize.height * scaleFactor

      // Upscale image first (before face enhancement) for better face quality
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = outputWidth
      tempCanvas.height = outputHeight
      const tempCtx = tempCanvas.getContext('2d')!
      tempCtx.imageSmoothingEnabled = true
      tempCtx.imageSmoothingQuality = 'high'
      tempCtx.drawImage(img, 0, 0, outputWidth, outputHeight)
      const imageData = tempCtx.getImageData(0, 0, outputWidth, outputHeight)

      // Enhance faces on the upscaled image
      const { dataUrl, faces } = await enhance(imageData)

      setFaceCount(faces)
      setEnhancedSize({ width: outputWidth, height: outputHeight })

      if (faces === 0) {
        // No faces detected - show warning but still update
        setError(t('freeTools.faceEnhancer.noFaces'))
      }

      // Set the enhanced image
      setEnhancedImage(dataUrl)

      // Also draw to canvas for download format conversion
      const canvas = canvasRef.current
      canvas.width = outputWidth
      canvas.height = outputHeight
      const ctx = canvas.getContext('2d')!
      const resultImg = new Image()
      await new Promise<void>((resolve) => {
        resultImg.onload = () => {
          ctx.drawImage(resultImg, 0, 0)
          resolve()
        }
        resultImg.src = dataUrl
      })

      completeAllPhases()
    } catch (error) {
      console.error('Enhancement failed:', error)
      setError(error instanceof Error ? error.message : 'Enhancement failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = () => {
    if (!enhancedImage || !canvasRef.current) return

    // Get canvas and convert to selected format
    const canvas = canvasRef.current
    const mimeType = `image/${downloadFormat}`
    const quality = downloadFormat === 'png' ? undefined : 0.95
    const dataUrl = canvas.toDataURL(mimeType, quality)

    const link = document.createElement('a')
    link.href = dataUrl
    link.download = generateFreeToolFilename('face-enhancer', downloadFormat)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div
      className="p-8 relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Drag overlay for inner page */}
      {isDragging && originalImage && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-4">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium">
              {t('freeTools.faceEnhancer.orDragDrop')}
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
            {t('freeTools.faceEnhancer.title')}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('freeTools.faceEnhancer.description')}
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
              {t('freeTools.faceEnhancer.selectImage')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('freeTools.faceEnhancer.orDragDrop')}
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
              {t('freeTools.faceEnhancer.selectImage')}
            </Button>

            <Select
              value={scale}
              onValueChange={(v) => setScale(v as ScaleType)}
              disabled={isProcessing}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1x">1x</SelectItem>
                <SelectItem value="2x">2x</SelectItem>
                <SelectItem value="3x">3x</SelectItem>
                <SelectItem value="4x">4x</SelectItem>
              </SelectContent>
            </Select>

            <Button
              onClick={handleEnhance}
              disabled={isProcessing}
              className="gradient-bg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('freeTools.faceEnhancer.processing')}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t('freeTools.faceEnhancer.enhance')}
                </>
              )}
            </Button>
            {enhancedImage && (
              <>
                {/* Face count badge */}
                {faceCount > 0 && (
                  <span className="text-sm text-muted-foreground px-2 py-1 bg-muted rounded">
                    {t('freeTools.faceEnhancer.facesFound', { count: faceCount })}
                  </span>
                )}

                {/* View mode toggle */}
                <div className="flex rounded-md border">
                  <Button
                    variant={viewMode === 'sideBySide' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="rounded-r-none border-0"
                    onClick={() => setViewMode('sideBySide')}
                    title={t('freeTools.faceEnhancer.sideBySide')}
                  >
                    <Columns2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'comparison' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="rounded-l-none border-0"
                    onClick={() => setViewMode('comparison')}
                    title={t('freeTools.faceEnhancer.comparison')}
                  >
                    <SplitSquareHorizontal className="h-4 w-4" />
                  </Button>
                </div>

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
                    <SelectItem value="jpeg">JPEG</SelectItem>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="webp">WebP</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  {t('freeTools.faceEnhancer.download')}
                </Button>
              </>
            )}
          </div>

          {/* Progress display */}
          <ProcessingProgress
            progress={progress}
            showPhases={true}
            showOverall={true}
            showEta={true}
          />

          {/* Error with retry button */}
          {error && hasFailed() && !isProcessing && (
            <div className="flex items-center justify-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <span className="text-sm text-destructive">{error}</span>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.retry')}
              </Button>
            </div>
          )}

          {/* No faces warning (non-fatal) */}
          {error && error === t('freeTools.faceEnhancer.noFaces') && !isProcessing && (
            <div className="flex items-center justify-center gap-3 p-4 bg-warning/10 border border-warning/20 rounded-lg">
              <span className="text-sm text-warning-foreground">{error}</span>
            </div>
          )}

          {/* Preview area */}
          {viewMode === 'sideBySide' || !enhancedImage ? (
            /* Side by side preview */
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Original */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">
                      {t('freeTools.faceEnhancer.original')}
                    </span>
                    {originalSize && (
                      <span className="text-xs text-muted-foreground">
                        {originalSize.width} x {originalSize.height}
                      </span>
                    )}
                  </div>
                  <div className="relative bg-muted rounded-lg">
                    <img
                      src={originalImage}
                      alt="Original"
                      className="w-full max-h-[70vh] object-contain cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setPreviewImage(originalImage)}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Enhanced */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">
                      {t('freeTools.faceEnhancer.enhanced')}
                    </span>
                    {enhancedSize && enhancedImage && (
                      <span className="text-xs text-muted-foreground">
                        {enhancedSize.width} x {enhancedSize.height}
                      </span>
                    )}
                  </div>
                  <div className="relative bg-muted rounded-lg" style={{ minHeight: enhancedImage ? undefined : '200px' }}>
                    {enhancedImage ? (
                      <img
                        src={enhancedImage}
                        alt="Enhanced"
                        className="w-full max-h-[70vh] object-contain cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setPreviewImage(enhancedImage)}
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        {isProcessing ? (
                          <>
                            <Loader2 className="h-8 w-8 animate-spin mb-2" />
                            <span className="text-sm">
                              {t('freeTools.faceEnhancer.processing')}
                            </span>
                          </>
                        ) : (
                          <span className="text-sm">—</span>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            /* Comparison slider view */
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium">
                      {t('freeTools.faceEnhancer.original')}
                    </span>
                    <span className="text-xs text-muted-foreground">←</span>
                    <span className="text-xs text-muted-foreground">
                      {t('freeTools.faceEnhancer.dragToCompare')}
                    </span>
                    <span className="text-xs text-muted-foreground">→</span>
                    <span className="text-sm font-medium">
                      {t('freeTools.faceEnhancer.enhanced')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {originalSize && (
                      <span>{originalSize.width} x {originalSize.height}</span>
                    )}
                    {enhancedSize && enhancedSize.width !== originalSize?.width && (
                      <span>→ {enhancedSize.width} x {enhancedSize.height}</span>
                    )}
                  </div>
                </div>
                <div
                  ref={comparisonRef}
                  className="relative bg-muted rounded-lg overflow-hidden cursor-ew-resize select-none"
                  onMouseDown={handleSliderMouseDown}
                  onTouchStart={handleSliderTouchStart}
                >
                  {/* Enhanced image (full, background) */}
                  <img
                    src={enhancedImage}
                    alt="Enhanced"
                    className="w-full max-h-[70vh] object-contain pointer-events-none"
                    draggable={false}
                  />

                  {/* Original image (clipped using clip-path) */}
                  <img
                    src={originalImage}
                    alt="Original"
                    className="absolute inset-0 w-full max-h-[70vh] object-contain pointer-events-none"
                    style={{
                      clipPath: `inset(0 ${100 - sliderPosition}% 0 0)`
                    }}
                    draggable={false}
                  />

                  {/* Slider handle */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white cursor-ew-resize"
                    style={{
                      left: `${sliderPosition}%`,
                      transform: 'translateX(-50%)',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.3), 0 0 8px rgba(0,0,0,0.5)'
                    }}
                  >
                    {/* Handle grip */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center border border-gray-200">
                      <div className="flex gap-1">
                        <div className="w-0.5 h-5 bg-gray-400 rounded-full" />
                        <div className="w-0.5 h-5 bg-gray-400 rounded-full" />
                      </div>
                    </div>
                  </div>

                  {/* Labels */}
                  <div className="absolute bottom-3 left-3 px-2 py-1 bg-black/60 text-white text-xs rounded">
                    {t('freeTools.faceEnhancer.original')}
                  </div>
                  <div className="absolute bottom-3 right-3 px-2 py-1 bg-black/60 text-white text-xs rounded">
                    {t('freeTools.faceEnhancer.enhanced')}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Fullscreen Preview Dialog */}
      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
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
