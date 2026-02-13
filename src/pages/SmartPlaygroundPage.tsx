import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useModelsStore } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { apiClient } from '@/api/client'
import { findFamilyById, SMART_FORM_FAMILIES } from '@/lib/smartFormConfig'
import { schemaToFormFields, getDefaultValues, type FormFieldConfig } from '@/lib/schemaToForm'
import type { SchemaProperty } from '@/types/model'
import type { Model } from '@/types/model'
import type { PredictionResult } from '@/types/prediction'
import { FormField } from '@/components/playground/FormField'
import { OutputDisplay } from '@/components/playground/OutputDisplay'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArrowLeft, Loader2, Play, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/useToast'

function getCategoryAccent(category: 'image' | 'video' | 'other') {
  switch (category) {
    case 'video':
      return 'from-purple-500 to-violet-500'
    case 'image':
      return 'from-sky-400 to-blue-500'
    default:
      return 'from-emerald-400 to-teal-500'
  }
}

// Extract schema fields from a model object
function extractModelFields(model: Model): { fields: FormFieldConfig[]; orderProps?: string[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiSchemas = (model.api_schema as any)?.api_schemas as Array<{
    type: string
    request_schema?: {
      properties?: Record<string, unknown>
      required?: string[]
      'x-order-properties'?: string[]
    }
  }> | undefined

  const requestSchema = apiSchemas?.find(s => s.type === 'model_run')?.request_schema
  if (!requestSchema?.properties) {
    return { fields: [] }
  }
  const fields = schemaToFormFields(
    requestSchema.properties as Record<string, SchemaProperty>,
    requestSchema.required || [],
    requestSchema['x-order-properties']
  )
  return { fields, orderProps: requestSchema['x-order-properties'] }
}

// Merge fields from multiple variants into one unified field list
function mergeVariantFields(
  variants: Model[],
  primaryVariant: string
): FormFieldConfig[] {
  const fieldMap = new Map<string, FormFieldConfig>()
  const primaryModel = variants.find(v => v.model_id === primaryVariant)

  // Get primary variant's order
  let primaryOrder: string[] | undefined
  if (primaryModel) {
    const { fields, orderProps } = extractModelFields(primaryModel)
    primaryOrder = orderProps
    for (const f of fields) {
      fieldMap.set(f.name, { ...f, required: false })
    }
  }

  // Merge fields from other variants (add new fields, don't overwrite existing)
  for (const variant of variants) {
    if (variant.model_id === primaryVariant) continue
    const { fields } = extractModelFields(variant)
    for (const f of fields) {
      if (!fieldMap.has(f.name)) {
        fieldMap.set(f.name, { ...f, required: false })
      }
    }
  }

  const allFields = Array.from(fieldMap.values())

  // Sort by primary variant's order, extras at end
  if (primaryOrder && primaryOrder.length > 0) {
    allFields.sort((a, b) => {
      const idxA = primaryOrder!.indexOf(a.name)
      const idxB = primaryOrder!.indexOf(b.name)
      const orderA = idxA === -1 ? Infinity : idxA
      const orderB = idxB === -1 ? Infinity : idxB
      if (orderA !== orderB) return orderA - orderB
      // For unordered fields, put prompt-like fields first
      if (a.name === 'prompt') return -1
      if (b.name === 'prompt') return 1
      return a.name.localeCompare(b.name)
    })
  }

  return allFields
}

// Get which field names a variant accepts
function getVariantFieldNames(model: Model): Set<string> {
  const { fields } = extractModelFields(model)
  return new Set(fields.map(f => f.name))
}

// Media field names for tracking last uploaded type
const IMAGE_FIELD_NAMES = ['image', 'images', 'image_url', 'image_urls', 'input_image']
const VIDEO_FIELD_NAMES = ['video', 'videos', 'video_url', 'video_urls', 'input_video']

export function SmartPlaygroundPage() {
  const { t } = useTranslation()
  const { familyId } = useParams<{ familyId: string }>()
  const navigate = useNavigate()
  const { models, fetchModels } = useModelsStore()
  const { isValidated } = useApiKeyStore()

  // Local state
  const [toggleValues, setToggleValues] = useState<Record<string, string>>({})
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<(string | Record<string, unknown>)[]>([])
  const [prediction, setPrediction] = useState<PredictionResult | null>(null)
  const [mobileView, setMobileView] = useState<'input' | 'output'>('input')
  const [isUploading, setIsUploading] = useState(false)
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null)
  const [batchEnabled, setBatchEnabled] = useState(false)
  const [batchCount, setBatchCount] = useState(2)
  const [batchRandomizeSeed, setBatchRandomizeSeed] = useState(true)
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [lastMediaType, setLastMediaType] = useState<'image' | 'video' | null>(null)
  const pricingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const defaultsInitializedRef = useRef<string | null>(null)

  // Find family config (SMART_FORM_FAMILIES in deps ensures HMR updates propagate)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const family = useMemo(() => findFamilyById(familyId || ''), [familyId, SMART_FORM_FAMILIES])

  // Ensure models are fetched
  useEffect(() => {
    if (isValidated) {
      fetchModels()
    }
  }, [isValidated, fetchModels])

  // Initialize toggle defaults
  useEffect(() => {
    if (!family) return
    const defaults: Record<string, string> = {}
    for (const toggle of family.toggles) {
      defaults[toggle.key] = toggle.default
    }
    setToggleValues(defaults)
  }, [family])

  // Get variant models
  const variantModels = useMemo(() => {
    if (!family) return []
    return family.variantIds
      .map(id => models.find(m => m.model_id === id))
      .filter((m): m is Model => !!m)
  }, [family, models])

  // Merged fields
  const mergedFields = useMemo(() => {
    if (variantModels.length === 0 || !family) return []
    const fields = mergeVariantFields(variantModels, family.primaryVariant)
    if (family.excludeFields?.length) {
      const excluded = new Set(family.excludeFields)
      return fields.filter(f => !excluded.has(f.name))
    }
    return fields
  }, [variantModels, family])

  // Initialize form defaults
  useEffect(() => {
    if (mergedFields.length === 0 || !family) return
    if (defaultsInitializedRef.current === family.id) return
    defaultsInitializedRef.current = family.id
    const defaults = getDefaultValues(mergedFields)
    setFormValues(defaults)
  }, [mergedFields, family])

  // Compute filled fields (for variant resolution)
  // When both image and video are filled, only keep the last uploaded type
  const filledFields = useMemo(() => {
    const filled = new Set<string>()
    for (const [key, value] of Object.entries(formValues)) {
      if (value === undefined || value === null || value === '') continue
      if (Array.isArray(value) && value.length === 0) continue
      filled.add(key)
    }

    // Conflict resolution: if both image and video fields are filled, remove the earlier one
    const hasImage = IMAGE_FIELD_NAMES.some(n => filled.has(n))
    const hasVideo = VIDEO_FIELD_NAMES.some(n => filled.has(n))
    if (hasImage && hasVideo && lastMediaType) {
      const toRemove = lastMediaType === 'video' ? IMAGE_FIELD_NAMES : VIDEO_FIELD_NAMES
      for (const name of toRemove) filled.delete(name)
    }

    // Debug: log filled fields for variant resolution
    if (filled.size > 0) {
      console.log('[SmartPlayground] filledFields:', [...filled])
    }
    return filled
  }, [formValues, lastMediaType])

  // Resolve variant
  const resolvedVariantId = useMemo(() => {
    if (!family) return ''
    const result = family.resolveVariant(filledFields, toggleValues)
    console.log('[SmartPlayground] resolvedVariant:', result, 'filledFields:', [...filledFields])
    return result
  }, [family, filledFields, toggleValues])

  const resolvedModel = useMemo(() => {
    return models.find(m => m.model_id === resolvedVariantId)
  }, [models, resolvedVariantId])

  // Fields that the resolved variant accepts (for dynamic show/hide)
  const resolvedVariantFieldNames = useMemo(() => {
    if (!resolvedModel) return new Set<string>()
    return getVariantFieldNames(resolvedModel)
  }, [resolvedModel])

  // Use resolved variant's own field configs (with its specific options/ranges),
  // plus always show trigger fields (file/loras) from merged set for variant switching
  const visibleFields = useMemo(() => {
    if (!resolvedModel || resolvedVariantFieldNames.size === 0) return mergedFields
    const triggerTypes = new Set(['file', 'file-array', 'loras'])

    // Get actual field configs from the resolved variant
    const { fields: resolvedFields } = extractModelFields(resolvedModel)
    const resolvedFieldMap = new Map(resolvedFields.map(f => [f.name, { ...f, required: false }]))

    // Build visible fields: resolved variant's fields (with its own config) + trigger fields from merged
    const result: FormFieldConfig[] = []
    const added = new Set<string>()

    // First add fields in merged order (preserves nice ordering)
    for (const mf of mergedFields) {
      if (resolvedFieldMap.has(mf.name)) {
        // Use resolved variant's config (has correct select options, ranges, etc.)
        result.push(resolvedFieldMap.get(mf.name)!)
        added.add(mf.name)
      } else if (triggerTypes.has(mf.type)) {
        // Trigger field not in resolved variant — keep from merged for switching
        result.push(mf)
        added.add(mf.name)
      }
    }

    return result
  }, [mergedFields, resolvedModel, resolvedVariantFieldNames])

  // Auto-disable batch when resolved variant has native max_images (e.g. sequential)
  useEffect(() => {
    if (resolvedVariantFieldNames.has('max_images')) {
      setBatchEnabled(false)
    }
  }, [resolvedVariantFieldNames])

  // Clean up invalid select values when variant changes (e.g. 480p not available in fast)
  useEffect(() => {
    if (visibleFields.length === 0) return
    setFormValues(prev => {
      const next = { ...prev }
      let changed = false
      for (const field of visibleFields) {
        if (field.type === 'select' && field.options && prev[field.name] !== undefined) {
          const currentVal = prev[field.name]
          if (!field.options.includes(currentVal as string | number)) {
            // Current value not in new options — reset to default or first option
            next[field.name] = field.default ?? field.options[0]
            changed = true
          }
        }
      }
      return changed ? next : prev
    })
  }, [visibleFields])

  // Dynamic pricing with debounce
  useEffect(() => {
    if (!resolvedVariantId || !resolvedModel) {
      setCalculatedPrice(null)
      return
    }

    if (pricingTimeoutRef.current) {
      clearTimeout(pricingTimeoutRef.current)
    }

    pricingTimeoutRef.current = setTimeout(async () => {
      try {
        const variantFieldNames = getVariantFieldNames(resolvedModel)
        const filteredValues: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(formValues)) {
          if (!variantFieldNames.has(key)) continue
          if (value === undefined || value === null || value === '') continue
          if (Array.isArray(value) && value.length === 0) continue
          filteredValues[key] = value
        }
        const price = await apiClient.calculatePricing(resolvedVariantId, filteredValues)
        setCalculatedPrice(price)
      } catch {
        // Pricing calculation failed silently
      }
    }, 500)

    return () => {
      if (pricingTimeoutRef.current) {
        clearTimeout(pricingTimeoutRef.current)
      }
    }
  }, [resolvedVariantId, resolvedModel, formValues])

  // Handle form value change
  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setFormValues(prev => ({ ...prev, [key]: value }))

    // Track last uploaded media type
    const isFilled = value !== undefined && value !== null && value !== '' &&
      !(Array.isArray(value) && value.length === 0)
    if (isFilled) {
      if (IMAGE_FIELD_NAMES.includes(key)) setLastMediaType('image')
      else if (VIDEO_FIELD_NAMES.includes(key)) setLastMediaType('video')
    } else {
      // Cleared — reset if it was this type
      if (IMAGE_FIELD_NAMES.includes(key) && lastMediaType === 'image') setLastMediaType(null)
      else if (VIDEO_FIELD_NAMES.includes(key) && lastMediaType === 'video') setLastMediaType(null)
    }
  }, [lastMediaType])

  // Handle toggle change
  const handleToggleChange = useCallback((key: string, value: string) => {
    setToggleValues(prev => ({ ...prev, [key]: value }))
  }, [])

  // Build cleaned values for the resolved variant
  const buildCleanedValues = useCallback(() => {
    if (!resolvedModel) return {}
    // Apply family-level value mapping first (e.g. left_audio → audio for InfiniteTalk)
    const mappedValues = family?.mapValues
      ? family.mapValues({ ...formValues }, resolvedVariantId)
      : formValues
    const variantFieldNames = getVariantFieldNames(resolvedModel)
    const cleanedValues: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(mappedValues)) {
      if (!variantFieldNames.has(key)) continue
      if (value === undefined || value === null || value === '') continue
      if (Array.isArray(value) && value.length === 0) continue
      cleanedValues[key] = value
    }
    return cleanedValues
  }, [resolvedModel, formValues, family, resolvedVariantId])

  // Run prediction (single or batch)
  const handleRun = useCallback(async () => {
    if (!resolvedVariantId || !resolvedModel || isRunning) return

    setIsRunning(true)
    setError(null)
    setOutputs([])
    setPrediction(null)
    setMobileView('output')
    setBatchProgress(null)

    try {
      const cleanedValues = buildCleanedValues()
      const runCount = batchEnabled ? batchCount : 1

      const allOutputs: (string | Record<string, unknown>)[] = []
      let lastPrediction: PredictionResult | null = null

      for (let i = 0; i < runCount; i++) {
        if (runCount > 1) {
          setBatchProgress({ current: i + 1, total: runCount })
        }

        const runValues = { ...cleanedValues }
        // Randomize seed for batch runs (skip first run to keep original seed)
        if (batchEnabled && batchRandomizeSeed && i > 0 && 'seed' in runValues) {
          runValues.seed = Math.floor(Math.random() * 65536)
        }

        const result = await apiClient.run(resolvedVariantId, runValues)
        lastPrediction = result
        if (result.outputs) {
          allOutputs.push(...result.outputs)
        }
        // Update outputs progressively
        setOutputs([...allOutputs])
        setPrediction(result)
      }

      setPrediction(lastPrediction)
      setOutputs(allOutputs)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Prediction failed'
      setError(message)
      toast({
        title: t('common.error'),
        description: message,
        variant: 'destructive',
      })
    } finally {
      setIsRunning(false)
      setBatchProgress(null)
    }
  }, [resolvedVariantId, resolvedModel, formValues, isRunning, batchEnabled, batchCount, batchRandomizeSeed, buildCleanedValues, t])

  // Not found
  if (!family) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground">Family not found</p>
          <Button variant="outline" onClick={() => navigate('/featured-models')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('smartPlayground.back')}
          </Button>
        </div>
      </div>
    )
  }

  // Loading state
  if (variantModels.length === 0 && models.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const shortVariantId = resolvedVariantId.split('/').slice(-1)[0] || resolvedVariantId

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate('/featured-models')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <img
            src={family.poster}
            alt={family.name}
            className="h-8 w-8 rounded-md object-cover"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold truncate">{family.name}</h1>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono truncate max-w-[200px]">
                {shortVariantId}
              </Badge>
              {calculatedPrice !== null && (
                <span className="text-[10px] text-muted-foreground font-medium">${calculatedPrice.toFixed(4)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Toggles */}
        {family.toggles.length > 0 && (
          <div className="flex items-center gap-3 mt-2">
            {family.toggles.map(toggle => (
              <div key={toggle.key} className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t(toggle.labelKey)}:</span>
                <div className="flex rounded-md border p-0.5 bg-muted/50">
                  {toggle.options.map(option => (
                    <button
                      key={option.value}
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                        toggleValues[toggle.key] === option.value
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => handleToggleChange(toggle.key, option.value)}
                    >
                      {t(option.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mobile Tab Switcher */}
      <div className="md:hidden shrink-0 flex border-b">
        <button
          className={cn(
            "flex-1 py-2 text-sm font-medium text-center transition-colors border-b-2",
            mobileView === 'input'
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground"
          )}
          onClick={() => setMobileView('input')}
        >
          {t('smartPlayground.input')}
        </button>
        <button
          className={cn(
            "flex-1 py-2 text-sm font-medium text-center transition-colors border-b-2",
            mobileView === 'output'
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground"
          )}
          onClick={() => setMobileView('output')}
        >
          {t('smartPlayground.output')}
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex">
        {/* Left Panel: Form (desktop always visible, mobile conditional) */}
        <div className={cn(
          "flex flex-col border-r",
          "md:w-[400px] md:flex",
          mobileView === 'input' ? "flex w-full" : "hidden"
        )}>
          {/* Variant indicator */}
          <div className="shrink-0 px-4 py-2 border-b bg-muted/30">
            <div className="flex items-center gap-1.5 text-xs">
              <div className={cn("w-2 h-2 shrink-0 rounded-full bg-gradient-to-r", getCategoryAccent(family.category))} />
              <span className="text-muted-foreground shrink-0">{t('smartPlayground.willCall')}:</span>
            </div>
            <p className="font-mono text-xs font-medium mt-0.5 break-all">{resolvedVariantId}</p>
          </div>

          {/* Form Fields */}
          <ScrollArea className="flex-1">
            <div className="space-y-4 p-4">
              {visibleFields.map(field => {
                if (field.hidden) {
                  return (
                    <HiddenFieldToggle
                      key={field.name}
                      field={field}
                      value={formValues[field.name]}
                      onChange={(value) => handleFieldChange(field.name, value)}
                      disabled={isRunning}
                      formValues={formValues}
                      onUploadingChange={setIsUploading}
                    />
                  )
                }
                return (
                  <FormField
                    key={field.name}
                    field={field}
                    value={formValues[field.name]}
                    onChange={(value) => handleFieldChange(field.name, value)}
                    disabled={isRunning}
                    formValues={formValues}
                    onUploadingChange={setIsUploading}
                  />
                )
              })}
            </div>
          </ScrollArea>

          {/* Run Button with Batch */}
          <div className="shrink-0 p-4 border-t">
            <div className="flex">
              <Button
                className="flex-1 rounded-r-none border-r border-r-primary/20"
                onClick={handleRun}
                disabled={isRunning || isUploading || !resolvedModel}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {batchProgress
                      ? t('playground.batch.running', { current: batchProgress.current, total: batchProgress.total })
                      : t('smartPlayground.running')
                    }
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    {batchEnabled && batchCount > 1
                      ? `${t('smartPlayground.run')} (${batchCount})`
                      : t('smartPlayground.run')
                    }
                    {calculatedPrice !== null && (
                      <span className="ml-1 opacity-70">
                        (${(calculatedPrice * (batchEnabled ? batchCount : 1)).toFixed(4)})
                      </span>
                    )}
                  </>
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="rounded-l-none px-2"
                    disabled={isRunning || isUploading}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-4">
                  <div className="space-y-4">
                    <div className="font-medium text-sm">{t('playground.batch.settings')}</div>
                    {batchEnabled && (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm">{t('playground.batch.repeatCount')}</Label>
                            <span className="text-sm font-medium">{batchCount}</span>
                          </div>
                          <Slider
                            value={[batchCount]}
                            onValueChange={(v) => setBatchCount(v[0])}
                            min={2}
                            max={16}
                            step={1}
                            className="w-full"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm cursor-pointer">{t('playground.batch.randomizeSeed')}</Label>
                          <Switch
                            checked={batchRandomizeSeed}
                            onCheckedChange={setBatchRandomizeSeed}
                          />
                        </div>
                      </>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <Label className="text-sm cursor-pointer">{t('playground.batch.enable')}</Label>
                      <Switch
                        checked={batchEnabled}
                        onCheckedChange={setBatchEnabled}
                      />
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Right Panel: Output */}
        <div className={cn(
          "flex-1 min-w-0",
          "md:flex",
          mobileView === 'output' ? "flex" : "hidden md:flex"
        )}>
          <div className="flex-1 p-4">
            <OutputDisplay
              prediction={prediction}
              outputs={outputs}
              error={error}
              isLoading={isRunning}
              modelId={resolvedVariantId}
              gridLayout={outputs.length > 1}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// Hidden field toggle component (mirrors DynamicForm pattern)
function HiddenFieldToggle({
  field,
  value,
  onChange,
  disabled,
  formValues,
  onUploadingChange,
}: {
  field: FormFieldConfig
  value: unknown
  onChange: (value: unknown) => void
  disabled: boolean
  formValues: Record<string, unknown>
  onUploadingChange?: (isUploading: boolean) => void
}) {
  const [isEnabled, setIsEnabled] = useState(false)

  const handleToggle = () => {
    if (isEnabled) {
      onChange(undefined)
    }
    setIsEnabled(!isEnabled)
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
          "border shadow-sm",
          isEnabled
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-background hover:bg-muted border-input"
        )}
      >
        <div className={cn(
          "w-3 h-3 rounded-full border-2 transition-colors",
          isEnabled ? "bg-primary-foreground border-primary-foreground" : "border-muted-foreground"
        )} />
        {field.label}
      </button>
      {field.description && !isEnabled && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
      {isEnabled && (
        <div className="pl-4 border-l-2 border-primary/50 ml-2">
          <FormField
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
            hideLabel
            formValues={formValues}
            onUploadingChange={onUploadingChange}
          />
        </div>
      )}
    </div>
  )
}
