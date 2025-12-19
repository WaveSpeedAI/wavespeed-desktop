import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePlaygroundStore } from '@/stores/playgroundStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { useTemplateStore } from '@/stores/templateStore'
import { apiClient } from '@/api/client'
import { DynamicForm } from '@/components/playground/DynamicForm'
import { OutputDisplay } from '@/components/playground/OutputDisplay'
import { ModelSelector } from '@/components/playground/ModelSelector'
import { BatchControls } from '@/components/playground/BatchControls'
import { BatchOutputGrid } from '@/components/playground/BatchOutputGrid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { RotateCcw, Loader2, Plus, X, BookOpen, Save, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/useToast'

export function PlaygroundPage() {
  const { t } = useTranslation()
  const params = useParams()
  // Support both old format (playground/:modelId) and new format (playground/*)
  const modelId = params['*'] || params.modelId
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { models, fetchModels } = useModelsStore()
  const { isLoading: isLoadingApiKey, isValidated, loadApiKey, apiKey, hasAttemptedLoad } = useApiKeyStore()
  const {
    tabs,
    activeTabId,
    createTab,
    closeTab,
    setActiveTab,
    getActiveTab,
    setSelectedModel,
    setFormValue,
    setFormValues,
    setFormFields,
    resetForm,
    runPrediction,
    runBatch,
    clearBatchResults,
    generateBatchInputs,
    setUploading,
  } = usePlaygroundStore()
  const { templates, loadTemplates, saveTemplate, isLoaded: templatesLoaded } = useTemplateStore()

  const activeTab = getActiveTab()
  const templateLoadedRef = useRef<string | null>(null)
  const initialTabCreatedRef = useRef(false)

  // Template dialog states
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')

  // Generate batch preview inputs
  const batchPreviewInputs = useMemo(() => {
    if (!activeTab) return []
    const { batchConfig } = activeTab
    if (!batchConfig.enabled || batchConfig.repeatCount <= 1) return []
    return generateBatchInputs()
  }, [activeTab, generateBatchInputs])

  // Dynamic pricing state
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null)
  const [isPricingLoading, setIsPricingLoading] = useState(false)
  const pricingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Load templates on mount
  useEffect(() => {
    if (!templatesLoaded) {
      loadTemplates()
    }
  }, [templatesLoaded, loadTemplates])

  // Load API key and fetch models on mount
  useEffect(() => {
    loadApiKey()
  }, [loadApiKey])

  useEffect(() => {
    if (isValidated) {
      fetchModels()
    }
  }, [isValidated, fetchModels])

  // Calculate dynamic pricing with debounce
  useEffect(() => {
    if (!activeTab?.selectedModel || !apiKey) {
      setCalculatedPrice(null)
      return
    }

    // Clear previous timeout
    if (pricingTimeoutRef.current) {
      clearTimeout(pricingTimeoutRef.current)
    }

    // Debounce pricing calculation
    pricingTimeoutRef.current = setTimeout(async () => {
      setIsPricingLoading(true)
      try {
        const price = await apiClient.calculatePricing(
          activeTab.selectedModel!.model_id,
          activeTab.formValues
        )
        setCalculatedPrice(price)
      } catch {
        // Fall back to base price on error
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
        setFormValues(template.values)
        templateLoadedRef.current = templateId
        toast({
          title: t('playground.templateLoaded'),
          description: t('playground.loadedTemplate', { name: template.name }),
        })
        // Clear the query param after loading
        setSearchParams({}, { replace: true })
      }
    }
  }, [searchParams, templates, templatesLoaded, activeTab, setFormValues, setSearchParams])

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

  // Create tab when navigating to playground (only on initial load)
  useEffect(() => {
    if (models.length > 0 && tabs.length === 0 && !initialTabCreatedRef.current) {
      initialTabCreatedRef.current = true
      if (modelId) {
        // Try to decode, but use original if decoding fails (for paths with slashes)
        let decodedId = modelId
        try {
          decodedId = decodeURIComponent(modelId)
        } catch {
          // Use original modelId if decoding fails
        }
        const model = models.find(m => m.model_id === decodedId)
        createTab(model)
      } else {
        // Without modelId: create empty tab
        createTab()
      }
    }
  }, [modelId, models, tabs.length, createTab])

  // Set model from URL param when navigating
  useEffect(() => {
    if (modelId && models.length > 0 && activeTab) {
      // Try to decode, but use original if decoding fails (for paths with slashes)
      let decodedId = modelId
      try {
        decodedId = decodeURIComponent(modelId)
      } catch {
        // Use original modelId if decoding fails
      }
      const model = models.find(m => m.model_id === decodedId)
      if (model && activeTab.selectedModel?.model_id !== decodedId) {
        setSelectedModel(model)
      }
    }
  }, [modelId, models, activeTab, setSelectedModel])

  const handleModelChange = (modelId: string) => {
    const model = models.find(m => m.model_id === modelId)
    if (model) {
      setSelectedModel(model)
      // Use modelId directly in path (supports slashes in model IDs like wavespeed-ai/z-image/turbo)
      navigate(`/playground/${modelId}`)
    }
  }

  const handleSetDefaults = useCallback((defaults: Record<string, unknown>) => {
    setFormValues(defaults)
  }, [setFormValues])

  const handleRun = async () => {
    if (!activeTab) return

    const { batchConfig } = activeTab
    if (batchConfig.enabled && batchConfig.repeatCount > 1) {
      await runBatch()
    } else {
      await runPrediction()
    }
  }

  const handleReset = () => {
    resetForm()
    clearBatchResults()
  }

  const handleNewTab = () => {
    createTab()
    navigate('/playground')
  }

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    closeTab(tabId)
  }

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId)
    const tab = tabs.find(t => t.id === tabId)
    if (tab?.selectedModel) {
      navigate(`/playground/${encodeURIComponent(tab.selectedModel.model_id)}`)
    } else {
      navigate('/playground')
    }
  }

  const handleViewDocs = () => {
    if (activeTab?.selectedModel) {
      // Transform model_id to docs URL format
      // wavespeed-ai models: "wavespeed-ai/z-image/turbo" -> "wavespeed-ai/z-image-turbo"
      // other models: "kwaivgi/kling-v2.6-pro/image-to-video" -> "kwaivgi/kwaivgi-kling-v2.6-pro-image-to-video"
      const modelId = activeTab.selectedModel.model_id
      const parts = modelId.split('/')
      let formattedId: string
      if (parts.length > 1) {
        const org = parts[0]
        const rest = parts.slice(1).join('-')
        if (org === 'wavespeed-ai') {
          formattedId = `${org}/${rest}`
        } else {
          // Non-wavespeed-ai models: prefix rest with org name
          formattedId = `${org}/${org}-${rest}`
        }
      } else {
        formattedId = modelId
      }
      const docsUrl = `https://wavespeed.ai/docs/docs-api/${formattedId}`
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(docsUrl)
      } else {
        window.open(docsUrl, '_blank')
      }
    }
  }

  const handleViewWebPage = () => {
    if (activeTab?.selectedModel) {
      // Model webpage URL uses the model_id directly
      const webUrl = `https://wavespeed.ai/models/${activeTab.selectedModel.model_id}`
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(webUrl)
      } else {
        window.open(webUrl, '_blank')
      }
    }
  }

  // Show loading state while API key is being loaded from storage
  // Also show loading when models are loading (needed for model selector)
  if (isLoadingApiKey || !hasAttemptedLoad || (isValidated && models.length === 0)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab Bar */}
      <div className="page-header">
        <ScrollArea className="w-full">
          <div className="flex items-center">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                role="tab"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleTabClick(tab.id)}
                className={cn(
                  'group relative flex items-center gap-2 border-r px-4 py-2 text-sm transition-colors cursor-pointer',
                  'hover:bg-muted/50',
                  tab.id === activeTabId
                    ? 'bg-background border-b-2 border-b-primary'
                    : 'text-muted-foreground'
                )}
              >
                {tab.isRunning && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <span className="max-w-[150px] truncate">
                      {tab.selectedModel?.name || t('playground.tabs.newTab')}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {tab.selectedModel?.name || t('playground.tabs.newTab')}
                  </TooltipContent>
                </Tooltip>
                <button
                  onClick={(e) => handleCloseTab(e, tab.id)}
                  className={cn(
                    'ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted',
                    'group-hover:opacity-100',
                    tab.id === activeTabId && 'opacity-100'
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNewTab}
              className="h-8 px-3"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* Playground Content */}
      {activeTab ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel - Configuration */}
          <div className="w-[420px] flex flex-col border-r bg-muted/30">
            {/* Model Selector */}
            <div className="p-4 border-b">
              <label className="text-sm font-semibold mb-2 block text-foreground">{t('history.model')}</label>
              <ModelSelector
                models={models}
                value={activeTab.selectedModel?.model_id}
                onChange={handleModelChange}
                disabled={activeTab.isRunning}
              />
            </div>

            {/* Parameters */}
            <div className="flex-1 overflow-hidden px-4 py-2">
              {activeTab.selectedModel ? (
                <DynamicForm
                  model={activeTab.selectedModel}
                  values={activeTab.formValues}
                  validationErrors={activeTab.validationErrors}
                  onChange={setFormValue}
                  onSetDefaults={handleSetDefaults}
                  onFieldsChange={setFormFields}
                  disabled={activeTab.isRunning}
                  onUploadingChange={setUploading}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <p>{t('playground.selectModelPrompt')}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-4 border-t bg-muted/30">
              <div className="flex gap-2">
                <div className="flex-1">
                  <BatchControls
                    disabled={!activeTab.selectedModel}
                    isRunning={activeTab.isRunning}
                    isUploading={activeTab.uploadingCount > 0}
                    onRun={handleRun}
                    runLabel={t('playground.run')}
                    runningLabel={
                      activeTab.batchState?.isRunning
                        ? `${t('playground.running')} (${activeTab.batchState.queue.length})`
                        : t('playground.running')
                    }
                    price={
                      activeTab.selectedModel
                        ? isPricingLoading
                          ? '...'
                          : calculatedPrice != null
                            ? `$${calculatedPrice.toFixed(4)}`
                            : activeTab.selectedModel.base_price != null
                              ? `$${activeTab.selectedModel.base_price.toFixed(4)}`
                              : undefined
                        : undefined
                    }
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={activeTab.isRunning}
                  title={t('playground.resetForm')}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowSaveTemplateDialog(true)}
                  disabled={!activeTab.selectedModel || activeTab.isRunning}
                  title={t('playground.saveAsTemplate')}
                >
                  <Save className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Right Panel - Output */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-lg">{t('playground.output')}</h2>
                {activeTab.selectedModel && (
                  <span className="text-sm text-muted-foreground">· {activeTab.selectedModel.name}</span>
                )}
              </div>
              {activeTab.selectedModel && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleViewWebPage}
                  >
                    <Globe className="mr-2 h-4 w-4" />
                    {t('playground.webPage')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleViewDocs}
                  >
                    <BookOpen className="mr-2 h-4 w-4" />
                    {t('playground.docs')}
                  </Button>
                </div>
              )}
            </div>
            <div className="flex-1 p-5 overflow-hidden">
              {/* Batch Results - shown while running or when completed */}
              {(activeTab.batchState?.isRunning || activeTab.batchResults.length > 0) ? (
                <BatchOutputGrid
                  results={activeTab.batchResults}
                  modelId={activeTab.selectedModel?.model_id}
                  modelName={activeTab.selectedModel?.name}
                  onClear={clearBatchResults}
                  isRunning={activeTab.batchState?.isRunning}
                  totalCount={activeTab.batchState?.queue.length}
                  queue={activeTab.batchState?.queue}
                />
              ) : /* Batch Preview - shown when batch mode is active but not yet run */
              batchPreviewInputs.length > 0 ? (
                <BatchOutputGrid
                  results={[]}
                  modelId={activeTab.selectedModel?.model_id}
                  modelName={activeTab.selectedModel?.name}
                  onClear={() => {}}
                  isRunning={false}
                  totalCount={batchPreviewInputs.length}
                  queue={batchPreviewInputs.map((input, index) => ({
                    id: `preview-${index}`,
                    index,
                    input,
                    status: 'pending' as const
                  }))}
                />
              ) : (
                /* Single output display - default */
                <OutputDisplay
                  key={activeTabId}
                  prediction={activeTab.currentPrediction}
                  outputs={activeTab.outputs}
                  error={activeTab.error}
                  isLoading={activeTab.isRunning}
                  modelId={activeTab.selectedModel?.model_id}
                  modelName={activeTab.selectedModel?.name}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="mb-4">{t('playground.noTabs')}</p>
            <Button onClick={handleNewTab}>
              <Plus className="mr-2 h-4 w-4" />
              {t('playground.tabs.newTab')}
            </Button>
          </div>
        </div>
      )}

      {/* Save Template Dialog */}
      <Dialog open={showSaveTemplateDialog} onOpenChange={setShowSaveTemplateDialog}>
        <DialogContent className="max-w-sm">
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
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNewTemplateName('')
                setShowSaveTemplateDialog(false)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
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
