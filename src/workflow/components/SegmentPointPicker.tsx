/**
 * Dialog for selecting segmentation points by clicking on an image.
 * Left click = positive (include), right click = negative (exclude).
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Star, X, Trash2 } from 'lucide-react'

export interface SegmentPoint {
  point: [number, number]
  label: 0 | 1
}

interface SegmentPointPickerProps {
  referenceImageUrl: string
  onComplete: (points: SegmentPoint[]) => void
  onClose: () => void
}

const clamp = (x: number) => Math.max(0, Math.min(1, x))

export function SegmentPointPicker({ referenceImageUrl, onComplete, onClose }: SegmentPointPickerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [points, setPoints] = useState<SegmentPoint[]>([])
  const [imageSize, setImageSize] = useState({ width: 400, height: 300 })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!referenceImageUrl?.trim()) {
      setLoaded(true)
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const maxW = 700
      const maxH = 500
      let w = img.width
      let h = img.height
      if (w > maxW) {
        h = (h * maxW) / w
        w = maxW
      }
      if (h > maxH) {
        w = (w * maxH) / h
        h = maxH
      }
      setImageSize({ width: Math.round(w), height: Math.round(h) })
      setLoaded(true)
    }
    img.onerror = () => setLoaded(true)
    img.src = referenceImageUrl
  }, [referenceImageUrl])

  const getPointFromEvent = useCallback((e: React.MouseEvent<HTMLDivElement>): SegmentPoint | null => {
    const container = containerRef.current
    if (!container) return null
    const rect = container.getBoundingClientRect()
    const x = clamp((e.clientX - rect.left) / rect.width)
    const y = clamp((e.clientY - rect.top) / rect.height)
    const label = e.button === 2 ? 0 : 1
    return { point: [x, y], label: label as 0 | 1 }
  }, [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 2) return
    e.preventDefault()
    const point = getPointFromEvent(e)
    if (point) {
      setPoints(prev => [...prev, point])
    }
  }, [getPointFromEvent])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  const handleClear = useCallback(() => {
    setPoints([])
  }, [])

  const handleDone = useCallback(() => {
    if (points.length === 0) {
      onComplete([{ point: [0.5, 0.5], label: 1 }])
    } else {
      onComplete(points)
    }
    onClose()
  }, [points, onComplete, onClose])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl p-0 gap-0" onClick={e => e.stopPropagation()}>
        <DialogHeader className="p-4 pb-2">
          <DialogTitle>{t('workflow.segmentPointPicker.title')}</DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-2">
          {!loaded ? (
            <div className="flex items-center justify-center bg-muted rounded-lg" style={{ height: 300 }}>
              <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
            </div>
          ) : (
            <div
              ref={containerRef}
              className="relative mx-auto bg-muted rounded-lg overflow-hidden cursor-crosshair select-none"
              style={{ width: imageSize.width, height: imageSize.height }}
              onMouseDown={handleClick}
              onContextMenu={handleContextMenu}
            >
              <img
                src={referenceImageUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                draggable={false}
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
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t bg-muted/30 flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">
            {t('workflow.segmentPointPicker.hint')} ({points.length} {t('workflow.segmentPointPicker.points')})
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleClear} disabled={points.length === 0}>
              <Trash2 className="h-4 w-4 mr-1" />
              {t('workflow.segmentPointPicker.clear')}
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleDone}>
              {t('workflow.segmentPointPicker.done')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
