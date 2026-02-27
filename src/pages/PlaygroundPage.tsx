import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePlaygroundStore, persistPlaygroundSession, hydratePlaygroundSession } from '@/stores/playgroundStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { useTemplateStore } from '@/stores/templateStore'
import { apiClient } from '@/api/client'
import { DynamicForm } from '@/components/playground/DynamicForm'
import { OutputDisplay } from '@/components/playground/OutputDisplay'
import { ModelSelector } from '@/components/playground/ModelSelector'
import { BatchControls } from '@/components/playground/BatchControls'
import { BatchOutputGrid } from '@/components/playground/BatchOutputGrid'
import { HistoryPanel } from '@/components/playground/HistoryPanel'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { RotateCcw, Loader2, Plus, X, BookOpen, Save, Globe, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/useToast'
import { TemplateDialog, type TemplateFormData } from '@/components/templates/TemplateDialog'
import { TemplatePickerDialog } from '@/components/templates/TemplatePickerDialog'

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
    reorderTab,
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
    selectHistoryItem,
  } = usePlaygroundStore()
  const { templates, loadTemplates, createTemplate, migrateFromLocalStorage } = useTemplateStore()

  const activeTab = getActiveTab()

  // History-aware output display
  const historyIndex = activeTab?.selectedHistoryIndex ?? null
  const historyItem = historyIndex !== null ? activeTab?.generationHistory[historyIndex] : null
  const displayedPrediction = historyItem ? historyItem.prediction : (activeTab?.currentPrediction ?? null)
  const displayedOutputs = historyItem ? historyItem.outputs : (activeTab?.outputs ?? [])

  const templateLoadedRef = useRef<string | null>(null)
  const initialTabCreatedRef = useRef(false)

  // Mobile view state: 'config' or 'output'
  const [mobileView, setMobileView] = useState<'config' | 'output'>('config')

  // Tab overflow detection (Chrome-like + button behavior)
  const tabScrollRef = useRef<HTMLDivElement>(null)
  const [tabsOverflow, setTabsOverflow] = useState(false)

  useEffect(() => {
    const el = tabScrollRef.current
    if (!el) return
    const check = () => setTabsOverflow(el.scrollWidth > el.clientWidth)
    const ro = new ResizeObserver(check)
    ro.observe(el)
    check()
    return () => ro.disconnect()
  }, [tabs.length])

  // Tab drag-and-drop state (desktop only)
  const [dragTabIndex, setDragTabIndex] = useState<number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragTabIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, e.currentTarget.offsetWidth / 2, e.currentTarget.offsetHeight / 2)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragTabIndex !== null && index !== dragTabIndex) {
      setDropTargetIndex(index)
    }
  }, [dragTabIndex])

  const handleDragEnd = useCallback(() => {
    if (dragTabIndex !== null && dropTargetIndex !== null && dragTabIndex !== dropTargetIndex) {
      reorderTab(dragTabIndex, dropTargetIndex)
    }
    setDragTabIndex(null)
    setDropTargetIndex(null)
  }, [dragTabIndex, dropTargetIndex, reorderTab])

  const handleDragLeave = useCallback(() => {
    setDropTargetIndex(null)
  }, [])

  // Template dialog states
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false)

  // Generate batch preview inputs
  const batchPreviewInputs = useMemo(() => {
    if (!activeTab) return []
    const { batchConfig } = activeTab
    if (!batchConfig.enabled) return []
    return generateBatchInputs()
  }, [activeTab, generateBatchInputs])

  // Dynamic pricing state
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null)
  const [isPricingLoading, setIsPricingLoading] = useState(false)
  const pricingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Migrate templates and load on mount
  useEffect(() => {
    const init = async () => {
      await migrateFromLocalStorage()
      await loadTemplates({ templateType: 'playground' })
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Hydrate playground session from Electron persistent storage on first mount
  useEffect(() => {
    hydratePlaygroundSession()
  }, [])

  // Persist playground tabs (debounced) so they restore on next visit
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const unsub = usePlaygroundStore.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(persistPlaygroundSession, 300)
    })
    return () => {
      clearTimeout(timer)
      unsub()
    }
  }, [])

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
    if (templateId && templates.length > 0 && activeTab && templateLoadedRef.current !== templateId) {
      const template = templates.find(t => t.id === templateId)
      if (template && template.playgroundData) {
        setFormValues(template.playgroundData.values)
        templateLoadedRef.current = templateId
        toast({
          title: t('playground.templateLoaded'),
          description: t('playground.loadedTemplate', { name: template.name }),
        })
        // Clear the query param after loading
        setSearchParams({}, { replace: true })
      }
    }
  }, [searchParams, templates, activeTab, setFormValues, setSearchParams, t])

  const handleSaveTemplate = async (data: TemplateFormData) => {
    if (!activeTab?.selectedModel) return

    await createTemplate({
      name: data.name,
      description: data.description || null,
      tags: data.tags,
      thumbnail: data.thumbnail || null,
      type: 'custom',
      templateType: 'playground',
      playgroundData: {
        modelId: activeTab.selectedModel.model_id,
        modelName: activeTab.selectedModel.name,
        values: activeTab.formValues
      }
    })
    toast({
      title: t('playground.templateSaved'),
      description: t('playground.savedAs', { name: data.name }),
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

  // Set model from URL only when the active tab has no model (e.g. initial load or new empty tab).
  // Do NOT overwrite when the tab already has a model, so tab switching never wipes form values
  // (otherwise URL can lag and we'd set the wrong model on the newly active tab and reset its form).
  useEffect(() => {
    if (!modelId || models.length === 0 || !activeTab || activeTab.selectedModel != null) return
    let decodedId = modelId
    try {
      decodedId = decodeURIComponent(modelId)
    } catch {
      // Use original modelId if decoding fails
    }
    const model = models.find(m => m.model_id === decodedId)
    if (model) setSelectedModel(model)
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

    // Switch to output view on mobile when running
    setMobileView('output')

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
    const currentModel = activeTab?.selectedModel
    createTab(currentModel || undefined)
    if (currentModel) {
      navigate(`/playground/${currentModel.model_id}`)
    } else {
      navigate('/playground')
    }
    // Auto-scroll to show the newly created tab
    requestAnimationFrame(() => {
      if (tabScrollRef.current) {
        tabScrollRef.current.scrollLeft = tabScrollRef.current.scrollWidth
      }
    })
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

  const handleLoadTemplate = () => {
    setShowTemplateDialog(true)
  }

  // Template dialog state
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)

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
    <div className="flex h-full flex-col md:pt-0">
      {/* Tab Bar */}
      <div className="backdrop-blur supports-[backdrop-filter]:bg-transparent">
        <div className="flex items-center h-12 border-b border-border">
          <div ref={tabScrollRef} className="flex-1 min-w-0 overflow-x-auto hide-scrollbar">
            <div className="flex items-center px-2 w-max">
              {/* Templates button */}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleLoadTemplate}
                    className={cn(
                      'h-7 w-7 rounded-md text-xs font-medium transition-colors flex items-center justify-center mr-1 shrink-0',
                      showTemplateDialog
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    )}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/><path d="M13 13h4"/><path d="M13 17h4"/>
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('templates.title', 'Templates')}</TooltipContent>
              </Tooltip>
              <div className="w-px h-5 bg-border mr-1 shrink-0" />
              {tabs.map((tab, index) => (
                <Fragment key={tab.id}>
                  {index > 0 && <div className="w-px h-4 bg-border/70 shrink-0 mx-0.5" />}
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  onDragLeave={handleDragLeave}
                  onClick={() => handleTabClick(tab.id)}
                  role="tab"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleTabClick(tab.id)}
                  className={cn(
                    'group relative flex h-8 items-center gap-2 px-3 text-xs transition-all cursor-pointer select-none shrink-0',
                    'first:rounded-l-md last:rounded-r-md',
                    'hover:bg-primary/10 dark:hover:bg-muted/60',
                    tab.id === activeTabId
                      ? 'bg-primary/15 dark:bg-primary/10 text-foreground font-medium'
                      : 'bg-primary/[0.06] dark:bg-muted/20 text-muted-foreground',
                    dragTabIndex === index && 'opacity-40',
                    dropTargetIndex === index && 'border-primary ring-1 ring-primary/50'
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
                </Fragment>
              ))}
              {/* + button inside scroll area: visible when tabs don't overflow */}
              {!tabsOverflow && (
                <button
                  onClick={handleNewTab}
                  className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 mx-1"
                  title={t('playground.tabs.newTab', 'New tab')}
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          {/* + button fixed outside: visible only when tabs overflow */}
          {tabsOverflow && (
            <button
              onClick={handleNewTab}
              className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 mx-1"
              title={t('playground.tabs.newTab', 'New tab')}
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Playground Content */}
      {activeTab ? (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Mobile Tab Switcher */}
          <div className="md:hidden flex border-b bg-background/80 backdrop-blur">
            <button
              onClick={() => setMobileView('config')}
              className={cn(
                "flex-1 py-3 text-sm font-medium transition-colors",
                mobileView === 'config'
                  ? "text-primary border-b-2 border-primary bg-background"
                  : "text-muted-foreground"
              )}
            >
              Input
            </button>
            <button
              onClick={() => setMobileView('output')}
              className={cn(
                "flex-1 py-3 text-sm font-medium transition-colors",
                mobileView === 'output'
                  ? "text-primary border-b-2 border-primary bg-background"
                  : "text-muted-foreground"
              )}
            >
              Output
            </button>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden md:flex-row md:gap-3 md:p-3">
            {/* Left Panel - Configuration */}
            <div className={cn(
              "w-full md:w-[430px] md:max-w-[430px] md:flex-none flex flex-col min-h-0 border-b bg-card/70 md:overflow-hidden md:rounded-xl md:border md:shadow-sm",
              // Mobile: show/hide based on mobileView, full height on mobile
              mobileView === 'config' ? "flex flex-1" : "hidden md:flex"
            )}>
            {/* Model Selector */}
            <div className="border-b bg-background/60 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <label className="block text-sm font-semibold text-foreground">{t('history.model')}</label>
              </div>
              <ModelSelector
                models={models}
                value={activeTab.selectedModel?.model_id}
                onChange={handleModelChange}
              />
            </div>

            {/* Parameters — min-h-0 + overflow-y-auto so this panel scrolls on mobile/short viewports */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              {activeTab.selectedModel ? (
                <DynamicForm
                  model={activeTab.selectedModel}
                  values={activeTab.formValues}
                  validationErrors={activeTab.validationErrors}
                  onChange={setFormValue}
                  onSetDefaults={handleSetDefaults}
                  collapsible
                  onFieldsChange={setFormFields}
                  onUploadingChange={setUploading}
                  scrollable={false}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <p>{t('playground.selectModelPrompt')}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t bg-background/80 p-4">
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
                  disabled={!activeTab.selectedModel}
                  title={t('playground.saveAsTemplate')}
                >
                  <Save className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Right Panel - Output */}
          <div className={cn(
            "flex-1 flex flex-col min-w-0 overflow-hidden md:rounded-xl md:border md:bg-card/75 md:shadow-sm",
            // Mobile: show/hide based on mobileView
            mobileView === 'output' ? "flex" : "hidden md:flex"
          )}>
            <div className="flex items-center justify-between border-b bg-background/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-lg">{t('playground.output')}</h2>
                {activeTab.currentPrediction?.timings?.inference != null && (
                  <span className="text-sm text-muted-foreground">
                    ({(activeTab.currentPrediction.timings.inference / 1000).toFixed(2)}s)
                  </span>
                )}
              </div>
              {activeTab.selectedModel && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleViewWebPage}
                    className="bg-background/80"
                  >
                    <Globe className="mr-2 h-4 w-4" />
                    {t('playground.webPage')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleViewDocs}
                    className="bg-background/80"
                  >
                    <BookOpen className="mr-2 h-4 w-4" />
                    {t('playground.docs')}
                  </Button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              <div className="flex-1 min-w-0 overflow-hidden p-5 md:p-6">
                {/* Batch Results - shown while running or when completed */}
                {(activeTab.batchState?.isRunning || activeTab.batchResults.length > 0) ? (
                  <BatchOutputGrid
                    results={activeTab.batchResults}
                    modelId={activeTab.selectedModel?.model_id}
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
                    prediction={displayedPrediction}
                    outputs={displayedOutputs}
                    error={activeTab.error}
                    isLoading={activeTab.isRunning}
                    modelId={activeTab.selectedModel?.model_id}
                  />
                )}
              </div>
              {/* History Panel - desktop: vertical sidebar, mobile: horizontal strip at bottom */}
              {activeTab.generationHistory.length >= 2 && (
                <>
                  {/* Desktop vertical sidebar */}
                  <div className="hidden md:block">
                    <HistoryPanel
                      history={activeTab.generationHistory}
                      selectedIndex={activeTab.selectedHistoryIndex}
                      onSelect={selectHistoryItem}
                      direction="vertical"
                    />
                  </div>
                  {/* Mobile horizontal strip */}
                  <div className="md:hidden">
                    <HistoryPanel
                      history={activeTab.generationHistory}
                      selectedIndex={activeTab.selectedHistoryIndex}
                      onSelect={selectHistoryItem}
                      direction="horizontal"
                    />
                  </div>
                </>
              )}
            </div>
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
      <TemplateDialog
        open={showSaveTemplateDialog}
        onOpenChange={setShowSaveTemplateDialog}
        mode="create"
        onSave={handleSaveTemplate}
      />

      {/* Template Picker Dialog */}
      <TemplatePickerDialog
        open={showTemplateDialog}
        onOpenChange={setShowTemplateDialog}
        templateType="playground"
        onUseTemplate={(template) => {
          if (template.playgroundData) {
            // Switch model if needed
            if (template.playgroundData.modelId && activeTab?.selectedModel?.model_id !== template.playgroundData.modelId) {
              const model = models.find(m => m.model_id === template.playgroundData!.modelId)
              if (model) {
                setSelectedModel(model)
                navigate(`/playground/${template.playgroundData.modelId}`)
              }
            }
            // Apply form values
            setFormValues(template.playgroundData.values)
            toast({
              title: t('playground.templateLoaded'),
              description: t('playground.loadedTemplate', { name: template.name }),
            })
          }
        }}
      />

    </div>
  )
}
