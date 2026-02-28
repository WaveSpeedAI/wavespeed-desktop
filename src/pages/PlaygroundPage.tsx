import { useState, useEffect, useCallback, useRef, useMemo, Fragment, useTransition } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePlaygroundStore, persistPlaygroundSession, hydratePlaygroundSession } from '@/stores/playgroundStore'
import { useModelsStore } from '@/stores/modelsStore'
import { useApiKeyStore } from '@/stores/apiKeyStore'
import { useTemplateStore } from '@/stores/templateStore'
import { apiClient } from '@/api/client'
import { DynamicForm } from '@/components/playground/DynamicForm'
import { ModelSelector } from '@/components/playground/ModelSelector'
import { BatchControls } from '@/components/playground/BatchControls'
import { HistoryDrawer } from '@/components/playground/HistoryDrawer'
import { ExplorePanel } from '@/components/playground/ExplorePanel'
import { ResultPanel } from '@/components/playground/ResultPanel'
import { TemplatesPanel } from '@/components/playground/TemplatesPanel'
import { FeaturedModelsPanel } from '@/components/playground/FeaturedModelsPanel'
import { Button } from '@/components/ui/button'
import { RotateCcw, Loader2, Plus, X, Save, Sparkles, Search, LayoutGrid, FolderOpen, Star, Globe, FileText, ChevronDown, Layers } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/useToast'
import { TemplateDialog, type TemplateFormData } from '@/components/templates/TemplateDialog'

type RightPanelTab = 'result' | 'models' | 'featured' | 'templates'

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

  // Right panel tab state
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('result')
  const [, startTransition] = useTransition()
  const switchTab = useCallback((tab: RightPanelTab) => {
    startTransition(() => setRightPanelTab(tab))
  }, [])

  // Top search bar state — local for instant input, debounced for filtering
  const [topSearchInput, setTopSearchInput] = useState('')
  const [topSearch, setTopSearch] = useState('')
  const topSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleTopSearchChange = useCallback((value: string) => {
    setTopSearchInput(value)
    if (topSearchTimerRef.current) clearTimeout(topSearchTimerRef.current)
    topSearchTimerRef.current = setTimeout(() => setTopSearch(value), 250)
  }, [])
  const handleTopSearchClear = useCallback(() => {
    setTopSearchInput('')
    setTopSearch('')
    if (topSearchTimerRef.current) clearTimeout(topSearchTimerRef.current)
  }, [])

  // Search scope dropdown state — independent from tab selection
  const [searchScope, setSearchScope] = useState<'models' | 'templates'>('models')
  const [searchScopeOpen, setSearchScopeOpen] = useState(false)
  const handleSearchScopeChange = (scope: 'models' | 'templates') => {
    setSearchScopeOpen(false)
    setSearchScope(scope)
    // Also switch to the corresponding tab
    if (scope === 'models') switchTab('models')
    else switchTab('templates')
  }

  // Tab scroll ref
  const tabScrollRef = useRef<HTMLDivElement>(null)

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

  // Explore: select a model from the all-models list → load in current tab
  const handleExploreSelectModel = useCallback((modelId: string) => {
    const model = models.find(m => m.model_id === modelId)
    if (model) {
      setSelectedModel(model)
      navigate(`/playground/${modelId}`)
      switchTab('result')
    }
  }, [models, setSelectedModel, navigate, switchTab])

  // Explore: select a featured model → open in new tab
  const handleExploreSelectFeatured = useCallback((primaryVariant: string) => {
    const model = models.find(m => m.model_id === primaryVariant)
    if (model) {
      createTab(model)
      navigate(`/playground/${primaryVariant}`)
      switchTab('result')
      requestAnimationFrame(() => {
        if (tabScrollRef.current) {
          tabScrollRef.current.scrollLeft = tabScrollRef.current.scrollWidth
        }
      })
    }
  }, [models, createTab, navigate, switchTab])

  // Templates panel: use a template
  const handleUseTemplateFromPanel = useCallback((template: import('@/types/template').Template) => {
    if (template.playgroundData) {
      if (template.playgroundData.modelId && activeTab?.selectedModel?.model_id !== template.playgroundData.modelId) {
        const model = models.find(m => m.model_id === template.playgroundData!.modelId)
        if (model) {
          setSelectedModel(model)
          navigate(`/playground/${template.playgroundData.modelId}`)
        }
      }
      setFormValues(template.playgroundData.values)
      toast({
        title: t('playground.templateLoaded'),
        description: t('playground.loadedTemplate', { name: template.name }),
      })
      switchTab('result')
    }
  }, [activeTab, models, setSelectedModel, setFormValues, navigate, t, switchTab])

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

  // Show loading state while API key is being loaded from storage
  // Also show loading when models are loading (needed for model selector)
  if (isLoadingApiKey || !hasAttemptedLoad || (isValidated && models.length === 0)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isMac = /mac/i.test(navigator.platform)

  return (
    <div className="flex h-full flex-col md:pt-0">
      {/* Titlebar WebPage & Docs buttons — fixed in titlebar area */}
      {activeTab?.selectedModel && (
        <div className={cn(
          'fixed top-0 z-[100] flex items-center h-8 electron-no-drag',
          isMac ? 'right-3 gap-1' : 'right-[140px]'
        )}>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <a
                href={`https://wavespeed.ai/models/${activeTab.selectedModel.model_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-center justify-center h-8 text-muted-foreground hover:text-foreground transition-colors',
                  isMac ? 'w-8 rounded-md hover:bg-muted/50' : 'w-[46px] hover:bg-[rgba(255,255,255,0.1)]'
                )}
              >
                <Globe className="h-4 w-4" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('playground.webPage', 'WebPage')}</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <a
                href={`https://docs.wavespeed.ai/models/${activeTab.selectedModel.model_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-center justify-center h-8 text-muted-foreground hover:text-foreground transition-colors',
                  isMac ? 'w-8 rounded-md hover:bg-muted/50' : 'w-[46px] hover:bg-[rgba(255,255,255,0.1)]'
                )}
              >
                <FileText className="h-4 w-4" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('playground.docs', 'Docs')}</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Tab Bar */}
      <div className="bg-background/80 border-b border-border">
        <div className="flex items-center h-11 px-2">
          <div ref={tabScrollRef} className="flex-1 min-w-0 overflow-x-auto hide-scrollbar">
            <div className="flex items-center gap-1 h-full py-1.5 w-max">
              {tabs.map((tab, index) => (
                <Fragment key={tab.id}>
                <button
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
                    'group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer select-none shrink-0',
                    tab.id === activeTabId
                      ? 'bg-primary/15 text-primary font-semibold border border-primary/30'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    dragTabIndex === index && 'opacity-40',
                    dropTargetIndex === index && 'ring-1 ring-primary/50'
                  )}
                >
                  {tab.isRunning ? (
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  ) : (
                    <Sparkles className="h-3 w-3 shrink-0" />
                  )}
                  <span className="max-w-[140px] truncate">
                    {tab.selectedModel?.name || t('playground.tabs.newTab')}
                  </span>
                  <span
                    onClick={(e) => handleCloseTab(e, tab.id)}
                    className={cn(
                      'ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted',
                      'group-hover:opacity-100',
                      tab.id === activeTabId && 'opacity-60'
                    )}
                  >
                    <X className="h-2.5 w-2.5" />
                  </span>
                </button>
                </Fragment>
              ))}
              <button
                onClick={handleNewTab}
                className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
                title={t('playground.tabs.newTab', 'New tab')}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
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

          <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
            {/* Left Panel - Configuration */}
            <div className={cn(
              "w-full md:w-[430px] md:max-w-[430px] md:flex-none flex flex-col min-h-0 border-b bg-card/70 md:overflow-hidden md:border-r md:border-b-0",
              // Mobile: show/hide based on mobileView, full height on mobile
              mobileView === 'config' ? "flex flex-1" : "hidden md:flex"
            )}>
            {/* Model Header */}
            <div className="border-b bg-background/60 px-4 py-3">
              {activeTab.selectedModel ? (
                <div className="space-y-2.5">
                  {/* Model name */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary shrink-0" />
                      <h2 className="text-base font-bold text-foreground truncate">{activeTab.selectedModel.name}</h2>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 pl-6">
                      {activeTab.selectedModel.type || activeTab.selectedModel.model_id}
                    </p>
                  </div>
                  {/* Model selector — full width */}
                  <ModelSelector
                    models={models}
                    value={activeTab.selectedModel?.model_id}
                    onChange={handleModelChange}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    <label className="block text-sm font-semibold text-foreground">{t('history.model')}</label>
                  </div>
                  <ModelSelector
                    models={models}
                    value={undefined}
                    onChange={handleModelChange}
                  />
                </div>
              )}
            </div>

            {/* Parameters */}
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

            {/* Bottom: Run + actions on same row */}
            <div className="border-t bg-background/80 px-4 py-3">
              <div className="flex items-center gap-2">
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
                            ? calculatedPrice.toFixed(4)
                            : activeTab.selectedModel.base_price != null
                              ? activeTab.selectedModel.base_price.toFixed(4)
                              : undefined
                        : undefined
                    }
                  />
                </div>
                <button
                  onClick={handleReset}
                  disabled={activeTab.isRunning}
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
                  title={t('playground.resetForm')}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setShowSaveTemplateDialog(true)}
                  disabled={!activeTab.selectedModel}
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
                  title={t('playground.saveAsTemplate')}
                >
                  <Save className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

                    {/* Right Panel */}
          <div className={cn(
            "flex-1 flex flex-col min-w-0 overflow-hidden",
            mobileView === 'output' ? "flex" : "hidden md:flex"
          )}>
            {/* Top bar: Scope dropdown + Search */}
            <div className="px-4 pt-6 pb-4">
              <div className="flex items-center gap-0">
                <div className="relative">
                  <button
                    onClick={() => setSearchScopeOpen(!searchScopeOpen)}
                    className="flex items-center gap-1.5 h-[38px] px-3 min-w-[150px] rounded-l-full border border-r-0 border-border bg-accent/60 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1">{searchScope === 'models' ? t('playground.rightPanel.models', 'Models') : t('playground.rightPanel.templates', 'Templates')}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {searchScopeOpen && (
                    <div className="absolute top-full left-0 mt-1 w-40 rounded-lg border border-border bg-popover shadow-lg z-50 py-1">
                      <button
                        onClick={() => handleSearchScopeChange('models')}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm transition-colors',
                          searchScope === 'models' ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted'
                        )}
                      >
                        {t('playground.rightPanel.models', 'Models')}
                      </button>
                      <button
                        onClick={() => handleSearchScopeChange('templates')}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm transition-colors',
                          searchScope === 'templates' ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted'
                        )}
                      >
                        {t('playground.rightPanel.templates', 'Templates')}
                      </button>
                    </div>
                  )}
                </div>
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={topSearchInput}
                    onChange={(e) => handleTopSearchChange(e.target.value)}
                    placeholder={t('playground.explore.searchPlaceholder', 'Search models, LoRAs, and styles...')}
                    className="w-full h-[38px] pl-4 pr-9 rounded-r-full border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                  />
                  {topSearchInput && (
                    <button onClick={handleTopSearchClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Sub-tabs + Web/Docs links */}
            <div className="flex items-center pl-8 pr-4 border-b border-border">
              <div className="flex items-center gap-6 flex-1">
                {([
                  { key: 'result' as const, icon: <LayoutGrid className="h-4 w-4" />, label: t('playground.rightPanel.result', 'Result') },
                  { key: 'models' as const, icon: <Layers className="h-4 w-4" />, label: t('playground.rightPanel.models', 'Models') },
                  { key: 'featured' as const, icon: <Star className="h-4 w-4" />, label: t('playground.rightPanel.featuredModels', 'Featured Models') },
                  { key: 'templates' as const, icon: <FolderOpen className="h-4 w-4" />, label: t('playground.rightPanel.templates', 'Templates') },
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => { switchTab(tab.key) }}
                    className={cn(
                      'relative flex items-center gap-2 pb-2.5 pt-1 text-sm font-medium transition-colors',
                      rightPanelTab === tab.key
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {tab.icon}
                    {tab.label}
                    {rightPanelTab === tab.key && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Right Panel Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Keep panels mounted but hidden to avoid expensive remounts */}
              <div className={cn('flex-1 overflow-hidden flex flex-col', rightPanelTab !== 'models' && 'hidden')}>
                <ExplorePanel
                  onSelectModel={handleExploreSelectModel}
                  externalSearch={topSearch}
                />
              </div>
              <div className={cn('flex-1 overflow-hidden flex flex-col', rightPanelTab !== 'featured' && 'hidden')}>
                <FeaturedModelsPanel
                  onSelectFeatured={handleExploreSelectFeatured}
                  models={models}
                />
              </div>
              <div className={cn('flex-1 overflow-hidden flex flex-col', rightPanelTab !== 'result' && 'hidden')}>
                <ResultPanel
                  prediction={displayedPrediction}
                  outputs={displayedOutputs}
                  error={activeTab.error}
                  isLoading={activeTab.isRunning}
                  modelId={activeTab.selectedModel?.model_id}
                  batchResults={activeTab.batchResults}
                  batchIsRunning={activeTab.batchState?.isRunning}
                  batchTotalCount={activeTab.batchState?.queue.length}
                  batchQueue={activeTab.batchState?.queue}
                  onClearBatch={clearBatchResults}
                  batchPreviewInputs={batchPreviewInputs}
                  historyIndex={historyIndex}
                />
                <HistoryDrawer
                  history={activeTab.generationHistory}
                  selectedIndex={activeTab.selectedHistoryIndex}
                  onSelect={selectHistoryItem}
                />
              </div>
              <div className={cn('flex-1 overflow-hidden flex flex-col', rightPanelTab !== 'templates' && 'hidden')}>
                <TemplatesPanel onUseTemplate={handleUseTemplateFromPanel} externalSearch={topSearch} />
              </div>
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

    </div>
  )
}
