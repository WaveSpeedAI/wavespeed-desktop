import { useState, useRef, useCallback, useEffect, useContext } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { PageResetContext } from '@/components/layout/Layout'
import { useTranslation } from 'react-i18next'
import { useSegmentAnythingWorker, type MaskResult } from '@/hooks/useSegmentAnythingWorker'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { ProcessingProgress } from '@/components/shared/ProcessingProgress'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  Loader2,
  X,
  Trash2,
  Scissors,
  Star,
  RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { featherMask } from '@/lib/maskUtils'

// Phase configuration for segment anything
const PHASES = [
  { id: 'download', labelKey: 'freeTools.progress.downloading', weight: 0.3 },
  { id: 'process', labelKey: 'freeTools.progress.processing', weight: 0.7 }
]

// Mask overlay color (blue with transparency)
const MASK_COLOR = { r: 0, g: 114, b: 189, a: 255 }

interface Point {
  x: number // Normalized 0-1
  y: number // Normalized 0-1
  label: 0 | 1 // 0 = negative, 1 = positive
}

export function SegmentAnythingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { resetPage } = useContext(PageResetContext)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageContainerRef = useRef<HTMLDivElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const dragCounterRef = useRef(0)

  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDecoding, setIsDecoding] = useState(false)
  const [isEncoded, setIsEncoded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })
  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 })

  // Multi-mask mode: starts false (hover preview), becomes true after first click
  const [isMultiMaskMode, setIsMultiMaskMode] = useState(false)
  const [points, setPoints] = useState<Point[]>([])
  const lastDecodedPointRef = useRef<{ x: number; y: number } | null>(null)
  const pendingPointRef = useRef<Point | null>(null)
  const isHoveringRef = useRef(false)

  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpeg' | 'webp'>('png')
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [showBackWarning, setShowBackWarning] = useState(false)
  const [lastMaskResult, setLastMaskResult] = useState<MaskResult | null>(null)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

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

  const {
    segmentImage,
    decodeMask,
    reset: resetWorker,
    dispose,
    isSegmented,
    retryModel,
    hasFailed
  } = useSegmentAnythingWorker({
    onPhase: (phase) => {
      if (phase === 'download') {
        startPhase('download')
      } else if (phase === 'process') {
        startPhase('process')
      }
    },
    onProgress: (phase, progressValue, detail) => {
      const phaseId = phase === 'download' ? 'download' : 'process'
      updatePhase(phaseId, progressValue, detail)
    },
    onSegmented: () => {
      setIsEncoded(true)
      setIsProcessing(false)
      completeAllPhases()
    },
    onReady: () => {
      setError(null)
    },
    onError: (err) => {
      console.error('Worker error:', err)
      setError(err)
      setIsProcessing(false)
      setIsDecoding(false)
    }
  })

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

  // Measure available container size on mount and window resize
  useEffect(() => {
    const updateContainerSize = () => {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const availableWidth = Math.max(500, viewportWidth - 300)
      const availableHeight = Math.max(400, viewportHeight - 300)
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

  // Initialize mask canvas when image loads
  useEffect(() => {
    if (!originalSize || !maskCanvasRef.current) return

    const maskCanvas = maskCanvasRef.current
    maskCanvas.width = originalSize.width
    maskCanvas.height = originalSize.height

    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
    if (!maskCtx) return

    maskCtx.clearRect(0, 0, originalSize.width, originalSize.height)
  }, [originalSize])

  // Draw mask overlay on canvas
  const drawMask = useCallback(
    (result: MaskResult) => {
      const maskCanvas = maskCanvasRef.current
      if (!maskCanvas || !originalSize) return

      const ctx = maskCanvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return

      ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)

      const imageData = ctx.createImageData(result.width, result.height)
      const pixelData = imageData.data

      // Select mask with highest score
      const numMasks = result.scores.length
      let bestIndex = 0
      for (let i = 1; i < numMasks; i++) {
        if (result.scores[i] > result.scores[bestIndex]) bestIndex = i
      }

      const pixelsPerMask = result.width * result.height
      const maskOffset = bestIndex * pixelsPerMask

      for (let i = 0; i < pixelsPerMask; i++) {
        if (result.mask[maskOffset + i] === 1) {
          const offset = 4 * i
          pixelData[offset] = MASK_COLOR.r
          pixelData[offset + 1] = MASK_COLOR.g
          pixelData[offset + 2] = MASK_COLOR.b
          pixelData[offset + 3] = MASK_COLOR.a
        }
      }

      ctx.putImageData(imageData, 0, 0)
    },
    [originalSize]
  )

  // Decode mask function
  const decode = useCallback(async (pointsToUse: Point[], forMultiMask = false) => {
    if (!isEncoded || pointsToUse.length === 0) return
    if (isDecoding) {
      pendingPointRef.current = pointsToUse[0]
      return
    }

    setIsDecoding(true)
    lastDecodedPointRef.current = { x: pointsToUse[0].x, y: pointsToUse[0].y }
    try {
      const result = await decodeMask(
        pointsToUse.map((p) => ({
          point: [p.x, p.y] as [number, number],
          label: p.label
        }))
      )
      // Only draw if still hovering (for hover mode) or in multi-mask mode
      if (forMultiMask || isHoveringRef.current) {
        setLastMaskResult(result)
        drawMask(result)
      }
    } catch (error) {
      console.error('Decode error:', error)
    } finally {
      setIsDecoding(false)
      // Process pending point if cursor moved during decode
      const pending = pendingPointRef.current
      if (pending && isHoveringRef.current && (pending.x !== lastDecodedPointRef.current?.x || pending.y !== lastDecodedPointRef.current?.y)) {
        pendingPointRef.current = null
        decode([pending])
      }
    }
  }, [isEncoded, isDecoding, decodeMask, drawMask])

  // Clamp value between 0 and 1
  const clamp = (x: number) => Math.max(0, Math.min(1, x))

  // Get normalized coordinates from mouse event
  const getPoint = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): Point | null => {
      const container = imageContainerRef.current
      if (!container) return null

      const rect = container.getBoundingClientRect()
      const x = clamp((e.clientX - rect.left) / rect.width)
      const y = clamp((e.clientY - rect.top) / rect.height)

      // Right click = negative point (label 0), left click = positive (label 1)
      const label = e.button === 2 ? 0 : 1

      return { x, y, label: label as 0 | 1 }
    },
    []
  )

  // Handle mouse move - hover preview in single point mode
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      isHoveringRef.current = true
      const container = imageContainerRef.current
      if (container) {
        const rect = container.getBoundingClientRect()
        setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      }

      if (!isEncoded || isMultiMaskMode) return

      const point = getPoint(e)
      if (point) decode([point])
    },
    [isEncoded, isMultiMaskMode, getPoint, decode]
  )

  // Handle mouse down - add point and switch to multi-mask mode
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.button !== 2) return // Only left/right click
      if (!isEncoded) return

      const point = getPoint(e)
      if (!point) return

      const newPoints = isMultiMaskMode ? [...points, point] : [point]
      if (!isMultiMaskMode) setIsMultiMaskMode(true)
      setPoints(newPoints)
      decode(newPoints, true)
    },
    [isEncoded, isMultiMaskMode, points, getPoint, decode]
  )

  // Handle mouse leave - clear hover preview if not in multi-mask mode
  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false
    setCursorPos(null)
    if (!isMultiMaskMode) {
      pendingPointRef.current = null
      lastDecodedPointRef.current = null
      setLastMaskResult(null)
      if (maskCanvasRef.current) {
        const ctx = maskCanvasRef.current.getContext('2d')
        if (ctx) ctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height)
      }
    }
  }, [isMultiMaskMode])

  // Prevent context menu on right click
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  // Clear all points and reset to hover mode
  const clearPoints = useCallback(() => {
    setPoints([])
    setIsMultiMaskMode(false)
    lastDecodedPointRef.current = null
    pendingPointRef.current = null
    setLastMaskResult(null)
    const maskCanvas = maskCanvasRef.current
    if (maskCanvas) {
      const ctx = maskCanvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
      }
    }
  }, [])

  // Reset image (load new image)
  const resetImage = useCallback(async () => {
    setOriginalImage(null)
    setLoadedImage(null)
    setError(null)
    setIsEncoded(false)
    setIsMultiMaskMode(false)
    setPoints([])
    lastDecodedPointRef.current = null
    pendingPointRef.current = null
    setLastMaskResult(null)
    setOriginalSize(null)
    resetProgress()

    if (isSegmented()) {
      await resetWorker()
    }
  }, [resetProgress, resetWorker, isSegmented])

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return

      // Reset state
      await resetImage()

      const reader = new FileReader()
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string
        setOriginalImage(dataUrl)

        // Load image to get dimensions
        const img = new Image()
        img.onload = async () => {
          setOriginalSize({ width: img.width, height: img.height })
          setLoadedImage(img)

          // Automatically start encoding
          setIsProcessing(true)
          resetAndStart('download')

          try {
            await segmentImage(dataUrl)
          } catch (error) {
            console.error('Segmentation failed:', error)
            setIsProcessing(false)
          }
        }
        img.src = dataUrl
      }
      reader.readAsDataURL(file)
    },
    [resetImage, resetAndStart, segmentImage]
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

  // Cut out the masked region
  const handleCutOut = useCallback(async () => {
    if (!lastMaskResult || !loadedImage || !originalSize) return

    // Create canvas with original image
    const imageCanvas = document.createElement('canvas')
    imageCanvas.width = originalSize.width
    imageCanvas.height = originalSize.height
    const imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true })
    if (!imageCtx) return

    imageCtx.drawImage(loadedImage, 0, 0, originalSize.width, originalSize.height)
    const imageData = imageCtx.getImageData(0, 0, originalSize.width, originalSize.height)
    const imagePixels = imageData.data

    // Get mask data and apply feathering for smooth edges
    const maskCanvas = maskCanvasRef.current
    if (!maskCanvas) return

    // Apply feathering to create smooth edges (4px soft falloff)
    const featheredMask = featherMask(maskCanvas, 4)
    const featheredCtx = featheredMask.getContext('2d', { willReadFrequently: true })
    if (!featheredCtx) return
    const featheredData = featheredCtx.getImageData(0, 0, originalSize.width, originalSize.height)
    const featheredPixels = featheredData.data

    // Create output canvas with transparent background
    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = originalSize.width
    outputCanvas.height = originalSize.height
    const outputCtx = outputCanvas.getContext('2d')
    if (!outputCtx) return

    const outputData = outputCtx.createImageData(originalSize.width, originalSize.height)
    const outputPixels = outputData.data

    // Copy pixels with feathered alpha for smooth edges
    for (let i = 3; i < featheredPixels.length; i += 4) {
      const alpha = featheredPixels[i]
      if (alpha > 0) {
        // Copy RGB from image to output
        outputPixels[i - 3] = imagePixels[i - 3] // R
        outputPixels[i - 2] = imagePixels[i - 2] // G
        outputPixels[i - 1] = imagePixels[i - 1] // B
        outputPixels[i] = alpha                   // Use feathered alpha for smooth edges
      }
    }

    outputCtx.putImageData(outputData, 0, 0)

    // Download
    const mimeType = downloadFormat === 'jpeg' ? 'image/jpeg' : `image/${downloadFormat}`
    const quality = downloadFormat === 'png' ? undefined : 0.95

    // For JPEG, we need a white background since it doesn't support transparency
    if (downloadFormat === 'jpeg') {
      const jpegCanvas = document.createElement('canvas')
      jpegCanvas.width = originalSize.width
      jpegCanvas.height = originalSize.height
      const jpegCtx = jpegCanvas.getContext('2d')
      if (jpegCtx) {
        jpegCtx.fillStyle = 'white'
        jpegCtx.fillRect(0, 0, originalSize.width, originalSize.height)
        jpegCtx.drawImage(outputCanvas, 0, 0)
        const dataUrl = jpegCanvas.toDataURL(mimeType, quality)
        downloadImage(dataUrl)
      }
    } else {
      const dataUrl = outputCanvas.toDataURL(mimeType, quality)
      downloadImage(dataUrl)
    }
  }, [lastMaskResult, loadedImage, originalSize, downloadFormat])

  const downloadImage = (dataUrl: string) => {
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `segment-${Date.now()}.${downloadFormat}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Handle retry when model download fails
  const handleRetry = useCallback(async () => {
    setError(null)
    setIsProcessing(true)
    resetAndStart('download')
    try {
      await retryModel()
      // Re-process the current image if we have one
      if (originalImage) {
        await segmentImage(originalImage)
      }
    } catch (err) {
      console.error('Retry failed:', err)
    }
  }, [retryModel, resetAndStart, originalImage, segmentImage])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      dispose()
    }
  }, [dispose])

  const canCut = isMultiMaskMode && lastMaskResult !== null

  return (
    <div
      className="p-4 relative h-full"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-4">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium">{t('freeTools.segmentAnything.orDragDrop')}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t('freeTools.segmentAnything.title')}</h1>
          <p className="text-muted-foreground text-xs">
            {t('freeTools.segmentAnything.description')}
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
        >
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium">{t('freeTools.segmentAnything.selectImage')}</p>
            <p className="text-sm text-muted-foreground">
              {t('freeTools.segmentAnything.orDragDrop')}
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
          // Reset input value so same file can be selected again
          e.target.value = ''
        }}
      />

      {/* Editor area */}
      {originalImage && (
        <div className="flex flex-col gap-3">
          {/* Progress display */}
          {isProcessing && (
            <ProcessingProgress progress={progress} showPhases={true} showOverall={true} showEta={true} />
          )}

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

          {/* Status */}
          <div className="text-sm text-muted-foreground text-center">
            {isProcessing && t('freeTools.segmentAnything.processing')}
            {isEncoded && !isMultiMaskMode && t('freeTools.segmentAnything.hoverToPreview')}
            {isEncoded && isMultiMaskMode && t('freeTools.segmentAnything.clickToRefine')}
          </div>

          {/* Canvas area */}
          <Card>
            <CardContent className="p-4">
              <div
                ref={imageContainerRef}
                className={cn(
                  'relative mx-auto bg-muted rounded-lg overflow-hidden',
                  'cursor-none'
                )}
                style={{
                  width: canvasSize.width,
                  height: canvasSize.height
                }}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseLeave={handleMouseLeave}
                onContextMenu={handleContextMenu}
              >
                {/* Background image */}
                {loadedImage && (
                  <img
                    src={originalImage}
                    alt="Input"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                    draggable={false}
                  />
                )}

                {/* Mask overlay canvas */}
                <canvas
                  ref={maskCanvasRef}
                  className="absolute inset-0 pointer-events-none opacity-50"
                  style={{
                    width: canvasSize.width,
                    height: canvasSize.height
                  }}
                />

                {/* Point markers (only in multi-mask mode) */}
                {isMultiMaskMode && points.map((point, index) => (
                  <div
                    key={index}
                    className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: `${point.x * 100}%`,
                      top: `${point.y * 100}%`
                    }}
                  >
                    {point.label === 1 ? (
                      // Positive point: star icon
                      <Star className="h-5 w-5 text-yellow-400 fill-yellow-400 drop-shadow-lg" />
                    ) : (
                      // Negative point: X icon
                      <X className="h-5 w-5 text-red-500 drop-shadow-lg" strokeWidth={3} />
                    )}
                  </div>
                ))}

                {/* Processing overlay */}
                {isProcessing && (
                  <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                )}

                {/* Decoding indicator */}
                {isDecoding && (
                  <div className="absolute top-2 right-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                )}

                {/* Custom circle cursor */}
                {cursorPos && loadedImage && !isProcessing && (
                  <div
                    className="pointer-events-none absolute rounded-full border-2 border-white"
                    style={{
                      left: cursorPos.x,
                      top: cursorPos.y,
                      width: 20,
                      height: 20,
                      transform: 'translate(-50%, -50%)',
                      boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(0, 0, 0, 0.3)'
                    }}
                  />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.segmentAnything.resetImage')}
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  onClick={clearPoints}
                  disabled={!isMultiMaskMode || isProcessing}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('freeTools.segmentAnything.clearPoints')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('freeTools.segmentAnything.clearPointsTooltip')}</TooltipContent>
            </Tooltip>

            <div className="h-6 w-px bg-border" />

            <Select
              value={downloadFormat}
              onValueChange={(v) => setDownloadFormat(v as 'png' | 'jpeg' | 'webp')}
            >
              <SelectTrigger className="h-9 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="jpeg">JPEG</SelectItem>
                <SelectItem value="webp">WebP</SelectItem>
              </SelectContent>
            </Select>

            <Button
              onClick={handleCutOut}
              disabled={!canCut || isProcessing}
              className="gradient-bg"
            >
              <Scissors className="h-4 w-4 mr-2" />
              {t('freeTools.segmentAnything.cutMask')}
            </Button>
          </div>

          {/* Instructions */}
          <div className="text-xs text-muted-foreground text-center">
            {t('freeTools.segmentAnything.hint')}
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
