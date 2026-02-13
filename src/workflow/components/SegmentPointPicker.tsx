/**
 * Dialog for selecting segmentation points with live mask preview.
 * Hover = real-time preview, left click = add include point, right click = add exclude point.
 * Uses SAM worker to encode image once, then decodes mask in real-time.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Star, X, Trash2, Loader2 } from 'lucide-react'
import { useSegmentAnythingWorker, type MaskResult } from '@/hooks/useSegmentAnythingWorker'

export interface SegmentPoint {
  point: [number, number]
  label: 0 | 1
}

interface SegmentPointPickerProps {
  referenceImageUrl: string
  onComplete: (points: SegmentPoint[], maskBlob?: Blob) => void
  onClose: () => void
}

const MASK_COLOR = { r: 0, g: 114, b: 189 }
const clamp = (x: number) => Math.max(0, Math.min(1, x))

export function SegmentPointPicker({ referenceImageUrl, onComplete, onClose }: SegmentPointPickerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)

  // Fixed points (clicked)
  const [points, setPoints] = useState<SegmentPoint[]>([])
  const pointsRef = useRef<SegmentPoint[]>([])
  pointsRef.current = points

  // Image state
  const [imageSize, setImageSize] = useState({ width: 400, height: 300 })
  const [naturalSize, setNaturalSize] = useState({ width: 400, height: 300 })
  const [loaded, setLoaded] = useState(false)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)

  // Worker state
  const [encoding, setEncoding] = useState(false)
  const [encoded, setEncoded] = useState(false)
  const [lastMask, setLastMask] = useState<MaskResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Decode queue
  const decodingRef = useRef(false)
  const pendingDecodeRef = useRef<SegmentPoint[] | null>(null)
  const isHoveringRef = useRef(false)
  const lastHoverRef = useRef<{ x: number; y: number } | null>(null)

  const {
    segmentImage,
    decodeMask,
    dispose
  } = useSegmentAnythingWorker({
    onError: (msg) => setError(msg)
  })

  // ── Load image & convert to data URL ──
  useEffect(() => {
    if (!referenceImageUrl?.trim()) { setLoaded(true); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const maxW = 700, maxH = 500
      let w = img.width, h = img.height
      if (w > maxW) { h = (h * maxW) / w; w = maxW }
      if (h > maxH) { w = (w * maxH) / h; h = maxH }
      setImageSize({ width: Math.round(w), height: Math.round(h) })
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      setImageDataUrl(canvas.toDataURL('image/png'))
      setLoaded(true)
    }
    img.onerror = () => setLoaded(true)
    img.src = referenceImageUrl
  }, [referenceImageUrl])

  // ── Encode image with SAM ──
  const encodingRef = useRef(false)
  useEffect(() => {
    if (!loaded || !imageDataUrl || encoded || encodingRef.current) return
    encodingRef.current = true
    let cancelled = false
    const run = async () => {
      setEncoding(true)
      setError(null)
      try {
        await segmentImage(imageDataUrl)
        if (!cancelled) setEncoded(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setEncoding(false)
        encodingRef.current = false
      }
    }
    run()
    return () => { cancelled = true }
  }, [loaded, imageDataUrl, encoded, segmentImage])

  // ── Init mask canvas ──
  useEffect(() => {
    const canvas = maskCanvasRef.current
    if (!canvas || !loaded) return
    canvas.width = naturalSize.width
    canvas.height = naturalSize.height
  }, [loaded, naturalSize])

  // ── Draw mask overlay ──
  const drawMask = useCallback((result: MaskResult) => {
    const canvas = maskCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const numMasks = result.scores.length
    let bestIdx = 0
    for (let i = 1; i < numMasks; i++) {
      if (result.scores[i] > result.scores[bestIdx]) bestIdx = i
    }
    const ppm = result.width * result.height
    const off = bestIdx * ppm
    const imageData = ctx.createImageData(result.width, result.height)
    const d = imageData.data
    for (let i = 0; i < ppm; i++) {
      if (result.mask[off + i] === 1) {
        const o = i * 4
        d[o] = MASK_COLOR.r; d[o + 1] = MASK_COLOR.g; d[o + 2] = MASK_COLOR.b; d[o + 3] = 180
      }
    }
    if (canvas.width !== result.width || canvas.height !== result.height) {
      const tmp = document.createElement('canvas')
      tmp.width = result.width; tmp.height = result.height
      tmp.getContext('2d')!.putImageData(imageData, 0, 0)
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height)
    } else {
      ctx.putImageData(imageData, 0, 0)
    }
  }, [])

  const clearMask = useCallback(() => {
    const canvas = maskCanvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [])

  // ── Decode with queue (shared by hover + click) ──
  const runDecode = useCallback(async (pts: SegmentPoint[]) => {
    if (!encoded || pts.length === 0) {
      clearMask()
      // Only clear lastMask if these are fixed points (no hover)
      return
    }
    if (decodingRef.current) {
      pendingDecodeRef.current = pts
      return
    }
    decodingRef.current = true
    try {
      const result = await decodeMask(pts.map(p => ({ point: p.point, label: p.label })))
      // Only draw if still relevant (hovering or these are fixed points)
      if (isHoveringRef.current || pts === pointsRef.current || pts.length === pointsRef.current.length) {
        drawMask(result)
      }
      // Update lastMask only for fixed-point decodes (when no hover point appended)
      // We check: if the pts length matches fixed points, it's a fixed decode
      if (pts.length === pointsRef.current.length) {
        setLastMask(result)
      }
    } catch (e) {
      console.error('Decode error:', e)
    } finally {
      decodingRef.current = false
      const pending = pendingDecodeRef.current
      if (pending) {
        pendingDecodeRef.current = null
        runDecode(pending)
      }
    }
  }, [encoded, decodeMask, drawMask, clearMask])

  // ── Decode fixed points when they change ──
  useEffect(() => {
    if (points.length === 0) {
      // If hovering, keep hover preview; otherwise clear
      if (!isHoveringRef.current) {
        clearMask()
        setLastMask(null)
      }
      return
    }
    runDecode(points)
  }, [points, runDecode, clearMask])

  // ── Hover decode ──
  const decodeHover = useCallback((hoverPt: SegmentPoint) => {
    // Combine fixed points + hover point
    const allPts = [...pointsRef.current, hoverPt]
    runDecode(allPts)
  }, [runDecode])

  // ── Mouse handlers ──
  const getNormalizedCoords = useCallback((e: React.MouseEvent<HTMLDivElement>): [number, number] | null => {
    const container = containerRef.current
    if (!container) return null
    const rect = container.getBoundingClientRect()
    return [clamp((e.clientX - rect.left) / rect.width), clamp((e.clientY - rect.top) / rect.height)]
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!encoded) return
    isHoveringRef.current = true
    const coords = getNormalizedCoords(e)
    if (!coords) return
    const [x, y] = coords
    // Throttle: skip if same pixel area
    if (lastHoverRef.current && Math.abs(lastHoverRef.current.x - x) < 0.005 && Math.abs(lastHoverRef.current.y - y) < 0.005) return
    lastHoverRef.current = { x, y }
    decodeHover({ point: [x, y], label: 1 })
  }, [encoded, getNormalizedCoords, decodeHover])

  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false
    lastHoverRef.current = null
    // Restore to fixed-points-only mask
    if (pointsRef.current.length > 0) {
      runDecode(pointsRef.current)
    } else {
      clearMask()
    }
  }, [runDecode, clearMask])

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 2) return
    e.preventDefault()
    e.stopPropagation()
    if (!encoded) return
    const coords = getNormalizedCoords(e)
    if (!coords) return
    const label = e.button === 2 ? 0 : 1
    setPoints(prev => [...prev, { point: [coords[0], coords[1]], label: label as 0 | 1 }])
  }, [encoded, getNormalizedCoords])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleClear = useCallback(() => {
    setPoints([])
    setLastMask(null)
    clearMask()
  }, [clearMask])

  // ── Export mask as PNG blob ──
  const exportMaskBlob = useCallback(async (): Promise<Blob | undefined> => {
    if (!lastMask) return undefined
    const { mask, width, height, scores } = lastMask
    let bestIdx = 0
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[bestIdx]) bestIdx = i
    }
    const ppm = width * height
    const off = bestIdx * ppm
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')!
    const imageData = ctx.createImageData(width, height)
    const d = imageData.data
    for (let i = 0; i < ppm; i++) {
      const v = mask[off + i] === 1 ? 255 : 0
      const o = i * 4
      d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = v ? 255 : 0
    }
    ctx.putImageData(imageData, 0, 0)
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Failed to export mask')), 'image/png')
    })
  }, [lastMask])

  const handleDone = useCallback(async () => {
    const maskBlob = await exportMaskBlob()
    if (points.length === 0) {
      onComplete([{ point: [0.5, 0.5], label: 1 }], maskBlob)
    } else {
      onComplete(points, maskBlob)
    }
    onClose()
  }, [points, exportMaskBlob, onComplete, onClose])

  // Cleanup worker on unmount
  useEffect(() => {
    return () => { dispose() }
  }, [dispose])

  const statusText = encoding
    ? t('workflow.segmentPointPicker.encoding')
    : !encoded
      ? t('workflow.segmentPointPicker.waitingEncode')
      : null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl p-0 gap-0" onClick={e => e.stopPropagation()}>
        <DialogHeader className="p-4 pb-2">
          <DialogTitle>{t('workflow.segmentPointPicker.title')}</DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-2">
          {!loaded ? (
            <div className="flex items-center justify-center bg-muted rounded-lg" style={{ height: 300 }}>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div
              ref={containerRef}
              className={`relative mx-auto bg-muted rounded-lg overflow-hidden select-none ${encoded ? 'cursor-crosshair' : 'cursor-wait'}`}
              style={{ width: imageSize.width, height: imageSize.height }}
              onMouseDown={handleClick}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onContextMenu={handleContextMenu}
            >
              <img
                src={referenceImageUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                draggable={false}
              />
              <canvas
                ref={maskCanvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ opacity: 0.55 }}
              />
              {points.map((pt, i) => (
                <div
                  key={i}
                  className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${pt.point[0] * 100}%`, top: `${pt.point[1] * 100}%` }}
                >
                  {pt.label === 1 ? (
                    <Star className="h-6 w-6 text-yellow-400 fill-yellow-400 drop-shadow-lg" />
                  ) : (
                    <X className="h-6 w-6 text-red-500 drop-shadow-lg" strokeWidth={3} />
                  )}
                </div>
              ))}
              {encoding && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                  <div className="flex items-center gap-2 text-white text-sm">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {t('workflow.segmentPointPicker.encoding')}
                  </div>
                </div>
              )}
            </div>
          )}
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
        <div className="px-4 py-3 border-t bg-muted/30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t('workflow.segmentPointPicker.hint')} ({points.length} {t('workflow.segmentPointPicker.points')})
            </span>
            {statusText && (
              <span className="text-xs text-blue-400 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {statusText}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleClear} disabled={points.length === 0}>
              <Trash2 className="h-4 w-4 mr-1" />
              {t('workflow.segmentPointPicker.clear')}
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleDone} disabled={encoding || (points.length > 0 && !lastMask)}>
              {t('workflow.segmentPointPicker.done')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
