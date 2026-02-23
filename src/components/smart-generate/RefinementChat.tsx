import { useState, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useSmartGenerateStore } from '@/stores/smartGenerateStore'
import { estimateCost, getDefaultModel, isTrainerMode, TRAINER_MODELS } from '@/lib/smartGenerateUtils'
import { SaveTemplateDialog } from './SaveTemplateDialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getScoreColor } from '@/lib/smartGenerateUtils'
import {
  Send,
  RefreshCw,
  Save,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  DollarSign,
  Brain,
  CheckCircle2,
  X,
} from 'lucide-react'

interface RefinementChatProps {
  className?: string
}

export function RefinementChat({ className }: RefinementChatProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [pickerManualToggle, setPickerManualToggle] = useState<boolean | null>(null)
  const [showTemplate, setShowTemplate] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const {
    chatMessages,
    suggestedPrompt,
    contextLayer2,
    phase,
    mode,
    selectedModelId,
    userPrompt,
    bestAttempt,
    parallelCount,
    attempts,
    selectedAttemptForChat,
    sendChatMessage,
    applyRefinedPrompt,
    applySuggestedPrompt,
    selectAttemptForChat,
  } = useSmartGenerateStore()

  const completedAttempts = useMemo(() =>
    attempts.filter(a => a.status === 'complete' && a.outputUrl),
    [attempts]
  )

  const showPicker = pickerManualToggle ?? completedAttempts.length <= 8
  const setShowPicker = (v: boolean) => setPickerManualToggle(v)

  const modelId = selectedModelId || (isTrainerMode(mode) ? TRAINER_MODELS[0].modelId : getDefaultModel(mode).modelId)
  const regenCost = estimateCost(modelId, parallelCount, 1)
  const isPaused = phase === 'paused' || phase === 'failed'
  const bestScore = bestAttempt?.tier2Score ?? bestAttempt?.tier1Score ?? 0

  // Auto-scroll on new messages - target the Radix ScrollArea Viewport
  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
  }, [chatMessages])

  const handleSend = async () => {
    if (!input.trim() || isSending) return
    const msg = input.trim()
    setInput('')
    setIsSending(true)
    try {
      await sendChatMessage(msg)
    } finally {
      setIsSending(false)
    }
  }



  const handleRegenerate = async () => {
    if (userPrompt) {
      await applyRefinedPrompt(userPrompt)
    }
  }

  const handleGoPlayground = () => {
    navigate(`/playground/${modelId}`, { state: { prompt: userPrompt } })
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="border-b bg-background/60 p-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">{t('smartGenerate.chat.title')}</h3>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTemplate(true)}
              className="h-7 w-7 p-0"
              title={t('smartGenerate.chat.saveTemplate')}
            >
              <Save className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGoPlayground}
              className="h-7 w-7 p-0"
              title={t('smartGenerate.chat.goPlayground')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Timeline results picker (collapsible, max 2 rows visible) */}
      {completedAttempts.length > 0 && (
        <div className="border-b bg-background/40 px-3 py-2 shrink-0">
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="flex items-center gap-1.5 w-full text-[10px] text-muted-foreground mb-1"
          >
            <span>{t('smartGenerate.chat.pickResult')}</span>
            <span className="font-medium text-foreground">({completedAttempts.length})</span>
            {showPicker
              ? <ChevronUp className="h-3 w-3 ml-auto" />
              : <ChevronDown className="h-3 w-3 ml-auto" />
            }
          </button>
          {showPicker && (
            <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto">
              {completedAttempts.map((attempt) => {
                const score = attempt.tier2Score ?? attempt.tier1Score ?? 0
                const isSelected = selectedAttemptForChat?.id === attempt.id
                const isVideo = attempt.outputUrl?.match(/\.(mp4|webm|mov)/i)
                return (
                  <button
                    key={attempt.id}
                    onClick={() => selectAttemptForChat(isSelected ? null : attempt)}
                    className={cn(
                      'w-14 rounded-md overflow-hidden border-2 transition-colors',
                      isSelected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'
                    )}
                  >
                    <div className="aspect-square bg-muted/30 relative">
                      {isVideo ? (
                        <video src={attempt.outputUrl!} className="w-full h-full object-cover" muted />
                      ) : (
                        <img src={attempt.outputUrl!} alt="" className="w-full h-full object-cover" />
                      )}
                      {isSelected && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        </div>
                      )}
                    </div>
                    <div className="text-center py-0.5">
                      <span className="text-[9px] font-bold" style={{ color: getScoreColor(score) }}>{score}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Selected attempt indicator */}
      {selectedAttemptForChat && selectedAttemptForChat.outputUrl && (
        <div className="border-b bg-primary/5 px-3 py-1.5 shrink-0 flex items-center gap-2">
          {selectedAttemptForChat.outputUrl.match(/\.(mp4|webm|mov)/i) ? (
            <video
              src={selectedAttemptForChat.outputUrl}
              muted
              className="h-8 w-8 rounded object-cover"
            />
          ) : (
            <img
              src={selectedAttemptForChat.outputUrl}
              alt=""
              className="h-8 w-8 rounded object-cover"
            />
          )}
          <span className="text-xs text-muted-foreground flex-1">
            {t('smartGenerate.chat.refiningSelected')}
          </span>
          <button onClick={() => selectAttemptForChat(null)} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-3">
          {/* Memory summary (collapsible) */}
          {contextLayer2 && (
            <div className="rounded-lg border bg-muted/20 p-2">
              <button
                onClick={() => setShowMemory(!showMemory)}
                className="flex items-center gap-2 w-full text-xs text-muted-foreground"
              >
                <Brain className="h-3 w-3" />
                <span>{t('smartGenerate.chat.aiUnderstanding')}</span>
                {showMemory ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
              </button>
              {showMemory && (
                <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{contextLayer2}</p>
              )}
            </div>
          )}

          {/* Chat messages */}
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  'max-w-[85%] rounded-xl px-3 py-2 text-sm',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50'
                )}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                <span className="text-[10px] opacity-50 mt-1 block">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {/* Empty state */}
          {chatMessages.length === 0 && isPaused && (
            <div className="text-center text-sm text-muted-foreground py-6">
              <p>{t('smartGenerate.chat.emptyHint')}</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Apply suggested prompt */}
      {suggestedPrompt && (
        <div className="border-t bg-primary/5 px-3 py-2 shrink-0">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1 truncate">{suggestedPrompt}</p>
            <Button
              size="sm"
              variant="default"
              onClick={applySuggestedPrompt}
              className="text-xs shrink-0"
            >
              {t('smartGenerate.chat.applyPrompt')}
            </Button>
          </div>
        </div>
      )}

      {/* Regenerate + Cost */}
      {isPaused && (
        <div className="border-t bg-background/40 px-3 py-2 shrink-0">
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRegenerate}
              className="text-xs"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              {t('smartGenerate.chat.regenerate')}
            </Button>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              ~${regenCost.min.toFixed(3)} {t('smartGenerate.chat.extraCost')}
            </span>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t bg-background/80 p-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!isSending) handleSend()
              }
            }}
            placeholder={t('smartGenerate.chat.placeholder')}
            rows={1}
            className="flex-1 min-h-[36px] max-h-[100px] rounded-lg border bg-background/80 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            className="h-9 w-9 p-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <SaveTemplateDialog open={showTemplate} onOpenChange={setShowTemplate} />
    </div>
  )
}
