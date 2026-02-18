import { create } from 'zustand'
import { toast } from '@/hooks/useToast'
import i18n from '@/i18n'
import {
  type SmartMode,
  type GenerationAttempt,
  type ChatMessage,
  type LoraItem,
  getDefaultModel,
  getModelAdapter,
  getNextFallbackModel,
  isTopModel,
  needsSourceImage,
  callLLM,
  detectNSFW,
  callPromptOptimizer,
  callImageCaptioner,
  callVideoCaptioner,
  isVideoMode,
  quickScore,
  deepAnalyze,
  buildChatSystemPrompt,
  compressMemory,
  loadLayer2,
  saveLayer2,
  estimateCost,
  checkBalance,
  runGeneration,
  generateRandomSeed,
  extractOutput,
  isPermanentError,
} from '@/lib/smartGenerateUtils'

// ─── Types ───────────────────────────────────────────────────────────────────

export type PipelinePhase =
  | 'idle'
  | 'checking-balance'
  | 'understanding'
  | 'optimizing'
  | 'generating'
  | 'evaluating'
  | 'retrying'
  | 'switching'
  | 'paused'
  | 'complete'
  | 'failed'

// Per-mode session state (saved/restored on tab switch)
interface ModeSession {
  userPrompt: string
  sourceImages: string[]
  referenceImage: string | null
  sizeValue: string | null
  resolutionValue: string | null
  extraConfigValues: Record<string, unknown>
  selectedModelId: string | null
  phase: PipelinePhase
  promptVariants: string[]
  attempts: GenerationAttempt[]
  bestAttempt: GenerationAttempt | null
  currentModelId: string | null
  currentRound: number
  failedModels: string[]
  currentSpent: number
  estimatedTimeRemaining: number | null
  contextLayer1: { originalPrompt: string; bestScore: number; bestAnalysis: string; target: number; mode: string }
  contextLayer3: ChatMessage[]
  chatMessages: ChatMessage[]
  quickFeedbackOptions: string[]
  suggestedPrompt: string | null
  selectedAttemptForChat: GenerationAttempt | null
  pipelineError: string | null
  imageDescription: string | null
}

interface SmartGenerateState {
  // Config
  mode: SmartMode
  selectedModelId: string | null
  userPrompt: string
  sourceImages: string[]  // Edit: multiple images; I2V: single image
  referenceImage: string | null
  sizeValue: string | null  // "1024*1024" or "16:9" etc.
  resolutionValue: string | null  // "1k"/"2k"/"4k" etc.
  extraConfigValues: Record<string, unknown>  // model-specific: duration, resolution, loras, etc.
  targetScore: number
  parallelCount: 2 | 4
  budgetLimit: number

  // Pipeline state
  phase: PipelinePhase
  promptVariants: string[]
  attempts: GenerationAttempt[]
  bestAttempt: GenerationAttempt | null  // computed from attempts, do not set directly
  currentModelId: string | null
  currentRound: number
  failedModels: string[]
  maxRoundsPerModel: number

  // Cost
  estimatedCost: { min: number; max: number }
  currentSpent: number
  estimatedTimeRemaining: number | null

  // Context layers
  contextLayer1: {
    originalPrompt: string
    bestScore: number
    bestAnalysis: string
    target: number
    mode: string
  }
  contextLayer2: string
  contextLayer3: ChatMessage[]
  chatMessages: ChatMessage[]
  quickFeedbackOptions: string[]
  suggestedPrompt: string | null
  selectedAttemptForChat: GenerationAttempt | null
  imageDescription: string | null  // cached captioner result for source/reference image

  // Per-mode session cache
  modeSessions: Partial<Record<SmartMode, ModeSession>>

  // UI state
  cancelRequested: boolean
  isFirstVisit: boolean
  isLocked: boolean
  pipelineError: string | null

  // Actions
  setMode: (mode: SmartMode) => void
  setSelectedModelId: (modelId: string) => void
  setUserPrompt: (prompt: string) => void
  addSourceImage: (url: string) => void
  removeSourceImage: (index: number) => void
  setReferenceImage: (url: string | null) => void
  setSizeValue: (value: string | null) => void
  setResolutionValue: (value: string | null) => void
  setExtraConfigValue: (key: string, value: unknown) => void
  setTargetScore: (score: number) => void
  setParallelCount: (count: 2 | 3) => void
  setBudgetLimit: (budget: number) => void
  startPipeline: () => Promise<void>
  cancelPipeline: () => void
  sendChatMessage: (content: string) => Promise<void>
  applyRefinedPrompt: (prompt: string) => Promise<void>
  applySuggestedPrompt: () => void
  selectAttemptForChat: (attempt: GenerationAttempt | null) => void
  saveAsTemplate: (name: string) => void
  useResultAsSource: (imageUrl: string) => void
  addToolResult: (outputUrl: string, modelId: string, cost: number) => void
  startNewTask: () => void
  reset: () => void
  dismissFirstVisit: () => void
  updateEstimatedCost: () => void
}

// ─── Initial State ───────────────────────────────────────────────────────────

const FIRST_VISIT_KEY = 'wavespeed_smart_generate_visited'

function getInitialFirstVisit(): boolean {
  try {
    return !localStorage.getItem(FIRST_VISIT_KEY)
  } catch {
    return true
  }
}

const initialState = {
  mode: 'text-to-image' as SmartMode,
  selectedModelId: null as string | null,
  userPrompt: '',
  sourceImages: [] as string[],
  referenceImage: null as string | null,
  sizeValue: null as string | null,
  resolutionValue: null as string | null,
  extraConfigValues: {} as Record<string, unknown>,
  targetScore: 80,
  parallelCount: 2 as 2 | 4,
  budgetLimit: 1.0,
  phase: 'idle' as PipelinePhase,
  promptVariants: [] as string[],
  attempts: [] as GenerationAttempt[],
  bestAttempt: null as GenerationAttempt | null,
  currentModelId: null as string | null,
  currentRound: 0,
  failedModels: [] as string[],
  maxRoundsPerModel: 5,
  estimatedCost: { min: 0, max: 0 },
  currentSpent: 0,
  estimatedTimeRemaining: null as number | null,
  contextLayer1: { originalPrompt: '', bestScore: 0, bestAnalysis: '', target: 90, mode: '' },
  contextLayer2: loadLayer2(),
  contextLayer3: [] as ChatMessage[],
  chatMessages: [] as ChatMessage[],
  quickFeedbackOptions: [] as string[],
  suggestedPrompt: null as string | null,
  selectedAttemptForChat: null as GenerationAttempt | null,
  imageDescription: null as string | null,
  modeSessions: {} as Partial<Record<SmartMode, ModeSession>>,
  cancelRequested: false,
  isFirstVisit: getInitialFirstVisit(),
  isLocked: false,
  pipelineError: null as string | null,
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useSmartGenerateStore = create<SmartGenerateState>((set, get) => {
  // Helper: check cancel
  const isCancelled = () => get().cancelRequested

  // Helper: add cost (mode-aware version created per-pipeline)
  const addCostRaw = (amount: number) => {
    set(s => ({ currentSpent: s.currentSpent + amount }))
  }

  // Helper: recompute best attempt from ALL attempts (exclude tool results — they have no prompt so can't be scored)
  const recomputeBestRaw = () => {
    const completed = get().attempts.filter(a => a.status === 'complete' && a.outputUrl && !a.id.startsWith('tool-'))
    if (completed.length === 0) {
      set({ bestAttempt: null })
      return
    }
    const best = completed.reduce((prev, curr) => {
      const prevScore = prev.tier2Score ?? prev.tier1Score ?? 0
      const currScore = curr.tier2Score ?? curr.tier1Score ?? 0
      return currScore > prevScore ? curr : prev
    })
    set({ bestAttempt: best })
  }

  // Helper: estimate time remaining
  const updateTimeEstimateRaw = (modelId: string, parallelCount: number) => {
    const adapter = getModelAdapter(modelId)
    if (!adapter) return
    const avgTime = (adapter.estimatedTime.min + adapter.estimatedTime.max) / 2
    set({ estimatedTimeRemaining: avgTime * parallelCount })
  }

  // ─── Pipeline ──────────────────────────────────────────────────────────

  async function executePipeline(options?: { keepHistory?: boolean }) {
    const state = get()
    const { mode, userPrompt, sourceImages, referenceImage, sizeValue, resolutionValue, extraConfigValues, targetScore, parallelCount, budgetLimit } = state
    const sourceImage = sourceImages[0] ?? null  // primary image for captioner/I2V

    // Capture the mode this pipeline was started for.
    // If user switches modes mid-pipeline, all further updates become no-ops.
    const pipelineMode = mode
    const modeChanged = () => get().mode !== pipelineMode
    const pipelineSet: typeof set = (updater: any) => {
      if (modeChanged()) return
      set(updater)
    }
    const addCost = (amount: number) => {
      if (modeChanged()) return
      addCostRaw(amount)
    }
    const recomputeBest = () => {
      if (modeChanged()) return
      recomputeBestRaw()
    }
    const updateTimeEstimate = (mid: string, pc: number) => {
      if (modeChanged()) return
      updateTimeEstimateRaw(mid, pc)
    }
    const modelId = state.selectedModelId || getDefaultModel(mode).modelId
    const adapter = getModelAdapter(modelId)
    if (!adapter) {
      pipelineSet({ phase: 'failed', pipelineError: 'Invalid model', isLocked: false })
      return
    }

    // Combined stop check: user cancel OR mode switched away
    const shouldStop = () => isCancelled() || modeChanged()

    const keepHistory = options?.keepHistory ?? false

    pipelineSet({
      phase: 'checking-balance',
      isLocked: true,
      cancelRequested: false,
      currentModelId: modelId,
      currentRound: 0,
      failedModels: [],
      // Keep old attempts + chat when refining
      ...(keepHistory ? {} : { attempts: [], chatMessages: [] as ChatMessage[], contextLayer3: [] as ChatMessage[], quickFeedbackOptions: [] as string[] }),
      currentSpent: keepHistory ? get().currentSpent : 0,
      pipelineError: null,
      contextLayer1: keepHistory
        ? { ...get().contextLayer1, target: targetScore }
        : { originalPrompt: userPrompt, bestScore: 0, bestAnalysis: '', target: targetScore, mode },
    })

    try {
      // [0] Balance check
      const balanceResult = await checkBalance()
      if (!balanceResult.sufficient) {
        pipelineSet({ phase: 'failed', pipelineError: i18n.t('smartGenerate.error.insufficientBalance', { balance: balanceResult.balance.toFixed(2) }), isLocked: false })
        return
      }
      if (shouldStop()) return finishCancel(pipelineMode)

      // [1] Image understanding (if needed)
      pipelineSet({ phase: 'understanding' })
      let imageDescription: string | undefined = get().imageDescription || undefined
      const imageToDescribe = sourceImage || referenceImage
      if (imageToDescribe && !imageDescription) {
        try {
          imageDescription = await callImageCaptioner(imageToDescribe)
          pipelineSet({ imageDescription: imageDescription || null })
        } catch {
          // non-fatal
        }
      }
      if (shouldStop()) return finishCancel(pipelineMode)

      // [2] Prompt variants
      let currentAdapter = adapter
      let currentModelIdLocal = modelId

      // Enrich prompt with reference image description (T2I only, no source image)
      let effectivePrompt = userPrompt
      if (referenceImage && imageDescription && !sourceImage) {
        effectivePrompt = `${userPrompt}\n\n(Visual reference: ${imageDescription})`
        toast({
          title: i18n.t('smartGenerate.toast.referenceApplied'),
          description: i18n.t('smartGenerate.toast.referenceAppliedDesc'),
          duration: 4000,
        })
      }

      // First run: use prompt directly (no LLM optimization)
      // User wants to see their own prompt's effect first.
      // Refine run (keepHistory): prompt was already refined via chat, use as-is.
      // Parallel diversity comes from different seeds, not different prompts.
      const variants = Array(parallelCount).fill(effectivePrompt)
      pipelineSet({ promptVariants: [effectivePrompt] })
      if (shouldStop()) return finishCancel(pipelineMode)

      // ─── Generation Loop ─────────────────────────────────────────
      // Automatic retry: generate → evaluate → score < target → retry with new seeds
      // Up to maxRoundsPerModel per model, then fallback chain switch

      const existingAttempts = get().attempts
      let currentRoundNum = existingAttempts.length > 0
        ? Math.max(...existingAttempts.map(a => a.roundIndex)) + 1
        : 1
      let roundsOnCurrentModel = 0
      let tempRetryCount = 0
      const MAX_TEMP_RETRIES = 3
      const { maxRoundsPerModel } = get()

      while (true) {
        if (modeChanged()) return
        roundsOnCurrentModel++
        pipelineSet({ currentRound: currentRoundNum })

        // Budget check
        const spent = get().currentSpent
        const nextRoundCost = currentAdapter.price * parallelCount + 0.03 // generation + auxiliary
        if (spent >= budgetLimit) {
          recomputeBest()
          pipelineSet({ phase: get().bestAttempt ? 'paused' : 'failed' })
          break
        }
        if (spent + nextRoundCost > budgetLimit) {
          // Not enough for next full round — warn user and stop
          toast({
            title: i18n.t('smartGenerate.toast.budgetWarning'),
            description: i18n.t('smartGenerate.toast.budgetWarningDesc', {
              spent: spent.toFixed(2),
              budget: budgetLimit.toFixed(2),
            }),
            duration: 5000,
          })
          recomputeBest()
          pipelineSet({ phase: get().bestAttempt ? 'paused' : 'failed' })
          break
        }
        if (shouldStop()) return finishCancel(pipelineMode)

        // [3] Generate in parallel
        pipelineSet({ phase: 'generating' })
        updateTimeEstimate(currentModelIdLocal, variants.length)

        const seeds = variants.map(() =>
          currentAdapter.seedField ? generateRandomSeed() : undefined
        )

        const genPromises = variants.map((prompt, idx) => {
          const attemptId = `r${currentRoundNum}-v${idx}-${Date.now()}`
          const attempt: GenerationAttempt = {
            id: attemptId,
            roundIndex: currentRoundNum,
            variantIndex: idx,
            modelId: currentModelIdLocal,
            promptUsed: prompt,
            outputUrl: null,
            tier1Score: null,
            tier2Score: null,
            tier2Analysis: null,
            moderationPassed: null,
            status: 'generating',
            cost: currentAdapter.price,
            inferenceTime: null,
            timestamp: Date.now(),
          }
          pipelineSet(s => ({ attempts: [...s.attempts, attempt] }))

          return runGeneration(currentModelIdLocal, prompt, mode, sourceImages.length > 0 ? sourceImages : undefined, seeds[idx], mode === 'image-to-video' ? undefined : sizeValue ?? undefined, resolutionValue ?? undefined, Object.keys(extraConfigValues).length > 0 ? extraConfigValues : undefined)
            .then(result => {
              const outputUrl = extractOutput(result)
              const inferenceTime = result.timings?.inference ?? null
              pipelineSet(s => ({
                attempts: s.attempts.map(a =>
                  a.id === attemptId ? { ...a, outputUrl, inferenceTime, status: outputUrl ? 'scoring' as const : 'failed' as const } : a
                ),
              }))
              addCost(currentAdapter.price)
              return { attemptId, outputUrl, inferenceTime, error: null as unknown }
            })
            .catch(error => {
              pipelineSet(s => ({
                attempts: s.attempts.map(a =>
                  a.id === attemptId ? { ...a, status: 'failed' as const } : a
                ),
              }))
              return { attemptId, outputUrl: null as string | null, inferenceTime: null, error }
            })
        })

        const genResults = await Promise.allSettled(genPromises)
        if (shouldStop()) return finishCancel(pipelineMode)

        // Collect successful outputs
        const outputs: { attemptId: string; outputUrl: string }[] = []
        let allPermanentError = true
        for (const r of genResults) {
          if (r.status === 'fulfilled' && r.value.outputUrl) {
            outputs.push({ attemptId: r.value.attemptId, outputUrl: r.value.outputUrl })
            allPermanentError = false
          } else if (r.status === 'fulfilled' && r.value.error) {
            if (!isPermanentError(r.value.error)) allPermanentError = false
          }
        }

        // All failed — error handling
        if (outputs.length === 0) {
          if (allPermanentError) {
            // Permanent error → switch model immediately
            const next = getNextFallbackModel(mode, [...get().failedModels, currentModelIdLocal], currentModelIdLocal)
            if (next) {
              pipelineSet(s => ({
                failedModels: [...s.failedModels, currentModelIdLocal],
                phase: 'switching',
              }))
              currentModelIdLocal = next
              currentAdapter = getModelAdapter(next)!
              pipelineSet({ currentModelId: next })
              roundsOnCurrentModel = 0
              tempRetryCount = 0
              currentRoundNum++
              continue
            }
            // No more models → stop
            recomputeBest()
            pipelineSet({ phase: get().bestAttempt ? 'paused' : 'failed' })
            break
          }
          // Temporary error → retry same round (up to MAX_TEMP_RETRIES)
          tempRetryCount++
          if (tempRetryCount <= MAX_TEMP_RETRIES) {
            roundsOnCurrentModel-- // don't count failed attempt as a round
            await new Promise(resolve => setTimeout(resolve, 2000))
            continue
          }
          recomputeBest()
          pipelineSet({ phase: get().bestAttempt ? 'paused' : 'failed' })
          break
        }

        // [4] Two-tier evaluation
        pipelineSet({ phase: 'evaluating' })
        let roundBestScore = 0
        let roundBest: GenerationAttempt | null = null

        for (const out of outputs) {
          if (shouldStop()) return finishCancel(pipelineMode)

          // Tier 1 - Quick score
          const t1 = await quickScore(out.outputUrl, userPrompt, mode)
          addCost(0.005)
          pipelineSet(s => ({
            attempts: s.attempts.map(a =>
              a.id === out.attemptId ? { ...a, tier1Score: t1.score } : a
            ),
          }))

          const finalScore = t1.score
          let feedbackOptions: string[] = []

          // Tier 2 - Deep analysis (only if 60 <= score < target, saves money)
          if (t1.score >= 60 && t1.score < targetScore) {
            const t2 = await deepAnalyze(out.outputUrl, userPrompt, mode)
            addCost(0.015)
            feedbackOptions = t2.quickFeedback

            pipelineSet(s => ({
              attempts: s.attempts.map(a =>
                a.id === out.attemptId
                  ? { ...a, tier2Score: t2.totalScore, tier2Analysis: t2.analysis, status: 'complete' }
                  : a
              ),
            }))
          } else {
            pipelineSet(s => ({
              attempts: s.attempts.map(a =>
                a.id === out.attemptId ? { ...a, status: 'complete' } : a
              ),
            }))
          }

          // Track round best
          recomputeBest()
          if (finalScore > roundBestScore) {
            roundBestScore = finalScore
            roundBest = get().attempts.find(a => a.id === out.attemptId)!
            if (feedbackOptions.length > 0) {
              pipelineSet({ quickFeedbackOptions: feedbackOptions })
            }
          }
        }

        // Update context layer 1
        if (roundBest) {
          pipelineSet(s => ({
            contextLayer1: {
              ...s.contextLayer1,
              bestScore: roundBestScore,
              bestAnalysis: roundBest?.tier2Analysis || '',
            },
          }))
        }

        // [5] Decision — check global best score across ALL rounds
        const globalBest = get().bestAttempt
        const globalBestScore = globalBest ? (globalBest.tier2Score ?? globalBest.tier1Score ?? 0) : 0

        if (globalBestScore >= targetScore) {
          // Target reached → complete
          pipelineSet({ phase: 'complete' })
          break
        }

        // Target not met — check if should retry or switch model
        if (roundsOnCurrentModel >= maxRoundsPerModel) {
          // Max rounds on this model → try fallback chain
          // Skip fallback if user selected the top-tier model
          if (isTopModel(mode, currentModelIdLocal)) {
            pipelineSet({ phase: 'paused' })
            break
          }
          const next = getNextFallbackModel(mode, [...get().failedModels, currentModelIdLocal], currentModelIdLocal)
          if (next) {
            pipelineSet(s => ({
              failedModels: [...s.failedModels, currentModelIdLocal],
              phase: 'switching',
            }))
            currentModelIdLocal = next
            currentAdapter = getModelAdapter(next)!
            pipelineSet({ currentModelId: next })
            roundsOnCurrentModel = 0
            tempRetryCount = 0
            currentRoundNum++
            await new Promise(r => setTimeout(r, 500))
            continue
          }
          // No more models → pause with best result
          pipelineSet({ phase: 'paused' })
          break
        }

        // Score < target, rounds left → retry with new seeds
        pipelineSet({ phase: 'retrying' })
        currentRoundNum++
        await new Promise(r => setTimeout(r, 500))
        // continue loop (new seeds will be generated at top)
      }

      // Pipeline finished — ensure bestAttempt is up to date
      recomputeBest()
      pipelineSet({ isLocked: false })
      if (modeChanged()) return // mode switched, state already saved
      // Brief delay so budget warning toast (if any) is visible before result toast
      await new Promise(r => setTimeout(r, 1500))
      const finalPhase = get().phase
      const finalBest = get().bestAttempt
      if (finalBest) {
        const score = finalBest.tier2Score ?? finalBest.tier1Score ?? 0
        if (finalPhase === 'complete') {
          toast({
            title: i18n.t('smartGenerate.toast.complete'),
            description: i18n.t('smartGenerate.toast.completeDesc', { score }),
            duration: 5000,
          })
        } else {
          toast({
            title: i18n.t('smartGenerate.toast.paused'),
            description: i18n.t('smartGenerate.toast.pausedDesc', { score }),
            duration: 5000,
          })
        }
      }
    } catch (error) {
      if (modeChanged()) return // mode switched, state already saved
      const msg = error instanceof Error ? error.message : 'Pipeline failed'
      pipelineSet({ phase: 'failed', pipelineError: msg, isLocked: false })
      toast({
        title: i18n.t('smartGenerate.toast.failed'),
        description: msg,
        variant: 'destructive',
        duration: 5000,
      })
    }
  }

  function finishCancel(pipelineMode?: SmartMode) {
    // If mode switched away, the state was already saved by setMode — don't write
    if (pipelineMode && get().mode !== pipelineMode) return
    set({
      phase: get().bestAttempt ? 'paused' : 'idle',
      isLocked: false,
      cancelRequested: false,
    })
    toast({
      title: i18n.t('smartGenerate.toast.cancelled'),
      description: i18n.t('smartGenerate.toast.cancelledDesc', { spent: get().currentSpent.toFixed(3) }),
      duration: 5000,
    })
  }

  // ─── Chat ──────────────────────────────────────────────────────────────

  async function handleChatMessage(content: string) {
    const state = get()
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    set(s => ({
      chatMessages: [...s.chatMessages, userMsg],
      contextLayer3: [...s.contextLayer3.slice(-3), userMsg],
    }))

    try {
      // Pre-check: detect NSFW using content-moderator/text
      // If NSFW → skip LLM (it would refuse), go straight to prompt-optimizer
      let isNsfw = false
      try {
        isNsfw = await detectNSFW(content)
      } catch {
        // detection failed, assume safe
      }

      if (isNsfw) {
        // NSFW detected → combine original prompt + user request → prompt-optimizer
        const basePrompt = state.contextLayer1.originalPrompt || state.userPrompt
        const combinedInput = basePrompt
          ? `${basePrompt}\n\nUser refinement: ${content}`
          : content

        const safePrompt = await callPromptOptimizer(combinedInput, state.mode, state.sourceImages[0] ?? undefined)

        const displayContent = i18n.t('smartGenerate.chat.suggestedPrompt') +
          '\n\n📝 ' + safePrompt

        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: displayContent,
          timestamp: Date.now(),
        }

        set(s => ({
          chatMessages: [...s.chatMessages, assistantMsg],
          contextLayer3: [...s.contextLayer3.slice(-3), assistantMsg],
          suggestedPrompt: safePrompt,
        }))
        return
      }

      // Auto-caption source/reference content if not cached yet (enables chat before pipeline)
      let imgDesc = get().imageDescription
      if (!imgDesc) {
        try {
          if (isVideoMode(state.mode)) {
            // For video modes: describe the best generated video so LLM knows what it looks like
            const bestVideo = get().bestAttempt?.outputUrl
            if (bestVideo) {
              imgDesc = await callVideoCaptioner(bestVideo)
              set({ imageDescription: imgDesc })
            }
          } else {
            const imageToDescribe = state.sourceImages[0] || state.referenceImage
            if (imageToDescribe) {
              imgDesc = await callImageCaptioner(imageToDescribe)
              set({ imageDescription: imgDesc })
            }
          }
        } catch {
          // non-fatal
        }
      }

      // Normal (safe) flow — use LLM
      const systemPrompt = buildChatSystemPrompt(
        state.mode,
        state.contextLayer1.originalPrompt || state.userPrompt,
        state.contextLayer1.bestScore,
        state.contextLayer1.bestAnalysis,
        state.contextLayer2,
        imgDesc || undefined,
      )

      // Build message context (Layer 3 window)
      const recentMsgs = get().contextLayer3
        .map(m => `${m.role}: ${m.content}`)
        .join('\n')

      // Include selected attempt context if user picked one
      const selectedAttempt = get().selectedAttemptForChat
      let userContext = recentMsgs + `\nuser: ${content}`
      if (selectedAttempt) {
        const score = selectedAttempt.tier2Score ?? selectedAttempt.tier1Score ?? 0
        userContext = recentMsgs +
          `\n[User selected a specific result to refine: Round ${selectedAttempt.roundIndex}, Score ${score}, Prompt used: "${selectedAttempt.promptUsed}"]` +
          `\nuser: ${content}`
      }

      const raw = await callLLM(systemPrompt, userContext)

      // Normal flow — parse LLM response
      let displayContent = raw
      let suggestedPrompt: string | null = null
      try {
        // Try parsing as pure JSON first
        const parsed = JSON.parse(raw)
        if (parsed.action === 'regenerate' && parsed.prompt) {
          suggestedPrompt = parsed.prompt
          displayContent = (parsed.explanation || parsed.brief || i18n.t('smartGenerate.chat.suggestedPrompt')) +
            '\n\n📝 ' + parsed.prompt
        }
      } catch {
        // Not pure JSON - try extracting from text
        // Match embedded JSON: {"action": "regenerate", "prompt": "..."}
        const jsonMatch = raw.match(/\{"action"\s*:\s*"regenerate"\s*,\s*"prompt"\s*:\s*"([^"]+)"/)
        if (jsonMatch) {
          suggestedPrompt = jsonMatch[1]
        } else {
          // Match markdown code block with prompt (```\n...\n```)
          const codeBlockMatch = raw.match(/```(?:prompt)?\s*\n([\s\S]*?)\n```/)
          if (codeBlockMatch && codeBlockMatch[1].trim().length > 10) {
            suggestedPrompt = codeBlockMatch[1].trim()
          }
        }
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: displayContent,
        timestamp: Date.now(),
      }

      set(s => ({
        chatMessages: [...s.chatMessages, assistantMsg],
        contextLayer3: [...s.contextLayer3.slice(-3), assistantMsg],
        // Store suggested prompt for "Apply" button
        ...(suggestedPrompt ? { suggestedPrompt } : {}),
      }))

      // Compress memory every 5 rounds
      const allMsgs = get().chatMessages
      if (allMsgs.length > 0 && allMsgs.length % 10 === 0) {
        try {
          const summary = await compressMemory(allMsgs)
          if (summary) {
            set({ contextLayer2: summary })
            saveLayer2(summary)
          }
        } catch {
          // non-fatal
        }
      }
    } catch {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: i18n.t('smartGenerate.chat.error'),
        timestamp: Date.now(),
      }
      set(s => ({ chatMessages: [...s.chatMessages, errorMsg] }))
    }
  }

  // ─── Return ────────────────────────────────────────────────────────────

  return {
    ...initialState,

    setMode: (newMode) => {
      // Allow switching even during a run (results preserved, pipeline stops gracefully)
      const currentMode = get().mode
      if (newMode === currentMode) return

      // If pipeline is running, cancel it gracefully
      const s = get()
      const runningPhases: PipelinePhase[] = ['checking-balance', 'understanding', 'optimizing', 'generating', 'evaluating', 'retrying', 'switching']
      const isRunning = runningPhases.includes(s.phase)
      if (isRunning) {
        // Signal cancel — pipeline will notice via isCancelled() || modeChanged()
        set({ cancelRequested: true })
      }

      // Save current mode's session (force-pause if pipeline was running)
      const currentSession: ModeSession = {
        userPrompt: s.userPrompt,
        sourceImages: s.sourceImages,
        referenceImage: s.referenceImage,
        sizeValue: s.sizeValue,
        resolutionValue: s.resolutionValue,
        extraConfigValues: s.extraConfigValues,
        selectedModelId: s.selectedModelId,
        phase: isRunning ? 'paused' : s.phase,
        promptVariants: s.promptVariants,
        attempts: s.attempts,
        bestAttempt: s.bestAttempt,
        currentModelId: s.currentModelId,
        currentRound: s.currentRound,
        failedModels: s.failedModels,
        currentSpent: s.currentSpent,
        estimatedTimeRemaining: s.estimatedTimeRemaining,
        contextLayer1: s.contextLayer1,
        contextLayer3: s.contextLayer3,
        chatMessages: s.chatMessages,
        quickFeedbackOptions: s.quickFeedbackOptions,
        suggestedPrompt: s.suggestedPrompt,
        selectedAttemptForChat: s.selectedAttemptForChat,
        pipelineError: s.pipelineError,
        imageDescription: s.imageDescription,
      }

      // Restore target mode's session, or start fresh
      const saved = s.modeSessions[newMode]
      const defaultModel = getDefaultModel(newMode)

      if (saved) {
        set({
          mode: newMode,
          modeSessions: { ...s.modeSessions, [currentMode]: currentSession },
          ...saved,
          isLocked: false,
          cancelRequested: false,
        })
      } else {
        set({
          mode: newMode,
          modeSessions: { ...s.modeSessions, [currentMode]: currentSession },
          isLocked: false,
          cancelRequested: false,
          userPrompt: '',
          sourceImages: [],
          referenceImage: null,
          sizeValue: null,
          resolutionValue: null,
          extraConfigValues: {},
          selectedModelId: defaultModel.modelId,
          phase: 'idle',
          promptVariants: [],
          attempts: [],
          bestAttempt: null,
          currentModelId: null,
          currentRound: 0,
          failedModels: [],
          currentSpent: 0,
          estimatedTimeRemaining: null,
          contextLayer1: { originalPrompt: '', bestScore: 0, bestAnalysis: '', target: s.targetScore, mode: newMode },
          contextLayer3: [],
          chatMessages: [],
          quickFeedbackOptions: [],
          suggestedPrompt: null,
          selectedAttemptForChat: null,
          pipelineError: null,
          imageDescription: null,
        })
      }

      get().updateEstimatedCost()
    },

    setSelectedModelId: (modelId) => {
      if (get().isLocked) return
      set({ selectedModelId: modelId, sizeValue: null, resolutionValue: null, extraConfigValues: {} })
      get().updateEstimatedCost()
    },

    setUserPrompt: (prompt) => {
      if (get().isLocked) return
      set({ userPrompt: prompt })
    },

    addSourceImage: (url) => {
      if (get().isLocked) return
      set(s => ({ sourceImages: [...s.sourceImages, url], imageDescription: null }))
    },

    removeSourceImage: (index) => {
      if (get().isLocked) return
      set(s => ({ sourceImages: s.sourceImages.filter((_, i) => i !== index), imageDescription: null }))
    },

    setReferenceImage: (url) => {
      if (get().isLocked) return
      set({ referenceImage: url, imageDescription: null })
    },

    useResultAsSource: (imageUrl) => {
      if (get().isLocked) return
      set({ sourceImages: [imageUrl], imageDescription: null })
    },

    addToolResult: (outputUrl, modelId, cost) => {
      const s = get()
      const maxRound = s.attempts.length > 0
        ? Math.max(...s.attempts.map(a => a.roundIndex))
        : 0
      const attempt: GenerationAttempt = {
        id: `tool-${Date.now()}`,
        roundIndex: maxRound + 1,
        variantIndex: 0,
        modelId,
        promptUsed: '',
        outputUrl,
        tier1Score: null,
        tier2Score: null,
        tier2Analysis: null,
        moderationPassed: null,
        status: 'complete',
        cost,
        inferenceTime: null,
        timestamp: Date.now(),
      }
      // Add to current mode's attempts (shows in timeline + all results)
      set(prev => ({ attempts: [...prev.attempts, attempt] }))
    },

    setSizeValue: (value) => {
      if (get().isLocked) return
      set({ sizeValue: value })
    },

    setResolutionValue: (value) => {
      if (get().isLocked) return
      set({ resolutionValue: value })
    },

    setExtraConfigValue: (key, value) => {
      if (get().isLocked) return
      set(s => ({ extraConfigValues: { ...s.extraConfigValues, [key]: value } }))
    },

    setTargetScore: (score) => {
      if (get().isLocked) return
      set({ targetScore: score })
    },

    setParallelCount: (count) => {
      if (get().isLocked) return
      set({ parallelCount: count })
      get().updateEstimatedCost()
    },

    setBudgetLimit: (budget) => {
      if (get().isLocked) return
      set({ budgetLimit: budget })
    },

    startPipeline: async () => {
      const state = get()
      if (state.isLocked) return
      if (!state.userPrompt.trim()) return
      if (needsSourceImage(state.mode) && state.sourceImages.length === 0) return
      // If there are already results, keep history (refine flow)
      const hasHistory = state.attempts.length > 0
      await executePipeline(hasHistory ? { keepHistory: true } : undefined)
    },

    cancelPipeline: () => {
      set({ cancelRequested: true })
    },

    sendChatMessage: handleChatMessage,

    applyRefinedPrompt: async (prompt: string) => {
      set({ userPrompt: prompt })
      await executePipeline({ keepHistory: true })
    },

    applySuggestedPrompt: async () => {
      const suggested = get().suggestedPrompt
      if (suggested) {
        set({ userPrompt: suggested, suggestedPrompt: null })
        await executePipeline({ keepHistory: true })
      }
    },

    selectAttemptForChat: (attempt: GenerationAttempt | null) => {
      set({ selectedAttemptForChat: attempt })
    },

    saveAsTemplate: (name: string) => {
      const state = get()
      const { useTemplateStore } = require('@/stores/templateStore')
      const modelId = state.selectedModelId || getDefaultModel(state.mode).modelId
      const adapter = getModelAdapter(modelId)
      useTemplateStore.getState().saveTemplate(
        name,
        modelId,
        adapter?.label || modelId,
        {
          smartGenerateMode: state.mode,
          originalPrompt: state.userPrompt,
          optimizedPrompts: state.promptVariants,
          targetScore: state.targetScore,
          parallelCount: state.parallelCount,
          budgetLimit: state.budgetLimit,
        }
      )
    },

    startNewTask: () => {
      const s = get()
      // Clear current mode's saved session so switching back starts fresh
      const updatedSessions = { ...s.modeSessions }
      delete updatedSessions[s.mode]
      set({
        ...initialState,
        mode: s.mode,
        selectedModelId: getDefaultModel(s.mode).modelId,
        isFirstVisit: s.isFirstVisit,
        contextLayer2: s.contextLayer2,
        modeSessions: updatedSessions,
      })
    },

    reset: () => {
      set({
        ...initialState,
        isFirstVisit: get().isFirstVisit,
        contextLayer2: get().contextLayer2,
        modeSessions: {},
        // imageGallery resets to [] via initialState
      })
    },

    dismissFirstVisit: () => {
      try {
        localStorage.setItem(FIRST_VISIT_KEY, '1')
      } catch {
        // ignore
      }
      set({ isFirstVisit: false })
    },

    updateEstimatedCost: () => {
      const state = get()
      const modelId = state.selectedModelId || getDefaultModel(state.mode).modelId
      const cost = estimateCost(modelId, state.parallelCount)
      set({ estimatedCost: cost })
    },
  }
})
