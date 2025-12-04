import { useState, useEffect, useMemo } from 'react'
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

// Aspect ratios to support
const ASPECT_RATIOS = [
  { label: '1:1', ratio: 1 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '2:3', ratio: 2 / 3 },
]

// Generate presets based on min/max range
function generatePresets(min: number, max: number) {
  const presets: { label: string; width: number; height: number }[] = []

  // Determine base sizes to use based on min/max range
  const baseSizes = [1024, 1536, 2048, 3072, 4096].filter(
    size => size >= min && size <= max
  )

  // If no standard sizes fit, use the min as base
  if (baseSizes.length === 0) {
    baseSizes.push(min)
  }

  // Prefer 2048 (2K) as the primary base if available, otherwise use the largest fitting size
  const primaryBase = baseSizes.includes(2048) ? 2048 : baseSizes[baseSizes.length - 1]

  for (const ar of ASPECT_RATIOS) {
    let width: number, height: number

    if (ar.ratio >= 1) {
      // Landscape or square: width is the larger dimension
      width = primaryBase
      height = Math.round(primaryBase / ar.ratio)
    } else {
      // Portrait: height is the larger dimension
      height = primaryBase
      width = Math.round(primaryBase * ar.ratio)
    }

    // Round to nearest 64 for better compatibility
    width = Math.round(width / 64) * 64
    height = Math.round(height / 64) * 64

    // Only add if both dimensions are within range
    if (width >= min && width <= max && height >= min && height <= max) {
      presets.push({ label: ar.label, width, height })
    }
  }

  return presets
}

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

  // Generate presets based on min/max range
  const availablePresets = useMemo(() => generatePresets(min, max), [min, max])

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

      {/* Current size and range display */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{width} × {height} px</span>
        <span>Range: {min} - {max}</span>
      </div>
    </div>
  )
}
