import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSegmentAnythingWorker, type MaskResult } from '@mobile/hooks/useSegmentAnythingWorker'
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
import {
  ArrowLeft,
  Upload,
  Loader2,
  X,
  Trash2,
  Download,
  Star,
  RefreshCw,
  Eye
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { featherMask } from '@/lib/maskUtils'

// Phase configuration for segment anything (simplified to single phase)
const PHASES = [
  { id: 'process', labelKey: 'freeTools.progress.processing', weight: 1.0 }
]

// Mask overlay color (blue with transparency)
const MASK_COLOR = { r: 0, g: 114, b: 189, a: 255 }

interface Point {
  x: number // Normalized 0-1
  y: number // Normalized 0-1
  label: 0 | 1 // 0 = negative, 1 = positive
}

export function MobileSegmentAnythingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageContainerRef = useRef<HTMLDivElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)

  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDecoding, setIsDecoding] = useState(false)
  const [isEncoded, setIsEncoded] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 300 })
  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 300, height: 400 })

  // Multi-mask mode: starts false (hover preview), becomes true after first click
  const [isMultiMaskMode, setIsMultiMaskMode] = useState(false)
  const [points, setPoints] = useState<Point[]>([])
  const lastDecodedPointRef = useRef<{ x: number; y: number } | null>(null)
  const pendingPointRef = useRef<Point | null>(null)

  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpeg' | 'webp'>('png')
  const [lastMaskResult, setLastMaskResult] = useState<MaskResult | null>(null)

  // Preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

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

  // Measure available container size on mount and window resize
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

  // Generate preview when mask result changes
  const generatePreview = useCallback(() => {
    if (!lastMaskResult || !loadedImage || !originalSize) {
      setPreviewUrl(null)
      return
    }

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
        outputPixels[i - 3] = imagePixels[i - 3] // R
        outputPixels[i - 2] = imagePixels[i - 2] // G
        outputPixels[i - 1] = imagePixels[i - 1] // B
        outputPixels[i] = alpha                   // Use feathered alpha
      }
    }

    outputCtx.putImageData(outputData, 0, 0)

    // Create preview URL
    const url = outputCanvas.toDataURL('image/png')
    setPreviewUrl(url)
  }, [lastMaskResult, loadedImage, originalSize])

  // Update preview when mask changes
  useEffect(() => {
    if (isMultiMaskMode && lastMaskResult) {
      generatePreview()
    } else {
      setPreviewUrl(null)
    }
  }, [isMultiMaskMode, lastMaskResult, generatePreview])

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
      if (forMultiMask) {
        setLastMaskResult(result)
        drawMask(result)
      }
    } catch (error) {
      console.error('Decode error:', error)
    } finally {
      setIsDecoding(false)
      const pending = pendingPointRef.current
      if (pending && (pending.x !== lastDecodedPointRef.current?.x || pending.y !== lastDecodedPointRef.current?.y)) {
        pendingPointRef.current = null
        decode([pending])
      }
    }
  }, [isEncoded, isDecoding, decodeMask, drawMask])

  // Clamp value between 0 and 1
  const clamp = (x: number) => Math.max(0, Math.min(1, x))

  // Get normalized coordinates from touch/click event
  const getPoint = useCallback(
    (clientX: number, clientY: number, isNegative = false): Point | null => {
      const container = imageContainerRef.current
      if (!container) return null

      const rect = container.getBoundingClientRect()
      const x = clamp((clientX - rect.left) / rect.width)
      const y = clamp((clientY - rect.top) / rect.height)

      return { x, y, label: isNegative ? 0 : 1 }
    },
    []
  )

  // Handle touch/click - add point
  const handleInteraction = useCallback(
    (clientX: number, clientY: number, isNegative = false) => {
      if (!isEncoded) return

      const point = getPoint(clientX, clientY, isNegative)
      if (!point) return

      const newPoints = isMultiMaskMode ? [...points, point] : [point]
      if (!isMultiMaskMode) setIsMultiMaskMode(true)
      setPoints(newPoints)
      decode(newPoints, true)
    },
    [isEncoded, isMultiMaskMode, points, getPoint, decode]
  )

  // Handle click
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      handleInteraction(e.clientX, e.clientY, e.button === 2)
    },
    [handleInteraction]
  )

  // Handle touch
  const handleTouch = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault()
      const touch = e.touches[0]
      if (touch) {
        handleInteraction(touch.clientX, touch.clientY, false)
      }
    },
    [handleInteraction]
  )

  // Handle long press for negative point
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null)

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0]
      if (!touch) return

      longPressStartRef.current = { x: touch.clientX, y: touch.clientY }
      longPressTimerRef.current = setTimeout(() => {
        if (longPressStartRef.current) {
          handleInteraction(longPressStartRef.current.x, longPressStartRef.current.y, true)
          longPressStartRef.current = null
        }
      }, 500)
    },
    [handleInteraction]
  )

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      if (longPressStartRef.current) {
        // Short tap - positive point
        handleInteraction(longPressStartRef.current.x, longPressStartRef.current.y, false)
        longPressStartRef.current = null
      }
      e.preventDefault()
    },
    [handleInteraction]
  )

  const handleTouchMove = useCallback(() => {
    // Cancel long press if finger moves
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressStartRef.current = null
  }, [])

  // Prevent context menu on long press
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  // Clear all points and reset
  const clearPoints = useCallback(() => {
    setPoints([])
    setIsMultiMaskMode(false)
    lastDecodedPointRef.current = null
    pendingPointRef.current = null
    setLastMaskResult(null)
    setPreviewUrl(null)
    const maskCanvas = maskCanvasRef.current
    if (maskCanvas) {
      const ctx = maskCanvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
      }
    }
  }, [])

  // Reset image
  const resetImage = useCallback(async () => {
    setOriginalImage(null)
    setLoadedImage(null)
    setIsEncoded(false)
    setIsMultiMaskMode(false)
    setPoints([])
    lastDecodedPointRef.current = null
    pendingPointRef.current = null
    setLastMaskResult(null)
    setPreviewUrl(null)
    setOriginalSize(null)
    resetProgress()

    if (isSegmented()) {
      await resetWorker()
    }
  }, [resetProgress, resetWorker, isSegmented])

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return

      await resetImage()

      const reader = new FileReader()
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string
        setOriginalImage(dataUrl)

        const img = new Image()
        img.onload = async () => {
          setOriginalSize({ width: img.width, height: img.height })
          setLoadedImage(img)

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

  // Download the preview
  const handleDownload = useCallback(() => {
    if (!previewUrl || !originalSize) return

    // For formats other than PNG, we need to convert
    if (downloadFormat === 'png') {
      const link = document.createElement('a')
      link.href = previewUrl
      link.download = `segment-${Date.now()}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } else {
      // Create a new canvas for the selected format
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = originalSize.width
        canvas.height = originalSize.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        if (downloadFormat === 'jpeg') {
          // JPEG needs white background
          ctx.fillStyle = 'white'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        ctx.drawImage(img, 0, 0)

        const mimeType = downloadFormat === 'jpeg' ? 'image/jpeg' : 'image/webp'
        const dataUrl = canvas.toDataURL(mimeType, 0.95)

        const link = document.createElement('a')
        link.href = dataUrl
        link.download = `segment-${Date.now()}.${downloadFormat}`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
      img.src = previewUrl
    }
  }, [previewUrl, downloadFormat, originalSize])

  // Handle retry
  const handleRetry = useCallback(async () => {
    setError(null)
    setIsProcessing(true)
    resetAndStart('download')
    try {
      await retryModel()
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
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
      }
    }
  }, [dispose])

  const canDownload = isMultiMaskMode && previewUrl !== null

  return (
    <div className="p-4 h-full overflow-auto">
      {/* Header with back button */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/free-tools')}>
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
          className="border-2 border-dashed cursor-pointer transition-colors border-muted-foreground/25 hover:border-primary/50"
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-base font-medium">{t('freeTools.segmentAnything.selectImage')}</p>
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

          {/* Status */}
          <div className="text-sm text-muted-foreground text-center">
            {isProcessing && t('freeTools.segmentAnything.processing')}
            {isEncoded && !isMultiMaskMode && t('freeTools.segmentAnything.hoverToPreview')}
            {isEncoded && isMultiMaskMode && t('freeTools.segmentAnything.clickToRefine')}
          </div>

          {/* Canvas area */}
          <Card>
            <CardContent className="p-3">
              <div
                ref={imageContainerRef}
                className={cn(
                  'relative mx-auto bg-muted rounded-lg overflow-hidden touch-none',
                  loadedImage ? 'cursor-crosshair' : 'cursor-default'
                )}
                style={{
                  width: canvasSize.width,
                  height: canvasSize.height
                }}
                onClick={handleClick}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchMove}
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

                {/* Point markers */}
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
                      <Star className="h-5 w-5 text-yellow-400 fill-yellow-400 drop-shadow-lg" />
                    ) : (
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
              </div>
            </CardContent>
          </Card>

          {/* Preview area */}
          {previewUrl && (
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('freeTools.backgroundRemover.result')}</span>
                </div>
                <div
                  className="relative mx-auto rounded-lg overflow-hidden"
                  style={{
                    width: canvasSize.width,
                    height: canvasSize.height,
                    backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                    backgroundSize: '20px 20px',
                    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                  }}
                >
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.segmentAnything.resetImage')}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={clearPoints}
              disabled={!isMultiMaskMode || isProcessing}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('freeTools.segmentAnything.clearPoints')}
            </Button>
          </div>

          {/* Download controls */}
          {canDownload && (
            <div className="flex items-center justify-center gap-2">
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

              <Button onClick={handleDownload} className="gradient-bg">
                <Download className="h-4 w-4 mr-2" />
                {t('common.download')}
              </Button>
            </div>
          )}

          {/* Instructions */}
          <div className="text-xs text-muted-foreground text-center space-y-1">
            <p>{t('freeTools.segmentAnything.hint')}</p>
            <p className="text-muted-foreground/70">
              {t('playground.capture.maskEditor.hint', 'Tap to include, long press to exclude')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
