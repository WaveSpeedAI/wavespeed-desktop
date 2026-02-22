import { useMemo, useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { GenerationAttempt } from '@/lib/smartGenerateUtils'
import { getModelAdapter, getScoreColor } from '@/lib/smartGenerateUtils'
import { useSmartGenerateStore } from '@/stores/smartGenerateStore'
import { AlertTriangle, CheckCircle2, Clock, DollarSign, RefreshCw, ArrowRightLeft, Maximize2, ImagePlus, Dna, Copy, Check, ZoomIn } from 'lucide-react'

/** Hook: mouse-drag horizontal scroll */
function useHorizontalDrag() {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    dragging.current = true
    startX.current = e.pageX - el.offsetLeft
    scrollLeft.current = el.scrollLeft
    el.style.cursor = 'grabbing'
    el.style.userSelect = 'none'
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return
    const el = ref.current
    if (!el) return
    e.preventDefault()
    const x = e.pageX - el.offsetLeft
    el.scrollLeft = scrollLeft.current - (x - startX.current)
  }, [])

  const onMouseUp = useCallback(() => {
    dragging.current = false
    const el = ref.current
    if (el) {
      el.style.cursor = 'grab'
      el.style.userSelect = ''
    }
  }, [])

  return { ref, onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp }
}

interface AttemptTimelineProps {
  attempts: GenerationAttempt[]
  onPreview?: (url: string | null) => void
  className?: string
  hideTitle?: boolean
}

interface RoundGroup {
  round: number
  modelId: string
  attempts: GenerationAttempt[]
  modelSwitched: boolean
}

export function AttemptTimeline({ attempts, onPreview, className, hideTitle }: AttemptTimelineProps) {
  const { t } = useTranslation()

  const rounds = useMemo(() => {
    const groups: RoundGroup[] = []
    let prevModelId = ''

    for (const attempt of attempts) {
      const existing = groups.find(g => g.round === attempt.roundIndex)
      if (existing) {
        existing.attempts.push(attempt)
      } else {
        groups.push({
          round: attempt.roundIndex,
          modelId: attempt.modelId,
          attempts: [attempt],
          modelSwitched: prevModelId !== '' && prevModelId !== attempt.modelId,
        })
        prevModelId = attempt.modelId
      }
    }
    return groups
  }, [attempts])

  if (rounds.length === 0) return null

  return (
    <div className={cn('space-y-3', className)}>
      {!hideTitle && <h3 className="text-sm font-semibold">{t('smartGenerate.timeline.title')}</h3>}
      <div className="space-y-2">
        {[...rounds].reverse().map((round) => (
          <RoundCard key={round.round} round={round} onPreview={onPreview} t={t} />
        ))}
      </div>
    </div>
  )
}

function RoundCard({ round, onPreview, t }: { round: RoundGroup; onPreview?: (url: string | null) => void; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const adapter = getModelAdapter(round.modelId)
  const totalCost = round.attempts.reduce((sum, a) => sum + a.cost, 0)
  const isTraining = round.attempts.some(a => a.id.startsWith('train-'))
  const trainerLabel = round.modelId.split('/').pop()?.replace(/-/g, ' ') || round.modelId
  const drag = useHorizontalDrag()

  return (
    <div className="rounded-lg border bg-card/50 p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isTraining ? (
            <>
              <Dna className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-medium">{t('smartGenerate.trainer.training')}</span>
              <span className="text-xs text-muted-foreground capitalize">{trainerLabel}</span>
            </>
          ) : (
            <>
              {round.modelSwitched && (
                <div className="flex items-center gap-1 text-amber-500 text-xs">
                  <ArrowRightLeft className="h-3 w-3" />
                  <span>{t('smartGenerate.timeline.switched')}</span>
                </div>
              )}
              <span className="text-sm font-medium">
                {t('smartGenerate.timeline.round', { n: round.round })}
              </span>
              <span className="text-xs text-muted-foreground">{adapter?.label || round.modelId.split('/').pop() || round.modelId}</span>
            </>
          )}
        </div>
        {!isTraining && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <DollarSign className="h-3 w-3" />
            <span className="font-mono">${totalCost.toFixed(3)}</span>
          </div>
        )}
      </div>

      {/* Variants — outer scroll wrapper + inner flex row */}
      <div
        ref={drag.ref}
        className="overflow-x-auto overflow-y-hidden pb-1 cursor-grab scrollbar-thin"
        onMouseDown={drag.onMouseDown}
        onMouseMove={drag.onMouseMove}
        onMouseUp={drag.onMouseUp}
        onMouseLeave={drag.onMouseLeave}
      >
        <div className="flex gap-2 w-max">
          {round.attempts.map((attempt) => (
            <AttemptCard key={attempt.id} attempt={attempt} onPreview={onPreview} t={t} />
          ))}
        </div>
      </div>
    </div>
  )
}

function AttemptCard({ attempt, onPreview, t }: { attempt: GenerationAttempt; onPreview?: (url: string | null) => void; t: (key: string) => string }) {
  const score = attempt.tier2Score ?? attempt.tier1Score ?? 0
  const isImage = attempt.outputUrl?.match(/\.(jpg|jpeg|png|webp|gif)/i)
  const hasOutput = !!attempt.outputUrl
  const isTraining = attempt.id.startsWith('train-')
  const isUpscaled = !!attempt.isUpscaled
  const clickable = hasOutput && onPreview && !isTraining
  const isLocked = useSmartGenerateStore(s => s.isLocked)
  const useResultAsSource = useSmartGenerateStore(s => s.useResultAsSource)
  const canUseAsSource = hasOutput && isImage && !isLocked && !isTraining
  const [copied, setCopied] = useState(false)

  // Training attempt card
  if (isTraining) {
    const copyUrl = () => {
      if (attempt.outputUrl) {
        navigator.clipboard.writeText(attempt.outputUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }
    return (
      <div className="shrink-0 w-36 rounded-lg border bg-background/50 overflow-hidden">
        <div className="aspect-video bg-muted/30 flex flex-col items-center justify-center gap-1 p-2">
          {attempt.status === 'generating' ? (
            <RefreshCw className="h-5 w-5 text-muted-foreground animate-spin" />
          ) : attempt.status === 'complete' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          )}
          <Dna className="h-4 w-4 text-primary" />
          {hasOutput && (
            <span className="text-[9px] text-muted-foreground text-center line-clamp-1 break-all">{attempt.outputUrl}</span>
          )}
        </div>
        <div className="p-2">
          <div className="flex items-center justify-between">
            <StatusBadge status={attempt.status} t={t} />
            {hasOutput && (
              <button onClick={copyUrl} className="shrink-0">
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      'shrink-0 w-36 rounded-lg border bg-background/50 overflow-hidden',
      clickable && 'cursor-pointer hover:shadow-md transition-shadow'
    )}>
      {/* Thumbnail */}
      <div
        className="aspect-video bg-muted/30 relative group"
        onClick={() => clickable && onPreview(attempt.outputUrl)}
      >
        {attempt.outputUrl && isImage ? (
          <img src={attempt.outputUrl} alt="" className="w-full h-full object-cover" />
        ) : attempt.outputUrl ? (
          <video src={attempt.outputUrl} className="w-full h-full object-cover" muted />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <StatusIcon status={attempt.status} />
          </div>
        )}
        {clickable && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <Maximize2 className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
        {isUpscaled && (
          <div className="absolute top-1 left-1 flex items-center gap-0.5 bg-blue-500/80 text-white text-[9px] px-1.5 py-0.5 rounded-full">
            <ZoomIn className="h-2.5 w-2.5" />
            <span>4K</span>
          </div>
        )}
        {canUseAsSource && (
          <button
            onClick={(e) => { e.stopPropagation(); useResultAsSource(attempt.outputUrl!) }}
            title={t('smartGenerate.output.useAsSource')}
            className="absolute bottom-1 right-1 h-6 w-6 rounded-full bg-black/60 hover:bg-primary flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all"
          >
            <ImagePlus className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-2 space-y-1">
        <div className="flex items-center justify-between">
          {score > 0 ? (
            <span className="text-xs font-bold" style={{ color: getScoreColor(score) }}>{score}</span>
          ) : (
            <StatusBadge status={attempt.status} t={t} />
          )}
          {attempt.inferenceTime && (
            <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {(attempt.inferenceTime / 1000).toFixed(1)}s
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: GenerationAttempt['status'] }) {
  switch (status) {
    case 'generating':
    case 'scoring':
      return <RefreshCw className="h-5 w-5 text-muted-foreground animate-spin" />
    case 'failed':
      return <AlertTriangle className="h-5 w-5 text-destructive" />
    case 'complete':
      return <CheckCircle2 className="h-5 w-5 text-primary" />
    default:
      return null
  }
}

function StatusBadge({ status, t }: { status: GenerationAttempt['status']; t: (key: string) => string }) {
  const map: Record<string, { color: string; key: string }> = {
    generating: { color: 'text-blue-500', key: 'smartGenerate.status.generating' },
    scoring: { color: 'text-purple-500', key: 'smartGenerate.status.scoring' },
    complete: { color: 'text-emerald-500', key: 'smartGenerate.status.complete' },
    failed: { color: 'text-destructive', key: 'smartGenerate.status.failed' },
  }
  const info = map[status] || { color: 'text-muted-foreground', key: status }
  return <span className={cn('text-[10px] font-medium', info.color)}>{t(info.key)}</span>
}
