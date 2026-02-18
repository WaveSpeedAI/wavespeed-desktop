import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { apiClient } from '@/api/client'
import { extractOutput } from '@/lib/smartGenerateUtils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Wand2, ChevronDown, ChevronUp, Loader2, Play } from 'lucide-react'

interface ImageToolsSectionProps {
  sourceImages: string[]
  isLocked: boolean
  onAddToolResult: (outputUrl: string, modelId: string, cost: number) => void
}

type ActiveTool = 'angle' | 'relight'

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

const LIGHT_TYPES = [
  'midday', 'golden hour', 'sunrise light', 'sunset light',
  'moonlight', 'cloudy', 'overcast', 'studio light',
  'neon light', 'warm light', 'cool light', 'dramatic light', 'candlelight',
]

const LIGHT_DIRECTIONS = [
  { value: 'front',    labelKey: 'smartGenerate.config.lightDirFront' },
  { value: 'side',     labelKey: 'smartGenerate.config.lightDirSide' },
  { value: 'bottom',   labelKey: 'smartGenerate.config.lightDirBottom' },
  { value: 'top-down', labelKey: 'smartGenerate.config.lightDirTopDown' },
]

export function ImageToolsSection({ sourceImages, isLocked, onAddToolResult }: ImageToolsSectionProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [activeTool, setActiveTool] = useState<ActiveTool>('angle')

  // Angle params
  const [horizontalAngle, setHorizontalAngle] = useState(0)
  const [verticalAngle, setVerticalAngle] = useState(0)
  const [distance, setDistance] = useState(1)

  // Relight params
  const [lightType, setLightType] = useState('midday')
  const [lightDirection, setLightDirection] = useState('front')

  // Execution state
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = isLocked || running
  const price = activeTool === 'angle' ? 0.025 : 0.04

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    try {
      const toolModelId = activeTool === 'angle'
        ? 'wavespeed-ai/qwen-image/edit-multiple-angles'
        : 'bria/fibo/relight'
      let result
      if (activeTool === 'angle') {
        result = await apiClient.run(toolModelId, {
          images: sourceImages.slice(0, 3),
          horizontal_angle: horizontalAngle,
          vertical_angle: verticalAngle,
          distance,
        })
      } else {
        result = await apiClient.run(toolModelId, {
          image: sourceImages[0],
          light_type: lightType,
          light_direction: lightDirection,
        })
      }
      const url = extractOutput(result)
      if (url) {
        onAddToolResult(url, toolModelId, price)
      } else {
        setError('No output returned')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
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
        <span className="font-medium">{t('smartGenerate.config.imageTools')}</span>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 ml-auto" />
          : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
      </button>

      {expanded && (
        <div className="space-y-3 pt-1">
          {/* Tab switcher */}
          <div className="flex gap-1.5">
            {(['angle', 'relight'] as const).map((tool) => (
              <button
                key={tool}
                onClick={() => setActiveTool(tool)}
                disabled={disabled}
                className={cn(
                  'flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  activeTool === tool
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'text-muted-foreground hover:bg-muted/50',
                  disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                {t(tool === 'angle' ? 'smartGenerate.config.imageToolsAngle' : 'smartGenerate.config.imageToolsRelight')}
              </button>
            ))}
          </div>

          {/* ─── Angle tab ─── */}
          {activeTool === 'angle' && (
            <div className="space-y-2.5">
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
            </div>
          )}

          {/* ─── Relight tab ─── */}
          {activeTool === 'relight' && (
            <div className="space-y-2.5">
              <div className="space-y-1">
                <Label className="text-xs">{t('smartGenerate.config.lightType')}</Label>
                <Select value={lightType} onValueChange={setLightType} disabled={disabled}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIGHT_TYPES.map((lt) => (
                      <SelectItem key={lt} value={lt}>
                        {lt.charAt(0).toUpperCase() + lt.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">{t('smartGenerate.config.lightDirection')}</Label>
                <div className="flex gap-1.5">
                  {LIGHT_DIRECTIONS.map((ld) => (
                    <button
                      key={ld.value}
                      onClick={() => setLightDirection(ld.value)}
                      disabled={disabled}
                      className={cn(
                        'flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                        lightDirection === ld.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'text-muted-foreground hover:bg-muted/50',
                        disabled && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      {t(ld.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

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
                {t('smartGenerate.config.runTool')} ${price.toFixed(3)}
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
