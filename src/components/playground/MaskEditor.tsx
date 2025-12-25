import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Paintbrush, Eraser, PaintBucket, RefreshCw, Trash2, Undo2, Redo2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { floodFill, invertMask, clearCanvas, canvasToBlob, extractVideoFrame } from '@/lib/maskUtils'

type Tool = 'brush' | 'eraser' | 'fill'

interface MaskEditorProps {
  referenceImageUrl?: string
  referenceVideoUrl?: string
  onComplete: (blob: Blob) => void
  onClose: () => void
  disabled?: boolean
}

export function MaskEditor({
  referenceImageUrl,
  referenceVideoUrl,
  onComplete,
  onClose,
  disabled = false
}: MaskEditorProps) {
  const { t } = useTranslation()

  // Canvas refs
  const containerRef = useRef<HTMLDivElement>(null)
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)

  // State
  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(30)
  const [isDrawing, setIsDrawing] = useState(false)
  const [history, setHistory] = useState<ImageData[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isLoading, setIsLoading] = useState(true)
  const [canvasSize, setCanvasSize] = useState({ width: 512, height: 512 })
  const [referenceImage, setReferenceImage] = useState<HTMLImageElement | null>(null)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  // Last position for smooth line drawing
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)

  // Load reference image
  useEffect(() => {
    const loadImage = async () => {
      setIsLoading(true)

      let imageUrl = referenceImageUrl

      // If we have a video, extract first frame
      if (!imageUrl && referenceVideoUrl) {
        const frameUrl = await extractVideoFrame(referenceVideoUrl)
        if (frameUrl) {
          imageUrl = frameUrl
        }
      }

      if (imageUrl) {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          setReferenceImage(img)
          // Calculate canvas size to fit within max dimensions while maintaining aspect ratio
          const maxWidth = 800
          const maxHeight = 600
          let width = img.width
          let height = img.height

          if (width > maxWidth) {
            height = (height * maxWidth) / width
            width = maxWidth
          }
          if (height > maxHeight) {
            width = (width * maxHeight) / height
            height = maxHeight
          }

          setCanvasSize({ width: Math.round(width), height: Math.round(height) })
          setIsLoading(false)
        }
        img.onerror = () => {
          // Fallback to default size if image fails to load
          setCanvasSize({ width: 512, height: 512 })
          setIsLoading(false)
        }
        img.src = imageUrl
      } else {
        // No reference, use default size
        setCanvasSize({ width: 512, height: 512 })
        setIsLoading(false)
      }
    }

    loadImage()
  }, [referenceImageUrl, referenceVideoUrl])

  // Initialize canvas when size is set
  useEffect(() => {
    if (isLoading) return

    const bgCanvas = backgroundCanvasRef.current
    const maskCanvas = maskCanvasRef.current
    if (!bgCanvas || !maskCanvas) return

    const bgCtx = bgCanvas.getContext('2d')
    const maskCtx = maskCanvas.getContext('2d')
    if (!bgCtx || !maskCtx) return

    // Draw reference image on background canvas
    if (referenceImage) {
      bgCtx.drawImage(referenceImage, 0, 0, canvasSize.width, canvasSize.height)
    } else {
      // Checkerboard pattern for transparency indication
      bgCtx.fillStyle = '#333333'
      bgCtx.fillRect(0, 0, canvasSize.width, canvasSize.height)
      const gridSize = 20
      bgCtx.fillStyle = '#444444'
      for (let x = 0; x < canvasSize.width; x += gridSize * 2) {
        for (let y = 0; y < canvasSize.height; y += gridSize * 2) {
          bgCtx.fillRect(x, y, gridSize, gridSize)
          bgCtx.fillRect(x + gridSize, y + gridSize, gridSize, gridSize)
        }
      }
    }

    // Initialize mask canvas to black (all hidden)
    clearCanvas(maskCtx)

    // Save initial state to history
    const initialState = maskCtx.getImageData(0, 0, canvasSize.width, canvasSize.height)
    setHistory([initialState])
    setHistoryIndex(0)
  }, [isLoading, canvasSize, referenceImage])

  // Save history snapshot
  const saveHistorySnapshot = useCallback(() => {
    const maskCtx = maskCanvasRef.current?.getContext('2d')
    if (!maskCtx) return

    const imageData = maskCtx.getImageData(0, 0, canvasSize.width, canvasSize.height)

    setHistory(prev => {
      // Remove any future history if we're not at the end
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(imageData)

      // Limit history size to prevent memory issues
      if (newHistory.length > 50) {
        newHistory.shift()
        return newHistory
      }
      return newHistory
    })
    setHistoryIndex(prev => Math.min(prev + 1, 49))
  }, [historyIndex, canvasSize])

  // Undo
  const undo = useCallback(() => {
    if (historyIndex <= 0) return

    const newIndex = historyIndex - 1
    const maskCtx = maskCanvasRef.current?.getContext('2d')
    if (!maskCtx || !history[newIndex]) return

    maskCtx.putImageData(history[newIndex], 0, 0)
    setHistoryIndex(newIndex)
  }, [historyIndex, history])

  // Redo
  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return

    const newIndex = historyIndex + 1
    const maskCtx = maskCanvasRef.current?.getContext('2d')
    if (!maskCtx || !history[newIndex]) return

    maskCtx.putImageData(history[newIndex], 0, 0)
    setHistoryIndex(newIndex)
  }, [historyIndex, history])

  // Get coordinates relative to canvas
  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    }
  }, [])

  // Get display coordinates for cursor overlay (in CSS pixels)
  const getDisplayCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }, [])

  // Draw at position
  const drawAt = useCallback((x: number, y: number, lastX?: number, lastY?: number) => {
    const maskCtx = maskCanvasRef.current?.getContext('2d')
    if (!maskCtx) return

    maskCtx.fillStyle = tool === 'eraser' ? '#000000' : '#FFFFFF'
    maskCtx.strokeStyle = tool === 'eraser' ? '#000000' : '#FFFFFF'
    maskCtx.lineWidth = brushSize
    maskCtx.lineCap = 'round'
    maskCtx.lineJoin = 'round'

    if (lastX !== undefined && lastY !== undefined) {
      // Draw line from last position to current
      maskCtx.beginPath()
      maskCtx.moveTo(lastX, lastY)
      maskCtx.lineTo(x, y)
      maskCtx.stroke()
    } else {
      // Draw circle at current position
      maskCtx.beginPath()
      maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
      maskCtx.fill()
    }
  }, [tool, brushSize])

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return

    const coords = getCanvasCoords(e)
    if (!coords) return

    if (tool === 'fill') {
      const maskCtx = maskCanvasRef.current?.getContext('2d')
      if (!maskCtx) return

      saveHistorySnapshot()
      const fillColor: [number, number, number, number] = [255, 255, 255, 255]
      floodFill(maskCtx, coords.x, coords.y, fillColor)
      saveHistorySnapshot()
      return
    }

    setIsDrawing(true)
    lastPosRef.current = coords
    drawAt(coords.x, coords.y)
  }, [disabled, tool, getCanvasCoords, drawAt, saveHistorySnapshot])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Update cursor position for brush indicator
    const displayCoords = getDisplayCoords(e)
    if (displayCoords) {
      setCursorPos(displayCoords)
    }

    if (!isDrawing || tool === 'fill') return

    const coords = getCanvasCoords(e)
    if (!coords) return

    const lastPos = lastPosRef.current
    drawAt(coords.x, coords.y, lastPos?.x, lastPos?.y)
    lastPosRef.current = coords
  }, [isDrawing, tool, getCanvasCoords, getDisplayCoords, drawAt])

  const handleMouseUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false)
      lastPosRef.current = null
      saveHistorySnapshot()
    }
  }, [isDrawing, saveHistorySnapshot])

  const handleMouseLeave = useCallback(() => {
    setCursorPos(null)
    if (isDrawing) {
      setIsDrawing(false)
      lastPosRef.current = null
      saveHistorySnapshot()
    }
  }, [isDrawing, saveHistorySnapshot])

  // Clear all (reset to black)
  const handleClear = useCallback(() => {
    const maskCtx = maskCanvasRef.current?.getContext('2d')
    if (!maskCtx) return

    saveHistorySnapshot()
    clearCanvas(maskCtx)
    saveHistorySnapshot()
  }, [saveHistorySnapshot])

  // Invert mask
  const handleInvert = useCallback(() => {
    const maskCtx = maskCanvasRef.current?.getContext('2d')
    if (!maskCtx) return

    saveHistorySnapshot()
    invertMask(maskCtx)
    saveHistorySnapshot()
  }, [saveHistorySnapshot])

  // Complete and export
  const handleComplete = useCallback(async () => {
    const maskCanvas = maskCanvasRef.current
    if (!maskCanvas) return

    try {
      const blob = await canvasToBlob(maskCanvas)
      onComplete(blob)
    } catch (error) {
      console.error('Failed to export mask:', error)
    }
  }, [onComplete])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          undo()
        } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault()
          redo()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 gap-0">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle>{t('playground.capture.maskEditor.title')}</DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-2">
          {isLoading ? (
            <div
              className="flex items-center justify-center bg-muted rounded-lg"
              style={{ height: 400 }}
            >
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div
              ref={containerRef}
              className="relative mx-auto"
              style={{ width: canvasSize.width, height: canvasSize.height }}
            >
              {/* Background canvas (reference image) */}
              <canvas
                ref={backgroundCanvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                className="absolute inset-0 rounded-lg"
                style={referenceImage ? undefined : { filter: 'brightness(1.2) contrast(1.02) saturate(1.05)' }}
              />

              {/* Mask canvas (drawing layer) */}
              <canvas
                ref={maskCanvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                className="absolute inset-0 rounded-lg"
                style={{ opacity: 0.4 }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
              />

              {/* Brush cursor indicator */}
              {cursorPos && tool !== 'fill' && (
                <div
                  className="pointer-events-none absolute rounded-full border-2"
                  style={{
                    left: cursorPos.x,
                    top: cursorPos.y,
                    width: brushSize,
                    height: brushSize,
                    transform: 'translate(-50%, -50%)',
                    borderColor: tool === 'eraser' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)',
                    boxShadow: tool === 'eraser'
                      ? '0 0 0 1px rgba(255, 255, 255, 0.5)'
                      : '0 0 0 1px rgba(0, 0, 0, 0.5)'
                  }}
                />
              )}
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="px-4 py-3 border-t bg-muted/30">
          <div className="flex flex-wrap items-center gap-4">
            {/* Drawing tools */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={tool === 'brush' ? 'default' : 'outline'}
                    size="icon"
                    onClick={() => setTool('brush')}
                    disabled={disabled || isLoading}
                    className="h-9 w-9"
                  >
                    <Paintbrush className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('playground.capture.maskEditor.brush')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={tool === 'eraser' ? 'default' : 'outline'}
                    size="icon"
                    onClick={() => setTool('eraser')}
                    disabled={disabled || isLoading}
                    className="h-9 w-9"
                  >
                    <Eraser className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('playground.capture.maskEditor.eraser')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={tool === 'fill' ? 'default' : 'outline'}
                    size="icon"
                    onClick={() => setTool('fill')}
                    disabled={disabled || isLoading}
                    className="h-9 w-9"
                  >
                    <PaintBucket className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('playground.capture.maskEditor.fill')}</TooltipContent>
              </Tooltip>
            </div>

            <div className="h-6 w-px bg-border" />

            {/* Actions */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleInvert}
                    disabled={disabled || isLoading}
                    className="h-9 w-9"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('playground.capture.maskEditor.invert')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleClear}
                    disabled={disabled || isLoading}
                    className="h-9 w-9"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('playground.capture.maskEditor.clear')}</TooltipContent>
              </Tooltip>
            </div>

            <div className="h-6 w-px bg-border" />

            {/* Undo/Redo */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={undo}
                    disabled={disabled || isLoading || !canUndo}
                    className="h-9 w-9"
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('playground.capture.maskEditor.undo')} (Ctrl+Z)</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={redo}
                    disabled={disabled || isLoading || !canRedo}
                    className="h-9 w-9"
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('playground.capture.maskEditor.redo')} (Ctrl+Shift+Z)</TooltipContent>
              </Tooltip>
            </div>

            <div className="h-6 w-px bg-border" />

            {/* Brush size */}
            <div className="flex items-center gap-3 flex-1 min-w-[150px] max-w-[250px]">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {t('playground.capture.maskEditor.brushSize')}
              </span>
              <Slider
                value={[brushSize]}
                onValueChange={([v]) => setBrushSize(v)}
                min={1}
                max={100}
                step={1}
                disabled={disabled || isLoading || tool === 'fill'}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-8 text-right">{brushSize}</span>
            </div>
          </div>

          {/* Hint */}
          <p className="text-xs text-muted-foreground mt-2">
            {t('playground.capture.maskEditor.hint')}
          </p>
        </div>

        <DialogFooter className="p-4 pt-2 border-t">
          <Button variant="outline" onClick={onClose} disabled={disabled}>
            {t('playground.capture.maskEditor.cancel')}
          </Button>
          <Button onClick={handleComplete} disabled={disabled || isLoading}>
            {t('playground.capture.maskEditor.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
