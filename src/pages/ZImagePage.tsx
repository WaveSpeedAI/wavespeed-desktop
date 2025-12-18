// Z-Image: Local AI Image Generation

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Zap, Download, AlertCircle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { useSDModelsStore, useSelectedModel } from '@/stores/sdModelsStore'
import { useZImage } from '@/hooks/useZImage'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { formatBytes } from '@/types/progress'
import { LogConsole } from '@/components/shared/LogConsole'
import type { ValidationResult } from '@/types/stable-diffusion'
import { ChunkedDownloader } from '@/lib/chunkedDownloader'

// Local utility functions (moved from sdUtils.ts)
function validateGenerationParams(params: {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  cfgScale: number
  seed?: number
}): ValidationResult {
  // Validate prompt
  if (params.prompt && params.prompt.length > 1000) {
    return { valid: false, error: 'Prompt too long (max 1000 characters)' }
  }

  // Prevent command injection
  const dangerousChars = /[;&|`$()]/
  if (params.prompt && dangerousChars.test(params.prompt)) {
    return { valid: false, error: 'Prompt contains invalid characters' }
  }

  if (params.negativePrompt && dangerousChars.test(params.negativePrompt)) {
    return { valid: false, error: 'Negative prompt contains invalid characters' }
  }

  // Validate image dimensions
  if (params.width % 64 !== 0 || params.height % 64 !== 0) {
    return { valid: false, error: 'Width and height must be multiples of 64' }
  }

  if (params.width < 256 || params.width > 1536) {
    return { valid: false, error: 'Width must be between 256-1536' }
  }

  if (params.height < 256 || params.height > 1536) {
    return { valid: false, error: 'Height must be between 256-1536' }
  }

  // Validate sampling steps
  if (params.steps < 4 || params.steps > 50) {
    return { valid: false, error: 'Sampling steps must be between 4-50' }
  }

  if (!Number.isInteger(params.steps)) {
    return { valid: false, error: 'Sampling steps must be an integer' }
  }

  // Validate CFG Scale
  if (params.cfgScale < 1 || params.cfgScale > 20) {
    return { valid: false, error: 'CFG Scale must be between 1-20' }
  }

  // Validate seed
  if (params.seed !== undefined) {
    if (!Number.isInteger(params.seed) || params.seed < 0) {
      return { valid: false, error: 'Seed must be a non-negative integer' }
    }

    if (params.seed > 2147483647) {
      return { valid: false, error: 'Seed value too large (max 2147483647)' }
    }
  }

  return { valid: true }
}

function generateRandomSeed(): number {
  return Math.floor(Math.random() * 2147483647)
}

const PHASES = [
  { id: 'download-sd', labelKey: 'Downloading SD', weight: 0.125 },
  { id: 'download-vae', labelKey: 'Downloading VAE', weight: 0.125 },
  { id: 'download-llm', labelKey: 'Downloading LLM', weight: 0.25 },
  { id: 'download-model', labelKey: 'Downloading Model', weight: 0.25 },
  { id: 'generate', labelKey: 'Generating', weight: 0.25 }
]

// Default prompts (English only)
const DEFAULT_PROMPT = 'Portrait of a beautiful woman with elegant features, professional fashion photography, studio lighting, soft focus background, glamorous makeup, flowing hair, confident pose, haute couture dress, sophisticated aesthetic, photorealistic, high detail, 8k quality'
const DEFAULT_NEGATIVE_PROMPT = 'blurry, bad quality, low resolution, watermark, distorted, ugly, deformed, extra limbs, poorly drawn, bad anatomy'

// Check if running in Electron environment
function isElectronAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.sdListModels
}

export function ZImagePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Check if Electron APIs are available
  const electronAvailable = isElectronAvailable()

  // State
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [width, setWidth] = useState(512)
  const [height, setHeight] = useState(512)
  const [steps, setSteps] = useState(8) // Default to CPU (8 steps), will be updated based on hardware
  const [cfgScale, setCfgScale] = useState(1)
  const [seed, setSeed] = useState<number>(generateRandomSeed())
  const [samplingMethod, setSamplingMethod] = useState<string>('euler')
  const [scheduler, setScheduler] = useState<string>('simple')
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [generatedImagePath, setGeneratedImagePath] = useState<string | null>(null) // Original file path
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [autoRandomizeSeed, setAutoRandomizeSeed] = useState(true) // Default to true
  const [isCancelled, setIsCancelled] = useState(false)
  const [showOnlineHint, setShowOnlineHint] = useState(false)
  const hasSetDefaultSteps = useRef(false) // Track if default steps have been set
  const generationStartTimeRef = useRef<number>(0)
  const onlineHintTimerRef = useRef<NodeJS.Timeout | null>(null)
  const modelDownloaderRef = useRef<ChunkedDownloader | null>(null) // Track model downloader for cancellation

  // Stores & Hooks
  const {
    models,
    fetchModels,
    selectModel,
    selectedModelId,
    error: storeError,
    binaryStatus,
    vaeStatus,
    llmStatus,
    modelDownloadStatus,
    isGenerating: storeIsGenerating,
    updateBinaryStatus,
    updateVaeStatus,
    updateLlmStatus,
    updateModelDownloadStatus,
    setIsGenerating: setStoreIsGenerating,
    checkAuxiliaryModels
  } = useSDModelsStore()
  const selectedModel = useSelectedModel()
  const { progress, startPhase, updatePhase, completePhase, complete, reset } = useMultiPhaseProgress({ phases: PHASES })

  // Z-Image hook (new architecture) - with store integration
  const {
    downloadLlm,
    downloadVae,
    downloadBinary,
    generate: generateZImage,
    cancelDownload
  } = useZImage({
    onPhase: (phase) => {
      // Map internal phase names to our phase IDs
      if (phase === 'download-binary') startPhase('download-sd')
      else if (phase === 'download-vae') startPhase('download-vae')
      else if (phase === 'download-llm') startPhase('download-llm')
      else startPhase(phase)
    },
    onProgress: (phase, prog, detail) => {
      // Only update phase progress, store is already updated by useEffect in useZImage
      // Type assertion: detail from useZImage is already ProgressDetail
      const progressDetail = detail as { current?: number; total?: number; unit?: 'bytes' | 'frames' | 'percent' | 'steps' | 'seconds' } | undefined

      if (phase === 'download-binary') {
        updatePhase('download-sd', prog, progressDetail)
      } else if (phase === 'download-vae') {
        updatePhase('download-vae', prog, progressDetail)
      } else if (phase === 'download-llm') {
        updatePhase('download-llm', prog, progressDetail)
      } else {
        updatePhase(phase, prog, progressDetail)
      }
    },
    onError: (err) => setError(err)
  })

  // Detect hardware acceleration and set default steps
  useEffect(() => {
    const detectHardwareAndSetDefaults = async () => {
      if (hasSetDefaultSteps.current) return // Only set once

      try {
        if (window.electronAPI?.sdGetSystemInfo) {
          const systemInfo = await window.electronAPI.sdGetSystemInfo()
          console.log('[ZImagePage] System info:', systemInfo)

          // Set default steps based on hardware acceleration
          const hasAcceleration = systemInfo.acceleration !== 'CPU'
          const defaultSteps = hasAcceleration ? 12 : 8

          console.log(`[ZImagePage] Hardware acceleration: ${systemInfo.acceleration}, setting default steps to ${defaultSteps}`)
          setSteps(defaultSteps)
          hasSetDefaultSteps.current = true
        }
      } catch (error) {
        console.error('[ZImagePage] Failed to get system info:', error)
        // Keep default of 8 steps on error
      }
    }

    detectHardwareAndSetDefaults()
  }, [])

  // Check models on mount and when returning to page
  useEffect(() => {
    // Fetch models first to get latest download status
    const initPage = async () => {
      await fetchModels()
      await checkAuxiliaryModels()

      // Clean up any stale downloading states after fetching models
      // If a download is marked as downloading but file is already downloaded, clear the downloading flag
      if (binaryStatus.downloading && binaryStatus.downloaded) {
        updateBinaryStatus({ downloading: false, progress: 100 })
      }
      if (vaeStatus.downloading && vaeStatus.downloaded) {
        updateVaeStatus({ downloading: false, progress: 100 })
      }
      if (llmStatus.downloading && llmStatus.downloaded) {
        updateLlmStatus({ downloading: false, progress: 100 })
      }

      // CRITICAL: Check if selected model is downloaded
      // If model is downloaded, clear any stale downloading status
      if (selectedModel?.isDownloaded && modelDownloadStatus.downloading) {
        console.log('[ZImagePage] Model is downloaded, clearing stale downloading status')
        updateModelDownloadStatus({ downloading: false, downloaded: true, progress: 100 })
      }
      if (modelDownloadStatus.downloading && modelDownloadStatus.downloaded) {
        updateModelDownloadStatus({ downloading: false, progress: 100 })
      }
    }

    initPage().then(() => {
      // After fetching models and cleaning up stale states, restore UI state

      // Restore progress if actively generating
      if (storeIsGenerating) {
        setIsGenerating(true)

        // Reset all phases first to avoid multiple active states
        reset()

        // Mark completed phases as completed
        if (binaryStatus.downloaded && !binaryStatus.downloading) {
          completePhase('download-sd')
        }
        if (vaeStatus.downloaded && !vaeStatus.downloading) {
          completePhase('download-vae')
        }
        if (llmStatus.downloaded && !llmStatus.downloading) {
          completePhase('download-llm')
        }
        if (modelDownloadStatus.downloaded && !modelDownloadStatus.downloading) {
          completePhase('download-model')
        }

        // Check if there's any active download in progress
        const hasActiveDownloadWithProgress =
          (binaryStatus.downloading && !binaryStatus.downloaded && binaryStatus.progress > 0) ||
          (vaeStatus.downloading && !vaeStatus.downloaded && vaeStatus.progress > 0) ||
          (llmStatus.downloading && !llmStatus.downloaded && llmStatus.progress > 0) ||
          (modelDownloadStatus.downloading && !modelDownloadStatus.downloaded && modelDownloadStatus.progress > 0)

        // Restore current downloading phase (only if actively downloading with progress)
        if (binaryStatus.downloading && !binaryStatus.downloaded && binaryStatus.progress > 0) {
          console.log('[ZImagePage] Restoring SD binary download phase')
          updatePhase('download-sd', binaryStatus.progress, binaryStatus.detail)
        } else if (vaeStatus.downloading && !vaeStatus.downloaded && vaeStatus.progress > 0) {
          console.log('[ZImagePage] Restoring VAE download phase')
          updatePhase('download-vae', vaeStatus.progress, vaeStatus.detail)
        } else if (llmStatus.downloading && !llmStatus.downloaded && llmStatus.progress > 0) {
          console.log('[ZImagePage] Restoring LLM download phase')
          updatePhase('download-llm', llmStatus.progress, llmStatus.detail)
        } else if (modelDownloadStatus.downloading && !modelDownloadStatus.downloaded && modelDownloadStatus.progress > 0) {
          console.log('[ZImagePage] Restoring model download phase')
          updatePhase('download-model', modelDownloadStatus.progress, modelDownloadStatus.detail)
        } else if (!hasActiveDownloadWithProgress) {
          // All downloads are completed, must be in generation phase
          console.log('[ZImagePage] All downloads completed, entering generation phase')
          startPhase('generate')
        }
      } else {
        // Not generating - ensure UI is in idle state
        setIsGenerating(false)
        reset()
      }
    })
    // Only run on mount - disable exhaustive deps warning
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Note: Polling removed - useZImage hook now handles all progress updates via its own polling mechanism

  // Handle generation with auto-download
  const handleGenerate = async () => {
    setError(null)
    setGeneratedImage(null)
    setGeneratedImagePath(null)
    setIsCancelled(false) // Reset cancel flag

    // Validate
    if (!selectedModel) {
      setError(t('zImage.errors.noModel'))
      return
    }

    const validation = validateGenerationParams({
      prompt,
      negativePrompt,
      width,
      height,
      steps,
      cfgScale,
      seed
    })

    if (!validation.valid) {
      setError(validation.error || t('zImage.errors.invalidParams'))
      return
    }

    // Clear store progress states before starting and set downloading=false for already downloaded items
    if (binaryStatus.downloaded) {
      updateBinaryStatus({ downloading: false, progress: 100, detail: undefined })
    } else {
      updateBinaryStatus({ progress: 0, detail: undefined })
    }

    if (vaeStatus.downloaded) {
      updateVaeStatus({ downloading: false, progress: 100, detail: undefined })
    } else {
      updateVaeStatus({ progress: 0, detail: undefined })
    }

    if (llmStatus.downloaded) {
      updateLlmStatus({ downloading: false, progress: 100, detail: undefined })
    } else {
      updateLlmStatus({ progress: 0, detail: undefined })
    }

    if (selectedModel.isDownloaded) {
      // Model already downloaded - clear any downloading state
      updateModelDownloadStatus({ downloading: false, downloaded: true, progress: 100, detail: undefined, error: null })
    } else {
      updateModelDownloadStatus({ progress: 0, detail: undefined, error: null })
    }

    setIsGenerating(true)
    setStoreIsGenerating(true)
    reset()

    // IMPORTANT: Only use localPath if model is already downloaded
    // Otherwise we need to download it first
    let modelPath = selectedModel.isDownloaded ? selectedModel.localPath : null

    try {
      // 1. Auto-download SD binary if not downloaded
      // IMPORTANT: Always get FRESH status from store to avoid stale closure values
      const currentBinaryStatus = useSDModelsStore.getState().binaryStatus
      if (!currentBinaryStatus.downloaded && !currentBinaryStatus.downloading) {
        console.log('[ZImagePage] SD Binary not downloaded, starting download...')
        await downloadBinary()

        // Verify file exists after download
        if (window.electronAPI?.sdGetBinaryPath) {
          const result = await window.electronAPI.sdGetBinaryPath()
          if (!result.success) {
            throw new Error('SD binary download completed but file not found')
          }
          console.log('[ZImagePage] SD Binary verified at:', result.path)
        }

        completePhase('download-sd')
        if (isCancelled) throw new Error('Cancelled')
      } else {
        console.log('[ZImagePage] SD Binary already downloaded, skipping')
        completePhase('download-sd')
      }

      // 2. Auto-download VAE if not downloaded
      // IMPORTANT: Get FRESH status from store (not closure value)
      const currentVaeStatus = useSDModelsStore.getState().vaeStatus
      if (!currentVaeStatus.downloaded && !currentVaeStatus.downloading) {
        console.log('[ZImagePage] VAE not downloaded, starting download...')
        await downloadVae()

        // Verify file exists after download
        if (window.electronAPI?.sdCheckAuxiliaryModels) {
          const result = await window.electronAPI.sdCheckAuxiliaryModels()
          if (!result.success || !result.vaeExists) {
            throw new Error('VAE download completed but file not found')
          }
          console.log('[ZImagePage] VAE verified at:', result.vaePath)
        }

        completePhase('download-vae')
        if (isCancelled) throw new Error('Cancelled')
      } else {
        console.log('[ZImagePage] VAE already downloaded, skipping')
        completePhase('download-vae')
      }

      // 3. Auto-download LLM if not downloaded
      // IMPORTANT: Get FRESH status from store (not closure value)
      const currentLlmStatus = useSDModelsStore.getState().llmStatus
      if (!currentLlmStatus.downloaded && !currentLlmStatus.downloading) {
        console.log('[ZImagePage] LLM not downloaded, starting download...')
        await downloadLlm()

        // Verify file exists after download
        if (window.electronAPI?.sdCheckAuxiliaryModels) {
          const result = await window.electronAPI.sdCheckAuxiliaryModels()
          if (!result.success || !result.llmExists) {
            throw new Error('LLM download completed but file not found')
          }
          console.log('[ZImagePage] LLM verified at:', result.llmPath)
        }

        completePhase('download-llm')
        if (isCancelled) throw new Error('Cancelled')
      } else {
        console.log('[ZImagePage] LLM already downloaded, skipping')
        completePhase('download-llm')
      }

      // 4. Auto-download main model if not downloaded
      if (!selectedModel.isDownloaded) {
        startPhase('download-model')

        console.log(`[ZImagePage] Starting model download via ChunkedDownloader`)
        console.log(`[ZImagePage] Model: ${selectedModel.name}`)
        console.log(`[ZImagePage] URL: ${selectedModel.downloadUrl}`)

        // Get destination path
        const modelsResult = await window.electronAPI?.sdGetModelsDir()
        if (!modelsResult?.success || !modelsResult.path) {
          throw new Error('Failed to get models directory')
        }

        const destPath = `${modelsResult.path}/${selectedModel.name}`
        console.log(`[ZImagePage] Destination: ${destPath}`)

        // Mark model download as in progress in store
        updateModelDownloadStatus({ downloading: true, downloaded: false, progress: 0, error: null })

        try {
          // Download via ChunkedDownloader
          const downloader = new ChunkedDownloader()
          modelDownloaderRef.current = downloader // Track for cancellation

          const result = await downloader.download({
            url: selectedModel.downloadUrl,
            destPath,
            onProgress: (progress) => {
              console.log(`[ZImagePage] Download progress: ${progress.progress}%`)

              // Update both UI phase and store status
              updatePhase('download-model', progress.progress, progress.detail)
              updateModelDownloadStatus({
                downloading: true,
                progress: progress.progress,
                detail: progress.detail
              })
            },
            chunkSize: 10 * 1024 * 1024, // 10MB chunks
            minValidSize: 500 * 1024 * 1024 // At least 500MB
          })

          // Clear reference after download completes
          modelDownloaderRef.current = null

          console.log(`[ZImagePage] Download result:`, result)

          if (!result.success) {
            // Mark download as failed in store
            updateModelDownloadStatus({ downloading: false, downloaded: false, progress: 0, error: result.error || 'Download failed' })
            throw new Error(result.error || t('zImage.errors.downloadFailed'))
          }

          // Mark download as completed in store
          console.log(`[ZImagePage] Marking model download as completed`)
          updateModelDownloadStatus({ downloading: false, downloaded: true, progress: 100, error: null })

          // CRITICAL: Complete the download-model phase to update UI
          console.log(`[ZImagePage] Completing download-model phase`)
          completePhase('download-model')

          modelPath = result.filePath
          console.log(`[ZImagePage] Model path set to: ${modelPath}`)

          console.log(`[ZImagePage] Fetching models to update state...`)
          await fetchModels()
          console.log(`[ZImagePage] Models fetched`)
        } catch (downloadError) {
          // Clear reference on error
          modelDownloaderRef.current = null

          // Mark download as failed in store
          updateModelDownloadStatus({
            downloading: false,
            downloaded: false,
            progress: 0,
            error: (downloadError as Error).message
          })
          throw downloadError
        }

        if (isCancelled) throw new Error('Cancelled')
      } else {
        // Model already downloaded - mark phase as complete immediately and skip to generation
        console.log('[ZImagePage] Model already downloaded, skipping download phase')
        completePhase('download-model')
      }

      // CRITICAL: After download phase, check if we have a valid model path
      console.log(`[ZImagePage] Checking model path: ${modelPath}`)
      if (!modelPath) {
        throw new Error(t('zImage.errors.modelNotDownloaded'))
      }
      console.log(`[ZImagePage] Model path valid, proceeding to generation phase`)
    } catch (err) {
      const errorMessage = (err as Error).message
      // If cancelled, show specific message
      if (errorMessage === 'Cancelled' || isCancelled) {
        setError(t('zImage.errors.generationCancelled'))
      } else {
        // Use download failed translation with retry hint
        setError(t('zImage.errors.downloadFailed') + ' ' + errorMessage)
      }
      setIsGenerating(false)
      setStoreIsGenerating(false)

      reset()
      return
    }

    if (!modelPath) {
      console.error('[ZImagePage] ERROR: modelPath is null/undefined after download phase!')
      setError(t('zImage.errors.modelNotDownloaded'))
      setIsGenerating(false)
      setStoreIsGenerating(false)
      return
    }

    // Start generation phase
    console.log('[ZImagePage] Starting generation phase...')
    startPhase('generate')

    // Track generation start time and set timer for online hint
    generationStartTimeRef.current = Date.now()
    setShowOnlineHint(false)

    // Show online hint after 30 seconds
    onlineHintTimerRef.current = setTimeout(() => {
      setShowOnlineHint(true)
    }, 30000) // 30 seconds

    // Use default prompts if empty
    const finalPrompt = prompt.trim() || DEFAULT_PROMPT
    const finalNegativePrompt = negativePrompt.trim() || DEFAULT_NEGATIVE_PROMPT

    console.log('[ZImagePage] Generation params:', {
      modelPath,
      prompt: finalPrompt.substring(0, 50) + '...',
      width,
      height,
      steps,
      cfgScale,
      seed
    })

    // Listen to generation progress from SD process
    let generationProgressListener: (() => void) | null = null
    if (window.electronAPI?.onSdProgress) {
      generationProgressListener = window.electronAPI.onSdProgress((data) => {
        console.log('[ZImagePage] SD generation progress:', data)
        if (data.phase === 'generate') {
          updatePhase('generate', data.progress, data.detail)
        }
      })
    }

    try {
      console.log('[ZImagePage] Calling generateZImage...')
      const result = await generateZImage({
        modelPath,
        prompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        width,
        height,
        steps,
        cfgScale,
        seed,
        samplingMethod: samplingMethod as any,
        scheduler: scheduler as any
      })

      console.log('[ZImagePage] Generation result:', result)

      if (result.success && result.outputPath) {
        console.log('[ZImagePage] Generation successful! Output path:', result.outputPath)

        // Use encodeURIComponent like AssetsPage (works on both Mac and Windows)
        const imageUrl = `local-asset://${encodeURIComponent(result.outputPath)}`
        console.log('[ZImagePage] Image URL:', imageUrl)

        setGeneratedImage(imageUrl)
        setGeneratedImagePath(result.outputPath)
        complete()

        // Clean up downloading states after successful generation
        // All downloads should be completed by now
        if (binaryStatus.downloading) {
          updateBinaryStatus({ downloading: false, downloaded: true, progress: 100 })
        }
        if (vaeStatus.downloading) {
          updateVaeStatus({ downloading: false, downloaded: true, progress: 100 })
        }
        if (llmStatus.downloading) {
          updateLlmStatus({ downloading: false, downloaded: true, progress: 100 })
        }
        if (modelDownloadStatus.downloading) {
          updateModelDownloadStatus({ downloading: false, downloaded: true, progress: 100 })
        }

        // Randomize seed for next generation if enabled
        if (autoRandomizeSeed) {
          setSeed(generateRandomSeed())
        }
      } else {
        console.error('[ZImagePage] Generation failed:', result.error)
        setError(result.error || t('zImage.errors.generationFailed'))
        reset()
      }
    } catch (err) {
      console.error('[ZImagePage] Generation exception:', err)
      setError((err as Error).message)
      reset()
    } finally {
      console.log('[ZImagePage] Generation phase completed')
      // Remove generation progress listener
      if (generationProgressListener) {
        generationProgressListener()
      }
      // Clear online hint timer
      if (onlineHintTimerRef.current) {
        clearTimeout(onlineHintTimerRef.current)
        onlineHintTimerRef.current = null
      }
      setShowOnlineHint(false)
      setIsGenerating(false)
      setStoreIsGenerating(false)
    }
  }

  // Handle cancel generation
  const handleCancelGeneration = async () => {
    // Set cancel flag to stop download chain
    setIsCancelled(true)

    // Clear online hint timer
    if (onlineHintTimerRef.current) {
      clearTimeout(onlineHintTimerRef.current)
      onlineHintTimerRef.current = null
    }
    setShowOnlineHint(false)

    // Immediately stop UI state
    setIsGenerating(false)
    setStoreIsGenerating(false)
    setError(t('zImage.errors.generationCancelled'))
    reset()

    // Reset all download states in store (completely clear progress)
    updateBinaryStatus({ downloading: false, progress: 0, detail: undefined })
    updateVaeStatus({ downloading: false, progress: 0, detail: undefined })
    updateLlmStatus({ downloading: false, progress: 0, detail: undefined })
    updateModelDownloadStatus({ downloading: false, progress: 0, detail: undefined })

    // Cancel any ongoing downloads
    cancelDownload()

    // Cancel model download
    if (modelDownloaderRef.current) {
      console.log('[ZImagePage] Cancelling model download')
      modelDownloaderRef.current.cancel()
      modelDownloaderRef.current = null
    }

    // Cancel image generation
    if (window.electronAPI?.sdCancelGeneration) {
      try {
        await window.electronAPI.sdCancelGeneration()
      } catch (err) {
        console.error('Failed to cancel generation:', err)
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          <h1 className="text-xl font-semibold">{t('zImage.title')}</h1>
        </div>
      </div>

      {/* Desktop App Required Message */}
      {!electronAvailable && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">{t('zImage.desktopRequired', 'Desktop App Required')}</h2>
            <p className="text-muted-foreground mb-4">
              {t('zImage.desktopRequiredDesc', 'Z-Image runs AI models locally on your computer. Please download the desktop app to use this feature.')}
            </p>
            <Button onClick={() => navigate('/playground/wavespeed-ai/z-image/turbo')}>
              <Zap className="mr-2 h-4 w-4" />
              {t('zImage.tryOnline', 'Try Online Version')}
            </Button>
          </div>
        </div>
      )}

      {/* Content - Two Column Layout */}
      {electronAvailable && (
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Configuration */}
        <div className="w-[420px] flex flex-col border-r bg-muted/30">
          {/* Model Selector */}
          <div className="p-4 border-b">
            <Label className="text-sm font-semibold mb-2 block">{t('zImage.selectModel')}</Label>
            <Select value={selectedModelId || ''} onValueChange={selectModel}>
              <SelectTrigger>
                <SelectValue placeholder={t('zImage.chooseModel')} />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex items-center gap-2">
                      {model.isDownloaded && <Check className="h-4 w-4 text-green-500" />}
                      <span>{model.displayName}</span>
                      {!model.isDownloaded && <span className="text-xs text-muted-foreground">({formatBytes(model.size)})</span>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedModel && (
              <p className="text-xs text-muted-foreground mt-2">{t(selectedModel.description)}</p>
            )}
          </div>

          {/* Parameters Form */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {/* Prompt */}
            <div className="space-y-1.5">
              <Label htmlFor="prompt">{t('zImage.prompt')}</Label>
              <Textarea
                id="prompt"
                placeholder={DEFAULT_PROMPT}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                className="text-sm"
              />
            </div>

            {/* Negative Prompt */}
            <div className="space-y-1.5">
              <Label htmlFor="negativePrompt">{t('zImage.negativePrompt')}</Label>
              <Input
                id="negativePrompt"
                placeholder={DEFAULT_NEGATIVE_PROMPT}
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                className="text-sm"
              />
            </div>

            {/* Parameters Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="width" className="text-xs">{t('zImage.width')}</Label>
                <Input
                  id="width"
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  min={256}
                  max={1536}
                  step={64}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="height" className="text-xs">{t('zImage.height')}</Label>
                <Input
                  id="height"
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  min={256}
                  max={1536}
                  step={64}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="steps" className="text-xs">{t('zImage.steps')}</Label>
                <Input
                  id="steps"
                  type="number"
                  value={steps}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  min={4}
                  max={50}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfgScale" className="text-xs">{t('zImage.cfgScale')}</Label>
                <Input
                  id="cfgScale"
                  type="number"
                  value={cfgScale}
                  onChange={(e) => setCfgScale(Number(e.target.value))}
                  min={1}
                  max={20}
                  step={0.5}
                />
              </div>
            </div>

            {/* Sampling Method & Scheduler */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="samplingMethod" className="text-xs">{t('zImage.samplingMethod')}</Label>
                <Select value={samplingMethod} onValueChange={setSamplingMethod}>
                  <SelectTrigger id="samplingMethod">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="euler">Euler</SelectItem>
                    <SelectItem value="euler_a">Euler A</SelectItem>
                    <SelectItem value="heun">Heun</SelectItem>
                    <SelectItem value="dpm2">DPM2</SelectItem>
                    <SelectItem value="dpm++2s_a">DPM++ 2S A</SelectItem>
                    <SelectItem value="dpm++2m">DPM++ 2M</SelectItem>
                    <SelectItem value="dpm++2mv2">DPM++ 2M V2</SelectItem>
                    <SelectItem value="ipndm">IPNDM</SelectItem>
                    <SelectItem value="ipndm_v">IPNDM V</SelectItem>
                    <SelectItem value="lcm">LCM</SelectItem>
                    <SelectItem value="ddim_trailing">DDIM Trailing</SelectItem>
                    <SelectItem value="tcd">TCD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="scheduler" className="text-xs">{t('zImage.scheduler')}</Label>
                <Select value={scheduler} onValueChange={setScheduler}>
                  <SelectTrigger id="scheduler">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple">Simple</SelectItem>
                    <SelectItem value="discrete">Discrete</SelectItem>
                    <SelectItem value="karras">Karras</SelectItem>
                    <SelectItem value="exponential">Exponential</SelectItem>
                    <SelectItem value="ays">AYS</SelectItem>
                    <SelectItem value="gits">GITS</SelectItem>
                    <SelectItem value="smoothstep">Smoothstep</SelectItem>
                    <SelectItem value="sgm_uniform">SGM Uniform</SelectItem>
                    <SelectItem value="lcm">LCM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Seed */}
            <div className="space-y-1.5">
              <Label htmlFor="seed">{t('zImage.seed')}</Label>
              <div className="flex gap-2">
                <Input
                  id="seed"
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSeed(generateRandomSeed())}
                >
                  {t('zImage.randomSeed')}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="autoRandomizeSeed"
                  checked={autoRandomizeSeed}
                  onCheckedChange={(checked) => setAutoRandomizeSeed(checked === true)}
                />
                <Label
                  htmlFor="autoRandomizeSeed"
                  className="text-xs font-normal cursor-pointer"
                >
                  {t('zImage.autoRandomizeSeed')}
                </Label>
              </div>
            </div>
          </div>

          {/* Progress and Action Button */}
          <div className="p-4 border-t bg-muted/30 space-y-3">
            {/* Error Alert */}
            {(error || storeError) && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{error || storeError}</AlertDescription>
              </Alert>
            )}

            {/* Online Hint - Show after 30 seconds */}
            {showOnlineHint && (isGenerating || storeIsGenerating) && (
              <Alert className="border-primary/50 bg-primary/5">
                <Zap className="h-4 w-4 text-primary" />
                <AlertDescription className="text-sm">
                  {t('zImage.onlineHint')}
                  <Button
                    variant="link"
                    className="h-auto p-0 ml-1 text-primary"
                    onClick={() => {
                      navigate('/playground/wavespeed-ai/z-image/turbo')
                    }}
                  >
                    {t('zImage.tryOnline')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* Progress */}
            {(isGenerating || storeIsGenerating || binaryStatus.downloading || vaeStatus.downloading || llmStatus.downloading || modelDownloadStatus.downloading) && (() => {
              const currentPhase = progress.phases[progress.currentPhaseIndex]

              // Don't show progress if phase is completed with 100% but not generating
              const isPhaseCompleted = currentPhase?.status === 'completed'
              const isGeneratingPhase = currentPhase?.id === 'generate'
              const shouldShowProgress = isGeneratingPhase || !isPhaseCompleted || (isGenerating || storeIsGenerating)

              if (!shouldShowProgress || !currentPhase) {
                return null
              }

              const getPhaseLabel = () => {
                switch (currentPhase?.id) {
                  case 'download-sd':
                    return t('zImage.downloadingSd')
                  case 'download-vae':
                    return t('zImage.downloadingVae')
                  case 'download-llm':
                    return t('zImage.downloadingLlm')
                  case 'download-model':
                    return t('zImage.downloadingZImage')
                  case 'generate':
                    return t('zImage.generating')
                  default:
                    return t('zImage.processing')
                }
              }

              const isDownloadPhase = currentPhase?.id?.startsWith('download-')

              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span>{getPhaseLabel()}</span>
                    <span>{Math.round(currentPhase?.progress || 0)}%</span>
                  </div>
                  <Progress value={currentPhase?.progress || 0} />
                  {currentPhase?.detail && (
                    <div className="text-xs text-muted-foreground">
                      {isDownloadPhase ? (
                        <>
                          {currentPhase.detail.unit === 'bytes'
                            ? `${formatBytes(currentPhase.detail.current || 0)} / ${formatBytes(currentPhase.detail.total || 0)}`
                            : `${currentPhase.detail.current} / ${currentPhase.detail.total} ${currentPhase.detail.unit || ''}`
                          }
                        </>
                      ) : currentPhase.detail.current && currentPhase.detail.total ? (
                        t('zImage.stepProgress', {
                          current: currentPhase.detail.current,
                          total: currentPhase.detail.total
                        })
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Generate/Stop Button */}
            {(isGenerating || storeIsGenerating) ? (
              <Button
                className="w-full"
                variant="destructive"
                onClick={handleCancelGeneration}
              >
                {t('zImage.stopGeneration')}
              </Button>
            ) : (
              <Button
                className="w-full gradient-bg hover:opacity-90 transition-opacity"
                onClick={handleGenerate}
                disabled={!selectedModel}
              >
                <Zap className="mr-2 h-4 w-4" />
                {!selectedModel
                  ? t('zImage.selectModelFirst')
                  : t('zImage.generateImage')}
              </Button>
            )}
          </div>
        </div>

        {/* Right Panel - Output */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-lg">{t('zImage.result')}</h2>
              {selectedModel && (
                <span className="text-sm text-muted-foreground">· {selectedModel.displayName}</span>
              )}
            </div>
          </div>

          {/* Output Display - Upper Section */}
          <div className="flex-1 p-3 min-h-0 flex flex-col">
            {generatedImage ? (
              <>
                {/* Image Container - Takes remaining space */}
                <div className="flex-1 flex items-center justify-center min-h-0 mb-3 overflow-hidden">
                  <img
                    src={generatedImage}
                    alt={t('zImage.generatedImage')}
                    className="w-full h-full object-contain rounded-lg shadow-lg"
                    onLoad={() => {
                      console.log('[ZImagePage] Image loaded successfully:', generatedImage)
                    }}
                    onError={(e) => {
                      console.error('[ZImagePage] Image failed to load:', generatedImage)
                      console.error('[ZImagePage] Error event:', e)
                    }}
                  />
                </div>
                {/* Action Button - Fixed at bottom */}
                <Button
                  className="w-full flex-shrink-0"
                  variant="outline"
                  onClick={() => {
                    if (generatedImagePath) {
                      window.electronAPI.openFileLocation(generatedImagePath)
                    }
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {t('zImage.openInFolder')}
                </Button>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <p>{t('zImage.noResult')}</p>
              </div>
            )}
          </div>

          {/* Log Console - Bottom Section (Always Visible) */}
          <div className="flex-shrink-0 border-t px-5 pb-5">
            <LogConsole isGenerating={isGenerating} />
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
