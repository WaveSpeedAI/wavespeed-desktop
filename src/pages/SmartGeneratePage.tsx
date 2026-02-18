import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useSmartGenerateStore } from '@/stores/smartGenerateStore'
import { SmartGenerateConfig } from '@/components/smart-generate/SmartGenerateConfig'
import { SmartGenerateOutput } from '@/components/smart-generate/SmartGenerateOutput'
import { RefinementChat } from '@/components/smart-generate/RefinementChat'
import { Button } from '@/components/ui/button'
import { Sparkles, ArrowRight, ArrowLeft, Zap, BarChart3, Wand2 } from 'lucide-react'

// Check if running in Capacitor native environment
const isCapacitorNative = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(window as any).Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

type MobileTab = 'config' | 'output' | 'chat'

export function SmartGeneratePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isMobile = isCapacitorNative()
  const [mobileTab, setMobileTab] = useState<MobileTab>('config')

  const {
    phase,
    isFirstVisit,
    dismissFirstVisit,
    startPipeline,
    chatMessages,
    updateEstimatedCost,
  } = useSmartGenerateStore()

  const isRunning = phase !== 'idle' && phase !== 'paused' && phase !== 'complete' && phase !== 'failed'
  const isPaused = phase === 'paused' || phase === 'failed'
  const hasChatBadge = isPaused && chatMessages.length === 0

  // Auto-switch to output tab when pipeline starts
  useEffect(() => {
    if (isRunning && isMobile) {
      setMobileTab('output')
    }
  }, [isRunning, isMobile])

  // Initialize estimated cost on mount
  useEffect(() => {
    updateEstimatedCost()
  }, [updateEstimatedCost])

  const handleStart = () => {
    startPipeline()
    if (isMobile) setMobileTab('output')
  }

  // First visit guide
  if (isFirstVisit) {
    return <FirstVisitGuide onDismiss={dismissFirstVisit} t={t} />
  }

  // ─── Desktop Layout ─────────────────────────────────────────────────
  if (!isMobile) {
    return (
      <div className="flex flex-col h-full bg-gradient-to-b from-background via-background to-muted/20">
        {/* Desktop Header */}
        <div className="shrink-0 border-b px-4 py-3 flex items-center gap-3">
          <Wand2 className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold">{t('nav.smartGenerate')}</h1>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Config */}
          <div className="w-[320px] border-r flex flex-col overflow-hidden">
            <SmartGenerateConfig onStart={handleStart} />
          </div>

          {/* Center: Output + Timeline */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <SmartGenerateOutput />
          </div>

          {/* Right: Chat */}
          <div className="w-[300px] border-l flex flex-col overflow-hidden">
            <RefinementChat />
          </div>
        </div>
      </div>
    )
  }

  // ─── Mobile Layout ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-background via-background to-muted/20">
      {/* Mobile Header with back button */}
      <div className="shrink-0 border-b px-4 py-3 flex items-center gap-3 pt-12">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Wand2 className="h-4 w-4 text-primary" />
        <h1 className="text-sm font-semibold">{t('nav.smartGenerate')}</h1>
      </div>

      {/* Mobile Tab Bar */}
      <div className="flex border-b bg-background/80 backdrop-blur shrink-0">
        <button
          onClick={() => setMobileTab('config')}
          disabled={isRunning}
          className={cn(
            'flex-1 py-2.5 text-sm font-medium transition-colors border-b-2',
            mobileTab === 'config'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground',
            isRunning && 'opacity-50'
          )}
        >
          {t('smartGenerate.tab.config')}
        </button>
        <button
          onClick={() => setMobileTab('output')}
          className={cn(
            'flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 relative',
            mobileTab === 'output'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground'
          )}
        >
          {t('smartGenerate.tab.output')}
          {isRunning && (
            <span className="absolute top-1.5 right-[calc(50%-20px)] h-2 w-2 rounded-full bg-primary animate-pulse" />
          )}
        </button>
        <button
          onClick={() => setMobileTab('chat')}
          className={cn(
            'flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 relative',
            mobileTab === 'chat'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground'
          )}
        >
          {t('smartGenerate.tab.chat')}
          {hasChatBadge && (
            <span className="absolute top-1.5 right-[calc(50%-12px)] h-2 w-2 rounded-full bg-amber-500" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {mobileTab === 'config' && <SmartGenerateConfig onStart={handleStart} />}
        {mobileTab === 'output' && <SmartGenerateOutput />}
        {mobileTab === 'chat' && <RefinementChat />}
      </div>
    </div>
  )
}

// ─── First Visit Guide ───────────────────────────────────────────────────────

function FirstVisitGuide({ onDismiss, t }: { onDismiss: () => void; t: (key: string) => string }) {
  const steps = [
    {
      icon: <Sparkles className="h-8 w-8 text-primary" />,
      title: t('smartGenerate.guide.step1Title'),
      desc: t('smartGenerate.guide.step1Desc'),
    },
    {
      icon: <Zap className="h-8 w-8 text-amber-500" />,
      title: t('smartGenerate.guide.step2Title'),
      desc: t('smartGenerate.guide.step2Desc'),
    },
    {
      icon: <BarChart3 className="h-8 w-8 text-emerald-500" />,
      title: t('smartGenerate.guide.step3Title'),
      desc: t('smartGenerate.guide.step3Desc'),
    },
  ]

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <h2 className="text-2xl font-bold mb-6 bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
        {t('smartGenerate.guide.title')}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mb-8">
        {steps.map((step, idx) => (
          <div key={idx} className="text-center p-4 rounded-xl border bg-card/50">
            <div className="flex justify-center mb-3">{step.icon}</div>
            <h3 className="font-semibold mb-1">{step.title}</h3>
            <p className="text-sm text-muted-foreground">{step.desc}</p>
          </div>
        ))}
      </div>
      <Button onClick={onDismiss} size="lg" className="gap-2">
        {t('smartGenerate.guide.getStarted')}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
