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

// 1K presets (~1 megapixel total, similar to 1024×1024)
const PRESETS_1K = [
  { label: '1:1', width: 1024, height: 1024 },   // 1,048,576 px
  { label: '16:9', width: 1280, height: 720 },   // 921,600 px (HD)
  { label: '9:16', width: 720, height: 1280 },   // 921,600 px
  { label: '4:3', width: 1152, height: 864 },    // 995,328 px
  { label: '3:4', width: 864, height: 1152 },    // 995,328 px
  { label: '3:2', width: 1216, height: 832 },    // 1,011,712 px
  { label: '2:3', width: 832, height: 1216 },    // 1,011,712 px
]

// 2K presets (~4 megapixels total, similar to 2048×2048)
const PRESETS_2K = [
  { label: '1:1', width: 2048, height: 2048 },   // 4,194,304 px
  { label: '16:9', width: 2560, height: 1440 },  // 3,686,400 px (QHD/2K)
  { label: '9:16', width: 1440, height: 2560 },  // 3,686,400 px
  { label: '4:3', width: 2304, height: 1728 },   // 3,981,312 px
  { label: '3:4', width: 1728, height: 2304 },   // 3,981,312 px
  { label: '3:2', width: 2432, height: 1664 },   // 4,046,848 px
  { label: '2:3', width: 1664, height: 2432 },   // 4,046,848 px
]

// Generate presets based on min/max range
// For each aspect ratio, prefer 2K if it fits, otherwise use 1K
function generatePresets(min: number, max: number) {
  const presets: { label: string; width: number; height: number }[] = []

  for (let i = 0; i < PRESETS_1K.length; i++) {
    const preset1k = PRESETS_1K[i]
    const preset2k = PRESETS_2K[i]

    // Try 2K first
    if (preset2k.width >= min && preset2k.width <= max && preset2k.height >= min && preset2k.height <= max) {
      presets.push(preset2k)
    } else if (preset1k.width >= min && preset1k.width <= max && preset1k.height >= min && preset1k.height <= max) {
      // Fall back to 1K
      presets.push(preset1k)
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
