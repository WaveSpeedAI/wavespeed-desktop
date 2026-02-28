import { useTranslation } from 'react-i18next'
import { Loader2, Check, Circle, AlertCircle } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { MultiPhaseProgress, ProcessingPhase } from '@/types/progress'
import { formatBytes } from '@/types/progress'

interface ProcessingProgressProps {
  progress: MultiPhaseProgress
  showPhases?: boolean
  showOverall?: boolean
  showEta?: boolean
  className?: string
  /** Maximum number of phases to show dots for (default: 4). Set to 0 to always hide. */
  maxPhaseDots?: number
}

function PhaseIndicator({ phase }: { phase: ProcessingPhase }) {
  const { status } = phase

  if (status === 'completed') {
    return (
      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-primary">
        <Check className="h-2.5 w-2.5 text-primary-foreground" />
      </div>
    )
  }

  if (status === 'active') {
    return (
      <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-primary bg-primary/20">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-destructive">
        <AlertCircle className="h-2.5 w-2.5 text-destructive-foreground" />
      </div>
    )
  }

  // pending
  return (
    <div className="flex h-4 w-4 items-center justify-center">
      <Circle className="h-2.5 w-2.5 text-muted-foreground/50" />
    </div>
  )
}

function formatDetail(detail: ProcessingPhase['detail']): string | null {
  if (!detail || detail.current === undefined || detail.total === undefined) {
    return null
  }

  if (detail.unit === 'bytes') {
    return `${formatBytes(detail.current)} / ${formatBytes(detail.total)}`
  }

  if (detail.unit === 'frames') {
    return `${detail.current} / ${detail.total}`
  }

  if (detail.unit === 'seconds') {
    return `${detail.current}s / ${detail.total}s`
  }

  if (detail.unit === 'items') {
    return `${detail.current} / ${detail.total}`
  }

  return null
}

export function ProcessingProgress({
  progress,
  showPhases = true,
  showOverall = true,
  showEta = true,
  className,
  maxPhaseDots = 4
}: ProcessingProgressProps) {
  const { t } = useTranslation()
  const { phases, currentPhaseIndex, overallProgress, eta, isActive } = progress

  const currentPhase = phases[currentPhaseIndex]
  const isComplete = phases.length > 0 && phases.every((phase) => phase.status === 'completed')
  const currentLabel = isComplete
    ? t('common.done')
    : currentPhase
      ? t(currentPhase.labelKey)
      : ''

  // Hide phase dots if too many phases
  const shouldShowPhaseDots = showPhases && phases.length > 1 && phases.length <= maxPhaseDots

  if (!isActive && overallProgress === 0) {
    return null
  }

  const progressValue = showOverall && phases.length > 1 ? overallProgress : currentPhase?.progress || 0

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* Top row: phase dots + label + ETA + percentage */}
      <div className="flex items-center gap-2">
        {/* Phase indicators - only show if not too many */}
        {shouldShowPhaseDots && (
          <div className="flex items-center gap-0.5 shrink-0">
            {phases.map((phase, index) => (
              <div key={phase.id} className="flex items-center">
                <PhaseIndicator phase={phase} />
                {index < phases.length - 1 && (
                  <div
                    className={cn(
                      'mx-0.5 h-0.5 w-3',
                      phases[index + 1].status !== 'pending'
                        ? 'bg-primary'
                        : 'bg-muted-foreground/30'
                    )}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Current phase label with spinner */}
        {currentLabel && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
            {isActive && currentPhase?.status === 'active' && (
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
            )}
            {currentPhase?.status === 'completed' && (
              <Check className="h-3 w-3 text-primary shrink-0" />
            )}
            <span className="truncate">{currentLabel}</span>
            {!isComplete && currentPhase?.detail && formatDetail(currentPhase.detail) && (
              <span className="text-muted-foreground/60 shrink-0">
                ({formatDetail(currentPhase.detail)})
              </span>
            )}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Percentage and ETA */}
        <div className="flex items-center gap-2 shrink-0 text-xs">
          {showEta && eta && isActive && (
            <span className="text-muted-foreground/60">~{eta}</span>
          )}
          <span className="font-medium w-12 text-right">
            {progressValue.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Progress bar - full width on its own row */}
      <Progress
        value={progressValue}
        className="h-1.5"
      />
    </div>
  )
}
