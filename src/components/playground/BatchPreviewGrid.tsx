import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { BatchConfig } from '@/types/batch'

interface BatchPreviewGridProps {
  inputs: Record<string, unknown>[]
  config: BatchConfig
  className?: string
}

export function BatchPreviewGrid({ inputs, config, className }: BatchPreviewGridProps) {
  const { t } = useTranslation()

  if (inputs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>{t('playground.batch.noPreview')}</p>
      </div>
    )
  }

  // Get seed value if present
  const getSeedValue = (input: Record<string, unknown>): string | null => {
    if ('seed' in input && input.seed !== undefined) {
      return String(input.seed)
    }
    return null
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t('playground.batch.preview')} ({inputs.length} {t('playground.batch.items')})
        </h3>
        {config.randomizeSeed && (
          <span className="text-xs text-muted-foreground">
            {t('playground.batch.seedsGenerated')}
          </span>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 p-1">
          {inputs.map((input, index) => {
            const seed = getSeedValue(input)
            return (
              <div
                key={index}
                className="border rounded-lg p-3 bg-card hover:bg-muted/50 transition-colors cursor-default"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">#{index + 1}</span>
                  {seed && (
                    <span className="text-xs font-mono text-muted-foreground">{seed}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
