// Z-Image: Local AI Image Generation

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Zap, Download, AlertCircle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { validateGenerationParams, generateRandomSeed, formatFileSize } from '@/lib/sdUtils'

const PHASES = [
  { id: 'download-sd', labelKey: 'Downloading SD', weight: 0.125 },
  { id: 'download-vae', labelKey: 'Downloading VAE', weight: 0.125 },
  { id: 'download-llm', labelKey: 'Downloading LLM', weight: 0.25 },
  { id: 'download-model', labelKey: 'Downloading Model', weight: 0.25 },
  { id: 'generate', labelKey: 'Generating', weight: 0.25 }
]

// Default prompts (English only)
const DEFAULT_PROMPT = 'A beautiful landscape with mountains and lake, sunset, highly detailed, photorealistic'
const DEFAULT_NEGATIVE_PROMPT = 'blurry, bad quality, low resolution, watermark'

export function ZImagePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // State
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [width, setWidth] = useState(512)
  const [height, setHeight] = useState(512)
  const [steps, setSteps] = useState(20)
  const [cfgScale, setCfgScale] = useState(7.5)
  const [seed, setSeed] = useState<number>(generateRandomSeed())
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [autoRandomizeSeed, setAutoRandomizeSeed] = useState(false)
  const [isCancelled, setIsCancelled] = useState(false)

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
    isGenerating: storeIsGenerating,
    updateBinaryStatus,
    updateVaeStatus,
    updateLlmStatus,
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
      // Update store status with both progress and detail
      if (phase === 'download-binary') {
        updateBinaryStatus({ progress: prog, detail })
        updatePhase('download-sd', prog, detail)
      } else if (phase === 'download-vae') {
        updateVaeStatus({ progress: prog, detail })
        updatePhase('download-vae', prog, detail)
      } else if (phase === 'download-llm') {
        updateLlmStatus({ progress: prog, detail })
        updatePhase('download-llm', prog, detail)
      } else {
        updatePhase(phase, prog, detail)
      }
    },
    onError: (err) => setError(err)
  })

  // Check models on mount and when returning to page
  useEffect(() => {
    fetchModels()
    checkAuxiliaryModels()

    // Restore progress if downloading
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

      // Restore current downloading phase (only one at a time, in order)
      if (binaryStatus.downloading && binaryStatus.progress > 0) {
        updatePhase('download-sd', binaryStatus.progress, binaryStatus.detail || {})
      } else if (vaeStatus.downloading && vaeStatus.progress > 0) {
        updatePhase('download-vae', vaeStatus.progress, vaeStatus.detail || {})
      } else if (llmStatus.downloading && llmStatus.progress > 0) {
        updatePhase('download-llm', llmStatus.progress, llmStatus.detail || {})
      }
    }
    // Only run on mount - disable exhaustive deps warning
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll store for progress updates while generating
  // This ensures UI updates even when component is remounted during download
  useEffect(() => {
    if (!storeIsGenerating && !isGenerating) return

    const interval = setInterval(() => {
      const { binaryStatus, vaeStatus, llmStatus } = useSDModelsStore.getState()

      // Only update phases that are actively downloading (not completed)
      // This prevents overwriting completed phases
      if (binaryStatus.downloading && binaryStatus.progress > 0 && !binaryStatus.downloaded) {
        updatePhase('download-sd', binaryStatus.progress, binaryStatus.detail || {})
      }
      if (vaeStatus.downloading && vaeStatus.progress > 0 && !vaeStatus.downloaded) {
        updatePhase('download-vae', vaeStatus.progress, vaeStatus.detail || {})
      }
      if (llmStatus.downloading && llmStatus.progress > 0 && !llmStatus.downloaded) {
        updatePhase('download-llm', llmStatus.progress, llmStatus.detail || {})
      }
    }, 500) // Poll every 500ms

    return () => clearInterval(interval)
  }, [storeIsGenerating, isGenerating, updatePhase])

  // Download model file with Browser Cache API (consistent with imageEraser)
  const downloadModelFile = useCallback(async (
    url: string,
    filename: string,
    onProgress?: (percent: number, loaded: number, total: number) => void
  ): Promise<Blob> => {
    const cache = await caches.open('zimage-models-cache')
    const cachedResponse = await cache.match(url)

    if (cachedResponse) {
      const blob = await cachedResponse.blob()
      onProgress?.(100, blob.size, blob.size)
      return blob
    }

    // Download with retry logic for large files
    let lastError: Error | null = null
    const maxRetries = 5

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'Origin': window.location.origin
          }
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const contentLength = parseInt(response.headers.get('content-length') || '0')
        const reader = response.body?.getReader()

        if (!reader) {
          throw new Error('Response body is not readable')
        }

        const chunks: Uint8Array[] = []
        let receivedLength = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          chunks.push(value)
          receivedLength += value.length

          const progressPercent = contentLength > 0 ? Math.round((receivedLength / contentLength) * 100) : 0
          onProgress?.(progressPercent, receivedLength, contentLength)
        }

        // Combine chunks into blob
        const blob = new Blob(chunks)

        // Cache the response
        try {
          await cache.put(url, new Response(blob))
        } catch (cacheError) {
          console.warn('Failed to cache model:', cacheError)
        }

        return blob

      } catch (error) {
        lastError = error as Error
        console.warn(`Download attempt ${attempt}/${maxRetries} failed:`, lastError.message)

        // Wait before retry with exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s, 16s
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError || new Error('Download failed after all retries')
  }, [])

  // Handle generation with auto-download
  const handleGenerate = async () => {
    setError(null)
    setGeneratedImage(null)
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

    // Clear store progress states before starting
    updateBinaryStatus({ progress: 0, detail: undefined })
    updateVaeStatus({ progress: 0, detail: undefined })
    updateLlmStatus({ progress: 0, detail: undefined })

    setIsGenerating(true)
    setStoreIsGenerating(true)
    reset()

    let modelPath = selectedModel.localPath

    try {
      // 1. Auto-download SD binary if not downloaded
      if (!binaryStatus.downloaded) {
        updateBinaryStatus({ downloading: true, progress: 0, error: null })
        await downloadBinary()
        updateBinaryStatus({ downloading: false, downloaded: true })
        if (isCancelled) throw new Error('Cancelled')
      }

      // 2. Auto-download VAE if not downloaded
      if (!vaeStatus.downloaded) {
        updateVaeStatus({ downloading: true, progress: 0, error: null })
        await downloadVae()
        updateVaeStatus({ downloading: false, downloaded: true })
        if (isCancelled) throw new Error('Cancelled')
      }

      // 3. Auto-download LLM if not downloaded
      if (!llmStatus.downloaded) {
        updateLlmStatus({ downloading: true, progress: 0, error: null })
        await downloadLlm()
        updateLlmStatus({ downloading: false, downloaded: true })
        if (isCancelled) throw new Error('Cancelled')
      }

      // 4. Auto-download main model if not downloaded
      if (!selectedModel.isDownloaded) {
        startPhase('download-model')

        // Download to cache using Browser Cache API (consistent with imageEraser)
        const blob = await downloadModelFile(
          selectedModel.downloadUrl,
          selectedModel.name,
          (percent, loaded, total) => {
            updatePhase('download-model', percent, {
              current: Math.round(loaded / 1024 / 1024 * 100) / 100,
              total: Math.round(total / 1024 / 1024 * 100) / 100,
              unit: 'MB'
            })
          }
        )

        // Save to file system via Electron
        if (window.electronAPI?.sdSaveModelFromCache) {
          const arrayBuffer = await blob.arrayBuffer()
          const result = await window.electronAPI.sdSaveModelFromCache(
            selectedModel.name,
            new Uint8Array(arrayBuffer),
            'model'
          )

          if (!result.success) {
            throw new Error(result.error || t('zImage.errors.downloadFailed'))
          }

          modelPath = result.filePath
          await fetchModels()
        }
        if (isCancelled) throw new Error('Cancelled')
      }
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

      // Update store status on error
      updateBinaryStatus({ downloading: false, error: errorMessage })
      updateVaeStatus({ downloading: false, error: errorMessage })
      updateLlmStatus({ downloading: false, error: errorMessage })

      reset()
      return
    }

    if (!modelPath) {
      setError(t('zImage.errors.modelNotDownloaded'))
      setIsGenerating(false)
      setStoreIsGenerating(false)
      return
    }

    // Start generation phase
    startPhase('generate')

    // Use default prompts if empty
    const finalPrompt = prompt.trim() || DEFAULT_PROMPT
    const finalNegativePrompt = negativePrompt.trim() || DEFAULT_NEGATIVE_PROMPT

    try {
      const result = await generateZImage({
        modelPath,
        prompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        width,
        height,
        steps,
        cfgScale,
        seed
      })

      if (result.success && result.outputPath) {
        setGeneratedImage(`local-asset://${result.outputPath}`)
        complete()

        // Randomize seed for next generation if enabled
        if (autoRandomizeSeed) {
          setSeed(generateRandomSeed())
        }
      } else {
        setError(result.error || t('zImage.errors.generationFailed'))
        reset()
      }
    } catch (err) {
      setError((err as Error).message)
      reset()
    } finally {
      setIsGenerating(false)
      setStoreIsGenerating(false)
    }
  }

  // Handle cancel generation
  const handleCancelGeneration = async () => {
    // Set cancel flag to stop download chain
    setIsCancelled(true)

    // Immediately stop UI state
    setIsGenerating(false)
    setStoreIsGenerating(false)
    setError(t('zImage.errors.generationCancelled'))
    reset()

    // Reset all download states in store (completely clear progress)
    updateBinaryStatus({ downloading: false, progress: 0, detail: undefined })
    updateVaeStatus({ downloading: false, progress: 0, detail: undefined })
    updateLlmStatus({ downloading: false, progress: 0, detail: undefined })

    // Cancel any ongoing downloads (browser-side)
    cancelDownload()

    // Cancel SD binary download (Electron-side)
    if (window.electronAPI?.sdCancelDownload) {
      try {
        await window.electronAPI.sdCancelDownload()
      } catch (err) {
        console.error('Failed to cancel SD download:', err)
      }
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

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          {/* Model Selection */}
          <Card>
            <CardContent className="space-y-3 pt-4 pb-4">
              <div className="space-y-2">
                <Label className="text-lg font-semibold">{t('zImage.selectModel')}</Label>
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
                          {!model.isDownloaded && <span className="text-xs text-muted-foreground">({formatFileSize(model.size)})</span>}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedModel && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{t(selectedModel.description)}</p>
                    {!selectedModel.isDownloaded && (
                      <p className="text-xs text-muted-foreground">
                        {t('zImage.autoDownloadHint', { size: formatFileSize(selectedModel.size) })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Generation Form */}
          <Card>
            <CardContent className="space-y-3 pt-4 pb-4">
              {/* Prompt */}
              <div className="space-y-1.5">
                <Label htmlFor="prompt">{t('zImage.prompt')}</Label>
                <Textarea
                  id="prompt"
                  placeholder={DEFAULT_PROMPT}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={2}
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
                />
              </div>

              {/* Parameters Grid */}
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="width" className="text-xs">{t('zImage.width')}</Label>
                  <Input
                    id="width"
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                    min={256}
                    max={1024}
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
                    max={1024}
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
                    min={10}
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
                    className="text-sm font-normal cursor-pointer"
                  >
                    {t('zImage.autoRandomizeSeed')}
                  </Label>
                </div>
              </div>

              {/* Error Alert */}
              {(error || storeError) && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error || storeError}</AlertDescription>
                </Alert>
              )}

              {/* Progress */}
              {(isGenerating || storeIsGenerating || binaryStatus.downloading || vaeStatus.downloading || llmStatus.downloading) && (() => {
                const currentPhase = progress.phases[progress.currentPhaseIndex]
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
                    <div className="flex items-center justify-between text-sm">
                      <span>{getPhaseLabel()}</span>
                      <span>{Math.round(progress.overallProgress)}%</span>
                    </div>
                    <Progress value={progress.overallProgress} />
                    {currentPhase?.detail && (
                      <div className="text-sm text-muted-foreground">
                        {isDownloadPhase ? (
                          <>
                            {currentPhase.detail.current} / {currentPhase.detail.total} {currentPhase.detail.unit || 'MB'}
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
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={!selectedModel}
                >
                  {!selectedModel
                    ? t('zImage.selectModelFirst')
                    : t('zImage.generateImage')}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Result */}
          {generatedImage && (
            <Card>
              <CardHeader>
                <CardTitle>{t('zImage.result')}</CardTitle>
                <CardDescription>{t('zImage.generatedImage')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <img
                  src={generatedImage}
                  alt={t('zImage.generatedImage')}
                  className="w-full rounded-lg"
                />
                <Button
                  className="w-full"
                  onClick={() => {
                    if (generatedImage) {
                      const path = generatedImage.replace('local-asset://', '')
                      window.electronAPI.openFileLocation(path)
                    }
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {t('zImage.openInFolder')}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
