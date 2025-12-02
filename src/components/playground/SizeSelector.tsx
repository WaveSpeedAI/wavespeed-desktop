import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface SizeSelectorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  min?: number  // minimum dimension value from schema
  max?: number  // maximum dimension value from schema
}

// Common size presets
const PRESETS = [
  { label: '1:1', width: 1024, height: 1024 },
  { label: '16:9', width: 1280, height: 720 },
  { label: '9:16', width: 720, height: 1280 },
  { label: '4:3', width: 1024, height: 768 },
  { label: '3:4', width: 768, height: 1024 },
  { label: '3:2', width: 1152, height: 768 },
  { label: '2:3', width: 768, height: 1152 },
]

export function SizeSelector({ value, onChange, disabled, min = 256, max = 1536 }: SizeSelectorProps) {
  const [width, setWidth] = useState(1024)
  const [height, setHeight] = useState(1024)

  // Parse value into width/height
  useEffect(() => {
    if (value) {
      const parts = value.split('*')
      if (parts.length === 2) {
        const w = parseInt(parts[0], 10)
        const h = parseInt(parts[1], 10)
        if (!isNaN(w) && !isNaN(h)) {
          setWidth(w)
          setHeight(h)
        }
      }
    }
  }, [value])

  const handleWidthChange = (w: number) => {
    setWidth(w)
    onChange(`${w}*${height}`)
  }

  const handleHeightChange = (h: number) => {
    setHeight(h)
    onChange(`${width}*${h}`)
  }

  const handlePreset = (w: number, h: number) => {
    setWidth(w)
    setHeight(h)
    onChange(`${w}*${h}`)
  }

  const handleSwap = () => {
    setWidth(height)
    setHeight(width)
    onChange(`${height}*${width}`)
  }

  // Filter presets to only show ones within min/max range
  const availablePresets = PRESETS.filter(p =>
    p.width >= min && p.width <= max && p.height >= min && p.height <= max
  )

  const isCurrentPreset = (w: number, h: number) => width === w && height === h

  return (
    <div className="space-y-3">
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2">
        {availablePresets.map((preset) => (
          <Button
            key={`${preset.width}x${preset.height}`}
            type="button"
            variant={isCurrentPreset(preset.width, preset.height) ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePreset(preset.width, preset.height)}
            disabled={disabled}
            className="text-xs"
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {/* Custom size inputs */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Width</Label>
          <Input
            type="number"
            value={width}
            onChange={(e) => handleWidthChange(parseInt(e.target.value, 10) || min)}
            min={min}
            max={max}
            step={64}
            disabled={disabled}
            className="h-9"
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleSwap}
          disabled={disabled}
          className="mt-5 h-9 w-9"
          title="Swap width and height"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3L4 7l4 4" />
            <path d="M4 7h16" />
            <path d="M16 21l4-4-4-4" />
            <path d="M20 17H4" />
          </svg>
        </Button>

        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Height</Label>
          <Input
            type="number"
            value={height}
            onChange={(e) => handleHeightChange(parseInt(e.target.value, 10) || min)}
            min={min}
            max={max}
            step={64}
            disabled={disabled}
            className="h-9"
          />
        </div>
      </div>

      {/* Current size display */}
      <div className="text-xs text-muted-foreground text-center">
        {width} x {height} pixels
      </div>
    </div>
  )
}
