import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Loader2, X, CheckCircle2, XCircle } from 'lucide-react'
import type { BatchState } from '@/types/batch'
import { cn } from '@/lib/utils'

interface BatchProgressProps {
  state: BatchState
  onCancel: () => void
  className?: string
}

export function BatchProgress({ state, onCancel, className }: BatchProgressProps) {
  const { t } = useTranslation()
  const { queue, currentIndex, completedCount, failedCount, cancelRequested } = state

  const totalCount = queue.length
  const progress = totalCount > 0 ? ((completedCount + failedCount) / totalCount) * 100 : 0

  return (
    <div className={cn('flex flex-col items-center justify-center h-full', className)}>
      <div className="w-full max-w-md space-y-4">
        {/* Status Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {cancelRequested ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm font-medium">{t('playground.batch.cancelling')}</span>
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium">
                  {t('playground.batch.running', { current: currentIndex + 1, total: totalCount })}
                </span>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={cancelRequested}
            className="text-destructive hover:text-destructive"
          >
            <X className="h-3 w-3 mr-1" />
            {t('playground.batch.cancel')}
          </Button>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={progress} className="h-3" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{Math.round(progress)}%</span>
            <span>{completedCount + failedCount} / {totalCount}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-center gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>
              {t('playground.batch.completed', { count: completedCount })}
            </span>
          </div>
          {failedCount > 0 && (
            <div className="flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-destructive" />
              <span>
                {t('playground.batch.failed', { count: failedCount })}
              </span>
            </div>
          )}
        </div>

        {/* Queue Preview */}
        <div className="flex items-center justify-center gap-1 flex-wrap max-w-full pt-2">
          {queue.map((item, index) => (
            <div
              key={item.id}
              className={cn(
                'w-2 h-2 rounded-full transition-colors',
                item.status === 'completed' && 'bg-green-500',
                item.status === 'failed' && 'bg-destructive',
                item.status === 'running' && 'bg-primary animate-pulse',
                item.status === 'pending' && 'bg-muted-foreground/30',
                item.status === 'cancelled' && 'bg-muted-foreground/50'
              )}
              title={`#${index + 1}: ${item.status}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
