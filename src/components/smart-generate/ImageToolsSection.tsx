import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { apiClient } from '@/api/client'
import { extractOutput } from '@/lib/smartGenerateUtils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Wand2, ChevronDown, ChevronUp, Loader2, Play } from 'lucide-react'

interface ImageToolsSectionProps {
  sourceImages: string[]
  isLocked: boolean
  onAddToolResult: (outputUrl: string, modelId: string, cost: number) => void
}

// Compass grid: position → horizontal_angle value
const COMPASS_GRID: { label: string; angle: number }[] = [
  { label: 'NW', angle: 315 },
  { label: 'N',  angle: 0 },
  { label: 'NE', angle: 45 },
  { label: 'W',  angle: 270 },
  { label: '\u00B7', angle: -1 }, // center dot (no selection)
  { label: 'E',  angle: 90 },
  { label: 'SW', angle: 225 },
  { label: 'S',  angle: 180 },
  { label: 'SE', angle: 135 },
]

const VERTICAL_ANGLES = [
  { value: -30, labelKey: 'smartGenerate.config.verticalLow' },
  { value: 0,   labelKey: 'smartGenerate.config.verticalEye' },
  { value: 30,  labelKey: 'smartGenerate.config.verticalHigh' },
  { value: 60,  labelKey: 'smartGenerate.config.verticalTop' },
]

const DISTANCES = [
  { value: 0, labelKey: 'smartGenerate.config.distanceClose' },
  { value: 1, labelKey: 'smartGenerate.config.distanceMedium' },
  { value: 2, labelKey: 'smartGenerate.config.distanceWide' },
]

const ANGLE_MODEL = 'wavespeed-ai/qwen-image/edit-multiple-angles'
const ANGLE_PRICE = 0.025

export function ImageToolsSection({ sourceImages, isLocked, onAddToolResult }: ImageToolsSectionProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  // Angle params
  const [horizontalAngle, setHorizontalAngle] = useState(0)
  const [verticalAngle, setVerticalAngle] = useState(0)
  const [distance, setDistance] = useState(1)

  // Execution state
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = isLocked || running

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    try {
      const result = await apiClient.run(ANGLE_MODEL, {
        images: sourceImages.slice(0, 3),
        horizontal_angle: horizontalAngle,
        vertical_angle: verticalAngle,
        distance,
      })
      const url = extractOutput(result)
      if (url) {
        onAddToolResult(url, ANGLE_MODEL, ANGLE_PRICE)
      } else {
        setError(t('smartGenerate.error.noOutput'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('smartGenerate.error.failed'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <Wand2 className="h-3.5 w-3.5" />
        <span className="font-medium">{t('smartGenerate.config.imageToolsAngle')}</span>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 ml-auto" />
          : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
      </button>

      {expanded && (
        <div className="space-y-3 pt-1">
          {/* Horizontal — 3×3 compass */}
          <div className="space-y-1">
            <Label className="text-xs">{t('smartGenerate.config.horizontalAngle')}</Label>
            <div className="grid grid-cols-3 gap-1 w-fit">
              {COMPASS_GRID.map((cell) => (
                <button
                  key={cell.label}
                  onClick={() => cell.angle >= 0 && setHorizontalAngle(cell.angle)}
                  disabled={disabled || cell.angle < 0}
                  className={cn(
                    'w-10 h-10 rounded-md border text-xs font-medium transition-colors',
                    cell.angle < 0 && 'bg-muted/30 text-muted-foreground cursor-default',
                    cell.angle >= 0 && horizontalAngle === cell.angle
                      ? 'border-primary bg-primary/5 text-primary'
                      : cell.angle >= 0 && 'text-muted-foreground hover:bg-muted/50',
                    disabled && cell.angle >= 0 && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {cell.label}
                </button>
              ))}
            </div>
          </div>

          {/* Vertical angle */}
          <div className="space-y-1">
            <Label className="text-xs">{t('smartGenerate.config.verticalAngle')}</Label>
            <div className="flex gap-1.5">
              {VERTICAL_ANGLES.map((v) => (
                <button
                  key={v.value}
                  onClick={() => setVerticalAngle(v.value)}
                  disabled={disabled}
                  className={cn(
                    'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                    verticalAngle === v.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'text-muted-foreground hover:bg-muted/50',
                    disabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {t(v.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Distance */}
          <div className="space-y-1">
            <Label className="text-xs">{t('smartGenerate.config.distance')}</Label>
            <div className="flex gap-1.5">
              {DISTANCES.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDistance(d.value)}
                  disabled={disabled}
                  className={cn(
                    'flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                    distance === d.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'text-muted-foreground hover:bg-muted/50',
                    disabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {t(d.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Run button */}
          <Button onClick={handleRun} disabled={disabled} size="sm" className="w-full">
            {running ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                {t('smartGenerate.config.toolRunning')}
              </>
            ) : (
              <>
                <Play className="mr-2 h-3.5 w-3.5" />
                {t('smartGenerate.config.runTool')} ${ANGLE_PRICE.toFixed(3)}
              </>
            )}
          </Button>

          {/* Error */}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
