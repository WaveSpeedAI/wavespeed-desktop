import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { PipelinePhase } from '@/stores/smartGenerateStore'

interface PipelineProgressProps {
  phase: PipelinePhase
  currentRound: number
  currentSpent: number
  budgetLimit: number
  estimatedTimeRemaining: number | null
}

const PHASE_ORDER: PipelinePhase[] = [
  'checking-balance',
  'understanding',
  'optimizing',
  'generating',
  'evaluating',
]

const PHASE_KEYS: Record<string, string> = {
  'idle': 'smartGenerate.phase.idle',
  'checking-balance': 'smartGenerate.phase.checkingBalance',
  'understanding': 'smartGenerate.phase.understanding',
  'optimizing': 'smartGenerate.phase.optimizing',
  'generating': 'smartGenerate.phase.generating',
  'evaluating': 'smartGenerate.phase.evaluating',
  'retrying': 'smartGenerate.phase.retrying',
  'switching': 'smartGenerate.phase.switching',
  'paused': 'smartGenerate.phase.paused',
  'complete': 'smartGenerate.phase.complete',
  'failed': 'smartGenerate.phase.failed',
}

export function PipelineProgress({ phase, currentRound, currentSpent, budgetLimit, estimatedTimeRemaining }: PipelineProgressProps) {
  const { t } = useTranslation()
  const currentIdx = PHASE_ORDER.indexOf(phase)
  const isRunning = phase !== 'idle' && phase !== 'paused' && phase !== 'complete' && phase !== 'failed'

  return (
    <div className="space-y-3">
      {/* Phase steps */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {PHASE_ORDER.map((p, idx) => {
          const isDone = currentIdx > idx || phase === 'paused' || phase === 'complete'
          const isCurrent = phase === p || (phase === 'retrying' && p === 'generating') || (phase === 'switching' && p === 'evaluating')
          return (
            <div key={p} className="flex items-center gap-1 shrink-0">
              <div
                className={cn(
                  'h-2 w-2 rounded-full transition-colors',
                  isDone ? 'bg-primary' : isCurrent ? 'bg-primary animate-pulse' : 'bg-muted-foreground/20'
                )}
              />
              {idx < PHASE_ORDER.length - 1 && (
                <div className={cn('h-px w-4', isDone ? 'bg-primary' : 'bg-muted-foreground/20')} />
              )}
            </div>
          )
        })}
      </div>

      {/* Status line */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          )}
          <span>{t(PHASE_KEYS[phase] || 'smartGenerate.phase.idle')}</span>
          {currentRound > 0 && (
            <span className="text-foreground font-medium">
              {t('smartGenerate.round', { round: currentRound })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {estimatedTimeRemaining !== null && isRunning && (
            <span>~{Math.ceil(estimatedTimeRemaining)}s</span>
          )}
          <span className={cn(
            'font-mono',
            currentSpent > budgetLimit * 0.8 ? 'text-amber-500' : 'text-foreground'
          )}>
            ${currentSpent.toFixed(3)} / ${budgetLimit.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}
