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
  isTrainerMode,
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
  extractTrainingOutput,
  isPermanentError,
  buildTrainingZip,
  getSizeFieldConfig,
  upscaleImage,
  TRAINER_MODELS,
} from '@/lib/smartGenerateUtils'
import { apiClient } from '@/api/client'

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
  pipelineStartIndex: number
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
  // Trainer fields
  trainingImages?: File[]
  trainingPreviews?: string[]
  triggerWord?: string
  trainerSteps?: number
  trainerLearningRate?: number
  trainerLoraRank?: number
  selectedTrainerId?: string | null
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
  pipelineStartIndex: number  // index into attempts[] where current pipeline run begins
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

  // Trainer state
  trainingImages: File[]
  trainingPreviews: string[]
  triggerWord: string
  trainerSteps: number
  trainerLearningRate: number
  trainerLoraRank: number
  selectedTrainerId: string | null

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
  setParallelCount: (count: 2 | 4) => void
  setBudgetLimit: (budget: number) => void
  startPipeline: () => Promise<void>
  cancelPipeline: () => void
  sendChatMessage: (content: string) => Promise<void>
  applyRefinedPrompt: (prompt: string) => Promise<void>
  applySuggestedPrompt: () => Promise<void>
  selectAttemptForChat: (attempt: GenerationAttempt | null) => void
  saveAsTemplate: (name: string) => void
  useResultAsSource: (imageUrl: string) => void
  addToolResult: (outputUrl: string, modelId: string, cost: number) => void
  startNewTask: () => void
  reset: () => void
  dismissFirstVisit: () => void
  updateEstimatedCost: () => void
  // Trainer actions
  addTrainingImages: (files: File[]) => void
  removeTrainingImage: (index: number) => void
  setTriggerWord: (word: string) => void
  setTrainerSteps: (steps: number) => void
  setTrainerLearningRate: (lr: number) => void
  setTrainerLoraRank: (rank: number) => void
  setSelectedTrainerId: (id: string) => void
  startTraining: () => Promise<void>
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
  pipelineStartIndex: 0,
  currentModelId: null as string | null,
  currentRound: 0,
  failedModels: [] as string[],
  maxRoundsPerModel: 5,
  estimatedCost: { min: 0, max: 0 },
  currentSpent: 0,
  estimatedTimeRemaining: null as number | null,
  contextLayer1: { originalPrompt: '', bestScore: 0, bestAnalysis: '', target: 80, mode: '' },
  contextLayer2: loadLayer2(),
  contextLayer3: [] as ChatMessage[],
  chatMessages: [] as ChatMessage[],
  quickFeedbackOptions: [] as string[],
  suggestedPrompt: null as string | null,
  selectedAttemptForChat: null as GenerationAttempt | null,
  imageDescription: null as string | null,
  trainingImages: [] as File[],
  trainingPreviews: [] as string[],
  triggerWord: 'p3r5on',
  trainerSteps: 1000,
  trainerLearningRate: 0.0001,
  trainerLoraRank: 16,
  selectedTrainerId: TRAINER_MODELS[0].modelId,
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
    const { attempts, pipelineStartIndex } = get()
    // Only consider attempts from the current pipeline run (same prompt)
    const currentRunAttempts = attempts.slice(pipelineStartIndex)
    const completed = currentRunAttempts.filter(a => a.status === 'complete' && a.outputUrl && !a.id.startsWith('tool-'))
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
    const { mode, userPrompt, sourceImages, referenceImage, targetScore, parallelCount, budgetLimit } = state
    let resolutionValue = state.resolutionValue
    let extraConfigValues = state.extraConfigValues

    // Reset extra params to new model's defaults on fallback switch
    const resetParamsForModel = (mid: string) => {
      const a = getModelAdapter(mid)
      resolutionValue = null
      extraConfigValues = a?.extraDefaults ? { ...a.extraDefaults } : {}
    }
    // Resolve sizeValue for a given model, respecting its constraints.
    // Handles cross-type switches (enum↔dimensions) and pixel budget limits.
    const resolveSizeForModel = (modelId: string, preferred: string | null): string | null => {
      const cfg = getSizeFieldConfig(modelId)
      if (!cfg) return null
      if (cfg.type === 'enum') {
        if (preferred && cfg.options?.includes(preferred)) return preferred
        // Edit mode: don't auto-select aspect_ratio — API preserves original image ratio when omitted
        if (mode === 'image-edit' && !preferred) return null
        return cfg.default ?? cfg.options?.[0] ?? null
      }
      if (cfg.type === 'dimensions') {
        const defaultSize = cfg.default || '1024*1024'
        const minDim = cfg.min || 256
        const minPixels = minDim * minDim

        // Helper: ensure dimensions meet minimum pixel requirement
        const enforceMinPixels = (w: number, h: number): [number, number] => {
          if (w * h < minPixels) {
            const scale = Math.sqrt(minPixels / (w * h))
            w = Math.ceil(w * scale / 64) * 64
            h = Math.ceil(h * scale / 64) * 64
          }
          return [w, h]
        }

        if (!preferred) {
          // No user preference — use default, but scale up if below model minimum
          const dp = defaultSize.split('*').map(Number)
          if (dp.length === 2 && dp.every(v => v > 0)) {
            let [dw, dh] = dp
            ;[dw, dh] = enforceMinPixels(dw, dh)
            return `${dw}*${dh}`
          }
          return defaultSize
        }

        const parts = preferred.split('*').map(Number)
        if (parts.length !== 2 || parts.some(isNaN) || parts.some(v => v <= 0)) {
          // Invalid format (e.g. "1:1" from an enum model) → use default
          const dp = defaultSize.split('*').map(Number)
          if (dp.length === 2 && dp.every(v => v > 0)) {
            let [dw, dh] = dp
            ;[dw, dh] = enforceMinPixels(dw, dh)
            return `${dw}*${dh}`
          }
          return defaultSize
        }

        let [w, h] = parts
        const maxDim = cfg.max || 1536
        const maxPixels = maxDim * maxDim

        // Scale down if any individual dimension exceeds max
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h)
          w = Math.floor(w * scale / 64) * 64
          h = Math.floor(h * scale / 64) * 64
        }

        // Scale down if total pixels exceed max (API enforces maxPixels ≈ maxDim²)
        if (w * h > maxPixels) {
          const scale = Math.sqrt(maxPixels / (w * h))
          w = Math.floor(w * scale / 64) * 64
          h = Math.floor(h * scale / 64) * 64
        }

        // Scale up if total pixels below model minimum (e.g. Seedream Edit needs ≥ 3686400)
        ;[w, h] = enforceMinPixels(w, h)

        // Clamp individual dimensions to min
        w = Math.max(w, minDim)
        h = Math.max(h, minDim)

        return `${w}*${h}`
      }
      return cfg.default ?? cfg.options?.[0] ?? null
    }

    const keepHistory = options?.keepHistory ?? false
    const sourceImage = sourceImages[0] ?? null  // primary image for captioner/I2V

    // Always use selectedModelId — auto-switch already syncs it, and user manual change is respected.
    const modelId = state.selectedModelId || getDefaultModel(mode).modelId
    // Detect if user explicitly changed model since last run (to reset failedModels)
    const userChangedModel = keepHistory && state.currentModelId && state.currentModelId !== modelId
    // Mutable — recalculated when fallback model switches (different models have different size constraints)
    let sizeValue = resolveSizeForModel(modelId, state.sizeValue)

    // Capture the mode this pipeline was started for.
    // If user switches modes mid-pipeline, all further updates become no-ops.
    const pipelineMode = mode
    const modeChanged = () => get().mode !== pipelineMode
    const pipelineSet: typeof set = (updater: any) => {
      if (modeChanged() || isCancelled()) return
      set(updater)
    }
    const addCost = (amount: number) => {
      if (modeChanged() || isCancelled()) return
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
    const adapter = getModelAdapter(modelId)
    if (!adapter) {
      pipelineSet({ phase: 'failed', pipelineError: 'Invalid model', isLocked: false })
      return
    }

    // Combined stop check: user cancel OR mode switched away
    const shouldStop = () => isCancelled() || modeChanged()

    // Reset cancel flag with raw set() — pipelineSet would no-op since isCancelled() is still true
    set({ cancelRequested: false })

    pipelineSet({
      phase: 'checking-balance',
      isLocked: true,
      currentModelId: modelId,
      currentRound: 0,
      // Always reset failedModels — fallback chain should be fully available each run
      failedModels: [],
      bestAttempt: null,  // Reset so old best doesn't short-circuit new pipeline run
      pipelineStartIndex: keepHistory ? get().attempts.length : 0,  // Only score attempts from this run
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

      // Update AI understanding with current prompt (non-blocking)
      const existingMsgs = get().chatMessages
      if (existingMsgs.length > 0 || get().contextLayer2) {
        compressMemory(existingMsgs, userPrompt).then(summary => {
          if (summary && !modeChanged()) {
            set({ contextLayer2: summary })
            saveLayer2(summary)
          }
        }).catch(() => {})
      }

      // [1] Image understanding + NSFW detection (parallel)
      pipelineSet({ phase: 'understanding' })
      let imageDescription: string | undefined = get().imageDescription || undefined
      let isNsfwContent = false

      const captionerPromise = (async () => {
        const imageToDescribe = sourceImage || referenceImage
        if (imageToDescribe && !imageDescription) {
          try {
            imageDescription = await callImageCaptioner(imageToDescribe)
            pipelineSet({ imageDescription: imageDescription || null })
          } catch {
            // non-fatal
          }
        }
      })()

      const nsfwPromise = (async () => {
        try {
          isNsfwContent = await detectNSFW(userPrompt)
        } catch {
          // fail open — assume safe
        }
      })()

      await Promise.all([captionerPromise, nsfwPromise])
      if (shouldStop()) return finishCancel(pipelineMode)

      const effectiveTarget = isNsfwContent ? 60 : targetScore

      let effectiveSourceImages = sourceImages

      // Seedream Edit requires large source images (≥1920²).
      // Auto-upscale source image and record it as an attempt in Timeline.
      const isSeedreamEdit = (mid: string) => mid.includes('seedream') && mid.includes('edit')
      const upscaleIfNeeded = async (mid: string) => {
        if (!isSeedreamEdit(mid) || mode !== 'image-edit' || effectiveSourceImages.length === 0) return
        try {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
            img.onerror = reject
            img.src = effectiveSourceImages[0]
          })
          if (dims.w * dims.h >= 3686400) return // already large enough

          // Create upscale attempt for Timeline visibility
          const upscaleAttemptId = `upscale-${Date.now()}`
          const existingAttempts = get().attempts
          const maxRound = existingAttempts.length > 0 ? Math.max(...existingAttempts.map(a => a.roundIndex)) : 0
          const upscaleAttempt: GenerationAttempt = {
            id: upscaleAttemptId,
            roundIndex: maxRound + 1,
            variantIndex: 0,
            modelId: 'wavespeed-ai/ultimate-image-upscaler',
            promptUsed: '',
            outputUrl: null,
            tier1Score: null,
            tier2Score: null,
            tier2Analysis: null,
            moderationPassed: null,
            status: 'generating',
            cost: 0,
            inferenceTime: null,
            timestamp: Date.now(),
            isUpscaled: true,
          }
          pipelineSet(s => ({ attempts: [...s.attempts, upscaleAttempt] }))

          toast({
            title: i18n.t('smartGenerate.toast.upscaling'),
            description: i18n.t('smartGenerate.toast.upscalingDesc'),
            duration: 5000,
          })
          const upscaled = await upscaleImage(effectiveSourceImages[0])
          effectiveSourceImages = [upscaled, ...effectiveSourceImages.slice(1)]

          // Update attempt with result + replace store sourceImages
          pipelineSet(s => ({
            attempts: s.attempts.map(a =>
              a.id === upscaleAttemptId ? { ...a, outputUrl: upscaled, status: 'complete' as const } : a
            ),
            sourceImages: effectiveSourceImages,
          }))
        } catch {
          // non-fatal — remove the failed upscale attempt
          pipelineSet(s => ({
            attempts: s.attempts.filter(a => !a.id.startsWith('upscale-') || a.status !== 'generating'),
          }))
        }
      }

      await upscaleIfNeeded(modelId)
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

      // [2.5] Use current prompt as-is (optimization is user-initiated via ✨ star button or chat)
      const variants = Array(parallelCount).fill(effectivePrompt)
      pipelineSet({ promptVariants: variants })
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
        const nextRoundCost = currentAdapter.price * parallelCount + 0.025 // generation + auxiliary (matches AUXILIARY_COST_PER_ROUND)
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

          return runGeneration(currentModelIdLocal, prompt, mode, effectiveSourceImages.length > 0 ? effectiveSourceImages : undefined, seeds[idx], mode === 'image-to-video' ? undefined : sizeValue ?? undefined, resolutionValue ?? undefined, Object.keys(extraConfigValues).length > 0 ? extraConfigValues : undefined)
            .then(result => {
              const outputUrl = extractOutput(result)
              const inferenceTime = result.timings?.inference ?? null
              // Use set() directly — bypass cancel gate so paid results aren't lost.
              // Guard with modeChanged() to avoid corrupting a different mode's attempts.
              if (!modeChanged()) {
                const cancelled = isCancelled()
                set(s => ({
                  attempts: s.attempts.map(a =>
                    a.id === attemptId ? { ...a, outputUrl, inferenceTime, status: outputUrl ? (cancelled ? 'complete' as const : 'scoring' as const) : 'failed' as const } : a
                  ),
                }))
                addCostRaw(currentAdapter.price)
                if (cancelled) recomputeBestRaw()
              }
              return { attemptId, outputUrl, inferenceTime, error: null as unknown }
            })
            .catch(error => {
              if (!modeChanged()) {
                set(s => ({
                  attempts: s.attempts.map(a =>
                    a.id === attemptId ? { ...a, status: 'failed' as const } : a
                  ),
                }))
              }
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
            const next = getNextFallbackModel(mode, [...get().failedModels, currentModelIdLocal], currentModelIdLocal, isNsfwContent)
            if (next) {
              // Pre-check budget before switching
              const nextAdapter = getModelAdapter(next)
              const nextCost = (nextAdapter?.price ?? 0) * parallelCount + 0.025
              if (get().currentSpent + nextCost > budgetLimit) {
                recomputeBest()
                pipelineSet({ phase: get().bestAttempt ? 'paused' : 'failed' })
                break
              }
              pipelineSet(s => ({
                failedModels: [...s.failedModels, currentModelIdLocal],
                phase: 'switching',
              }))
              currentModelIdLocal = next
              currentAdapter = nextAdapter!
              sizeValue = resolveSizeForModel(next, null)
              resetParamsForModel(next)
              await upscaleIfNeeded(next)
              pipelineSet({ currentModelId: next, selectedModelId: next, sizeValue, resolutionValue, extraConfigValues })
              roundsOnCurrentModel = 0
              tempRetryCount = 0
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
          // Temp retries exhausted → try fallback chain before giving up
          const nextAfterTemp = getNextFallbackModel(mode, [...get().failedModels, currentModelIdLocal], currentModelIdLocal, isNsfwContent)
          if (nextAfterTemp) {
            // Pre-check budget before switching
            const nextTempAdapter = getModelAdapter(nextAfterTemp)
            const nextTempCost = (nextTempAdapter?.price ?? 0) * parallelCount + 0.025
            if (get().currentSpent + nextTempCost > budgetLimit) {
              recomputeBest()
              pipelineSet({ phase: get().bestAttempt ? 'paused' : 'failed' })
              break
            }
            pipelineSet(s => ({
              failedModels: [...s.failedModels, currentModelIdLocal],
              phase: 'switching',
            }))
            currentModelIdLocal = nextAfterTemp
            currentAdapter = nextTempAdapter!
            sizeValue = resolveSizeForModel(nextAfterTemp, null)
            resetParamsForModel(nextAfterTemp)
            await upscaleIfNeeded(nextAfterTemp)
            pipelineSet({ currentModelId: nextAfterTemp, selectedModelId: nextAfterTemp, sizeValue, resolutionValue, extraConfigValues })
            roundsOnCurrentModel = 0
            tempRetryCount = 0
            currentRoundNum++
            await new Promise(r => setTimeout(r, 500))
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

          // Tier 1 - Quick score (NSFW uses relaxed prompt)
          const t1 = await quickScore(out.outputUrl, userPrompt, mode, isNsfwContent)
          addCost(0.005)
          pipelineSet(s => ({
            attempts: s.attempts.map(a =>
              a.id === out.attemptId ? { ...a, tier1Score: t1.score } : a
            ),
          }))

          const finalScore = t1.score
          let feedbackOptions: string[] = []

          // Tier 2 - Deep analysis (only if 60 <= score < target, saves money; skip for NSFW)
          if (!isNsfwContent && t1.score >= 60 && t1.score < effectiveTarget) {
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

        // Successful round — reset temp retry counter
        tempRetryCount = 0

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

        if (globalBestScore >= effectiveTarget) {
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
          const next = getNextFallbackModel(mode, [...get().failedModels, currentModelIdLocal], currentModelIdLocal, isNsfwContent)
          if (next) {
            // Pre-check budget before switching — don't switch if budget can't cover the next round
            const nextAdapter = getModelAdapter(next)
            const nextCost = (nextAdapter?.price ?? 0) * parallelCount + 0.025
            if (get().currentSpent + nextCost > budgetLimit) {
              recomputeBest()
              pipelineSet({ phase: get().bestAttempt ? 'paused' : 'failed' })
              break
            }
            pipelineSet(s => ({
              failedModels: [...s.failedModels, currentModelIdLocal],
              phase: 'switching',
            }))
            currentModelIdLocal = next
            currentAdapter = nextAdapter!
            sizeValue = resolveSizeForModel(next, null)
            resetParamsForModel(next)
            await upscaleIfNeeded(next)
            pipelineSet({ currentModelId: next, selectedModelId: next, sizeValue, resolutionValue, extraConfigValues })
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
      if (modeChanged() || isCancelled()) return // cancelled or mode switched
      // Brief delay so budget warning toast (if any) is visible before result toast
      await new Promise(r => setTimeout(r, 1500))
      if (isCancelled()) return // cancelled during delay
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
      if (modeChanged() || isCancelled()) return // cancelled or mode switched
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
    // If already unlocked (cancelPipeline did immediate cleanup), skip
    if (!get().isLocked) return
    // Clean up in-flight attempts: scoring → complete (image exists), generating → failed
    set(s => ({
      phase: s.bestAttempt ? 'paused' : 'idle',
      isLocked: false,
      cancelRequested: false,
      attempts: s.attempts.map(a =>
        a.status === 'scoring' ? { ...a, status: 'complete' as const } :
        a.status === 'generating' ? { ...a, status: 'failed' as const } :
        a
      ),
    }))
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
      // Check both current prompt AND user's chat message — if either is NSFW, skip LLM
      const basePrompt = state.userPrompt
      let isNsfw = false
      try {
        const checks = await Promise.all([
          detectNSFW(content),
          basePrompt ? detectNSFW(basePrompt) : Promise.resolve(false),
        ])
        isNsfw = checks[0] || checks[1]
      } catch {
        // detection failed, assume safe
      }

      if (isNsfw) {
        // NSFW detected → combine original prompt + user request → prompt-optimizer
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
      // Always use current userPrompt (user may have edited it after pipeline ran)
      const systemPrompt = buildChatSystemPrompt(
        state.mode,
        state.userPrompt,
        state.contextLayer1.bestScore,
        state.contextLayer1.bestAnalysis,
        state.contextLayer2,
        imgDesc || undefined,
      )

      // Build message context (Layer 3 window)
      const currentState = get()
      const recentMsgs = currentState.contextLayer3
        .map(m => `${m.role}: ${m.content}`)
        .join('\n')

      // Always inject the current prompt so LLM sees the latest version
      // (user may have edited it since last chat message)
      let userContext = `[Current prompt: "${currentState.userPrompt}"]\n` + recentMsgs + `\nuser: ${content}`

      // Include selected attempt context if user picked one
      const selectedAttempt = currentState.selectedAttemptForChat
      if (selectedAttempt) {
        const score = selectedAttempt.tier2Score ?? selectedAttempt.tier1Score ?? 0
        // Caption the selected result so LLM can see what it looks like
        let selectedDesc = ''
        if (selectedAttempt.outputUrl) {
          try {
            const isVideo = selectedAttempt.outputUrl.match(/\.(mp4|webm|mov)/i)
            selectedDesc = isVideo
              ? await callVideoCaptioner(selectedAttempt.outputUrl)
              : await callImageCaptioner(selectedAttempt.outputUrl)
          } catch {
            // non-fatal
          }
        }
        const analysis = selectedAttempt.tier2Analysis ? `, Analysis: "${selectedAttempt.tier2Analysis}"` : ''
        const desc = selectedDesc ? `, Visual description: "${selectedDesc}"` : ''
        userContext = `[Current prompt: "${currentState.userPrompt}"]\n` + recentMsgs +
          `\n[User selected a specific result to refine: Round ${selectedAttempt.roundIndex}, Score ${score}, Prompt used: "${selectedAttempt.promptUsed}"${analysis}${desc}]` +
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

      // Compress memory: update AI understanding with latest prompt + recent messages
      const allMsgs = get().chatMessages
      if (allMsgs.length > 0 && allMsgs.length % 4 === 0) {
        try {
          const summary = await compressMemory(allMsgs, get().userPrompt)
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
        pipelineStartIndex: s.pipelineStartIndex,
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
        // Trainer fields
        trainingImages: s.trainingImages,
        trainingPreviews: s.trainingPreviews,
        triggerWord: s.triggerWord,
        trainerSteps: s.trainerSteps,
        trainerLearningRate: s.trainerLearningRate,
        trainerLoraRank: s.trainerLoraRank,
        selectedTrainerId: s.selectedTrainerId,
      }

      // Restore target mode's session, or start fresh
      const saved = s.modeSessions[newMode]

      if (saved) {
        set({
          mode: newMode,
          modeSessions: { ...s.modeSessions, [currentMode]: currentSession },
          ...saved,
          pipelineStartIndex: saved.pipelineStartIndex ?? 0,
          // Restore trainer fields from session if present
          trainingImages: saved.trainingImages ?? [],
          trainingPreviews: saved.trainingPreviews ?? [],
          triggerWord: saved.triggerWord ?? 'p3r5on',
          trainerSteps: saved.trainerSteps ?? 1000,
          trainerLearningRate: saved.trainerLearningRate ?? 0.0001,
          trainerLoraRank: saved.trainerLoraRank ?? 16,
          selectedTrainerId: saved.selectedTrainerId ?? TRAINER_MODELS[0].modelId,
          isLocked: false,
          cancelRequested: false,
        })
      } else {
        const isTrainer = isTrainerMode(newMode)
        const defaultModelId = isTrainer ? TRAINER_MODELS[0].modelId : getDefaultModel(newMode).modelId
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
          selectedModelId: defaultModelId,
          phase: 'idle',
          promptVariants: [],
          attempts: [],
          bestAttempt: null,
          pipelineStartIndex: 0,
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
          // Reset trainer fields for fresh session
          trainingImages: [],
          trainingPreviews: [],
          triggerWord: 'p3r5on',
          trainerSteps: isTrainer ? TRAINER_MODELS[0].defaults.steps : 1000,
          trainerLearningRate: isTrainer ? TRAINER_MODELS[0].defaults.learningRate : 0.0001,
          trainerLoraRank: isTrainer ? TRAINER_MODELS[0].defaults.loraRank : 16,
          selectedTrainerId: TRAINER_MODELS[0].modelId,
        })
      }

      get().updateEstimatedCost()
    },

    setSelectedModelId: (modelId) => {
      set({ selectedModelId: modelId, sizeValue: null, resolutionValue: null, extraConfigValues: {} })
      get().updateEstimatedCost()
    },

    setUserPrompt: (prompt) => {
      set({ userPrompt: prompt })
    },

    addSourceImage: (url) => {
      set(s => ({ sourceImages: [...s.sourceImages, url], imageDescription: null }))
    },

    removeSourceImage: (index) => {
      set(s => ({ sourceImages: s.sourceImages.filter((_, i) => i !== index), imageDescription: null }))
    },

    setReferenceImage: (url) => {
      set({ referenceImage: url, imageDescription: null })
    },

    useResultAsSource: (imageUrl) => {
      const { mode } = get()
      if (needsSourceImage(mode)) {
        // image-edit, image-to-video → show immediately, then re-upload to get a stable URL
        // (model output URLs may be temporary/signed and inaccessible to other model backends)
        set({ sourceImages: [imageUrl], imageDescription: null })
        fetch(imageUrl)
          .then(r => r.blob())
          .then(blob => {
            const ext = imageUrl.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg'
            const file = new File([blob], `source-${Date.now()}.${ext}`, { type: blob.type })
            return apiClient.uploadFile(file)
          })
          .then(uploadedUrl => {
            // Only update if user hasn't changed the source image since
            if (get().sourceImages[0] === imageUrl) {
              set({ sourceImages: [uploadedUrl] })
            }
          })
          .catch(() => {
            // keep original URL as fallback
          })
      } else if (isTrainerMode(mode)) {
        // lora-trainer → fetch URL and add as training image
        fetch(imageUrl)
          .then(r => r.blob())
          .then(blob => {
            const ext = imageUrl.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg'
            const file = new File([blob], `imported-${Date.now()}.${ext}`, { type: blob.type })
            const preview = URL.createObjectURL(file)
            set(s => ({
              trainingImages: [...s.trainingImages, file],
              trainingPreviews: [...s.trainingPreviews, preview],
            }))
          })
          .catch(() => {})
      } else {
        // text-to-image, text-to-video → set as reference image
        set({ referenceImage: imageUrl, imageDescription: null })
      }
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
      set({ sizeValue: value })
    },

    setResolutionValue: (value) => {
      set({ resolutionValue: value })
    },

    setExtraConfigValue: (key, value) => {
      set(s => ({ extraConfigValues: { ...s.extraConfigValues, [key]: value } }))
    },

    setTargetScore: (score) => {
      set({ targetScore: score })
    },

    setParallelCount: (count) => {
      set({ parallelCount: count })
      get().updateEstimatedCost()
    },

    setBudgetLimit: (budget) => {
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
      const s = get()
      if (!s.isLocked) return
      // Immediately unlock UI. In-flight generation requests continue in background —
      // their .then() callbacks will update attempts with results (user paid for them).
      // Only scoring attempts (already have images) are finalized; generating stays as-is.
      set(prev => ({
        cancelRequested: true,
        phase: prev.bestAttempt ? 'paused' : 'idle',
        isLocked: false,
        attempts: prev.attempts.map(a =>
          a.status === 'scoring' ? { ...a, status: 'complete' as const } : a
        ),
      }))
      toast({
        title: i18n.t('smartGenerate.toast.cancelled'),
        description: i18n.t('smartGenerate.toast.cancelledDesc', { spent: get().currentSpent.toFixed(3) }),
        duration: 5000,
      })
    },

    sendChatMessage: handleChatMessage,

    applyRefinedPrompt: async (prompt: string) => {
      if (get().isLocked) return
      set({ userPrompt: prompt })
      await executePipeline({ keepHistory: true })
    },

    applySuggestedPrompt: async () => {
      if (get().isLocked) return
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
      // Signal any running pipeline to stop (API calls already submitted will still charge)
      if (s.isLocked) set({ cancelRequested: true })
      // Clear ALL mode sessions + AI understanding — full reset
      saveLayer2('')
      set({
        ...initialState,
        mode: s.mode,
        selectedModelId: isTrainerMode(s.mode)
          ? TRAINER_MODELS[0].modelId
          : getDefaultModel(s.mode).modelId,
        isFirstVisit: s.isFirstVisit,
        contextLayer2: '',
        modeSessions: {},
      })
    },

    reset: () => {
      const s = get()
      if (s.isLocked) set({ cancelRequested: true })
      saveLayer2('')
      set({
        ...initialState,
        isFirstVisit: s.isFirstVisit,
        contextLayer2: '',
        modeSessions: {},
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
      if (isTrainerMode(state.mode)) return // no cost estimation for trainer
      const modelId = state.selectedModelId || getDefaultModel(state.mode).modelId
      const cost = estimateCost(modelId, state.parallelCount)
      set({ estimatedCost: cost })
    },

    // ─── Trainer Actions ──────────────────────────────────────────────────

    addTrainingImages: (files: File[]) => {
      const newPreviews = files.map(f => URL.createObjectURL(f))
      set(s => ({
        trainingImages: [...s.trainingImages, ...files],
        trainingPreviews: [...s.trainingPreviews, ...newPreviews],
      }))
    },

    removeTrainingImage: (index: number) => {
      set(s => {
        // Revoke the object URL
        URL.revokeObjectURL(s.trainingPreviews[index])
        return {
          trainingImages: s.trainingImages.filter((_, i) => i !== index),
          trainingPreviews: s.trainingPreviews.filter((_, i) => i !== index),
        }
      })
    },

    setTriggerWord: (word: string) => {
      set({ triggerWord: word })
    },

    setTrainerSteps: (steps: number) => {
      set({ trainerSteps: steps })
    },

    setTrainerLearningRate: (lr: number) => {
      set({ trainerLearningRate: lr })
    },

    setTrainerLoraRank: (rank: number) => {
      set({ trainerLoraRank: rank })
    },

    setSelectedTrainerId: (id: string) => {
      const trainer = TRAINER_MODELS.find(m => m.modelId === id)
      if (trainer) {
        set({
          selectedTrainerId: id,
          trainerSteps: trainer.defaults.steps,
          trainerLearningRate: trainer.defaults.learningRate,
          trainerLoraRank: trainer.defaults.loraRank,
        })
      }
    },

    startTraining: async () => {
      const state = get()
      if (state.isLocked) return
      if (state.trainingImages.length === 0) return
      if (!state.triggerWord.trim()) return

      const trainerId = state.selectedTrainerId || TRAINER_MODELS[0].modelId
      const attemptId = `train-${Date.now()}`

      set({
        phase: 'generating',
        isLocked: true,
        cancelRequested: false,
        pipelineError: null,
      })

      // Create training attempt
      const attempt: GenerationAttempt = {
        id: attemptId,
        roundIndex: 1,
        variantIndex: 0,
        modelId: trainerId,
        promptUsed: state.triggerWord,
        outputUrl: null,
        tier1Score: null,
        tier2Score: null,
        tier2Analysis: null,
        moderationPassed: null,
        status: 'generating',
        cost: 0,
        inferenceTime: null,
        timestamp: Date.now(),
      }
      set(s => ({ attempts: [...s.attempts, attempt] }))

      try {
        // 1. Build ZIP
        const zipFile = await buildTrainingZip(state.trainingImages)

        if (get().cancelRequested) {
          set({ phase: 'idle', isLocked: false, cancelRequested: false })
          return
        }

        // 2. Upload ZIP
        const zipUrl = await apiClient.uploadFile(zipFile)

        if (get().cancelRequested) {
          set({ phase: 'idle', isLocked: false, cancelRequested: false })
          return
        }

        // 3. Call training API
        const result = await apiClient.run(trainerId, {
          data: zipUrl,
          trigger_word: state.triggerWord,
          steps: state.trainerSteps,
          learning_rate: state.trainerLearningRate,
          lora_rank: state.trainerLoraRank,
        }, { pollInterval: 5000 })

        const loraUrl = extractTrainingOutput(result)
        const inferenceTime = result.timings?.inference ?? null

        set(s => ({
          phase: loraUrl ? 'complete' : 'failed',
          isLocked: false,
          attempts: s.attempts.map(a =>
            a.id === attemptId
              ? { ...a, outputUrl: loraUrl, inferenceTime, status: loraUrl ? 'complete' as const : 'failed' as const }
              : a
          ),
        }))

        if (loraUrl) {
          toast({
            title: i18n.t('smartGenerate.trainer.completeToast'),
            description: i18n.t('smartGenerate.trainer.completeToastDesc'),
            duration: 5000,
          })
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Training failed'
        set(s => ({
          phase: 'failed',
          isLocked: false,
          pipelineError: msg,
          attempts: s.attempts.map(a =>
            a.id === attemptId ? { ...a, status: 'failed' as const } : a
          ),
        }))
        toast({
          title: i18n.t('smartGenerate.toast.failed'),
          description: msg,
          variant: 'destructive',
          duration: 5000,
        })
      }
    },
  }
})
