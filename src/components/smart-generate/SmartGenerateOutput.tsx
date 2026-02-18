import { useMemo, useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useSmartGenerateStore } from '@/stores/smartGenerateStore'
import type { GenerationAttempt } from '@/lib/smartGenerateUtils'
import { getScoreColor, getScoreLabel } from '@/lib/smartGenerateUtils'
import { PipelineProgress } from './PipelineProgress'
import { AttemptTimeline } from './AttemptTimeline'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, Download, Maximize2, Trophy, RefreshCw, Plus, ImagePlus } from 'lucide-react'

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
  } = useSmartGenerateStore()

  const [previewIndex, setPreviewIndex] = useState<number>(-1)
  const [showTimeline, setShowTimeline] = useState(true)
  const [showAllResults, setShowAllResults] = useState(false)
  const [showNewTaskDialog, setShowNewTaskDialog] = useState(false)
  const isDone = phase === 'paused' || phase === 'complete' || phase === 'failed'

  // All URLs (from all attempts with output) for preview navigation
  const allUrls = useMemo(() =>
    attempts.filter(a => a.outputUrl).map(a => a.outputUrl!),
    [attempts]
  )

  // Latest completed attempts for the carousel
  const completedAttempts = useMemo(() =>
    attempts.filter(a => a.status === 'complete' && a.outputUrl),
    [attempts]
  )

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

      {/* Empty state - centered */}
      {phase === 'idle' && attempts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <Trophy className="h-12 w-12 mb-3 opacity-20" />
          <p className="text-sm">{t('smartGenerate.output.empty')}</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Best Result */}
            {bestAttempt && bestAttempt.outputUrl && (
              <BestResultCard
                attempt={bestAttempt}
                onPreview={() => openPreview(bestAttempt.outputUrl)}
                onDownload={() => setShowNewTaskDialog(true)}
                onUseAsSource={(mode === 'image-edit' || mode === 'image-to-video') && !isLocked ? useResultAsSource : undefined}
                t={t}
              />
            )}

            {/* Timeline (collapsible, default collapsed) */}
            {attempts.length > 0 && (
              <div className="space-y-2">
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

            {/* All Results (collapsible) */}
            {completedAttempts.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowAllResults(!showAllResults)}
                  className="flex items-center gap-1.5 text-sm font-semibold hover:text-primary transition-colors w-full"
                >
                  <span>{t('smartGenerate.output.allResults')}</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    ({completedAttempts.length})
                  </span>
                  {showAllResults
                    ? <ChevronUp className="h-4 w-4 ml-auto text-muted-foreground" />
                    : <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground" />
                  }
                </button>
                {showAllResults && (
                  <ResultCarousel
                    attempts={completedAttempts}
                    bestId={bestAttempt?.id}
                    onPreview={openPreview}
                    onUseAsSource={(mode === 'image-edit' || mode === 'image-to-video') && !isLocked ? useResultAsSource : undefined}
                    t={t}
                  />
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
        </ScrollArea>
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

              {/* Bottom bar: counter + download */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
                <div className="bg-black/50 text-white text-xs px-2.5 py-1 rounded-full">
                  {previewIndex + 1} / {allUrls.length}
                </div>
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
  const color = getScoreColor(score)

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-primary/5 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{t('smartGenerate.output.bestResult')}</span>
        </div>
        <ScoreBadge score={score} color={color} t={t} />
      </div>

      <div className="relative group cursor-pointer bg-muted/10" onClick={onPreview}>
        {isVideo ? (
          <video src={attempt.outputUrl!} className="w-full max-h-[400px] object-contain" muted autoPlay loop />
        ) : (
          <img src={attempt.outputUrl!} alt="" className="w-full max-h-[400px] object-contain" />
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
              onClick={(e) => { e.stopPropagation(); onDownload?.() }}
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
