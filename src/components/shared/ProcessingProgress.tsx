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

  return null
}

export function ProcessingProgress({
  progress,
  showPhases = true,
  showOverall = true,
  showEta = true,
  className
}: ProcessingProgressProps) {
  const { t } = useTranslation()
  const { phases, currentPhaseIndex, overallProgress, eta, isActive } = progress

  const currentPhase = phases[currentPhaseIndex]

  if (!isActive && overallProgress === 0) {
    return null
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Single row: phase dots + current phase label + progress + ETA */}
      <div className="flex items-center gap-3">
        {/* Phase indicators */}
        {showPhases && phases.length > 1 && (
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
        {currentPhase && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            {isActive && currentPhase.status === 'active' && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {currentPhase.status === 'completed' && (
              <Check className="h-3 w-3 text-primary" />
            )}
            {t(currentPhase.labelKey)}
            {currentPhase.detail && (
              <span className="text-muted-foreground/60">
                ({formatDetail(currentPhase.detail)})
              </span>
            )}
          </span>
        )}

        {/* Progress bar - fills remaining space */}
        <div className="flex-1 min-w-0">
          <Progress
            value={showOverall && phases.length > 1 ? overallProgress : currentPhase?.progress || 0}
            className="h-1.5"
          />
        </div>

        {/* Percentage and ETA */}
        <div className="flex items-center gap-2 shrink-0 text-xs">
          {showEta && eta && isActive && (
            <span className="text-muted-foreground/60">~{eta}</span>
          )}
          <span className="font-medium w-8 text-right">
            {Math.round(showOverall && phases.length > 1 ? overallProgress : currentPhase?.progress || 0)}%
          </span>
        </div>
      </div>
    </div>
  )
}
