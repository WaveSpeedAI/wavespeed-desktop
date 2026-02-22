import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useSmartGenerateStore } from '@/stores/smartGenerateStore'
import type { GenerationAttempt } from '@/lib/smartGenerateUtils'
import { getScoreColor, getScoreLabel } from '@/lib/smartGenerateUtils'
import { PipelineProgress } from './PipelineProgress'
import { AttemptTimeline } from './AttemptTimeline'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, Download, Maximize2, Trophy, RefreshCw, Plus, ImagePlus, Dna, Copy, Check, ZoomIn } from 'lucide-react'

interface SmartGenerateOutputProps {
  className?: string
}

export function SmartGenerateOutput({ className }: SmartGenerateOutputProps) {
  const { t } = useTranslation()
  const {
    phase, attempts, bestAttempt, mode,
    currentRound, currentSpent, budgetLimit,
    estimatedTimeRemaining,
    startNewTask,
    applyRefinedPrompt,
    useResultAsSource,
    isLocked,
    userPrompt,
    modeSessions,
  } = useSmartGenerateStore()

  const [previewIndex, setPreviewIndex] = useState<number>(-1)
  const [showTimeline, setShowTimeline] = useState(true)
  const [showAllResults, setShowAllResults] = useState(false)
  const [showNewTaskDialog, setShowNewTaskDialog] = useState(false)
  const isDone = phase === 'paused' || phase === 'complete' || phase === 'failed'
  const bestRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const prevLockedRef = useRef(false)

  // Auto-scroll to Timeline when generation starts
  useEffect(() => {
    if (isLocked && !prevLockedRef.current) {
      setTimeout(() => {
        timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 150)
    }
    prevLockedRef.current = isLocked
  }, [isLocked])

  // Auto-scroll to Best Result when pipeline finishes (scoring done)
  useEffect(() => {
    if (isDone && bestAttempt?.outputUrl) {
      setTimeout(() => {
        bestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }, [isDone, bestAttempt?.id])

  // All URLs (from all attempts with output, including cross-mode) for preview navigation
  const allUrls = useMemo(() => {
    const currentUrls = attempts.filter(a => a.outputUrl).map(a => a.outputUrl!)
    const sessionUrls = Object.entries(modeSessions)
      .filter(([m]) => m !== mode)
      .flatMap(([, session]) => session?.attempts?.filter(a => a.status === 'complete' && a.outputUrl).map(a => a.outputUrl!) ?? [])
    // Deduplicate while preserving order (current mode first)
    return [...new Set([...currentUrls, ...sessionUrls])]
  }, [attempts, modeSessions, mode])

  // Current mode completed attempts (for timeline context)
  const completedAttempts = useMemo(() =>
    attempts.filter(a => a.status === 'complete' && a.outputUrl),
    [attempts]
  )

  // All completed attempts across ALL modes (for All Results)
  const allCompletedAttempts = useMemo(() => {
    const current = attempts.filter(a => a.status === 'complete' && a.outputUrl)
    const fromSessions = Object.entries(modeSessions)
      .filter(([m]) => m !== mode) // skip current mode (already included)
      .flatMap(([, session]) => session?.attempts?.filter(a => a.status === 'complete' && a.outputUrl) ?? [])
    return [...current, ...fromSessions].sort((a, b) => b.timestamp - a.timestamp)
  }, [attempts, modeSessions, mode])

  const openPreview = useCallback((url: string | null) => {
    if (!url) return
    const idx = allUrls.indexOf(url)
    setPreviewIndex(idx >= 0 ? idx : -1)
  }, [allUrls])

  const previewUrl = previewIndex >= 0 ? allUrls[previewIndex] : null
  const canPrev = previewIndex > 0
  const canNext = previewIndex < allUrls.length - 1

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Progress bar (always visible during run) */}
      {phase !== 'idle' && (
        <div className="border-b bg-background/60 p-3 shrink-0">
          <PipelineProgress
            phase={phase}
            currentRound={currentRound}
            currentSpent={currentSpent}
            budgetLimit={budgetLimit}
            estimatedTimeRemaining={estimatedTimeRemaining}
          />
        </div>
      )}

      {/* Empty state - centered (only if no results anywhere) */}
      {phase === 'idle' && attempts.length === 0 && allCompletedAttempts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <Trophy className="h-12 w-12 mb-3 opacity-20" />
          <p className="text-sm">{t('smartGenerate.output.empty')}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Best Result */}
            {bestAttempt && bestAttempt.outputUrl && (
              <div ref={bestRef}>
                <BestResultCard
                  attempt={bestAttempt}
                  onPreview={() => openPreview(bestAttempt.outputUrl)}
                  onDownload={() => setShowNewTaskDialog(true)}
                  onUseAsSource={!isLocked ? useResultAsSource : undefined}
                  t={t}
                />
              </div>
            )}

            {/* All Results (collapsible, default collapsed) — aggregated from ALL modes, max 40 */}
            {allCompletedAttempts.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowAllResults(!showAllResults)}
                  className="flex items-center gap-1.5 text-sm font-semibold hover:text-primary transition-colors w-full"
                >
                  <span>{t('smartGenerate.output.allResults')}</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    ({Math.min(allCompletedAttempts.length, 40)}{allCompletedAttempts.length > 40 ? '+' : ''})
                  </span>
                  {showAllResults
                    ? <ChevronUp className="h-4 w-4 ml-auto text-muted-foreground" />
                    : <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground" />
                  }
                </button>
                {showAllResults && (
                  <>
                    <ResultCarousel
                      attempts={allCompletedAttempts.slice(0, 40)}
                      bestId={bestAttempt?.id}
                      onPreview={openPreview}
                      onUseAsSource={!isLocked ? useResultAsSource : undefined}
                      t={t}
                    />
                    {allCompletedAttempts.length > 40 && (
                      <p className="text-xs text-muted-foreground text-center py-1">
                        {t('smartGenerate.output.moreInHistory')}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Timeline (collapsible, default expanded) */}
            {attempts.length > 0 && (
              <div ref={timelineRef} className="space-y-2">
                <button
                  onClick={() => setShowTimeline(!showTimeline)}
                  className="flex items-center gap-1.5 text-sm font-semibold hover:text-primary transition-colors w-full"
                >
                  <span>{t('smartGenerate.timeline.title')}</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    ({attempts.filter(a => a.status === 'complete').length} {t('smartGenerate.timeline.results')})
                  </span>
                  {showTimeline
                    ? <ChevronUp className="h-4 w-4 ml-auto text-muted-foreground" />
                    : <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground" />
                  }
                </button>
                {showTimeline && (
                  <AttemptTimeline attempts={attempts} onPreview={openPreview} hideTitle />
                )}
              </div>
            )}

            {/* Paused actions */}
            {isDone && completedAttempts.length > 0 && (
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyRefinedPrompt(userPrompt)}
                  className="flex-1 text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  {t('smartGenerate.output.continueRefining')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowNewTaskDialog(true)}
                  className="text-xs"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  {t('smartGenerate.output.newTask')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen preview with navigation */}
      <Dialog open={previewIndex >= 0} onOpenChange={() => setPreviewIndex(-1)}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden flex items-center justify-center">
          {previewUrl && (
            <div className="relative flex items-center justify-center">
              {previewUrl.match(/\.(mp4|webm|mov)/i) ? (
                <video src={previewUrl} controls autoPlay className="max-w-full max-h-[85vh] object-contain" />
              ) : (
                <img src={previewUrl} alt="" className="max-w-full max-h-[85vh] object-contain" />
              )}

              {/* Left arrow */}
              {canPrev && (
                <button
                  onClick={(e) => { e.stopPropagation(); setPreviewIndex(previewIndex - 1) }}
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
                >
                  <span className="text-lg leading-none">&#9664;</span>
                </button>
              )}

              {/* Right arrow */}
              {canNext && (
                <button
                  onClick={(e) => { e.stopPropagation(); setPreviewIndex(previewIndex + 1) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
                >
                  <span className="text-lg leading-none">&#9654;</span>
                </button>
              )}

              {/* Bottom bar: counter + actions */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
                <div className="bg-black/50 text-white text-xs px-2.5 py-1 rounded-full">
                  {previewIndex + 1} / {allUrls.length}
                </div>
                {!isLocked && !previewUrl.match(/\.(mp4|webm|mov)/i) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); useResultAsSource(previewUrl); setPreviewIndex(-1) }}
                    title={t('smartGenerate.output.useAsSource')}
                    className="h-8 w-8 rounded-full bg-black/50 hover:bg-primary flex items-center justify-center text-white transition-colors"
                  >
                    <ImagePlus className="h-4 w-4" />
                  </button>
                )}
                <a
                  href={previewUrl}
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="h-8 w-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
                >
                  <Download className="h-4 w-4" />
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* New Task confirmation dialog */}
      <Dialog open={showNewTaskDialog} onOpenChange={setShowNewTaskDialog}>
        <DialogContent className="max-w-sm">
          <div className="space-y-4 p-2">
            <h3 className="text-lg font-semibold">{t('smartGenerate.output.newTaskTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('smartGenerate.output.newTaskDesc')}</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowNewTaskDialog(false)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => { setShowNewTaskDialog(false); startNewTask() }}>
                {t('smartGenerate.output.confirmNewTask')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BestResultCard({
  attempt,
  onPreview,
  onDownload,
  onUseAsSource,
  t,
}: {
  attempt: GenerationAttempt
  onPreview: () => void
  onDownload?: () => void
  onUseAsSource?: (url: string) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const score = attempt.tier2Score ?? attempt.tier1Score ?? 0
  const isVideo = attempt.outputUrl?.match(/\.(mp4|webm|mov)/i)
  const isTraining = attempt.id.startsWith('train-')
  const color = getScoreColor(score)
  const [copied, setCopied] = useState(false)

  const copyUrl = () => {
    if (attempt.outputUrl) {
      navigator.clipboard.writeText(attempt.outputUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Training result: show LoRA URL instead of image preview
  if (isTraining) {
    return (
      <div className="rounded-xl border-2 border-primary/30 bg-primary/5 overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center gap-2">
            <Dna className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">{t('smartGenerate.trainer.result')}</span>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">{t('smartGenerate.trainer.loraUrl')}</span>
          </div>
          <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-2.5">
            <code className="text-xs flex-1 break-all text-foreground">{attempt.outputUrl}</code>
            <button
              onClick={copyUrl}
              className="shrink-0 h-7 w-7 rounded-md border bg-background hover:bg-muted flex items-center justify-center transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-primary/5 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{t('smartGenerate.output.bestResult')}</span>
        </div>
        <ScoreBadge score={score} color={color} t={t} />
      </div>

      <div className="relative group cursor-pointer flex items-center justify-center bg-muted/10 overflow-hidden" onClick={onPreview}>
        {isVideo ? (
          <video src={attempt.outputUrl!} className="max-w-full max-h-[400px] object-contain" muted autoPlay loop />
        ) : (
          <img src={attempt.outputUrl!} alt="" className="max-w-full max-h-[400px] object-contain" />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <Maximize2 className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        {/* Action buttons overlay */}
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onUseAsSource && !isVideo && attempt.outputUrl && (
            <button
              onClick={(e) => { e.stopPropagation(); onUseAsSource(attempt.outputUrl!) }}
              title={t('smartGenerate.output.useAsSource')}
              className="h-8 w-8 rounded-full bg-black/50 hover:bg-primary flex items-center justify-center text-white transition-colors"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
          )}
          {attempt.outputUrl && (
            <a
              href={attempt.outputUrl}
              download
              onClick={(e) => e.stopPropagation()}
              className="h-8 w-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
            >
              <Download className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>

      {attempt.tier2Analysis && (
        <div className="p-3 text-xs text-muted-foreground border-t">
          <p className="line-clamp-3">{attempt.tier2Analysis}</p>
        </div>
      )}
    </div>
  )
}

// Inline score badge instead of circular gauge - cleaner design
function ScoreBadge({ score, color, t }: { score: number; color: string; t: (key: string) => string }) {
  const labelKey = getScoreLabel(score)
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-lg font-bold" style={{ color }}>{score}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium" style={{ color, borderColor: color + '40' }}>
        {t(labelKey)}
      </span>
    </div>
  )
}

// Horizontal carousel with left/right arrows
function ResultCarousel({
  attempts,
  bestId,
  onPreview,
  onUseAsSource,
  t,
}: {
  attempts: GenerationAttempt[]
  bestId?: string
  onPreview: (url: string | null) => void
  onUseAsSource?: (url: string) => void
  t: (key: string) => string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={scrollRef}
      className="flex flex-wrap gap-2"
    >
      {attempts.map((attempt) => (
        <CarouselCard
          key={attempt.id}
          attempt={attempt}
          isBest={attempt.id === bestId}
          onPreview={() => onPreview(attempt.outputUrl)}
          onUseAsSource={onUseAsSource}
          t={t}
        />
      ))}
    </div>
  )
}

function CarouselCard({
  attempt,
  isBest,
  onPreview,
  onUseAsSource,
  t,
}: {
  attempt: GenerationAttempt
  isBest: boolean
  onPreview: () => void
  onUseAsSource?: (url: string) => void
  t: (key: string) => string
}) {
  const score = attempt.tier2Score ?? attempt.tier1Score ?? 0
  const isVideo = attempt.outputUrl?.match(/\.(mp4|webm|mov)/i)
  const isTraining = attempt.id.startsWith('train-')
  const [copied, setCopied] = useState(false)

  // Training result card — shows LoRA icon + truncated URL + copy button
  if (isTraining) {
    const copyUrl = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (attempt.outputUrl) {
        navigator.clipboard.writeText(attempt.outputUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }
    return (
      <div className="w-32 rounded-lg border overflow-hidden">
        <div className="aspect-square bg-muted/30 flex flex-col items-center justify-center gap-2 p-2">
          <Dna className="h-8 w-8 text-primary" />
          <span className="text-[10px] text-muted-foreground text-center line-clamp-2 break-all">{attempt.outputUrl}</span>
        </div>
        <div className="p-1.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground truncate">{t('smartGenerate.trainer.lora')}</span>
          <button onClick={copyUrl} className="shrink-0">
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'w-32 rounded-lg border overflow-hidden cursor-pointer hover:shadow-md transition-shadow',
        isBest && 'ring-2 ring-primary/30'
      )}
      onClick={onPreview}
    >
      <div className="aspect-square bg-muted/30 relative group">
        {isVideo ? (
          <video src={attempt.outputUrl!} className="w-full h-full object-cover" muted />
        ) : (
          <img src={attempt.outputUrl!} alt="" className="w-full h-full object-cover" />
        )}
        {isBest && (
          <div className="absolute top-1 left-1">
            <Trophy className="h-3.5 w-3.5 text-primary drop-shadow" />
          </div>
        )}
        {attempt.isUpscaled && (
          <div className="absolute top-1 right-1 flex items-center gap-0.5 bg-blue-500/80 text-white text-[9px] px-1.5 py-0.5 rounded-full">
            <ZoomIn className="h-2.5 w-2.5" />
            <span>4K</span>
          </div>
        )}
        {onUseAsSource && !isVideo && attempt.outputUrl && (
          <button
            onClick={(e) => { e.stopPropagation(); onUseAsSource(attempt.outputUrl!) }}
            title={t('smartGenerate.output.useAsSource')}
            className="absolute bottom-1 right-1 h-6 w-6 rounded-full bg-black/60 hover:bg-primary flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all"
          >
            <ImagePlus className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="p-1.5 flex items-center justify-between">
        <span className="text-xs font-bold" style={{ color: score > 0 ? getScoreColor(score) : undefined }}>
          {score > 0 ? score : '-'}
        </span>
        <span className="text-[10px] text-muted-foreground">R{attempt.roundIndex}</span>
      </div>
    </div>
  )
}
