import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useSmartGenerateStore } from '@/stores/smartGenerateStore'
import { SmartModelSelector } from './ModelSelector'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  type SmartMode,
  type LoraItem,
  getDefaultModel,
  getModelAdapter,
  getRecommendedBudget,
  needsSourceImage,
  getSizeFieldConfig,
  getResolutionFieldConfig,
  callPromptOptimizer,
} from '@/lib/smartGenerateUtils'
import { SizeSelector } from '@/components/playground/SizeSelector'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useState, useRef, useCallback, useMemo } from 'react'
import { apiClient } from '@/api/client'
import {
  Image,
  Pencil,
  Film,
  ImagePlus,
  Square,
  Upload,
  X,
  Sparkles,
  Loader2,
  Settings2,
  ChevronDown,
  ChevronUp,
  Plus,
  Link,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ImageToolsSection } from './ImageToolsSection'

const MODE_TABS: { mode: SmartMode; icon: React.ComponentType<{ className?: string }>; labelKey: string }[] = [
  { mode: 'text-to-image', icon: Image, labelKey: 'smartGenerate.mode.text-to-image' },
  { mode: 'image-edit', icon: Pencil, labelKey: 'smartGenerate.mode.image-edit' },
  { mode: 'text-to-video', icon: Film, labelKey: 'smartGenerate.mode.text-to-video' },
  { mode: 'image-to-video', icon: ImagePlus, labelKey: 'smartGenerate.mode.image-to-video' },
]


interface SmartGenerateConfigProps {
  onStart: () => void
  className?: string
}

export function SmartGenerateConfig({ onStart, className }: SmartGenerateConfigProps) {
  const { t } = useTranslation()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [optimizingPrompt, setOptimizingPrompt] = useState(false)
  const store = useSmartGenerateStore()
  const {
    mode, setMode,
    selectedModelId, setSelectedModelId,
    userPrompt, setUserPrompt,
    sourceImages, addSourceImage, removeSourceImage,
    referenceImage, setReferenceImage,
    sizeValue, setSizeValue,
    resolutionValue, setResolutionValue,
    extraConfigValues, setExtraConfigValue,
    parallelCount, setParallelCount,
    budgetLimit, setBudgetLimit,
    estimatedCost,
    isLocked,
    cancelRequested,
  } = store

  const promptRef = useRef<HTMLTextAreaElement>(null)
  const autoResize = useCallback(() => {
    const el = promptRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(Math.max(el.scrollHeight, 120), 200) + 'px'
  }, [])

  const isRunning = isLocked
  const modelId = selectedModelId || getDefaultModel(mode).modelId
  const recommended = getRecommendedBudget(modelId)
  const canStart = userPrompt.trim() && (!needsSourceImage(mode) || sourceImages.length > 0) && !uploading
  const isI2V = mode === 'image-to-video' // I2V only needs 1 image

  // Get size field config from model schema (T2I/T2V/Edit — skip I2V where size follows source)
  const sizeConfig = useMemo(() => {
    if (mode === 'image-to-video') return null
    return getSizeFieldConfig(modelId)
  }, [modelId, mode])

  // Get resolution field config (e.g. Nano Banana "1k"/"2k"/"4k")
  const resolutionConfig = useMemo(() => {
    return getResolutionFieldConfig(modelId)
  }, [modelId])

  // Get model-specific extra config fields (duration, resolution, loras)
  const extraFields = useMemo(() => {
    const adapter = getModelAdapter(modelId)
    return adapter?.extraConfigFields ?? []
  }, [modelId])

  // LoRA input state
  const [loraUrlInput, setLoraUrlInput] = useState('')
  const currentLoras = (extraConfigValues.loras as LoraItem[] | undefined) ?? []

  const addLora = useCallback(() => {
    const url = loraUrlInput.trim()
    if (!url) return
    const updated = [...currentLoras, { path: url, scale: 1 }]
    setExtraConfigValue('loras', updated)
    setLoraUrlInput('')
  }, [loraUrlInput, currentLoras, setExtraConfigValue])

  const removeLora = useCallback((index: number) => {
    const updated = currentLoras.filter((_, i) => i !== index)
    setExtraConfigValue('loras', updated.length > 0 ? updated : undefined)
  }, [currentLoras, setExtraConfigValue])

  const updateLoraScale = useCallback((index: number, scale: number) => {
    const updated = currentLoras.map((l, i) => i === index ? { ...l, scale } : l)
    setExtraConfigValue('loras', updated)
  }, [currentLoras, setExtraConfigValue])

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Mode Tabs - icon only, tooltip on hover */}
      <div className="flex border-b bg-background/60 shrink-0">
        {MODE_TABS.map(({ mode: m, icon: Icon, labelKey }) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            title={t(labelKey)}
            className={cn(
              'flex-1 flex items-center justify-center py-2.5 transition-colors border-b-2',
              mode === m
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      {/* Scrollable config */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Source Image(s) (Edit: multi / I2V: single) */}
          {needsSourceImage(mode) && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t('smartGenerate.config.sourceImage')}</Label>
              {sourceImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {sourceImages.map((img, idx) => (
                    <div key={idx} className="relative rounded-lg overflow-hidden border w-24 h-24">
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      {!isRunning && (
                        <button
                          onClick={() => removeSourceImage(idx)}
                          className="absolute top-1 right-1 rounded-full bg-background/80 p-0.5 hover:bg-background"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* Upload button: always show for Edit (multi), hide for I2V when 1 already uploaded */}
              {(!isI2V || sourceImages.length === 0) && !isRunning && (
                <label className={cn(
                  "flex items-center justify-center h-16 rounded-lg border-2 border-dashed transition-colors",
                  uploading ? "opacity-50 cursor-wait" : "cursor-pointer hover:bg-muted/30"
                )}>
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span>{uploading ? t('smartGenerate.config.uploading') : sourceImages.length === 0 ? t('smartGenerate.config.uploadImage') : t('smartGenerate.config.addImage')}</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple={!isI2V}
                    className="hidden"
                    disabled={uploading}
                    onChange={async (e) => {
                      const files = e.target.files
                      if (!files || files.length === 0) return
                      setUploading(true)
                      try {
                        for (let i = 0; i < files.length; i++) {
                          const url = await apiClient.uploadFile(files[i])
                          addSourceImage(url)
                        }
                      } catch (err) {
                        console.error('Failed to upload image:', err)
                      } finally {
                        setUploading(false)
                        e.target.value = ''
                      }
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {/* Reference Image (T2I/T2V optional - captioned for prompt enrichment) */}
          {(mode === 'text-to-image' || mode === 'text-to-video') && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('smartGenerate.config.referenceImage')}</Label>
              {referenceImage ? (
                <div className="relative rounded-lg overflow-hidden border">
                  <img src={referenceImage} alt="" className="w-full max-h-40 object-contain bg-muted/30" />
                  {!isRunning && (
                    <button
                      onClick={() => setReferenceImage(null)}
                      className="absolute top-2 right-2 rounded-full bg-background/80 p-1 hover:bg-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ) : (
                <label className={cn(
                  "flex items-center justify-center h-16 rounded-lg border border-dashed transition-colors",
                  uploading ? "opacity-50 cursor-wait" : "cursor-pointer hover:bg-muted/30"
                )}>
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span>{uploading ? t('smartGenerate.config.uploading') : t('smartGenerate.config.optionalReference')}</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setUploading(true)
                      try {
                        const url = await apiClient.uploadFile(file)
                        setReferenceImage(url)
                      } catch (err) {
                        console.error('Failed to upload reference image:', err)
                      } finally {
                        setUploading(false)
                      }
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {/* Prompt */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">{t('smartGenerate.config.prompt')}</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!userPrompt.trim() || optimizingPrompt || isRunning) return
                      setOptimizingPrompt(true)
                      try {
                        const optimized = await callPromptOptimizer(userPrompt, mode, sourceImages[0] ?? undefined)
                        if (optimized && optimized !== userPrompt) {
                          setUserPrompt(optimized)
                          setTimeout(autoResize, 0)
                        }
                      } catch {
                        // non-fatal
                      } finally {
                        setOptimizingPrompt(false)
                      }
                    }}
                    disabled={!userPrompt.trim() || optimizingPrompt || isRunning}
                    className={cn(
                      'h-5 w-5 flex items-center justify-center rounded transition-colors',
                      !userPrompt.trim() || isRunning
                        ? 'text-muted-foreground/40 cursor-not-allowed'
                        : 'text-muted-foreground hover:text-primary hover:bg-primary/10',
                    )}
                  >
                    {optimizingPrompt
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Sparkles className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{t('smartGenerate.config.optimizePrompt')}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <textarea
              ref={promptRef}
              value={userPrompt}
              onChange={(e) => {
                setUserPrompt(e.target.value)
                autoResize()
              }}
              disabled={isRunning}
              placeholder={t('smartGenerate.config.promptPlaceholder')}
              className="w-full min-h-[120px] max-h-[200px] rounded-lg border bg-background/80 p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            />
          </div>

          {/* Size / Aspect Ratio (T2I/T2V only) */}
          {sizeConfig && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t('smartGenerate.config.size')}</Label>
              {sizeConfig.type === 'dimensions' ? (
                <SizeSelector
                  value={sizeValue || sizeConfig.default || '1024*1024'}
                  onChange={(v) => setSizeValue(v)}
                  disabled={isRunning}
                  min={sizeConfig.min}
                  max={sizeConfig.max}
                />
              ) : (
                <Select
                  value={sizeValue || sizeConfig.default || sizeConfig.options?.[0] || ''}
                  onValueChange={(v) => setSizeValue(v)}
                  disabled={isRunning}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sizeConfig.options?.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Resolution (e.g. 1k/2k/4k for Nano Banana) */}
          {resolutionConfig && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t('smartGenerate.config.resolution')}</Label>
              <div className="flex gap-1.5">
                {resolutionConfig.options?.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setResolutionValue(opt)}
                    disabled={isRunning}
                    className={cn(
                      'flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      (resolutionValue || resolutionConfig.default) === opt
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'text-muted-foreground hover:bg-muted/50',
                      isRunning && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {opt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Model-specific extra config fields (duration, resolution, loras) */}
          {extraFields.filter(f => f.type === 'enum').map((field) => (
            <div key={field.fieldName} className="space-y-1.5">
              <Label className="text-xs">{t(field.labelKey)}</Label>
              <div className="flex gap-1.5">
                {field.options?.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setExtraConfigValue(field.fieldName, opt)}
                    disabled={isRunning}
                    className={cn(
                      'flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      ((extraConfigValues[field.fieldName] as string) || field.default) === opt
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'text-muted-foreground hover:bg-muted/50',
                      isRunning && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {field.fieldName === 'duration' ? `${opt}s` : opt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* LoRA URLs (for LoRA models) */}
          {extraFields.some(f => f.type === 'lora') && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t('smartGenerate.config.loras')}</Label>
              {/* Added LoRAs list */}
              {currentLoras.map((lora, idx) => {
                // Show short display: domain + filename tail
                const urlObj = (() => { try { return new URL(lora.path) } catch { return null } })()
                const shortUrl = urlObj
                  ? `${urlObj.hostname}/...${lora.path.slice(-20)}`
                  : lora.path.length > 30 ? `...${lora.path.slice(-28)}` : lora.path
                return (
                  <div key={idx} className="rounded-md border bg-muted/20 p-2 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Link className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="text-xs truncate text-muted-foreground" title={lora.path}>{shortUrl}</span>
                      {!isRunning && (
                        <button onClick={() => removeLora(idx)} className="shrink-0 ml-auto text-muted-foreground hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground shrink-0 w-12">Scale {lora.scale.toFixed(1)}</span>
                      <Slider
                        value={[lora.scale]}
                        onValueChange={([v]) => updateLoraScale(idx, v)}
                        min={0}
                        max={2}
                        step={0.1}
                        disabled={isRunning}
                        className="flex-1"
                      />
                    </div>
                  </div>
                )
              })}
              {/* Add LoRA input */}
              {!isRunning && (
                <div className="flex gap-1.5">
                  <Input
                    value={loraUrlInput}
                    onChange={(e) => setLoraUrlInput(e.target.value)}
                    placeholder={t('smartGenerate.config.loraPlaceholder')}
                    className="h-8 text-xs flex-1"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLora() } }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={addLora}
                    disabled={!loraUrlInput.trim()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Advanced Settings (collapsible) */}
          <div className="space-y-1.5">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span className="font-medium">{t('smartGenerate.config.advanced')}</span>
              {showAdvanced
                ? <ChevronUp className="h-3.5 w-3.5 ml-auto" />
                : <ChevronDown className="h-3.5 w-3.5 ml-auto" />
              }
            </button>

            {showAdvanced && (
              <div className="space-y-3 pt-1">
                {/* Model Selection */}
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('smartGenerate.config.model')}</Label>
                  <SmartModelSelector
                    mode={mode}
                    selectedModelId={selectedModelId}
                    onSelect={setSelectedModelId}
                    disabled={isRunning}
                  />
                </div>

                {/* Parallel Count */}
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('smartGenerate.config.parallel')}</Label>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setParallelCount(2)}
                      disabled={isRunning}
                      className={cn(
                        'flex-1 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                        parallelCount === 2 ? 'border-primary bg-primary/5 text-primary' : 'text-muted-foreground hover:bg-muted/50',
                        isRunning && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <div className="font-medium">{t('smartGenerate.config.standard')}</div>
                    </button>
                    <button
                      onClick={() => setParallelCount(4)}
                      disabled={isRunning}
                      className={cn(
                        'flex-1 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                        parallelCount === 4 ? 'border-primary bg-primary/5 text-primary' : 'text-muted-foreground hover:bg-muted/50',
                        isRunning && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <div className="font-medium">{t('smartGenerate.config.deep')}</div>
                    </button>
                  </div>
                </div>

                {/* Budget */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('smartGenerate.config.budget')}</Label>
                    <span className="text-sm font-mono text-foreground">${budgetLimit.toFixed(2)}</span>
                  </div>
                  <Slider
                    value={[budgetLimit]}
                    onValueChange={([v]) => setBudgetLimit(v)}
                    min={0.10}
                    max={10.00}
                    step={0.10}
                    disabled={isRunning}
                  />
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div className="flex justify-between">
                      <span>{t('smartGenerate.config.recommended')}</span>
                      <span className="font-mono">${recommended.min.toFixed(2)}-${recommended.max.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('smartGenerate.config.estimated')}</span>
                      <span className="font-mono">${estimatedCost.min.toFixed(2)}-${estimatedCost.max.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Image Tools (Angle / Relight) — only for Image Edit with source images */}
          {mode === 'image-edit' && sourceImages.length > 0 && (
            <ImageToolsSection
              sourceImages={sourceImages}
              isLocked={isRunning}
              onAddToolResult={store.addToolResult}
            />
          )}
        </div>
      </ScrollArea>

      {/* Start / Cancel button */}
      <div className="border-t bg-background/80 p-3 shrink-0">
        {isRunning ? (
          <Button
            variant="destructive"
            className="w-full"
            disabled={cancelRequested}
            onClick={() => store.cancelPipeline()}
          >
            {cancelRequested ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('smartGenerate.cancelling')}
              </>
            ) : (
              <>
                <Square className="mr-2 h-4 w-4" />
                {t('smartGenerate.cancel')}
              </>
            )}
          </Button>
        ) : (
          <Button
            className="w-full"
            disabled={!canStart}
            onClick={onStart}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {t('smartGenerate.start')}
          </Button>
        )}
      </div>
    </div>
  )
}
