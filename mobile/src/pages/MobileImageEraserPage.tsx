import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { generateFreeToolFilename } from '@/stores/assetsStore'
import { useImageEraserWorker } from '@/hooks/useImageEraserWorker'
import { useMobileDownload } from '@mobile/hooks/useMobileDownload'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { ProcessingProgress } from '@/components/shared/ProcessingProgress'
import {
  canvasToFloat32Array,
  maskCanvasToFloat32Array,
  tensorToCanvas,
  canvasToBlob,
  getMaskBoundingBox,
  cropCanvas,
  pasteWithBlending,
  addReflectPadding,
  addMaskReflectPadding
} from '@/lib/lamaUtils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  Eraser,
  Paintbrush,
  Undo2,
  Trash2,
  RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Tool = 'brush' | 'eraser'

// Phase configuration for image eraser
const PHASES = [
  { id: 'download', labelKey: 'freeTools.progress.downloading', weight: 0.1 },
  { id: 'loading', labelKey: 'freeTools.progress.loading', weight: 0.1 },
  { id: 'process', labelKey: 'freeTools.progress.processing', weight: 0.8 }
]

export function MobileImageEraserPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { downloadFromDataUrl } = useMobileDownload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const imageCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const resultCanvasRef = useRef<HTMLCanvasElement>(null)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)

  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null)
  const [resultImage, setResultImage] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 300 })
  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 300, height: 400 })
  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(40)
  const [maskHistory, setMaskHistory] = useState<ImageData[]>([])
  const [maskHistoryIndex, setMaskHistoryIndex] = useState(-1)
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpeg' | 'webp'>('jpeg')

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

  const { initModel, removeObjects, dispose, hasFailed, retryWorker } = useImageEraserWorker({
    onPhase: (phase) => {
      if (phase === 'download') {
        startPhase('download')
      } else if (phase === 'loading') {
        startPhase('loading')
      } else if (phase === 'process') {
        startPhase('process')
      }
    },
    onProgress: (phase, progressValue, detail) => {
      const phaseId = phase === 'download' ? 'download' : phase === 'loading' ? 'loading' : 'process'
      updatePhase(phaseId, progressValue, detail)
    },
    onReady: () => {
      setError(null)
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

  // Measure available container size on mount and window resize (same as MobileSegmentAnythingPage)
  useEffect(() => {
    const updateContainerSize = () => {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const availableWidth = Math.min(viewportWidth - 32, 500)
      const availableHeight = Math.max(300, viewportHeight - 400)
      setContainerSize({ width: availableWidth, height: availableHeight })
    }

    updateContainerSize()
    window.addEventListener('resize', updateContainerSize)
    return () => window.removeEventListener('resize', updateContainerSize)
  }, [])

  // Recalculate canvas size when container or image changes
  useEffect(() => {
    if (!loadedImage) return

    const imgWidth = loadedImage.width
    const imgHeight = loadedImage.height

    let width = imgWidth
    let height = imgHeight

    // Scale to fit container while maintaining aspect ratio
    if (width > containerSize.width) {
      height = (height * containerSize.width) / width
      width = containerSize.width
    }
    if (height > containerSize.height) {
      width = (width * containerSize.height) / height
      height = containerSize.height
    }

    setCanvasSize({ width: Math.round(width), height: Math.round(height) })
  }, [loadedImage, containerSize])

  // Draw loaded image to canvas at ORIGINAL resolution
  useEffect(() => {
    if (!loadedImage || !imageCanvasRef.current || !originalSize) return

    const imageCanvas = imageCanvasRef.current
    imageCanvas.width = originalSize.width
    imageCanvas.height = originalSize.height

    const ctx = imageCanvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    ctx.drawImage(loadedImage, 0, 0, originalSize.width, originalSize.height)
  }, [loadedImage, originalSize])

  // Initialize mask canvas when image loads
  useEffect(() => {
    if (!originalImage || !maskCanvasRef.current || !originalSize) return

    const maskCanvas = maskCanvasRef.current
    maskCanvas.width = originalSize.width
    maskCanvas.height = originalSize.height

    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
    if (!maskCtx) return

    maskCtx.clearRect(0, 0, originalSize.width, originalSize.height)

    const initialMaskState = maskCtx.getImageData(0, 0, originalSize.width, originalSize.height)
    setMaskHistory([initialMaskState])
    setMaskHistoryIndex(0)
  }, [originalImage, originalSize])

  // Save mask history snapshot
  const saveMaskSnapshot = useCallback(() => {
    const maskCanvas = maskCanvasRef.current
    const maskCtx = maskCanvas?.getContext('2d', { willReadFrequently: true })
    if (!maskCtx || !maskCanvas) return

    const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)

    setMaskHistory((prev) => {
      const newHistory = prev.slice(0, maskHistoryIndex + 1)
      newHistory.push(imageData)
      if (newHistory.length > 30) {
        newHistory.shift()
        return newHistory
      }
      return newHistory
    })
    setMaskHistoryIndex((prev) => Math.min(prev + 1, 29))
  }, [maskHistoryIndex])

  // Undo mask drawing
  const undoMask = useCallback(() => {
    if (maskHistoryIndex <= 0) return

    const newIndex = maskHistoryIndex - 1
    const maskCtx = maskCanvasRef.current?.getContext('2d', { willReadFrequently: true })
    if (!maskCtx || !maskHistory[newIndex]) return

    maskCtx.putImageData(maskHistory[newIndex], 0, 0)
    setMaskHistoryIndex(newIndex)
  }, [maskHistoryIndex, maskHistory])

  // Clear mask
  const clearMask = useCallback(() => {
    const maskCanvas = maskCanvasRef.current
    const maskCtx = maskCanvas?.getContext('2d', { willReadFrequently: true })
    if (!maskCtx || !maskCanvas) return

    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    saveMaskSnapshot()
  }, [saveMaskSnapshot])

  // Get coordinates relative to canvas from touch event
  const getTouchCoords = useCallback(
    (touch: React.Touch) => {
      const canvas = maskCanvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height

      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY
      }
    },
    []
  )

  // Draw at position
  const drawAt = useCallback(
    (x: number, y: number, lastX?: number, lastY?: number) => {
      const maskCanvas = maskCanvasRef.current
      const maskCtx = maskCanvas?.getContext('2d', { willReadFrequently: true })
      if (!maskCtx || !maskCanvas) return

      // Scale brush size from display to canvas coordinates
      const scaleRatio = maskCanvas.width / canvasSize.width
      const scaledBrushSize = brushSize * scaleRatio

      if (tool === 'eraser') {
        maskCtx.globalCompositeOperation = 'destination-out'
        maskCtx.fillStyle = 'rgba(0,0,0,1)'
        maskCtx.strokeStyle = 'rgba(0,0,0,1)'
      } else {
        maskCtx.globalCompositeOperation = 'source-over'
        maskCtx.fillStyle = 'rgba(255, 80, 80, 1)'
        maskCtx.strokeStyle = 'rgba(255, 80, 80, 1)'
      }

      maskCtx.lineWidth = scaledBrushSize
      maskCtx.lineCap = 'round'
      maskCtx.lineJoin = 'round'

      if (lastX !== undefined && lastY !== undefined) {
        maskCtx.beginPath()
        maskCtx.moveTo(lastX, lastY)
        maskCtx.lineTo(x, y)
        maskCtx.stroke()
      } else {
        maskCtx.beginPath()
        maskCtx.arc(x, y, scaledBrushSize / 2, 0, Math.PI * 2)
        maskCtx.fill()
      }

      maskCtx.globalCompositeOperation = 'source-over'
    },
    [tool, brushSize, canvasSize.width]
  )

  // Touch event handlers
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()

      if (isProcessing) return

      const touch = e.touches[0]
      if (!touch) return

      const coords = getTouchCoords(touch)
      if (!coords) return

      setIsDrawing(true)
      lastPosRef.current = coords
      drawAt(coords.x, coords.y)
    },
    [isProcessing, getTouchCoords, drawAt]
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()

      if (!isDrawing) return

      const touch = e.touches[0]
      if (!touch) return

      const coords = getTouchCoords(touch)
      if (!coords) return

      const lastPos = lastPosRef.current
      drawAt(coords.x, coords.y, lastPos?.x, lastPos?.y)
      lastPosRef.current = coords
    },
    [isDrawing, getTouchCoords, drawAt]
  )

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault()
      if (isDrawing) {
        setIsDrawing(false)
        lastPosRef.current = null
        saveMaskSnapshot()
      }
    },
    [isDrawing, saveMaskSnapshot]
  )

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return

      setError(null)
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        setOriginalImage(dataUrl)
        setResultImage(null)
        setLoadedImage(null)
        resetProgress()

        const img = new Image()
        img.onload = () => {
          setOriginalSize({ width: img.width, height: img.height })
          setLoadedImage(img)
        }
        img.src = dataUrl
      }
      reader.readAsDataURL(file)
    },
    [resetProgress]
  )

  const handleRemoveObjects = async () => {
    const imageCanvas = imageCanvasRef.current
    const maskCanvas = maskCanvasRef.current
    if (!imageCanvas || !maskCanvas) return

    const bbox = getMaskBoundingBox(maskCanvas)
    if (!bbox) {
      console.warn('No mask drawn')
      return
    }

    setIsProcessing(true)
    resetAndStart('download')

    try {
      await initModel()

      const croppedImage = cropCanvas(imageCanvas, bbox.x, bbox.y, bbox.width, bbox.height)
      const croppedMask = cropCanvas(maskCanvas, bbox.x, bbox.y, bbox.width, bbox.height)

      const padAmount = 32
      const padding = {
        top: bbox.y === 0 ? padAmount : 0,
        left: bbox.x === 0 ? padAmount : 0,
        bottom: originalSize && bbox.y + bbox.height >= originalSize.height ? padAmount : 0,
        right: originalSize && bbox.x + bbox.width >= originalSize.width ? padAmount : 0
      }
      const hasPadding = padding.top > 0 || padding.left > 0 || padding.bottom > 0 || padding.right > 0

      const processImage = hasPadding ? addReflectPadding(croppedImage, padding) : croppedImage
      const processMask = hasPadding ? addMaskReflectPadding(croppedMask, padding) : croppedMask

      const imageData = canvasToFloat32Array(processImage)
      const maskData = maskCanvasToFloat32Array(processMask)

      const result = await removeObjects(
        imageData,
        maskData,
        processImage.width,
        processImage.height
      )

      let resultCanvas = tensorToCanvas(result.data, result.width, result.height, true)

      if (hasPadding) {
        resultCanvas = cropCanvas(
          resultCanvas,
          padding.left,
          padding.top,
          bbox.width,
          bbox.height
        )
      }

      pasteWithBlending(imageCanvas, resultCanvas, croppedMask, bbox.x, bbox.y, 12)

      if (resultCanvasRef.current && originalSize) {
        resultCanvasRef.current.width = originalSize.width
        resultCanvasRef.current.height = originalSize.height
        const downloadCtx = resultCanvasRef.current.getContext('2d')
        if (downloadCtx) {
          downloadCtx.drawImage(imageCanvas, 0, 0)
        }
      }

      const blob = await canvasToBlob(imageCanvas)
      const resultUrl = URL.createObjectURL(blob)
      setResultImage(resultUrl)

      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
      if (maskCtx) {
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
        const initialState = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
        setMaskHistory([initialState])
        setMaskHistoryIndex(0)
      }

      completeAllPhases()
    } catch (error) {
      console.error('Object removal failed:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = async () => {
    const canvas = resultCanvasRef.current || imageCanvasRef.current
    if (!canvas) return

    const mimeType = `image/${downloadFormat}`
    const quality = downloadFormat === 'png' ? undefined : 0.95
    const dataUrl = canvas.toDataURL(mimeType, quality)

    const filename = generateFreeToolFilename('image-eraser', downloadFormat)
    await downloadFromDataUrl(dataUrl, filename)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      dispose()
    }
  }, [dispose])

  const canUndo = maskHistoryIndex > 0

  // Same layout structure as MobileSegmentAnythingPage
  return (
    <div className="p-4 h-full overflow-auto">
      {/* Hidden canvas for download */}
      <canvas ref={resultCanvasRef} className="hidden" />

      {/* Header with back button */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/free-tools')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t('freeTools.imageEraser.title')}</h1>
          <p className="text-muted-foreground text-xs">
            {t('freeTools.imageEraser.description')}
          </p>
        </div>
      </div>

      {/* Upload area */}
      {!originalImage && (
        <Card
          className="border-2 border-dashed cursor-pointer transition-colors border-muted-foreground/25 hover:border-primary/50"
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-base font-medium">{t('freeTools.imageEraser.selectImage')}</p>
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
          e.target.value = ''
        }}
      />

      {/* Editor area */}
      {originalImage && (
        <div className="flex flex-col gap-4">
          {/* Progress display */}
          {isProcessing && (
            <ProcessingProgress progress={progress} showPhases={true} showOverall={true} showEta={true} />
          )}

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

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded-lg">
            {/* Left: Tool selection */}
            <div className="flex items-center gap-1">
              <Button
                variant={tool === 'brush' ? 'default' : 'ghost'}
                size="icon"
                className="h-9 w-9"
                onClick={() => setTool('brush')}
                disabled={isProcessing}
                title={t('freeTools.imageEraser.brush')}
              >
                <Paintbrush className="h-4 w-4" />
              </Button>
              <Button
                variant={tool === 'eraser' ? 'default' : 'ghost'}
                size="icon"
                className="h-9 w-9"
                onClick={() => setTool('eraser')}
                disabled={isProcessing}
                title={t('freeTools.imageEraser.eraser')}
              >
                <Eraser className="h-4 w-4" />
              </Button>

              <div className="w-px h-6 bg-border mx-1" />

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={undoMask}
                disabled={isProcessing || !canUndo}
                title={t('freeTools.imageEraser.undo')}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={clearMask}
                disabled={isProcessing}
                title={t('freeTools.imageEraser.clear')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Right: Brush size */}
            <div className="flex items-center gap-2 flex-1 max-w-[140px]">
              <Slider
                value={[brushSize]}
                onValueChange={([v]) => setBrushSize(v)}
                min={10}
                max={150}
                step={5}
                disabled={isProcessing}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-6 text-right">{brushSize}</span>
            </div>
          </div>

          {/* Canvas area - same structure as MobileSegmentAnythingPage */}
          <Card>
            <CardContent className="p-3">
              <div
                ref={canvasContainerRef}
                className={cn(
                  'relative mx-auto bg-muted rounded-lg overflow-hidden touch-none',
                  loadedImage ? 'cursor-crosshair' : 'cursor-default'
                )}
                style={{
                  width: canvasSize.width,
                  height: canvasSize.height
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                {/* Background image canvas */}
                <canvas
                  ref={imageCanvasRef}
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    width: canvasSize.width,
                    height: canvasSize.height
                  }}
                />

                {/* Mask canvas */}
                <canvas
                  ref={maskCanvasRef}
                  className="absolute inset-0 pointer-events-none opacity-50"
                  style={{
                    width: canvasSize.width,
                    height: canvasSize.height
                  }}
                />

                {/* Processing overlay */}
                {isProcessing && (
                  <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.imageEraser.selectImage')}
            </Button>

            <Button
              onClick={handleRemoveObjects}
              disabled={isProcessing}
              className="gradient-bg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('freeTools.imageEraser.processing')}
                </>
              ) : (
                <>
                  <Eraser className="h-4 w-4 mr-2" />
                  {t('freeTools.imageEraser.removeObjects')}
                </>
              )}
            </Button>
          </div>

          {/* Download controls */}
          {resultImage && (
            <div className="flex items-center justify-center gap-2">
              <Select
                value={downloadFormat}
                onValueChange={(v) => setDownloadFormat(v as 'png' | 'jpeg' | 'webp')}
              >
                <SelectTrigger className="h-9 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jpeg">JPEG</SelectItem>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="webp">WebP</SelectItem>
                </SelectContent>
              </Select>

              <Button onClick={handleDownload} className="gradient-bg">
                <Download className="h-4 w-4 mr-2" />
                {t('common.download')}
              </Button>
            </div>
          )}

          {/* Instructions - Mobile friendly */}
          <div className="text-xs text-muted-foreground text-center">
            <p>{t('freeTools.imageEraser.hintMobile', 'Draw on the area you want to remove')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
