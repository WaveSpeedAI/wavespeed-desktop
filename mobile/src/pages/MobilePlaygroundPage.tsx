import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePlaygroundStore } from '@/stores/playgroundStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { useTemplateStore } from '@/stores/templateStore'
import { usePredictionInputsStore } from '@mobile/stores/predictionInputsStore'
import { apiClient } from '@/api/client'
import { DynamicForm } from '@/components/playground/DynamicForm'
import { OutputDisplay } from '@/components/playground/OutputDisplay'
import { BatchControls } from '@/components/playground/BatchControls'
import { BatchOutputGrid } from '@/components/playground/BatchOutputGrid'
import { HistoryPanel } from '@/components/playground/HistoryPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { RotateCcw, Loader2, Save, Globe, Settings2, Image } from 'lucide-react'
import { ModelSelector } from '@/components/playground/ModelSelector'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/useToast'

type ViewTab = 'input' | 'output'

export function MobilePlaygroundPage() {
  const { t } = useTranslation()
  const params = useParams()
  const modelId = params['*'] || params.modelId
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { models } = useModelsStore()
  const { isLoading: isLoadingApiKey, apiKey } = useApiKeyStore()
  const {
    tabs,
    activeTabId,
    createTab,
    getActiveTab,
    setSelectedModel,
    setFormValue,
    setFormValues,
    setFormFields,
    resetForm,
    runPrediction,
    runBatch,
    clearBatchResults,
    selectHistoryItem,
  } = usePlaygroundStore()
  const { templates, loadTemplates, saveTemplate, isLoaded: templatesLoaded } = useTemplateStore()
  const { save: savePredictionInputs, load: loadPredictionInputs, isLoaded: inputsLoaded } = usePredictionInputsStore()

  const activeTab = getActiveTab()

  // History-aware output display
  const historyIndex = activeTab?.selectedHistoryIndex ?? null
  const historyItem = historyIndex !== null ? activeTab?.generationHistory[historyIndex] : null
  const displayedPrediction = historyItem ? historyItem.prediction : (activeTab?.currentPrediction ?? null)
  const displayedOutputs = historyItem ? historyItem.outputs : (activeTab?.outputs ?? [])

  const templateLoadedRef = useRef<string | null>(null)
  const pendingTemplateRef = useRef<{ values: Record<string, unknown>, name: string } | null>(null)
  const prevOutputsLengthRef = useRef(0)
  const lastSavedPredictionRef = useRef<string | null>(null)

  // Mobile: switch between input and output views
  const [activeView, setActiveView] = useState<ViewTab>('input')

  // Template dialog states
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')

  // Dynamic pricing state
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null)
  const [isPricingLoading, setIsPricingLoading] = useState(false)
  const pricingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Load templates and prediction inputs on mount
  useEffect(() => {
    if (!templatesLoaded) {
      loadTemplates()
    }
    if (!inputsLoaded) {
      loadPredictionInputs()
    }
  }, [templatesLoaded, loadTemplates, inputsLoaded, loadPredictionInputs])

  // Reset template loaded ref and view when modelId changes (navigating from templates page)
  useEffect(() => {
    templateLoadedRef.current = null
    // Also reset to input view when navigating to a different model
    setActiveView('input')
  }, [modelId])

  // Calculate dynamic pricing with debounce
  useEffect(() => {
    if (!activeTab?.selectedModel || !apiKey) {
      setCalculatedPrice(null)
      return
    }

    if (pricingTimeoutRef.current) {
      clearTimeout(pricingTimeoutRef.current)
    }

    pricingTimeoutRef.current = setTimeout(async () => {
      setIsPricingLoading(true)
      try {
        const price = await apiClient.calculatePricing(
          activeTab.selectedModel!.model_id,
          activeTab.formValues
        )
        setCalculatedPrice(price)
      } catch {
        setCalculatedPrice(null)
      } finally {
        setIsPricingLoading(false)
      }
    }, 500)

    return () => {
      if (pricingTimeoutRef.current) {
        clearTimeout(pricingTimeoutRef.current)
      }
    }
  }, [activeTab?.selectedModel, activeTab?.formValues, apiKey, tabs])

  // Load template from URL query param
  useEffect(() => {
    const templateId = searchParams.get('template')
    if (templateId && templatesLoaded && activeTab && templateLoadedRef.current !== templateId) {
      const template = templates.find(t => t.id === templateId)
      if (template) {
        templateLoadedRef.current = templateId
        setActiveView('input')
        // Store template values as pending — they will be applied in handleSetDefaults
        // after DynamicForm loads the model schema and sets default values.
        // This avoids the race condition where defaults overwrite template values.
        pendingTemplateRef.current = { values: template.values, name: template.name }
        // If model is already correct and form fields exist, apply immediately
        if (activeTab.selectedModel?.model_id === template.modelId && activeTab.formFields.length > 0) {
          setFormValues(template.values)
          pendingTemplateRef.current = null
          toast({
            title: t('playground.templateLoaded'),
            description: t('playground.loadedTemplate', { name: template.name }),
          })
        }
        setSearchParams({}, { replace: true })
      }
    }
  }, [searchParams, templates, templatesLoaded, activeTab, setFormValues, setSearchParams, t])

  const handleSaveTemplate = () => {
    if (!activeTab?.selectedModel || !newTemplateName.trim()) return

    saveTemplate(
      newTemplateName.trim(),
      activeTab.selectedModel.model_id,
      activeTab.selectedModel.name,
      activeTab.formValues
    )
    setNewTemplateName('')
    setShowSaveTemplateDialog(false)
    toast({
      title: t('playground.templateSaved'),
      description: t('playground.savedAs', { name: newTemplateName.trim() }),
    })
  }

  // Create initial tab if none exist
  useEffect(() => {
    if (tabs.length === 0 && models.length > 0) {
      if (modelId) {
        const decodedId = decodeURIComponent(modelId)
        const model = models.find(m => m.model_id === decodedId)
        createTab(model)
      } else {
        createTab()
      }
    }
  }, [tabs.length, models, modelId, createTab])

  // Set model from URL param when navigating
  useEffect(() => {
    if (modelId && models.length > 0 && activeTab) {
      const decodedId = decodeURIComponent(modelId)
      const model = models.find(m => m.model_id === decodedId)
      if (model && activeTab.selectedModel?.model_id !== decodedId) {
        setSelectedModel(model)
      }
    }
  }, [modelId, models, activeTab, setSelectedModel])

  const handleSetDefaults = useCallback((defaults: Record<string, unknown>) => {
    setFormValues(defaults)
    // Apply pending template values after defaults are set (overrides defaults)
    if (pendingTemplateRef.current) {
      const { values, name } = pendingTemplateRef.current
      pendingTemplateRef.current = null
      setFormValues(values)
      toast({
        title: t('playground.templateLoaded'),
        description: t('playground.loadedTemplate', { name }),
      })
    }
  }, [setFormValues, t])

  const handleRun = async () => {
    // Switch to output view immediately so user can play game while waiting
    setActiveView('output')

    // Check if batch mode is enabled
    if (activeTab?.batchConfig?.enabled && activeTab.batchConfig.repeatCount > 1) {
      await runBatch()
    } else {
      await runPrediction()
    }
  }

  const handleReset = () => {
    resetForm()
  }

  const handleViewWebPage = () => {
    if (activeTab?.selectedModel) {
      const webUrl = `https://wavespeed.ai/models/${activeTab.selectedModel.model_id}`
      window.open(webUrl, '_blank')
    }
  }

  // Auto-switch to output only when NEW outputs appear (after running prediction)
  useEffect(() => {
    const currentLength = activeTab?.outputs?.length ?? 0
    const prevLength = prevOutputsLengthRef.current

    // Only auto-switch if outputs increased (new results) and not running
    if (currentLength > prevLength && !activeTab?.isRunning) {
      setActiveView('output')
    }

    // Update the ref to track current length
    prevOutputsLengthRef.current = currentLength
  }, [activeTab?.outputs, activeTab?.isRunning])

  // Save prediction inputs to local storage when prediction completes
  useEffect(() => {
    const prediction = activeTab?.currentPrediction
    const model = activeTab?.selectedModel
    const formValues = activeTab?.formValues
    const outputs = activeTab?.outputs
    const isRunning = activeTab?.isRunning

    // Check if we have a new completed prediction that hasn't been saved yet
    // We check for outputs and !isRunning instead of status because sync mode
    // might return results without status: 'completed'
    if (
      prediction?.id &&
      !isRunning &&
      outputs &&
      outputs.length > 0 &&
      model &&
      formValues &&
      Object.keys(formValues).length > 0 &&
      lastSavedPredictionRef.current !== prediction.id
    ) {
      console.log('[MobilePlaygroundPage] Saving prediction inputs:', {
        predictionId: prediction.id,
        modelId: model.model_id,
        inputKeys: Object.keys(formValues)
      })
      savePredictionInputs(
        prediction.id,
        model.model_id,
        model.name,
        formValues
      )
      lastSavedPredictionRef.current = prediction.id
    }
  }, [activeTab?.currentPrediction, activeTab?.selectedModel, activeTab?.formValues, activeTab?.outputs, activeTab?.isRunning, savePredictionInputs])

  // Save batch prediction inputs to local storage when batch completes
  const lastSavedBatchRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const batchResults = activeTab?.batchResults
    const model = activeTab?.selectedModel
    const isRunning = activeTab?.isRunning

    if (!batchResults || batchResults.length === 0 || !model || isRunning) return

    // Save inputs for each completed batch result
    for (const result of batchResults) {
      if (
        result.prediction?.id &&
        !result.error &&
        result.outputs.length > 0 &&
        result.input &&
        Object.keys(result.input).length > 0 &&
        !lastSavedBatchRef.current.has(result.prediction.id)
      ) {
        console.log('[MobilePlaygroundPage] Saving batch prediction inputs:', {
          predictionId: result.prediction.id,
          modelId: model.model_id,
          inputKeys: Object.keys(result.input)
        })
        savePredictionInputs(
          result.prediction.id,
          model.model_id,
          model.name,
          result.input
        )
        lastSavedBatchRef.current.add(result.prediction.id)
      }
    }
  }, [activeTab?.batchResults, activeTab?.selectedModel, activeTab?.isRunning, savePredictionInputs])

  if (isLoadingApiKey) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Mobile Tab Switcher */}
      <div className="tab-bar">
        <button
          className={cn('tab-item', activeView === 'input' && 'active')}
          onClick={() => setActiveView('input')}
        >
          <Settings2 className="h-4 w-4 inline-block mr-1.5" />
          Input
        </button>
        <button
          className={cn('tab-item', activeView === 'output' && 'active')}
          onClick={() => setActiveView('output')}
        >
          <Image className="h-4 w-4 inline-block mr-1.5" />
          Output
          {activeTab?.isRunning && (
            <Loader2 className="h-3 w-3 animate-spin inline-block ml-1.5" />
          )}
        </button>
      </div>

      {/* Content Area */}
      {activeTab ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeView === 'input' ? (
            /* Input View */
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Model Selector */}
              <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <ModelSelector
                    models={models}
                    value={activeTab?.selectedModel?.model_id}
                    onChange={(newModelId) => navigate(`/playground/${encodeURIComponent(newModelId)}`, { replace: true })}
                    disabled={activeTab?.isRunning}
                  />
                </div>
                {activeTab?.selectedModel && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={handleViewWebPage}
                  >
                    <Globe className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Parameters Form */}
              <div className="flex-1 overflow-auto px-4 py-3">
                {activeTab.selectedModel ? (
                  <DynamicForm
                    model={activeTab.selectedModel}
                    values={activeTab.formValues}
                    validationErrors={activeTab.validationErrors}
                    onChange={setFormValue}
                    onSetDefaults={handleSetDefaults}
                    onFieldsChange={setFormFields}
                    disabled={activeTab.isRunning}
                    collapsible
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <p className="text-center px-4">{t('playground.selectModelPrompt')}</p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="p-4 border-t bg-muted/30 safe-area-bottom">
                <div className="flex gap-2">
                  <BatchControls
                    disabled={!activeTab.selectedModel}
                    isRunning={activeTab.isRunning}
                    onRun={handleRun}
                    runLabel={t('playground.run')}
                    runningLabel={t('playground.running')}
                    price={
                      isPricingLoading
                        ? '...'
                        : calculatedPrice != null
                          ? `$${calculatedPrice.toFixed(4)}`
                          : activeTab.selectedModel?.base_price != null
                            ? `$${activeTab.selectedModel.base_price.toFixed(4)}`
                            : undefined
                    }
                  />
                  <Button
                    variant="outline"
                    className="touch-target"
                    onClick={handleReset}
                    disabled={activeTab.isRunning}
                    title={t('playground.resetForm')}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="touch-target"
                    onClick={() => setShowSaveTemplateDialog(true)}
                    disabled={!activeTab.selectedModel || activeTab.isRunning}
                    title={t('playground.saveAsTemplate')}
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* Output View */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{t('playground.output')}</h2>
                    {activeTab.selectedModel && (
                      <span className="text-sm text-muted-foreground truncate max-w-[150px]">
                        · {activeTab.selectedModel.name}
                      </span>
                    )}
                  </div>
                  {activeTab.isRunning && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('playground.running')}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 p-4 overflow-auto">
                  {/* Show BatchOutputGrid for batch results, OutputDisplay for single results */}
                  {activeTab.batchResults && activeTab.batchResults.length > 0 ? (
                    <BatchOutputGrid
                      results={activeTab.batchResults}
                      modelId={activeTab.selectedModel?.model_id}
                      modelName={activeTab.selectedModel?.name}
                      onClear={clearBatchResults}
                      isRunning={activeTab.isRunning}
                      totalCount={activeTab.batchConfig?.repeatCount}
                      queue={activeTab.batchState?.queue}
                    />
                  ) : (
                    <OutputDisplay
                      prediction={displayedPrediction}
                      outputs={displayedOutputs}
                      error={activeTab.error}
                      isLoading={activeTab.isRunning}
                      modelId={activeTab.selectedModel?.model_id}
                      hideGameButton
                    />
                  )}
                </div>
                {/* History Panel - horizontal strip at bottom */}
                {activeTab.generationHistory.length >= 1 && (
                  <HistoryPanel
                    history={activeTab.generationHistory}
                    selectedIndex={activeTab.selectedHistoryIndex}
                    onSelect={selectHistoryItem}
                    direction="horizontal"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground p-4">
          <p className="text-center">{t('playground.noTabs')}</p>
        </div>
      )}

      {/* Save Template Dialog */}
      <Dialog open={showSaveTemplateDialog} onOpenChange={setShowSaveTemplateDialog}>
        <DialogContent className="max-w-[90vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('playground.saveTemplate')}</DialogTitle>
            <DialogDescription>
              {t('playground.saveTemplateDesc', { model: activeTab?.selectedModel?.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="templateName">{t('playground.templateName')}</Label>
              <Input
                id="templateName"
                className="mobile-input"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder={t('templates.templateNamePlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTemplateName.trim()) {
                    handleSaveTemplate()
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                setNewTemplateName('')
                setShowSaveTemplateDialog(false)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={handleSaveTemplate}
              disabled={!newTemplateName.trim()}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
