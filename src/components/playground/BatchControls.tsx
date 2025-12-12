import { useTranslation } from 'react-i18next'
import { usePlaygroundStore } from '@/stores/playgroundStore'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Play, Loader2, ChevronDown, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BatchControlsProps {
  disabled?: boolean
  isRunning?: boolean
  onRun: () => void
  runLabel: string
  runningLabel: string
  price?: string
}

export function BatchControls({
  disabled,
  isRunning,
  onRun,
  runLabel,
  runningLabel,
  price
}: BatchControlsProps) {
  const { t } = useTranslation()
  const { getActiveTab, setBatchConfig } = usePlaygroundStore()
  const activeTab = getActiveTab()

  if (!activeTab) return null

  const { batchConfig } = activeTab
  const { enabled, repeatCount, randomizeSeed } = batchConfig

  const handleEnabledChange = (checked: boolean) => {
    setBatchConfig({ enabled: checked })
  }

  const handleCountChange = (delta: number) => {
    const newCount = Math.max(2, Math.min(50, repeatCount + delta))
    setBatchConfig({ repeatCount: newCount })
  }

  const handleCountInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10)
    if (!isNaN(value)) {
      setBatchConfig({ repeatCount: Math.max(2, Math.min(50, value)) })
    }
  }

  const handleRandomizeSeedChange = (checked: boolean) => {
    setBatchConfig({ randomizeSeed: checked })
  }

  const displayLabel = enabled && repeatCount > 1
    ? `${runLabel} (${repeatCount})`
    : runLabel

  // Calculate display price (multiply by repeatCount if batch enabled)
  const displayPrice = (() => {
    if (!price) return null
    if (!enabled) return price
    // Parse price string (e.g., "$0.01" -> 0.01)
    const numericPrice = parseFloat(price.replace(/[^0-9.]/g, ''))
    if (isNaN(numericPrice)) return price
    const totalPrice = numericPrice * repeatCount
    // Format back with same currency symbol
    const currencySymbol = price.match(/^[^0-9]*/)?.[0] || '$'
    return `${currencySymbol}${totalPrice.toFixed(2)}`
  })()

  return (
    <div className="flex">
      {/* Main Run Button */}
      <Button
        className={cn(
          'flex-1 gradient-bg hover:opacity-90 transition-opacity glow-sm',
          'rounded-r-none border-r border-r-white/20'
        )}
        onClick={onRun}
        disabled={disabled || isRunning}
      >
        {isRunning ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {runningLabel}
          </>
        ) : (
          <>
            <Play className="mr-2 h-4 w-4" />
            {displayLabel}
            {displayPrice && (
              <span className="ml-2 text-xs opacity-80">{displayPrice}</span>
            )}
          </>
        )}
      </Button>

      {/* Dropdown Trigger */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className={cn(
              'gradient-bg hover:opacity-90 transition-opacity glow-sm',
              'rounded-l-none px-2'
            )}
            disabled={disabled || isRunning}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-4">
          <div className="space-y-4">
            {/* Header */}
            <div className="font-medium text-sm">{t('playground.batch.settings')}</div>

            {enabled && (
              <>
                {/* Repeat Count */}
                <div className="space-y-2">
                  <Label className="text-sm">{t('playground.batch.repeatCount')}</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleCountChange(-1)}
                      disabled={repeatCount <= 2}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="number"
                      value={repeatCount}
                      onChange={handleCountInputChange}
                      className="h-8 w-16 text-center"
                      min={2}
                      max={50}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleCountChange(1)}
                      disabled={repeatCount >= 50}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Randomize Seed */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="randomize-seed" className="text-sm cursor-pointer">
                    {t('playground.batch.randomizeSeed')}
                  </Label>
                  <Switch
                    id="randomize-seed"
                    checked={randomizeSeed}
                    onCheckedChange={handleRandomizeSeedChange}
                  />
                </div>
              </>
            )}

            {/* Enable Batch - at bottom so position stays fixed */}
            <div className="flex items-center justify-between pt-2 border-t">
              <Label htmlFor="batch-enabled" className="text-sm cursor-pointer">
                {t('playground.batch.enable')}
              </Label>
              <Switch
                id="batch-enabled"
                checked={enabled}
                onCheckedChange={handleEnabledChange}
              />
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
