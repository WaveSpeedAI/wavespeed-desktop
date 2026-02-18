import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { type SmartMode, getModelsForMode, getDefaultModel, getTagLabelKey } from '@/lib/smartGenerateUtils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ModelSelectorProps {
  mode: SmartMode
  selectedModelId: string | null
  onSelect: (modelId: string) => void
  disabled?: boolean
}

const TAG_COLORS: Record<string, string> = {
  recommended: 'text-emerald-600 dark:text-emerald-400',
  ultimate: 'text-purple-600 dark:text-purple-400',
  value: 'text-blue-600 dark:text-blue-400',
  fast: 'text-amber-600 dark:text-amber-400',
  turbo: 'text-orange-600 dark:text-orange-400',
  flagship: 'text-indigo-600 dark:text-indigo-400',
  premium: 'text-rose-600 dark:text-rose-400',
  chinese: 'text-red-600 dark:text-red-400',
  detail: 'text-cyan-600 dark:text-cyan-400',
  understanding: 'text-violet-600 dark:text-violet-400',
}

export function SmartModelSelector({ mode, selectedModelId, onSelect, disabled }: ModelSelectorProps) {
  const { t } = useTranslation()
  const models = getModelsForMode(mode)
  const defaultModel = getDefaultModel(mode)
  const currentId = selectedModelId || defaultModel.modelId

  return (
    <Select value={currentId} onValueChange={onSelect} disabled={disabled}>
      <SelectTrigger className="w-full h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {models.map((model) => {
          const tagColor = TAG_COLORS[model.tag] || 'text-muted-foreground'
          return (
            <SelectItem key={model.modelId} value={model.modelId}>
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-sm truncate">{model.label}</span>
                <span className={cn('text-[10px] font-medium shrink-0', tagColor)}>
                  {t(getTagLabelKey(model.tag))}
                </span>
                <span className="text-xs text-muted-foreground font-mono shrink-0">${model.price.toFixed(3)}</span>
              </div>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
