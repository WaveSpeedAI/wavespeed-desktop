// Z-Image: Local AI Image Generation using Playground components

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { DynamicForm } from '@/components/playground/DynamicForm'
import { OutputDisplay } from '@/components/playground/OutputDisplay'
import { LogConsole } from '@/components/shared/LogConsole'
import { useSDModelsStore } from '@/stores/sdModelsStore'
import { useZImage } from '@/hooks/useZImage'
import { useMultiPhaseProgress } from '@/hooks/useMultiPhaseProgress'
import { createZImageModel, ZIMAGE_DEFAULT_NEGATIVE_PROMPT } from '@/lib/zImageModel'
import { schemaToFormFields, validateFormValues } from '@/lib/schemaToForm'
import { PREDEFINED_MODELS } from '@/types/stable-diffusion'
import { ChunkedDownloader } from '@/lib/chunkedDownloader'
import { formatBytes } from '@/types/progress'
import type { PredictionResult } from '@/types/prediction'
import type { SamplingMethod, Scheduler } from '@/types/stable-diffusion'
import type { ProgressDetail } from '@/types/progress'

// Check if running in Electron environment
function isElectronAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.sdListModels
}

const PHASES = [
  { id: 'download-sd', labelKey: 'Downloading SD', weight: 0.125 },
  { id: 'download-vae', labelKey: 'Downloading VAE', weight: 0.125 },
  { id: 'download-llm', labelKey: 'Downloading LLM', weight: 0.25 },
  { id: 'download-model', labelKey: 'Downloading Model', weight: 0.25 },
  { id: 'generate', labelKey: 'Generating', weight: 0.25 }
]

export function ZImagePage() {
  const { t } = useTranslation()
  const electronAvailable = isElectronAvailable()

  // Create ZImage model for DynamicForm
  const [zImageModel] = useState(() => createZImageModel())
  const zImageFields = useMemo(() => {
    const apiSchemas = (zImageModel.api_schema as { api_schemas?: Array<{ type: string; request_schema?: { properties?: Record<string, unknown>; required?: string[]; 'x-order-properties'?: string[] } }> })?.api_schemas
    const requestSchema = apiSchemas?.find(s => s.type === 'model_run')?.request_schema
    if (!requestSchema?.properties) return []
    return schemaToFormFields(
      requestSchema.properties as Record<string, import('@/types/model').SchemaProperty>,
      requestSchema.required || [],
      requestSchema['x-order-properties']
    )
  }, [zImageModel])

  // Form state
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prediction, setPrediction] = useState<PredictionResult | null>(null)
  const [outputs, setOutputs] = useState<string[]>([])
  const [metalWarning, setMetalWarning] = useState<string | null>(null)
  const [accelerationInfo, setAccelerationInfo] = useState<{ platform: string; arch: string; acceleration: string } | null>(null)

  // Stores
  const {
    models: sdModels,
    fetchModels: fetchSDModels,
    binaryStatus,
    vaeStatus,
    llmStatus,
    updateModelDownloadStatus,
    checkAuxiliaryModels
  } = useSDModelsStore()

  // Progress tracking
  const { progress, startPhase, updatePhase, completePhase, complete, reset } = useMultiPhaseProgress({ phases: PHASES })

  // useZImage hook for downloads and generation
  const {
    downloadLlm,
    downloadVae,
    downloadBinary,
    generate: generateZImage,
    cancelDownload
  } = useZImage({
    onPhase: (phase) => {
      if (phase === 'download-binary') startPhase('download-sd')
      else if (phase === 'download-vae') startPhase('download-vae')
      else if (phase === 'download-llm') startPhase('download-llm')
      else startPhase(phase)
    },
    onProgress: (phase, prog, detail) => {
      const progressDetail = detail as ProgressDetail | undefined
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

  // Refs for cancellation
  const modelDownloaderRef = useRef<ChunkedDownloader | null>(null)
  const isCancelledRef = useRef(false)

  // Initialize on mount
  useEffect(() => {
    if (electronAvailable) {
      fetchSDModels()
      checkAuxiliaryModels()
    }
  }, [electronAvailable, fetchSDModels, checkAuxiliaryModels])

  // Detect hardware acceleration for local generation
  useEffect(() => {
    let active = true
    if (!electronAvailable || !window.electronAPI?.sdGetSystemInfo) {
      return
    }

    window.electronAPI.sdGetSystemInfo().then((info) => {
      if (!active || !info) return
      setAccelerationInfo({ platform: info.platform, arch: info.arch, acceleration: info.acceleration })
    }).catch(() => {
      // Ignore acceleration detection failures
    })

    return () => {
      active = false
    }
  }, [electronAvailable])

  // Listen for generation progress from sd.cpp
  useEffect(() => {
    if (!electronAvailable || !window.electronAPI?.onSdProgress) {
      return
    }

    const unsubscribe = window.electronAPI.onSdProgress((data) => {
      if (data.phase !== 'generate') return
      const detail = data.detail as ProgressDetail | undefined
      updatePhase('generate', data.progress, detail)
    })

    return () => {
      unsubscribe()
    }
  }, [electronAvailable, updatePhase])

  // Listen for Metal fallback errors during generation
  useEffect(() => {
    if (!electronAvailable || !isGenerating || !window.electronAPI?.onSdLog) {
      return
    }

    const removeListener = window.electronAPI.onSdLog((data) => {
      if (metalWarning) return
      const msg = data.message || ''
      if (/ggml_metal_init: error|ggml_backend_metal_init: error|failed to create command queue/i.test(msg)) {
        setMetalWarning(t('zImage.warnings.metalFallback', 'Metal initialization failed, falling back to CPU. Generation will be much slower.'))
      }
    })

    return () => {
      removeListener()
    }
  }, [electronAvailable, isGenerating, metalWarning, t])

  // Form handlers
  const handleFormChange = useCallback((key: string, value: unknown) => {
    setFormValues(prev => ({ ...prev, [key]: value }))
    if (validationErrors[key]) {
      setValidationErrors(prev => ({ ...prev, [key]: '' }))
    }
  }, [validationErrors])

  const handleSetDefaults = useCallback((defaults: Record<string, unknown>) => {
    setFormValues(defaults)
  }, [])

  // Main generation handler
  const handleGenerate = async () => {
    setError(null)
    setPrediction(null)
    setOutputs([])
    setMetalWarning(null)
    isCancelledRef.current = false
    setValidationErrors({})

    // Check Electron availability
    if (!electronAvailable) {
      setError(t('zImage.errors.desktopRequired', 'This feature requires the desktop app. Please download WaveSpeed Desktop or try the online version.'))
      return
    }

    // Get selected SD model
    const sdModelId = (formValues.model as string) || 'z-image-turbo-q4-k'
    const sdModel = PREDEFINED_MODELS.find(m => m.id === sdModelId)
    const sdModelState = sdModels.find(m => m.id === sdModelId)

    if (!sdModel) {
      setError('Selected model not found')
      return
    }

    setIsGenerating(true)
    reset()

    let modelPath = sdModelState?.isDownloaded ? sdModelState.localPath : null

    try {
      // 1. Download SD binary if needed
      if (!binaryStatus.downloaded) {
        await downloadBinary()
        if (isCancelledRef.current) throw new Error('Cancelled')
      } else {
        completePhase('download-sd')
      }

      // 2. Download VAE if needed
      if (!vaeStatus.downloaded) {
        await downloadVae()
        if (isCancelledRef.current) throw new Error('Cancelled')
      } else {
        completePhase('download-vae')
      }

      // 3. Download LLM if needed
      if (!llmStatus.downloaded) {
        await downloadLlm()
        if (isCancelledRef.current) throw new Error('Cancelled')
      } else {
        completePhase('download-llm')
      }

      // 4. Download model if needed
      if (!sdModelState?.isDownloaded) {
        startPhase('download-model')
        updateModelDownloadStatus({ downloading: true, progress: 0 })

        const modelsResult = await window.electronAPI?.sdGetModelsDir()
        if (!modelsResult?.success || !modelsResult.path) {
          throw new Error('Failed to get models directory')
        }

        const destPath = `${modelsResult.path}/${sdModel.name}`
        const downloader = new ChunkedDownloader()
        modelDownloaderRef.current = downloader

        const result = await downloader.download({
          url: sdModel.downloadUrl,
          destPath,
          onProgress: (prog) => {
            updatePhase('download-model', prog.progress, prog.detail)
            updateModelDownloadStatus({ progress: prog.progress, detail: prog.detail })
          },
          chunkSize: 10 * 1024 * 1024,
          minValidSize: 500 * 1024 * 1024
        })

        modelDownloaderRef.current = null

        if (!result.success) {
          updateModelDownloadStatus({ downloading: false, error: result.error })
          throw new Error(result.error || 'Download failed')
        }

        updateModelDownloadStatus({ downloading: false, downloaded: true, progress: 100 })
        completePhase('download-model')
        modelPath = result.filePath
        await fetchSDModels()

        if (isCancelledRef.current) throw new Error('Cancelled')
      } else {
        completePhase('download-model')
      }

      if (!modelPath) {
        throw new Error('Model path not available')
      }

      // 5. Generate image using useZImage hook
      startPhase('generate')

      const validation = validateFormValues(zImageFields, formValues)
      if (Object.keys(validation).length > 0) {
        setValidationErrors(validation)
        reset()
        setIsGenerating(false)
        return
      }

      const prompt = ((formValues.prompt as string) || '').trim()
      const negativePrompt = ((formValues.negative_prompt as string) || '').trim() || ZIMAGE_DEFAULT_NEGATIVE_PROMPT

      let seed = formValues.seed as number
      if (seed === undefined || seed === -1) {
        seed = Math.floor(Math.random() * 2147483647)
      }

      const sizeStr = (formValues.size as string) || '1024*1024'
      const sizeParts = sizeStr.split('*')
      const width = parseInt(sizeParts[0], 10) || 1024
      const height = parseInt(sizeParts[1], 10) || 1024
      const steps = (formValues.steps as number) || 4
      const cfgScale = (formValues.cfg_scale as number) || 1

      const result = await generateZImage({
        modelPath,
        prompt,
        negativePrompt,
        width,
        height,
        steps,
        cfgScale,
        seed,
        samplingMethod: ((formValues.sampling_method as string) || 'euler') as SamplingMethod,
        scheduler: ((formValues.scheduler as string) || 'simple') as Scheduler
      })

      if (!result.success || !result.outputPath) {
        throw new Error(result.error || 'Generation failed')
      }

      const imageUrl = `local-asset://${encodeURIComponent(result.outputPath)}`

      complete()
      setPrediction({
        id: `local-${Date.now()}`,
        model: 'local/z-image',
        status: 'completed',
        outputs: [imageUrl],
        created_at: new Date().toISOString()
      })
      setOutputs([imageUrl])

      // Randomize seed for next run
      setFormValues(prev => ({ ...prev, seed: Math.floor(Math.random() * 2147483647) }))

    } catch (err) {
      const msg = (err as Error).message
      if (msg === 'Cancelled') {
        setError(t('zImage.errors.generationCancelled', 'Generation cancelled'))
      } else {
        setError(msg)
      }
      reset()
    } finally {
      setIsGenerating(false)
    }
  }

  // Cancel handler
  const handleCancel = async () => {
    isCancelledRef.current = true
    modelDownloaderRef.current?.cancel()
    cancelDownload()
    if (window.electronAPI?.sdCancelGeneration) {
      await window.electronAPI.sdCancelGeneration().catch(console.error)
    }
    setIsGenerating(false)
    reset()
  }

  // Get current phase info for progress display
  const currentPhase = progress.phases[progress.currentPhaseIndex]

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          <h1 className="text-xl font-semibold">{t('zImage.title')}</h1>
        </div>
        <span className="text-sm text-muted-foreground">{t('zImage.subtitle', 'Run Z-Image locally for free')}</span>
      </div>

      {/* Content - Two Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Form */}
        <div className="w-[420px] flex flex-col border-r bg-muted/30">
          <div className="flex-1 overflow-hidden p-4">
            {accelerationInfo?.platform === 'darwin' && accelerationInfo.arch !== 'arm64' && (
              <Alert variant="destructive" className="mb-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {t('zImage.tips.intelMacUnsupported', 'Local Z-Image is only supported on Apple Silicon Macs.')}
                </AlertDescription>
              </Alert>
            )}

            {accelerationInfo?.platform === 'linux' && accelerationInfo.arch !== 'x64' && (
              <Alert variant="destructive" className="mb-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {t('zImage.tips.linuxArmUnsupported', 'Linux ARM is not supported for local Z-Image.')}
                </AlertDescription>
              </Alert>
            )}

            {accelerationInfo?.platform === 'win32' && accelerationInfo.arch !== 'x64' && (
              <Alert variant="destructive" className="mb-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {t('zImage.tips.windowsArmUnsupported', 'Windows ARM is not supported for local Z-Image.')}
                </AlertDescription>
              </Alert>
            )}

            {accelerationInfo?.platform === 'linux' && accelerationInfo.arch === 'x64' && (
              <Alert className="mb-3">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <AlertDescription className="text-sm">
                  {t('zImage.tips.linuxCpuOnly', 'Local Z-Image runs on CPU only on Linux. It may be slow—reduce steps or image size.')}
                </AlertDescription>
              </Alert>
            )}

            {accelerationInfo?.platform === 'win32' && accelerationInfo.arch === 'x64' && (
              <Alert className="mb-3">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <AlertDescription className="text-sm">
                  {t('zImage.tips.windowsVulkanRequired', 'Local Z-Image on Windows requires Vulkan-capable GPU drivers. If unavailable, generation will be slow or may fail.')}
                </AlertDescription>
              </Alert>
            )}

            {accelerationInfo?.platform === 'darwin' && accelerationInfo.arch === 'arm64' && accelerationInfo.acceleration === 'CPU' && (
              <Alert className="mb-3">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <AlertDescription className="text-sm">
                  {t('zImage.tips.slowWithoutMetal', 'Metal acceleration is not available. Generation will run on CPU and may be slow—reduce steps or image size.')}
                </AlertDescription>
              </Alert>
            )}
            <DynamicForm
              model={zImageModel}
              values={formValues}
              validationErrors={validationErrors}
              onChange={handleFormChange}
              onSetDefaults={handleSetDefaults}
              disabled={isGenerating}
            />
          </div>

          {/* Progress and Actions */}
          <div className="p-4 border-t bg-muted/30 space-y-3">
            {/* Error */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}

            {metalWarning && (
              <Alert>
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <AlertDescription className="text-sm">{metalWarning}</AlertDescription>
              </Alert>
            )}

            {/* Progress */}
            {isGenerating && currentPhase && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span>
                    {currentPhase.id === 'download-sd' && t('zImage.downloadingSd', 'Downloading SD')}
                    {currentPhase.id === 'download-vae' && t('zImage.downloadingVae', 'Downloading VAE')}
                    {currentPhase.id === 'download-llm' && t('zImage.downloadingLlm', 'Downloading LLM')}
                    {currentPhase.id === 'download-model' && t('zImage.downloadingZImage', 'Downloading Model')}
                    {currentPhase.id === 'generate' && t('zImage.generating', 'Generating')}
                  </span>
                  <span>{Math.round(currentPhase.progress || 0)}%</span>
                </div>
                <Progress value={currentPhase.progress || 0} />
                {currentPhase.detail && currentPhase.id.startsWith('download-') && (
                  <div className="text-xs text-muted-foreground">
                    {formatBytes(currentPhase.detail.current || 0)} / {formatBytes(currentPhase.detail.total || 0)}
                  </div>
                )}
              </div>
            )}

            {/* Generate Button */}
            {isGenerating ? (
              <Button className="w-full" variant="destructive" onClick={handleCancel}>
                {t('zImage.stopGeneration', 'Stop')}
              </Button>
            ) : (
              <Button
                className="w-full gradient-bg hover:opacity-90 transition-opacity"
                onClick={handleGenerate}
              >
                <Zap className="mr-2 h-4 w-4" />
                {t('zImage.generateImage', 'Generate')}
              </Button>
            )}

            <LogConsole isGenerating={isGenerating} />
          </div>
        </div>

        {/* Right Panel - Output */}
        <div className="flex-1 min-w-0">
          <OutputDisplay
            prediction={prediction}
            outputs={outputs}
            error={null}
            isLoading={isGenerating}
            modelId="local/z-image"
            modelName="Z-Image (Local)"
          />
        </div>
      </div>
    </div>
  )
}
