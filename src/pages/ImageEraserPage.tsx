import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useImageEraserWorker } from '@/hooks/useImageEraserWorker'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { ProcessingProgress } from '@/components/shared/ProcessingProgress'
import {
  canvasToFloat32Array,
  maskCanvasToFloat32Array,
  tensorToCanvas,
  canvasToBlob,
  resizeCanvas,
  getMaskBoundingBox,
  cropCanvas,
  pasteWithBlending,
  addReflectPadding,
  addMaskReflectPadding
} from '@/lib/lamaUtils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
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
  ArrowLeft,
  Upload,
  Download,
  Loader2,
  Eraser,
  X,
  Paintbrush,
  Undo2,
  Redo2,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Tool = 'brush' | 'eraser'

// Phase configuration for image eraser
const PHASES = [
  { id: 'download', labelKey: 'freeTools.progress.downloading', weight: 0.1 },
  { id: 'process', labelKey: 'freeTools.progress.processing', weight: 0.9 }
]

export function ImageEraserPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imageCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const resultCanvasRef = useRef<HTMLCanvasElement>(null)
  const dragCounterRef = useRef(0)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)

  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null)
  const [resultImage, setResultImage] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 512, height: 512 })
  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 })
  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(30)
  // Mask drawing history (for current editing session)
  const [maskHistory, setMaskHistory] = useState<ImageData[]>([])
  const [maskHistoryIndex, setMaskHistoryIndex] = useState(-1)
  // Image edit history (for undo/redo of object removal operations)
  const [imageHistory, setImageHistory] = useState<ImageData[]>([])
  const [imageHistoryIndex, setImageHistoryIndex] = useState(-1)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpeg' | 'webp'>('png')
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  // Multi-phase progress tracking
  const {
    progress,
    startPhase,
    updatePhase,
    reset: resetProgress,
    resetAndStart,
    complete: completeAllPhases
  } = useMultiPhaseProgress({ phases: PHASES })

  const { initModel, removeObjects, dispose, isInitialized } = useImageEraserWorker({
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
    onError: (error) => {
      console.error('Worker error:', error)
      setIsProcessing(false)
    }
  })

  // Measure available container size on mount and window resize
  useEffect(() => {
    const updateContainerSize = () => {
      // Use most of viewport width (minus sidebar ~240px and padding)
      // Use generous height - page can scroll if needed
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const availableWidth = Math.max(500, viewportWidth - 300)
      const availableHeight = Math.max(500, viewportHeight - 250)
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

  // Draw loaded image to canvas at ORIGINAL resolution (not display size)
  useEffect(() => {
    if (!loadedImage || !imageCanvasRef.current || !originalSize) return

    const imageCanvas = imageCanvasRef.current
    // Set canvas buffer to original image size for full resolution processing
    imageCanvas.width = originalSize.width
    imageCanvas.height = originalSize.height

    const ctx = imageCanvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    ctx.drawImage(loadedImage, 0, 0, originalSize.width, originalSize.height)
  }, [loadedImage, originalSize])

  // Initialize mask canvas when image loads (at original resolution)
  useEffect(() => {
    if (!originalImage || !maskCanvasRef.current || !originalSize) return

    const maskCanvas = maskCanvasRef.current
    // Set mask canvas to original image size
    maskCanvas.width = originalSize.width
    maskCanvas.height = originalSize.height

    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
    if (!maskCtx) return

    // Clear mask canvas to transparent (no mask)
    maskCtx.clearRect(0, 0, originalSize.width, originalSize.height)

    // Save initial mask state to mask history
    const initialMaskState = maskCtx.getImageData(0, 0, originalSize.width, originalSize.height)
    setMaskHistory([initialMaskState])
    setMaskHistoryIndex(0)
  }, [originalImage, originalSize])

  // Initialize image history when image is drawn to canvas
  useEffect(() => {
    if (!loadedImage || !imageCanvasRef.current || !originalSize) return

    // Small delay to ensure image is drawn to canvas
    const timer = setTimeout(() => {
      const imageCtx = imageCanvasRef.current?.getContext('2d', { willReadFrequently: true })
      if (!imageCtx) return

      const initialImageState = imageCtx.getImageData(0, 0, originalSize.width, originalSize.height)
      setImageHistory([initialImageState])
      setImageHistoryIndex(0)
    }, 50)

    return () => clearTimeout(timer)
  }, [loadedImage, originalSize])

  // Save mask history snapshot (for mask drawing undo/redo)
  const saveMaskSnapshot = useCallback(() => {
    const maskCanvas = maskCanvasRef.current
    const maskCtx = maskCanvas?.getContext('2d', { willReadFrequently: true })
    if (!maskCtx || !maskCanvas) return

    const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)

    setMaskHistory((prev) => {
      const newHistory = prev.slice(0, maskHistoryIndex + 1)
      newHistory.push(imageData)
      if (newHistory.length > 50) {
        newHistory.shift()
        return newHistory
      }
      return newHistory
    })
    setMaskHistoryIndex((prev) => Math.min(prev + 1, 49))
  }, [maskHistoryIndex])

  // Save image history snapshot (for object removal undo/redo)
  const saveImageSnapshot = useCallback(() => {
    const imageCanvas = imageCanvasRef.current
    const imageCtx = imageCanvas?.getContext('2d', { willReadFrequently: true })
    if (!imageCtx || !imageCanvas) return

    const imageData = imageCtx.getImageData(0, 0, imageCanvas.width, imageCanvas.height)

    setImageHistory((prev) => {
      const newHistory = prev.slice(0, imageHistoryIndex + 1)
      newHistory.push(imageData)
      if (newHistory.length > 20) {
        // Keep fewer image snapshots (they're larger)
        newHistory.shift()
        return newHistory
      }
      return newHistory
    })
    setImageHistoryIndex((prev) => Math.min(prev + 1, 19))
  }, [imageHistoryIndex])

  // Undo mask drawing
  const undoMask = useCallback(() => {
    if (maskHistoryIndex <= 0) return

    const newIndex = maskHistoryIndex - 1
    const maskCtx = maskCanvasRef.current?.getContext('2d', { willReadFrequently: true })
    if (!maskCtx || !maskHistory[newIndex]) return

    maskCtx.putImageData(maskHistory[newIndex], 0, 0)
    setMaskHistoryIndex(newIndex)
  }, [maskHistoryIndex, maskHistory])

  // Redo mask drawing
  const redoMask = useCallback(() => {
    if (maskHistoryIndex >= maskHistory.length - 1) return

    const newIndex = maskHistoryIndex + 1
    const maskCtx = maskCanvasRef.current?.getContext('2d', { willReadFrequently: true })
    if (!maskCtx || !maskHistory[newIndex]) return

    maskCtx.putImageData(maskHistory[newIndex], 0, 0)
    setMaskHistoryIndex(newIndex)
  }, [maskHistoryIndex, maskHistory])

  // Undo image edit (object removal)
  const undoImage = useCallback(() => {
    if (imageHistoryIndex <= 0) return

    const newIndex = imageHistoryIndex - 1
    const imageCtx = imageCanvasRef.current?.getContext('2d', { willReadFrequently: true })
    if (!imageCtx || !imageHistory[newIndex]) return

    imageCtx.putImageData(imageHistory[newIndex], 0, 0)
    setImageHistoryIndex(newIndex)

    // Update result image preview
    if (imageCanvasRef.current) {
      const dataUrl = imageCanvasRef.current.toDataURL('image/png')
      setResultImage(dataUrl)
    }
  }, [imageHistoryIndex, imageHistory])

  // Redo image edit (object removal)
  const redoImage = useCallback(() => {
    if (imageHistoryIndex >= imageHistory.length - 1) return

    const newIndex = imageHistoryIndex + 1
    const imageCtx = imageCanvasRef.current?.getContext('2d', { willReadFrequently: true })
    if (!imageCtx || !imageHistory[newIndex]) return

    imageCtx.putImageData(imageHistory[newIndex], 0, 0)
    setImageHistoryIndex(newIndex)

    // Update result image preview
    if (imageCanvasRef.current) {
      const dataUrl = imageCanvasRef.current.toDataURL('image/png')
      setResultImage(dataUrl)
    }
  }, [imageHistoryIndex, imageHistory])

  // Clear mask
  const clearMask = useCallback(() => {
    const maskCanvas = maskCanvasRef.current
    const maskCtx = maskCanvas?.getContext('2d', { willReadFrequently: true })
    if (!maskCtx || !maskCanvas) return

    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    saveMaskSnapshot()
  }, [saveMaskSnapshot])

  // Zoom controls
  const zoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.25, 3))
  }, [])

  const zoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.25, 0.5))
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(1)
  }, [])

  // Get coordinates relative to canvas (accounting for zoom)
  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = maskCanvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height

      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      }
    },
    []
  )

  // Get display coordinates for cursor overlay (adjusted for zoom)
  const getDisplayCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = maskCanvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      // Divide by zoom because cursor is inside the scaled container
      return {
        x: (e.clientX - rect.left) / zoom,
        y: (e.clientY - rect.top) / zoom
      }
    },
    [zoom]
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
        // Eraser: use destination-out to make transparent
        maskCtx.globalCompositeOperation = 'destination-out'
        maskCtx.fillStyle = 'rgba(0,0,0,1)'
        maskCtx.strokeStyle = 'rgba(0,0,0,1)'
      } else {
        // Brush: draw with full opacity (transparency applied via CSS)
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

      // Reset composite operation
      maskCtx.globalCompositeOperation = 'source-over'
    },
    [tool, brushSize, canvasSize.width]
  )

  // Mouse event handlers for drawing
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isProcessing) return

      const coords = getCanvasCoords(e)
      if (!coords) return

      setIsDrawing(true)
      lastPosRef.current = coords
      drawAt(coords.x, coords.y)
    },
    [isProcessing, getCanvasCoords, drawAt]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const displayCoords = getDisplayCoords(e)
      if (displayCoords) {
        setCursorPos(displayCoords)
      }

      if (!isDrawing) return

      const coords = getCanvasCoords(e)
      if (!coords) return

      const lastPos = lastPosRef.current
      drawAt(coords.x, coords.y, lastPos?.x, lastPos?.y)
      lastPosRef.current = coords
    },
    [isDrawing, getCanvasCoords, getDisplayCoords, drawAt]
  )

  const handleMouseUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false)
      lastPosRef.current = null
      saveMaskSnapshot()
    }
  }, [isDrawing, saveMaskSnapshot])

  const handleMouseLeave = useCallback(() => {
    setCursorPos(null)
    if (isDrawing) {
      setIsDrawing(false)
      lastPosRef.current = null
      saveMaskSnapshot()
    }
  }, [isDrawing, saveMaskSnapshot])

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return

      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        setOriginalImage(dataUrl)
        setResultImage(null)
        setLoadedImage(null)
        setZoom(1)
        resetProgress()

        // Load image to get dimensions
        const img = new Image()
        img.onload = () => {
          setOriginalSize({ width: img.width, height: img.height })
          setLoadedImage(img) // Canvas size is calculated by effect
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

  const handleRemoveObjects = async () => {
    const imageCanvas = imageCanvasRef.current
    const maskCanvas = maskCanvasRef.current
    if (!imageCanvas || !maskCanvas) return

    // Find mask bounding box (at least 512x512 and 2x mask size)
    const bbox = getMaskBoundingBox(maskCanvas)
    if (!bbox) {
      console.warn('No mask drawn')
      return
    }

    setIsProcessing(true)
    resetAndStart('process')

    try {
      // Initialize model if not already done (instant if cached)
      await initModel()

      // Crop the region around the mask
      const croppedImage = cropCanvas(imageCanvas, bbox.x, bbox.y, bbox.width, bbox.height)
      const croppedMask = cropCanvas(maskCanvas, bbox.x, bbox.y, bbox.width, bbox.height)

      // Add reflect padding at image edges to prevent seams
      const padAmount = 32
      const padding = {
        top: bbox.y === 0 ? padAmount : 0,
        left: bbox.x === 0 ? padAmount : 0,
        bottom: originalSize && bbox.y + bbox.height >= originalSize.height ? padAmount : 0,
        right: originalSize && bbox.x + bbox.width >= originalSize.width ? padAmount : 0
      }
      const hasPadding = padding.top > 0 || padding.left > 0 || padding.bottom > 0 || padding.right > 0

      // Apply padding if needed
      const processImage = hasPadding ? addReflectPadding(croppedImage, padding) : croppedImage
      const processMask = hasPadding ? addMaskReflectPadding(croppedMask, padding) : croppedMask

      // Convert to Float32Arrays (worker handles resize to 768x768 internally)
      const imageData = canvasToFloat32Array(processImage)
      const maskData = maskCanvasToFloat32Array(processMask)

      // Run inference (worker handles resize internally)
      const result = await removeObjects(
        imageData,
        maskData,
        processImage.width,
        processImage.height
      )

      // Convert result back to canvas (DeepFillv2 outputs normalized 0-1)
      let resultCanvas = tensorToCanvas(result.data, result.width, result.height, true)

      // Crop away padding if it was added
      if (hasPadding) {
        resultCanvas = cropCanvas(
          resultCanvas,
          padding.left,
          padding.top,
          bbox.width,
          bbox.height
        )
      }

      // Paste back into original image with blending
      pasteWithBlending(imageCanvas, resultCanvas, croppedMask, bbox.x, bbox.y, 12)

      // Save the new image state to history (for undo/redo of removals)
      saveImageSnapshot()

      // Copy to result canvas ref for download (full size)
      if (resultCanvasRef.current && originalSize) {
        resultCanvasRef.current.width = originalSize.width
        resultCanvasRef.current.height = originalSize.height
        const downloadCtx = resultCanvasRef.current.getContext('2d')
        if (downloadCtx) {
          downloadCtx.drawImage(imageCanvas, 0, 0)
        }
      }

      // Convert to data URL for preview
      const blob = await canvasToBlob(imageCanvas)
      const resultUrl = URL.createObjectURL(blob)
      setResultImage(resultUrl)

      // Clear the mask canvas for next iteration
      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
      if (maskCtx) {
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
        // Reset mask history for new editing session
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

  const handleDownload = () => {
    // Prefer result canvas, fallback to image canvas
    const canvas = resultCanvasRef.current || imageCanvasRef.current
    if (!canvas) return

    const mimeType = `image/${downloadFormat}`
    const quality = downloadFormat === 'png' ? undefined : 0.95
    const dataUrl = canvas.toDataURL(mimeType, quality)

    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `erased-${Date.now()}.${downloadFormat}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          // Prefer mask undo if available, otherwise image undo
          if (maskHistoryIndex > 0) {
            undoMask()
          } else if (imageHistoryIndex > 0) {
            undoImage()
          }
        } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault()
          // Prefer mask redo if available, otherwise image redo
          if (maskHistoryIndex < maskHistory.length - 1) {
            redoMask()
          } else if (imageHistoryIndex < imageHistory.length - 1) {
            redoImage()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undoMask, redoMask, undoImage, redoImage, maskHistoryIndex, maskHistory.length, imageHistoryIndex, imageHistory.length])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      dispose()
    }
  }, [dispose])

  const canUndoMask = maskHistoryIndex > 0
  const canRedoMask = maskHistoryIndex < maskHistory.length - 1
  const canUndoImage = imageHistoryIndex > 0
  const canRedoImage = imageHistoryIndex < imageHistory.length - 1

  return (
    <div
      className="p-4 relative h-full"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Hidden canvas for download */}
      <canvas ref={resultCanvasRef} className="hidden" />

      {/* Drag overlay */}
      {isDragging && originalImage && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg m-4">
          <div className="text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-2" />
            <p className="text-lg font-medium">{t('freeTools.imageEraser.orDragDrop')}</p>
          </div>
        </div>
      )}

      {/* Header */}
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
            <p className="text-lg font-medium">{t('freeTools.imageEraser.selectImage')}</p>
            <p className="text-sm text-muted-foreground">
              {t('freeTools.imageEraser.orDragDrop')}
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

      {/* Editor area */}
      {originalImage && (
        <div className="flex flex-col gap-3">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('freeTools.imageEraser.selectImage')}
            </Button>

            {/* Drawing tools */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={tool === 'brush' ? 'default' : 'outline'}
                    size="icon"
                    onClick={() => setTool('brush')}
                    disabled={isProcessing}
                  >
                    <Paintbrush className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('freeTools.imageEraser.brush')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={tool === 'eraser' ? 'default' : 'outline'}
                    size="icon"
                    onClick={() => setTool('eraser')}
                    disabled={isProcessing}
                  >
                    <Eraser className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('freeTools.imageEraser.eraser')}</TooltipContent>
              </Tooltip>
            </div>

            <div className="h-6 w-px bg-border" />

            {/* Mask Undo/Redo/Clear */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={undoMask}
                    disabled={isProcessing || !canUndoMask}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('freeTools.imageEraser.undo')} (Ctrl+Z)</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={redoMask}
                    disabled={isProcessing || !canRedoMask}
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t('freeTools.imageEraser.redo')} (Ctrl+Shift+Z)
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={clearMask}
                    disabled={isProcessing}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('freeTools.imageEraser.clear')}</TooltipContent>
              </Tooltip>
            </div>

            {/* Image History Undo/Redo (for removal operations) */}
            {(canUndoImage || canRedoImage) && (
              <>
                <div className="h-6 w-px bg-border" />
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-1">
                    {t('freeTools.imageEraser.edits')}:
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={undoImage}
                        disabled={isProcessing || !canUndoImage}
                      >
                        <Undo2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('freeTools.imageEraser.undoEdit')}</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={redoImage}
                        disabled={isProcessing || !canRedoImage}
                      >
                        <Redo2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('freeTools.imageEraser.redoEdit')}</TooltipContent>
                  </Tooltip>
                </div>
              </>
            )}

            <div className="h-6 w-px bg-border" />

            {/* Zoom controls */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={zoomOut}
                    disabled={zoom <= 0.5}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zoom Out</TooltipContent>
              </Tooltip>

              <span className="text-xs text-muted-foreground w-12 text-center">
                {Math.round(zoom * 100)}%
              </span>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={zoomIn}
                    disabled={zoom >= 3}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zoom In</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={resetZoom}
                    disabled={zoom === 1}
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset Zoom</TooltipContent>
              </Tooltip>
            </div>

            <div className="h-6 w-px bg-border" />

            {/* Brush size */}
            <div className="flex items-center gap-3 min-w-[150px] max-w-[200px]">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {t('freeTools.imageEraser.brushSize')}
              </span>
              <Slider
                value={[brushSize]}
                onValueChange={([v]) => setBrushSize(v)}
                min={5}
                max={100}
                step={1}
                disabled={isProcessing}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-6 text-right">{brushSize}</span>
            </div>

            <div className="flex-1" />

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

          {/* Progress display */}
          <ProcessingProgress
            progress={progress}
            showPhases={true}
            showOverall={true}
            showEta={true}
          />

          {/* Canvas area - single unified view */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">
                  {t('freeTools.imageEraser.drawMask')}
                </span>
                <div className="flex items-center gap-2">
                  {originalSize && (
                    <span className="text-xs text-muted-foreground">
                      {originalSize.width} x {originalSize.height}
                    </span>
                  )}
                  {resultImage && (
                    <>
                      <Select
                        value={downloadFormat}
                        onValueChange={(v) => setDownloadFormat(v as 'png' | 'jpeg' | 'webp')}
                      >
                        <SelectTrigger className="h-7 w-20 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="png">PNG</SelectItem>
                          <SelectItem value="jpeg">JPEG</SelectItem>
                          <SelectItem value="webp">WebP</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={handleDownload}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div
                ref={containerRef}
                className="relative flex items-center justify-center bg-muted rounded-lg overflow-auto"
                style={{ minHeight: Math.max(400, canvasSize.height * zoom + 16) }}
              >
                <div
                  className="relative"
                  style={{
                    width: canvasSize.width,
                    height: canvasSize.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: 'center center'
                  }}
                >
                {/* Background image canvas - buffer at original res, displayed at canvasSize */}
                <canvas
                  ref={imageCanvasRef}
                  className="absolute inset-0 cursor-pointer"
                  style={{
                    width: canvasSize.width,
                    height: canvasSize.height,
                    objectFit: 'contain'
                  }}
                  onClick={() => resultImage && setPreviewImage(resultImage)}
                />

                {/* Mask canvas (drawing layer) - buffer at original res, displayed at canvasSize */}
                <canvas
                  ref={maskCanvasRef}
                  className={cn('absolute inset-0 cursor-none', isProcessing && 'pointer-events-none')}
                  style={{
                    width: canvasSize.width,
                    height: canvasSize.height,
                    opacity: 0.5
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                />

                {/* Processing overlay */}
                {isProcessing && (
                  <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                )}

                {/* Brush cursor indicator */}
                {cursorPos && !isProcessing && (
                  <div
                    className="pointer-events-none absolute rounded-full border-2"
                    style={{
                      left: cursorPos.x,
                      top: cursorPos.y,
                      width: brushSize,
                      height: brushSize,
                      transform: 'translate(-50%, -50%)',
                      borderColor:
                        tool === 'eraser'
                          ? 'rgba(0, 0, 0, 0.8)'
                          : 'rgba(255, 255, 255, 0.8)',
                      boxShadow:
                        tool === 'eraser'
                          ? '0 0 0 1px rgba(255, 255, 255, 0.5)'
                          : '0 0 0 1px rgba(0, 0, 0, 0.5)'
                    }}
                  />
                )}
                </div>
              </div>
            </CardContent>
          </Card>
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
    </div>
  )
}
