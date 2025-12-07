import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUpscalerWorker } from '@/hooks/useUpscalerWorker'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ArrowLeft, Upload, Download, Loader2, ImageUp, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ModelType = 'slim' | 'medium' | 'thick'
type ScaleType = '2x' | '3x' | '4x'

export function ImageEnhancerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragCounterRef = useRef(0)
  const startTimeRef = useRef<number>(0)

  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [enhancedImage, setEnhancedImage] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingModel, setIsLoadingModel] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null)
  const [enhancedSize, setEnhancedSize] = useState<{ width: number; height: number } | null>(null)
  const [model, setModel] = useState<ModelType>('slim')
  const [scale, setScale] = useState<ScaleType>('2x')
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpeg' | 'webp'>('jpeg')
  const [showPreview, setShowPreview] = useState(false)
  const [eta, setEta] = useState<string | null>(null)

  const { loadModel, upscale, dispose } = useUpscalerWorker({
    onProgress: (percent) => {
      setProgress(percent * 0.95)
      // Calculate ETA
      if (percent > 0.05) {
        const elapsed = Date.now() - startTimeRef.current
        const totalEstimated = elapsed / percent
        const remainingMs = totalEstimated - elapsed
        const remainingSec = Math.ceil(remainingMs / 1000)
        if (remainingSec >= 60) {
          const mins = Math.floor(remainingSec / 60)
          const secs = remainingSec % 60
          setEta(`${mins}m ${secs}s`)
        } else if (remainingSec > 0) {
          setEta(`${remainingSec}s`)
        }
      }
    },
    onStatus: (status) => {
      if (status === 'downloading') {
        setStatusText(t('freeTools.imageEnhancer.downloadingModel'))
      }
    },
    onError: (error) => {
      console.error('Worker error:', error)
      setStatusText(`Error: ${error}`)
      setIsProcessing(false)
      setIsLoadingModel(false)
      setEta(null)
    }
  })

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setOriginalImage(dataUrl)
      setEnhancedImage(null)
      setEnhancedSize(null)
      setProgress(0)
      setStatusText('')

      // Get original dimensions
      const img = new Image()
      img.onload = () => {
        setOriginalSize({ width: img.width, height: img.height })
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragging(false)
    if (isProcessing || isLoadingModel) return
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect, isProcessing, isLoadingModel])

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

  const handleEnhance = async () => {
    if (!originalImage || !originalSize || !canvasRef.current) return

    setIsLoadingModel(true)
    setProgress(0)
    setStatusText(t('freeTools.imageEnhancer.loadingModel'))
    setEta(null)

    try {
      // Load the selected model in worker
      await loadModel(model, scale)

      setIsLoadingModel(false)
      setIsProcessing(true)
      setStatusText(t('freeTools.imageEnhancer.processing'))
      startTimeRef.current = Date.now()

      // Create source image and get ImageData
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = originalImage
      })

      // Draw to canvas to get ImageData
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = img.width
      tempCanvas.height = img.height
      const tempCtx = tempCanvas.getContext('2d')!
      tempCtx.drawImage(img, 0, 0)
      const imageData = tempCtx.getImageData(0, 0, img.width, img.height)

      // Upscale in worker
      const upscaledDataUrl = await upscale(imageData)

      setProgress(95)

      // Get scale multiplier
      const scaleMultiplier = parseInt(scale.replace('x', ''))

      // Set the enhanced image
      setEnhancedImage(upscaledDataUrl)
      setEnhancedSize({
        width: originalSize.width * scaleMultiplier,
        height: originalSize.height * scaleMultiplier
      })

      // Also draw to canvas for download format conversion
      const canvas = canvasRef.current
      canvas.width = originalSize.width * scaleMultiplier
      canvas.height = originalSize.height * scaleMultiplier
      const ctx = canvas.getContext('2d')!
      const resultImg = new Image()
      await new Promise<void>((resolve) => {
        resultImg.onload = () => {
          ctx.drawImage(resultImg, 0, 0)
          resolve()
        }
        resultImg.src = upscaledDataUrl
      })

      setProgress(100)
      setStatusText(t('freeTools.imageEnhancer.complete'))
      setEta(null)

    } catch (error) {
      console.error('Enhancement failed:', error)
      setStatusText(`Error: ${(error as Error).message}`)
      setEta(null)
    } finally {
      setIsProcessing(false)
      setIsLoadingModel(false)
      dispose()
    }
  }

  const handleDownload = () => {
    if (!enhancedImage || !canvasRef.current) return

    // Get canvas and convert to selected format
    const canvas = canvasRef.current
    const mimeType = `image/${downloadFormat}`
    const quality = downloadFormat === 'jpeg' ? 0.95 : undefined
    const dataUrl = canvas.toDataURL(mimeType, quality)

    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `enhanced-image-${Date.now()}.${downloadFormat}`
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
            <p className="text-lg font-medium">{t('freeTools.imageEnhancer.orDragDrop')}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/free-tools')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t('freeTools.imageEnhancer.title')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('freeTools.imageEnhancer.description')}
          </p>
        </div>
      </div>

      {/* Upload area */}
      {!originalImage && (
        <Card
          className={cn(
            "border-2 border-dashed cursor-pointer transition-colors",
            isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
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
            <p className="text-lg font-medium">{t('freeTools.imageEnhancer.selectImage')}</p>
            <p className="text-sm text-muted-foreground">{t('freeTools.imageEnhancer.orDragDrop')}</p>
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
              disabled={isProcessing || isLoadingModel}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.imageEnhancer.selectImage')}
            </Button>

            <Select value={model} onValueChange={(v) => setModel(v as ModelType)} disabled={isProcessing || isLoadingModel}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="slim">
                  {t('freeTools.imageEnhancer.modelFast')}
                </SelectItem>
                <SelectItem value="medium">
                  {t('freeTools.imageEnhancer.modelBalanced')}
                </SelectItem>
                <SelectItem value="thick">
                  {t('freeTools.imageEnhancer.modelQuality')}
                </SelectItem>
              </SelectContent>
            </Select>

            <Select value={scale} onValueChange={(v) => setScale(v as ScaleType)} disabled={isProcessing || isLoadingModel}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2x">2x</SelectItem>
                <SelectItem value="3x">3x</SelectItem>
                <SelectItem value="4x">4x</SelectItem>
              </SelectContent>
            </Select>

            <Button
              onClick={handleEnhance}
              disabled={isProcessing || isLoadingModel}
              className="gradient-bg"
            >
              {isProcessing || isLoadingModel ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('freeTools.imageEnhancer.processing')}
                </>
              ) : (
                <>
                  <ImageUp className="h-4 w-4 mr-2" />
                  {t('freeTools.imageEnhancer.enhance')}
                </>
              )}
            </Button>
            {enhancedImage && (
              <>
                <Select value={downloadFormat} onValueChange={(v) => setDownloadFormat(v as 'png' | 'jpeg' | 'webp')}>
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
                  {t('freeTools.imageEnhancer.download')}
                </Button>
              </>
            )}
          </div>

          {/* Progress bar */}
          {(isProcessing || isLoadingModel || progress > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  {(isProcessing || isLoadingModel) && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {statusText}
                  {eta && isProcessing && (
                    <span className="text-muted-foreground/70">
                      ({t('freeTools.imageEnhancer.eta', { time: eta })})
                    </span>
                  )}
                </span>
                <span className="font-medium">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* Side by side preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Original */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">{t('freeTools.imageEnhancer.original')}</span>
                  {originalSize && (
                    <span className="text-xs text-muted-foreground">
                      {originalSize.width} x {originalSize.height}
                    </span>
                  )}
                </div>
                <div className="relative aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                  <img
                    src={originalImage}
                    alt="Original"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Enhanced */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">{t('freeTools.imageEnhancer.enhanced')}</span>
                  {enhancedSize && (
                    <span className="text-xs text-muted-foreground">
                      {enhancedSize.width} x {enhancedSize.height}
                    </span>
                  )}
                </div>
                <div className="relative aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                  {enhancedImage ? (
                    <img
                      src={enhancedImage}
                      alt="Enhanced"
                      className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setShowPreview(true)}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      {isProcessing || isLoadingModel ? (
                        <>
                          <Loader2 className="h-8 w-8 animate-spin mb-2" />
                          <span className="text-sm">{statusText}</span>
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
        </div>
      )}

      {/* Fullscreen Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="w-screen h-screen max-w-none max-h-none p-0 border-0 bg-black flex items-center justify-center" hideCloseButton>
          <DialogTitle className="sr-only">Fullscreen Preview</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20 h-10 w-10 [filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))_drop-shadow(0_0_4px_rgba(0,0,0,0.5))]"
            onClick={() => setShowPreview(false)}
          >
            <X className="h-6 w-6" />
          </Button>
          {enhancedImage && (
            <img
              src={enhancedImage}
              alt="Fullscreen preview"
              className="max-w-full max-h-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
