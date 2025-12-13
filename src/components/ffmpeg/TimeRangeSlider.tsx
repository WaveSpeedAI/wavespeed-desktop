import { useRef, useCallback, useEffect, useState } from 'react'
import { formatDuration } from '@/lib/ffmpegFormats'
import { cn } from '@/lib/utils'

interface TimeRangeSliderProps {
  duration: number
  startTime: number
  endTime: number
  onStartChange: (time: number) => void
  onEndChange: (time: number) => void
  className?: string
}

export function TimeRangeSlider({
  duration,
  startTime,
  endTime,
  onStartChange,
  onEndChange,
  className
}: TimeRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'start' | 'end' | 'range' | null>(null)
  const dragStartRef = useRef({ x: 0, startTime: 0, endTime: 0 })

  const getTimeFromPosition = useCallback(
    (clientX: number): number => {
      if (!trackRef.current) return 0
      const rect = trackRef.current.getBoundingClientRect()
      const x = clientX - rect.left
      const percentage = Math.max(0, Math.min(1, x / rect.width))
      return percentage * duration
    },
    [duration]
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, type: 'start' | 'end' | 'range') => {
      e.preventDefault()
      setDragging(type)
      dragStartRef.current = {
        x: e.clientX,
        startTime,
        endTime
      }
    },
    [startTime, endTime]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return

      const time = getTimeFromPosition(e.clientX)

      if (dragging === 'start') {
        const newStart = Math.min(time, endTime - 0.1)
        onStartChange(Math.max(0, newStart))
      } else if (dragging === 'end') {
        const newEnd = Math.max(time, startTime + 0.1)
        onEndChange(Math.min(duration, newEnd))
      } else if (dragging === 'range') {
        const delta = e.clientX - dragStartRef.current.x
        const timeDelta = (delta / (trackRef.current?.offsetWidth || 1)) * duration
        const rangeDuration = dragStartRef.current.endTime - dragStartRef.current.startTime

        let newStart = dragStartRef.current.startTime + timeDelta
        let newEnd = dragStartRef.current.endTime + timeDelta

        // Clamp to bounds
        if (newStart < 0) {
          newStart = 0
          newEnd = rangeDuration
        }
        if (newEnd > duration) {
          newEnd = duration
          newStart = duration - rangeDuration
        }

        onStartChange(newStart)
        onEndChange(newEnd)
      }
    },
    [dragging, getTimeFromPosition, startTime, endTime, duration, onStartChange, onEndChange]
  )

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  useEffect(() => {
    if (dragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  const startPercent = (startTime / duration) * 100
  const endPercent = (endTime / duration) * 100
  const selectedDuration = endTime - startTime

  return (
    <div className={cn('space-y-2', className)}>
      {/* Time labels */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0:00</span>
        <span className="font-medium text-foreground">
          {formatDuration(selectedDuration)}
        </span>
        <span>{formatDuration(duration)}</span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-8 bg-muted rounded-lg cursor-pointer"
      >
        {/* Unselected region (before) */}
        <div
          className="absolute inset-y-0 left-0 bg-muted-foreground/20 rounded-l-lg"
          style={{ width: `${startPercent}%` }}
        />

        {/* Selected region */}
        <div
          className={cn(
            'absolute inset-y-0 bg-primary/30 cursor-grab',
            dragging === 'range' && 'cursor-grabbing'
          )}
          style={{
            left: `${startPercent}%`,
            width: `${endPercent - startPercent}%`
          }}
          onMouseDown={(e) => handleMouseDown(e, 'range')}
        />

        {/* Unselected region (after) */}
        <div
          className="absolute inset-y-0 right-0 bg-muted-foreground/20 rounded-r-lg"
          style={{ width: `${100 - endPercent}%` }}
        />

        {/* Start handle */}
        <div
          className={cn(
            'absolute top-0 bottom-0 w-1 bg-primary cursor-ew-resize hover:w-1.5 transition-all',
            dragging === 'start' && 'w-1.5'
          )}
          style={{ left: `${startPercent}%`, transform: 'translateX(-50%)' }}
          onMouseDown={(e) => handleMouseDown(e, 'start')}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-6 rounded bg-primary flex items-center justify-center shadow-md">
            <div className="w-0.5 h-3 bg-primary-foreground/50 rounded-full" />
          </div>
        </div>

        {/* End handle */}
        <div
          className={cn(
            'absolute top-0 bottom-0 w-1 bg-primary cursor-ew-resize hover:w-1.5 transition-all',
            dragging === 'end' && 'w-1.5'
          )}
          style={{ left: `${endPercent}%`, transform: 'translateX(-50%)' }}
          onMouseDown={(e) => handleMouseDown(e, 'end')}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-6 rounded bg-primary flex items-center justify-center shadow-md">
            <div className="w-0.5 h-3 bg-primary-foreground/50 rounded-full" />
          </div>
        </div>
      </div>

      {/* Time inputs */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Start:</span>
          <span className="font-mono">{formatDuration(startTime)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">End:</span>
          <span className="font-mono">{formatDuration(endTime)}</span>
        </div>
      </div>
    </div>
  )
}
