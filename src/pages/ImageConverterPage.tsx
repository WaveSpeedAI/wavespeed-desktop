import { useState, useRef, useCallback, useContext } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { PageResetContext } from '@/components/layout/Layout'
import { useTranslation } from 'react-i18next'
import { useFFmpegWorker } from '@/hooks/useFFmpegWorker'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { ProcessingProgress } from '@/components/shared/ProcessingProgress'
import { IMAGE_FORMATS, getImageFormat } from '@/lib/ffmpegFormats'
import { formatBytes } from '@/types/progress'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
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
  FileImage,
  X,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImageFile {
  id: string
  file: File
  preview: string
  size: { width: number; height: number } | null
}

interface ConvertedImage {
  id: string
  blob: Blob
  url: string
  filename: string
}

// Phase configuration for image converter
const PHASES = [
  { id: 'download', labelKey: 'freeTools.ffmpeg.loading', weight: 0.1 },
  { id: 'process', labelKey: 'freeTools.ffmpeg.converting', weight: 0.9 }
]

export function ImageConverterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { resetPage } = useContext(PageResetContext)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  const [images, setImages] = useState<ImageFile[]>([])
  const [convertedImages, setConvertedImages] = useState<ConvertedImage[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [outputFormat, setOutputFormat] = useState('jpg')
  const [quality, setQuality] = useState(95)
  const [error, setError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
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

  const { convert, hasFailed, retryWorker } = useFFmpegWorker({
    onPhase: (phase) => {
      if (phase === 'download') {
        startPhase('download')
      } else if (phase === 'process') {
        startPhase('process')
      }
    },
    onProgress: (phase, progressValue, detail) => {
      const phaseId = phase === 'download' ? 'download' : 'process'
      // Adjust progress for batch processing
      const batchProgress = ((currentIndex + progressValue / 100) / images.length) * 100
      updatePhase(phaseId, phaseId === 'process' ? batchProgress : progressValue, detail)
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
      resetPage(location.pathname)
      navigate('/free-tools')
    }
  }, [isProcessing, resetPage, location.pathname, navigate])

  const handleConfirmBack = useCallback(() => {
    setShowBackWarning(false)
    resetPage(location.pathname)
    navigate('/free-tools')
  }, [resetPage, location.pathname, navigate])

  const handleFileSelect = useCallback((files: FileList | File[]) => {
    setError(null)
    const newImages: ImageFile[] = []

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return

      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const preview = URL.createObjectURL(file)

      const img = new Image()
      img.onload = () => {
        setImages((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, size: { width: img.width, height: img.height } } : item
          )
        )
      }
      img.src = preview

      newImages.push({ id, file, preview, size: null })
    })

    setImages((prev) => [...prev, ...newImages])
    setConvertedImages([])
    resetProgress()
  }, [resetProgress])

  const handleRemoveImage = useCallback((id: string) => {
    setImages((prev) => {
      const image = prev.find((img) => img.id === id)
      if (image) URL.revokeObjectURL(image.preview)
      return prev.filter((img) => img.id !== id)
    })
    setConvertedImages((prev) => {
      const converted = prev.find((img) => img.id === id)
      if (converted) URL.revokeObjectURL(converted.url)
      return prev.filter((img) => img.id !== id)
    })
  }, [])

  const handleClearAll = useCallback(() => {
    images.forEach((img) => URL.revokeObjectURL(img.preview))
    convertedImages.forEach((img) => URL.revokeObjectURL(img.url))
    setImages([])
    setConvertedImages([])
    resetProgress()
  }, [images, convertedImages, resetProgress])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragging(false)
      if (isProcessing) return
      if (e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files)
      }
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

  const handleConvert = async () => {
    if (images.length === 0) return

    setIsProcessing(true)
    setError(null)
    setConvertedImages([])
    resetAndStart('download')

    const format = getImageFormat(outputFormat)
    if (!format) return

    const results: ConvertedImage[] = []

    try {
      for (let i = 0; i < images.length; i++) {
        setCurrentIndex(i)
        const image = images[i]

        // Read file as ArrayBuffer
        const arrayBuffer = await image.file.arrayBuffer()

        // Convert using FFmpeg worker
        const result = await convert(
          arrayBuffer,
          image.file.name,
          outputFormat,
          format.ext,
          format.supportsQuality ? { quality } : undefined
        )

        // Create blob and URL
        const blob = new Blob([result.data], { type: format.mimeType })
        const url = URL.createObjectURL(blob)
        const filename = image.file.name.replace(/\.[^.]+$/, `.${format.ext}`)

        results.push({ id: image.id, blob, url, filename })
      }

      setConvertedImages(results)
      completeAllPhases()
    } catch (err) {
      console.error('Conversion failed:', err)
      setError(err instanceof Error ? err.message : 'Conversion failed')
    } finally {
      setIsProcessing(false)
      setCurrentIndex(0)
    }
  }

  const handleDownload = (converted: ConvertedImage) => {
    const link = document.createElement('a')
    link.href = converted.url
    link.download = converted.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleDownloadAll = async () => {
    // For multiple files, download each one with a small delay
    for (const converted of convertedImages) {
      handleDownload(converted)
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  const selectedFormat = getImageFormat(outputFormat)

  return (
    <div
      className="p-8 relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Drag overlay */}
      {isDragging && images.length > 0 && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-4">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium">{t('freeTools.imageConverter.dropToAdd')}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t('freeTools.imageConverter.title')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('freeTools.imageConverter.description')}
          </p>
        </div>
      </div>

      {/* Upload area */}
      {images.length === 0 && (
        <Card
          className={cn(
            'border-2 border-dashed cursor-pointer transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50'
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium">{t('freeTools.imageConverter.selectImages')}</p>
            <p className="text-sm text-muted-foreground">
              {t('freeTools.imageConverter.orDragDrop')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t('freeTools.imageConverter.supportedFormats')}
            </p>
          </CardContent>
        </Card>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFileSelect(e.target.files)
          e.target.value = ''
        }}
      />

      {/* Image list and controls */}
      {images.length > 0 && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.imageConverter.addMore')}
            </Button>

            <Select
              value={outputFormat}
              onValueChange={setOutputFormat}
              disabled={isProcessing}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_FORMATS.map((format) => (
                  <SelectItem key={format.id} value={format.id}>
                    {format.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedFormat?.supportsQuality && (
              <div className="flex items-center gap-3">
                <Label className="text-sm whitespace-nowrap">
                  {t('freeTools.imageConverter.quality')}: {quality}%
                </Label>
                <Slider
                  value={[quality]}
                  onValueChange={([v]) => setQuality(v)}
                  min={1}
                  max={100}
                  step={1}
                  className="w-32"
                  disabled={isProcessing}
                />
              </div>
            )}

            <Button
              onClick={handleConvert}
              disabled={isProcessing || images.length === 0}
              className="gradient-bg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('freeTools.imageConverter.converting')} ({currentIndex + 1}/{images.length})
                </>
              ) : (
                <>
                  <FileImage className="h-4 w-4 mr-2" />
                  {t('freeTools.imageConverter.convert')} ({images.length})
                </>
              )}
            </Button>

            {convertedImages.length > 1 && (
              <Button variant="outline" onClick={handleDownloadAll}>
                <Download className="h-4 w-4 mr-2" />
                {t('freeTools.imageConverter.downloadAll')}
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearAll}
              disabled={isProcessing}
              className="ml-auto"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
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

          {/* Image grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {images.map((image) => {
              const converted = convertedImages.find((c) => c.id === image.id)
              return (
                <Card key={image.id} className="overflow-hidden group relative">
                  <CardContent className="p-0">
                    <div className="aspect-square relative bg-muted">
                      <img
                        src={converted?.url || image.preview}
                        alt={image.file.name}
                        className="w-full h-full object-cover"
                      />
                      {/* Remove button */}
                      <Button
                        variant="secondary"
                        size="icon"
                        className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleRemoveImage(image.id)}
                        disabled={isProcessing}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                      {/* Converted indicator */}
                      {converted && (
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-full h-7 text-xs"
                            onClick={() => handleDownload(converted)}
                          >
                            <Download className="h-3 w-3 mr-1" />
                            {t('common.download')}
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="p-2 space-y-1">
                      <p className="text-xs font-medium truncate" title={image.file.name}>
                        {image.file.name}
                      </p>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{formatBytes(image.file.size)}</span>
                        {image.size && (
                          <span>
                            {image.size.width}x{image.size.height}
                          </span>
                        )}
                      </div>
                      {converted && (
                        <p className="text-xs text-green-600 dark:text-green-400">
                          → {formatBytes(converted.blob.size)}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

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
