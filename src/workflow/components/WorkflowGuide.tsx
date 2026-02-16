/**
 * WorkflowGuide — interactive spotlight-based onboarding tour.
 *
 * Uses a full-screen SVG overlay with an evenodd path cutout to
 * highlight real UI elements. A floating popover shows step content
 * next to the highlighted element.
 *
 * Technique inspired by driver.js:
 *   - SVG covers the entire viewport
 *   - Outer rect = full screen (opaque)
 *   - Inner rounded-rect = target element bounds (transparent cutout)
 *   - fill-rule: evenodd creates the "hole"
 *   - CSS transition on the path for smooth animation between steps
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/* ── Constants ─────────────────────────────────────────────────────── */

const GUIDE_COMPLETED_KEY = 'wavespeed_workflow_guide_completed'
const STAGE_PADDING = 8
const STAGE_RADIUS = 8
const POPOVER_GAP = 12

/* ── Public hook ───────────────────────────────────────────────────── */

export function useWorkflowGuide() {
  const completed = localStorage.getItem(GUIDE_COMPLETED_KEY) === '1'
  const [open, setOpen] = useState(!completed)

  const show = useCallback(() => setOpen(true), [])
  const dismiss = useCallback(() => {
    setOpen(false)
    localStorage.setItem(GUIDE_COMPLETED_KEY, '1')
  }, [])

  return { open, show, dismiss }
}

/* ── Step definitions ──────────────────────────────────────────────── */

type PopoverSide = 'top' | 'right' | 'bottom' | 'left'

interface GuideStepDef {
  /** i18n key suffix under workflow.guide.* */
  key: string
  /** CSS selector for the target element (null = centered modal) */
  target: string | null
  /** Preferred popover side */
  side: PopoverSide
  /** Whether to show the AI Task feature list */
  showAIFeatures?: boolean
  /** Callback to prepare UI before showing this step */
  prepare?: () => void
}

function buildSteps(actions: {
  openNodePalette: () => void
  closeNodePalette: () => void
}): GuideStepDef[] {
  return [
    {
      key: 'welcome',
      target: null,
      side: 'bottom',
    },
    {
      key: 'nodePaletteBtn',
      target: '[data-guide="node-palette-btn"]',
      side: 'bottom',
      prepare: actions.closeNodePalette,
    },
    {
      key: 'nodePalette',
      target: '[data-guide="node-palette"]',
      side: 'right',
      prepare: actions.openNodePalette,
    },
    {
      key: 'aiTask',
      target: '[data-guide="node-palette"]',
      side: 'right',
      showAIFeatures: true,
    },
    {
      key: 'canvas',
      target: '[data-guide="canvas"]',
      side: 'top',
    },
    {
      key: 'canvasTools',
      target: '[data-guide="canvas-tools"]',
      side: 'bottom',
    },
    {
      key: 'config',
      target: '[data-guide="canvas"]',
      side: 'top',
    },
    {
      key: 'run',
      target: '[data-guide="run-controls"]',
      side: 'bottom',
    },
    {
      key: 'templates',
      target: '[data-guide="toolbar-more"]',
      side: 'bottom',
    },
  ]
}

/* ── Geometry helpers ──────────────────────────────────────────────── */

interface Rect {
  x: number; y: number; w: number; h: number
}

function getElementRect(selector: string | null): Rect | null {
  if (!selector) return null
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/** Expand rect by padding on each side */
function padRect(r: Rect, p: number): Rect {
  return { x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 }
}

/** Clamp rect to viewport boundaries so cutout never overflows */
function clampRect(r: Rect, vw: number, vh: number): Rect {
  const x = Math.max(0, r.x)
  const y = Math.max(0, r.y)
  const right = Math.min(vw, r.x + r.w)
  const bottom = Math.min(vh, r.y + r.h)
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) }
}

/**
 * Build an SVG path string that covers the full viewport with a
 * rounded-rect cutout. Uses fill-rule: evenodd so the inner shape
 * is subtracted from the outer.
 */
function buildOverlayPath(vw: number, vh: number, cutout: Rect | null, radius: number): string {
  // Outer rect (clockwise)
  const outer = `M0,0 H${vw} V${vh} H0 Z`
  if (!cutout) return outer

  const { x, y, w, h } = cutout
  const r = Math.min(radius, w / 2, h / 2)

  // Inner rounded rect (counter-clockwise for evenodd)
  const inner = [
    `M${x + r},${y}`,
    `H${x + w - r}`,
    `A${r},${r} 0 0 1 ${x + w},${y + r}`,
    `V${y + h - r}`,
    `A${r},${r} 0 0 1 ${x + w - r},${y + h}`,
    `H${x + r}`,
    `A${r},${r} 0 0 1 ${x},${y + h - r}`,
    `V${y + r}`,
    `A${r},${r} 0 0 1 ${x + r},${y}`,
    'Z',
  ].join(' ')

  return `${outer} ${inner}`
}

/* ── Popover positioning ───────────────────────────────────────────── */

interface PopoverPos {
  top: number
  left: number
  actualSide: PopoverSide
}

const POPOVER_WIDTH = 340
const POPOVER_EST_HEIGHT = 400

function computePopoverPos(
  targetRect: Rect | null,
  side: PopoverSide,
  vw: number,
  vh: number,
): PopoverPos {
  // No target → center of screen
  if (!targetRect) {
    return {
      top: Math.max(40, (vh - POPOVER_EST_HEIGHT) / 2),
      left: (vw - POPOVER_WIDTH) / 2,
      actualSide: 'bottom',
    }
  }

  const padded = padRect(targetRect, STAGE_PADDING)
  const cx = padded.x + padded.w / 2

  const tryOrder: PopoverSide[] = [side, 'bottom', 'right', 'left', 'top']

  for (const s of tryOrder) {
    let top = 0
    let left = 0

    switch (s) {
      case 'bottom':
        top = padded.y + padded.h + POPOVER_GAP
        left = cx - POPOVER_WIDTH / 2
        break
      case 'top':
        top = padded.y - POPOVER_GAP - POPOVER_EST_HEIGHT
        left = cx - POPOVER_WIDTH / 2
        break
      case 'right':
        top = padded.y
        left = padded.x + padded.w + POPOVER_GAP
        break
      case 'left':
        top = padded.y
        left = padded.x - POPOVER_GAP - POPOVER_WIDTH
        break
    }

    // Clamp to viewport
    left = Math.max(8, Math.min(left, vw - POPOVER_WIDTH - 8))
    top = Math.max(8, Math.min(top, vh - POPOVER_EST_HEIGHT - 8))

    // Check if it fits without overlapping the target
    const popRect: Rect = { x: left, y: top, w: POPOVER_WIDTH, h: POPOVER_EST_HEIGHT }
    if (!rectsOverlap(popRect, padded) || s === tryOrder[tryOrder.length - 1]) {
      return { top, left, actualSide: s }
    }
  }

  // Fallback
  return { top: 8, left: (vw - POPOVER_WIDTH) / 2, actualSide: 'bottom' }
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/* ── Main component ────────────────────────────────────────────────── */

interface WorkflowGuideProps {
  open: boolean
  onClose: () => void
  /** Called when the active step changes; receives the step key */
  onStepChange?: (stepKey: string | null) => void
}

export function WorkflowGuide({ open, onClose, onStepChange }: WorkflowGuideProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [viewportSize, setViewportSize] = useState({ w: window.innerWidth, h: window.innerHeight })

  const steps = useMemo(() => buildSteps({
    openNodePalette: () => {
      const btn = document.querySelector('[data-guide="node-palette-btn"]') as HTMLElement | null
      // If palette is not visible, click the button to open it
      const palette = document.querySelector('[data-guide="node-palette"]')
      if (!palette && btn) btn.click()
    },
    closeNodePalette: () => {
      // If palette is visible, we want it closed for this step
      const palette = document.querySelector('[data-guide="node-palette"]')
      const btn = document.querySelector('[data-guide="node-palette-btn"]') as HTMLElement | null
      if (palette && btn) btn.click()
    },
  }), [])

  const total = steps.length
  const current = steps[step]

  // Measure target element and viewport
  const measure = useCallback(() => {
    setViewportSize({ w: window.innerWidth, h: window.innerHeight })
    if (!current) return
    const rect = getElementRect(current.target)
    setTargetRect(rect)
  }, [current])

  // Run prepare callback and measure on step change
  useEffect(() => {
    if (!open) return
    current?.prepare?.()
    // Small delay to let DOM update after prepare
    const timer = setTimeout(measure, 80)
    return () => clearTimeout(timer)
  }, [open, step, current, measure])

  // Periodic measurement for resize/scroll (throttled to ~100ms)
  useEffect(() => {
    if (!open) return
    const interval = setInterval(measure, 100)
    window.addEventListener('resize', measure)
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        if (step < total - 1) setStep(s => s + 1)
        else onClose()
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (step > 0) setStep(s => s - 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, step, total, onClose])

  // Reset step when opening
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  // Notify parent of step changes
  useEffect(() => {
    if (open) {
      onStepChange?.(steps[step]?.key ?? null)
    } else {
      onStepChange?.(null)
    }
  }, [open, step, steps, onStepChange])

  if (!open) return null

  const { w: vw, h: vh } = viewportSize
  const cutout = targetRect ? clampRect(padRect(targetRect, STAGE_PADDING), vw, vh) : null
  const pathD = buildOverlayPath(vw, vh, cutout, STAGE_RADIUS)
  const popPos = computePopoverPos(targetRect, current.side, vw, vh)

  return (
    <div className="fixed inset-0 z-[99999]" role="dialog" aria-modal="true" aria-label="Workflow Guide">
      {/* SVG overlay with cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <path
          d={pathD}
          fill="rgba(0,0,0,0.65)"
          fillRule="evenodd"
          style={{
            transition: 'd 0.3s ease-in-out',
            pointerEvents: 'auto',
          }}
          onClick={e => e.stopPropagation()}
        />
        {/* Highlight border around cutout for dark mode visibility */}
        {cutout && cutout.w > 0 && cutout.h > 0 && (
          <rect
            x={cutout.x}
            y={cutout.y}
            width={cutout.w}
            height={cutout.h}
            rx={STAGE_RADIUS}
            ry={STAGE_RADIUS}
            fill="none"
            stroke="rgba(99,152,255,0.7)"
            strokeWidth={2}
            style={{ transition: 'x 0.3s ease-in-out, y 0.3s ease-in-out, width 0.3s ease-in-out, height 0.3s ease-in-out' }}
          />
        )}
      </svg>

      {/* Clickable backdrop (outside cutout) to prevent interaction */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: 'auto' }}
        onClick={e => {
          // Only close if clicking the dark overlay area, not the cutout
          if (!cutout) return
          const { clientX: mx, clientY: my } = e
          const inCutout = mx >= cutout.x && mx <= cutout.x + cutout.w &&
                           my >= cutout.y && my <= cutout.y + cutout.h
          if (!inCutout) e.stopPropagation()
        }}
      />

      {/* Popover */}
      <div
        className="absolute z-[100000] rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        style={{
          top: popPos.top,
          left: popPos.left,
          width: POPOVER_WIDTH,
          maxHeight: `calc(100vh - ${popPos.top + 16}px)`,
          pointerEvents: 'auto',
          transition: 'top 0.3s ease-in-out, left 0.3s ease-in-out',
        }}
      >
        {/* Content */}
        <div className="px-5 pt-5 pb-3 overflow-y-auto" style={{ maxHeight: `calc(100vh - ${popPos.top + 80}px)` }}>
          <h3 className="text-sm font-semibold mb-2 text-foreground">
            {t(`workflow.guide.${current.key}.title`, current.key)}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
            {t(`workflow.guide.${current.key}.desc`, '')}
          </p>
          {/* AI Task feature highlights */}
          {current.showAIFeatures && (
            <ul className="mt-3 space-y-1.5">
              {(['modelSwitch', 'dynamicParams', 'costEstimate', 'upstream'] as const).map(k => (
                <li key={k} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="mt-0.5 text-primary shrink-0">•</span>
                  <span>{t(`workflow.guide.aiTask.features.${k}`, k)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 pt-2 flex items-center justify-between">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${
                  i === step
                    ? 'bg-primary w-4'
                    : i < step
                      ? 'bg-primary/50'
                      : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                }`}
                aria-label={`Step ${i + 1}`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
            >
              {t('workflow.guide.skip', 'Skip')}
            </button>
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setStep(s => s - 1)}>
                {t('workflow.guide.prev', 'Back')}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                if (step < total - 1) setStep(s => s + 1)
                else onClose()
              }}
            >
              {step === total - 1
                ? t('workflow.guide.finish', 'Get Started')
                : t('workflow.guide.next', 'Next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
