import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useTransition,
} from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  usePlaygroundStore,
  persistPlaygroundSession,
  hydratePlaygroundSession,
} from "@/stores/playgroundStore";
import { useModelsStore } from "@/stores/modelsStore";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import { useTemplateStore } from "@/stores/templateStore";
import { apiClient } from "@/api/client";
import { DynamicForm } from "@/components/playground/DynamicForm";
import { ModelSelector } from "@/components/playground/ModelSelector";
import { BatchControls } from "@/components/playground/BatchControls";
import { HistoryDrawer } from "@/components/playground/HistoryDrawer";
import { ExplorePanel } from "@/components/playground/ExplorePanel";
import { ResultPanel } from "@/components/playground/ResultPanel";
import { TemplatesPanel } from "@/components/playground/TemplatesPanel";
import { FeaturedModelsPanel } from "@/components/playground/FeaturedModelsPanel";
import {
  RotateCcw,
  Loader2,
  Plus,
  X,
  Save,
  Sparkles,
  LayoutGrid,
  FolderOpen,
  Star,
  Layers,
  ChevronDown,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import {
  TemplateDialog,
  type TemplateFormData,
} from "@/components/templates/TemplateDialog";

type RightPanelTab = "result" | "models" | "featured" | "templates";

const isCapacitorNative = () => {
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

export function PlaygroundPage() {
  const { t } = useTranslation();
  const params = useParams();
  // Support both old format (playground/:modelId) and new format (playground/*)
  const modelId = params["*"] || params.modelId;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { models, fetchModels } = useModelsStore();
  const {
    isLoading: isLoadingApiKey,
    isValidated,
    loadApiKey,
    apiKey,
    hasAttemptedLoad,
  } = useApiKeyStore();
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
    selectHistoryItem,
  } = usePlaygroundStore();
  const { templates, loadTemplates, createTemplate, migrateFromLocalStorage } =
    useTemplateStore();

  const activeTab = getActiveTab();

  // History-aware output display
  const historyIndex = activeTab?.selectedHistoryIndex ?? null;
  const historyItem =
    historyIndex !== null ? activeTab?.generationHistory[historyIndex] : null;
  const displayedPrediction = historyItem
    ? historyItem.prediction
    : (activeTab?.currentPrediction ?? null);
  const displayedOutputs = historyItem
    ? historyItem.outputs
    : (activeTab?.outputs ?? []);

  const templateLoadedRef = useRef<string | null>(null);
  const initialTabCreatedRef = useRef(false);

  // Mobile view state: 'config' or 'output'
  const [mobileView, setMobileView] = useState<"config" | "output">("config");

  // Right panel tab state
  const isMobile = isCapacitorNative();
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("models");
  const [, startTransition] = useTransition();
  const switchTab = useCallback((tab: RightPanelTab) => {
    startTransition(() => setRightPanelTab(tab));
  }, []);

  // When all tabs are closed and we're on the Result tab, switch to Featured/Models
  useEffect(() => {
    if (!activeTab && rightPanelTab === "result") {
      setRightPanelTab("models");
    }
  }, [activeTab, rightPanelTab, isMobile]);

  // Top search bar state — removed: search is now inline per tab

  // Workspace sessions dropdown state
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Close workspace dropdown on click outside
  useEffect(() => {
    if (!workspaceOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        workspaceRef.current &&
        !workspaceRef.current.contains(e.target as Node)
      ) {
        setWorkspaceOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [workspaceOpen]);

  // Template dialog states
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);

  // Generate batch preview inputs
  const batchPreviewInputs = useMemo(() => {
    if (!activeTab) return [];
    const { batchConfig } = activeTab;
    if (!batchConfig.enabled) return [];
    return generateBatchInputs();
  }, [activeTab, generateBatchInputs]);

  // Dynamic pricing state
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [isPricingLoading, setIsPricingLoading] = useState(false);
  const pricingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Migrate templates and load on mount
  useEffect(() => {
    const init = async () => {
      await migrateFromLocalStorage();
      await loadTemplates({ templateType: "playground" });
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Hydrate playground session from Electron persistent storage on first mount
  useEffect(() => {
    hydratePlaygroundSession();
  }, []);

  // Persist playground tabs (debounced) so they restore on next visit
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsub = usePlaygroundStore.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(persistPlaygroundSession, 300);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  // Load API key and fetch models on mount
  useEffect(() => {
    loadApiKey();
  }, [loadApiKey]);

  useEffect(() => {
    if (isValidated) {
      fetchModels();
    }
  }, [isValidated, fetchModels]);

  // Calculate dynamic pricing with debounce
  useEffect(() => {
    if (!activeTab?.selectedModel || !apiKey) {
      setCalculatedPrice(null);
      return;
    }

    // Clear previous timeout
    if (pricingTimeoutRef.current) {
      clearTimeout(pricingTimeoutRef.current);
    }

    // Debounce pricing calculation
    pricingTimeoutRef.current = setTimeout(async () => {
      setIsPricingLoading(true);
      try {
        const price = await apiClient.calculatePricing(
          activeTab.selectedModel!.model_id,
          activeTab.formValues,
        );
        setCalculatedPrice(price);
      } catch {
        // Fall back to base price on error
        setCalculatedPrice(null);
      } finally {
        setIsPricingLoading(false);
      }
    }, 500);

    return () => {
      if (pricingTimeoutRef.current) {
        clearTimeout(pricingTimeoutRef.current);
      }
    };
  }, [activeTab?.selectedModel, activeTab?.formValues, apiKey, tabs]);

  // Load template from URL query param
  useEffect(() => {
    const templateId = searchParams.get("template");
    if (
      templateId &&
      templates.length > 0 &&
      activeTab &&
      templateLoadedRef.current !== templateId
    ) {
      const template = templates.find((t) => t.id === templateId);
      if (template && template.playgroundData) {
        setFormValues(template.playgroundData.values);
        templateLoadedRef.current = templateId;
        toast({
          title: t("playground.templateLoaded"),
          description: t("playground.loadedTemplate", { name: template.name }),
        });
        // Clear the query param after loading
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, templates, activeTab, setFormValues, setSearchParams, t]);

  const handleSaveTemplate = async (data: TemplateFormData) => {
    if (!activeTab?.selectedModel) return;

    await createTemplate({
      name: data.name,
      description: data.description || null,
      tags: data.tags,
      thumbnail: data.thumbnail || null,
      type: "custom",
      templateType: "playground",
      playgroundData: {
        modelId: activeTab.selectedModel.model_id,
        modelName: activeTab.selectedModel.name,
        values: activeTab.formValues,
      },
    });
    toast({
      title: t("playground.templateSaved"),
      description: t("playground.savedAs", { name: data.name }),
    });
  };

  // Create tab when navigating to playground with a specific model (only on initial load)
  useEffect(() => {
    if (
      models.length > 0 &&
      tabs.length === 0 &&
      !initialTabCreatedRef.current &&
      modelId
    ) {
      initialTabCreatedRef.current = true;
      // Try to decode, but use original if decoding fails (for paths with slashes)
      let decodedId = modelId;
      try {
        decodedId = decodeURIComponent(modelId);
      } catch {
        // Use original modelId if decoding fails
      }
      const model = models.find((m) => m.model_id === decodedId);
      createTab(model);
    }
  }, [modelId, models, tabs.length, createTab]);

  // Set model from URL only when the active tab has no model (e.g. initial load or new empty tab).
  // Do NOT overwrite when the tab already has a model, so tab switching never wipes form values
  // (otherwise URL can lag and we'd set the wrong model on the newly active tab and reset its form).
  useEffect(() => {
    if (
      !modelId ||
      models.length === 0 ||
      !activeTab ||
      activeTab.selectedModel != null
    )
      return;
    let decodedId = modelId;
    try {
      decodedId = decodeURIComponent(modelId);
    } catch {
      // Use original modelId if decoding fails
    }
    const model = models.find((m) => m.model_id === decodedId);
    if (model) setSelectedModel(model);
  }, [modelId, models, activeTab, setSelectedModel]);

  const handleModelChange = (modelId: string) => {
    const model = models.find((m) => m.model_id === modelId);
    if (model) {
      if (activeTab) {
        setSelectedModel(model);
      } else {
        createTab(model);
      }
      navigate(`/playground/${modelId}`);
      switchTab("result");
    }
  };

  const handleSetDefaults = useCallback(
    (defaults: Record<string, unknown>) => {
      setFormValues(defaults);
    },
    [setFormValues],
  );

  const handleRun = async () => {
    if (!activeTab) return;

    // Switch to output view on mobile when running
    setMobileView("output");

    const { batchConfig } = activeTab;
    if (batchConfig.enabled && batchConfig.repeatCount > 1) {
      await runBatch();
    } else {
      await runPrediction();
    }
  };

  const handleReset = () => {
    resetForm();
    clearBatchResults();
  };

  const handleNewTab = () => {
    const currentModel = activeTab?.selectedModel;
    createTab(currentModel || undefined);
    if (currentModel) {
      navigate(`/playground/${currentModel.model_id}`);
    } else {
      navigate("/playground");
    }
  };

  // Explore: select a model from the all-models list → load in current tab (or create new tab if none)
  const handleExploreSelectModel = useCallback(
    (modelId: string) => {
      const model = models.find((m) => m.model_id === modelId);
      if (model) {
        if (activeTab) {
          setSelectedModel(model);
        } else {
          createTab(model);
        }
        navigate(`/playground/${modelId}`);
        switchTab("result");
      }
    },
    [models, activeTab, setSelectedModel, createTab, navigate, switchTab],
  );

  // Explore: select a featured model → open in new tab
  const handleExploreSelectFeatured = useCallback(
    (primaryVariant: string) => {
      const model = models.find((m) => m.model_id === primaryVariant);
      if (model) {
        createTab(model);
        navigate(`/playground/${primaryVariant}`);
        switchTab("result");
      }
    },
    [models, createTab, navigate, switchTab],
  );

  // Templates panel: use a template
  const handleUseTemplateFromPanel = useCallback(
    (template: import("@/types/template").Template) => {
      if (template.playgroundData) {
        if (!activeTab) {
          // No active tab — create one with the template's model
          const model = template.playgroundData.modelId
            ? models.find(
                (m) => m.model_id === template.playgroundData!.modelId,
              )
            : undefined;
          createTab(model);
          if (template.playgroundData.modelId) {
            navigate(`/playground/${template.playgroundData.modelId}`);
          }
          // Set form values after a tick so the new tab is active
          setTimeout(() => {
            setFormValues(template.playgroundData!.values);
          }, 0);
        } else {
          if (
            template.playgroundData.modelId &&
            activeTab.selectedModel?.model_id !==
              template.playgroundData.modelId
          ) {
            const model = models.find(
              (m) => m.model_id === template.playgroundData!.modelId,
            );
            if (model) {
              setSelectedModel(model);
              navigate(`/playground/${template.playgroundData.modelId}`);
            }
          }
          setFormValues(template.playgroundData.values);
        }
        toast({
          title: t("playground.templateLoaded"),
          description: t("playground.loadedTemplate", { name: template.name }),
        });
        switchTab("result");
      }
    },
    [
      activeTab,
      models,
      setSelectedModel,
      setFormValues,
      createTab,
      navigate,
      t,
      switchTab,
    ],
  );

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.selectedModel) {
      navigate(`/playground/${encodeURIComponent(tab.selectedModel.model_id)}`);
    } else {
      navigate("/playground");
    }
  };

  // Show loading state while API key is being loaded from storage
  // Also show loading when models are loading (needed for model selector)
  if (
    isLoadingApiKey ||
    !hasAttemptedLoad ||
    (isValidated && models.length === 0)
  ) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col md:pt-0">
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Mobile Tab Switcher */}
        <div className="md:hidden flex border-b bg-background/80 backdrop-blur">
          <button
            onClick={() => setMobileView("config")}
            className={cn(
              "flex-1 py-3 text-sm font-medium transition-colors",
              mobileView === "config"
                ? "text-primary border-b-2 border-primary bg-background"
                : "text-muted-foreground",
            )}
          >
            Input
          </button>
          <button
            onClick={() => setMobileView("output")}
            className={cn(
              "flex-1 py-3 text-sm font-medium transition-colors",
              mobileView === "output"
                ? "text-primary border-b-2 border-primary bg-background"
                : "text-muted-foreground",
            )}
          >
            Output
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          {/* Left Panel - Configuration (always visible) */}
          <div
            className={cn(
              "w-full md:w-[360px] md:max-w-[360px] md:flex-none flex flex-col min-h-0 border-b bg-card/70 md:overflow-hidden md:border-r md:border-b-0",
              mobileView === "config" ? "flex flex-1" : "hidden md:flex",
            )}
          >
            {/* Page Title */}
            <div className="px-4 py-3 border-b border-border shrink-0">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {t("playground.title")}
              </h1>
            </div>

            {/* Model Selector */}
            <div className="px-4 pb-3 shrink-0">
              <ModelSelector
                models={models}
                value={activeTab?.selectedModel?.model_id}
                onChange={handleModelChange}
              />
            </div>

            {/* Parameters */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              {activeTab?.selectedModel ? (
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
                <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
                  <div className="rounded-2xl bg-primary/10 p-4">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t("playground.selectModelPrompt")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t(
                        "playground.emptyStateHint",
                        "Pick a featured model or browse all models to get started",
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => switchTab("featured")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                    >
                      <Star className="h-3.5 w-3.5" />
                      {t("playground.rightPanel.featuredModels", "Featured Models")}
                    </button>
                    <button
                      onClick={() => switchTab("models")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      {t("playground.rightPanel.models", "All Models")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom: Run + actions on same row */}
            <div className="border-t bg-background/80 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <BatchControls
                    disabled={!activeTab?.selectedModel}
                    isRunning={activeTab?.isRunning ?? false}
                    isUploading={(activeTab?.uploadingCount ?? 0) > 0}
                    onRun={handleRun}
                    runLabel={t("playground.run")}
                    runningLabel={
                      activeTab?.batchState?.isRunning
                        ? `${t("playground.running")} (${activeTab.batchState.queue.length})`
                        : t("playground.running")
                    }
                    price={
                      activeTab?.selectedModel
                        ? isPricingLoading
                          ? "..."
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
                  disabled={!activeTab || activeTab.isRunning}
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
                  title={t("playground.resetForm")}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setShowSaveTemplateDialog(true)}
                  disabled={!activeTab?.selectedModel}
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
                  title={t("playground.saveAsTemplate")}
                >
                  <Save className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Right Panel - always visible */}
          <div
            className={cn(
              "flex-1 flex flex-col min-w-0 overflow-hidden",
              mobileView === "output" ? "flex" : "hidden md:flex",
            )}
          >
            {/* Content Tabs - always visible at top */}
            <div className="flex items-center justify-between pl-4 pr-4 pt-2 border-b border-border shrink-0">
              {/* Left group: Workspace + Result */}
              <div className="flex items-center gap-4">
                {/* Workspace / Active Session dropdown */}
                <div ref={workspaceRef} className="relative">
                  <button
                    onClick={() => setWorkspaceOpen(!workspaceOpen)}
                    className={cn(
                      "relative flex items-center gap-1.5 pb-2.5 pt-2 text-sm font-medium transition-colors",
                      rightPanelTab === "result" || workspaceOpen
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Monitor className="h-4 w-4" />
                    <span className="max-w-[160px] truncate">
                      {activeTab?.selectedModel?.name ||
                        t("playground.workspace", "Workspace")}
                    </span>
                    {tabs.length > 0 && (
                      <span className="text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5 font-semibold leading-none">
                        {tabs.length}
                      </span>
                    )}
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        workspaceOpen && "rotate-180",
                      )}
                    />
                    {rightPanelTab === "result" && !workspaceOpen && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
                    )}
                  </button>

                  {/* Sessions dropdown */}
                  {workspaceOpen && (
                    <div className="absolute z-50 mt-0.5 left-0 min-w-[260px] rounded-xl border border-border/80 bg-popover shadow-xl animate-in fade-in-0 zoom-in-95">
                      <div className="p-1.5">
                        {tabs.length === 0 ? (
                          <div className="py-4 text-center text-xs text-muted-foreground">
                            {t("playground.noTabs")}
                          </div>
                        ) : (
                          tabs.map((tab) => (
                            <button
                              key={tab.id}
                              onClick={() => {
                                handleTabClick(tab.id);
                                switchTab("result");
                                setWorkspaceOpen(false);
                              }}
                              className={cn(
                                "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors",
                                "hover:bg-accent hover:text-accent-foreground",
                                tab.id === activeTabId &&
                                  "bg-primary/10 text-foreground font-medium",
                              )}
                            >
                              {tab.isRunning ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                              ) : (
                                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                              )}
                              <span className="flex-1 text-left truncate">
                                {tab.selectedModel?.name ||
                                  t("playground.tabs.newTab")}
                              </span>
                              {tab.id === activeTabId && (
                                <span className="text-[9px] bg-primary/20 text-primary rounded px-1 py-0.5 font-medium shrink-0">
                                  active
                                </span>
                              )}
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCloseTab(e, tab.id);
                                }}
                                className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity shrink-0"
                              >
                                <X className="h-3 w-3" />
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                      <div className="border-t border-border/60 p-1.5">
                        <button
                          onClick={() => {
                            handleNewTab();
                            setWorkspaceOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {t("playground.tabs.newTab", "New Tab")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    switchTab("result");
                    setWorkspaceOpen(false);
                  }}
                  className={cn(
                    "relative flex items-center gap-2 pb-2.5 pt-2 text-sm font-medium transition-colors",
                    rightPanelTab === "result"
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="h-4 w-4" />
                  {t("playground.rightPanel.result", "Results")}
                  {rightPanelTab === "result" && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
                  )}
                </button>
              </div>

              {/* Right group: Featured Models / Models / Templates */}
              <div className="flex items-center gap-4">
                {(
                  [
                    ...(!isMobile
                      ? [
                          {
                            key: "featured" as const,
                            icon: <Star className="h-4 w-4" />,
                            label: t(
                              "playground.rightPanel.featuredModels",
                              "Featured Models",
                            ),
                          },
                        ]
                      : []),
                    {
                      key: "models" as const,
                      icon: <Layers className="h-4 w-4" />,
                      label: t("playground.rightPanel.models", "All Models"),
                    },
                    {
                      key: "templates" as const,
                      icon: <FolderOpen className="h-4 w-4" />,
                      label: t("playground.rightPanel.templates", "Templates"),
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      switchTab(tab.key);
                      setWorkspaceOpen(false);
                    }}
                    className={cn(
                      "relative flex items-center gap-2 pb-2.5 pt-2 text-sm font-medium transition-colors",
                      rightPanelTab === tab.key
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground",
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
              <div
                className={cn(
                  "flex-1 overflow-hidden flex flex-col",
                  rightPanelTab !== "models" && "hidden",
                )}
              >
                <ExplorePanel onSelectModel={handleExploreSelectModel} />
              </div>
              {!isMobile && (
                <div
                  className={cn(
                    "flex-1 overflow-hidden flex flex-col",
                    rightPanelTab !== "featured" && "hidden",
                  )}
                >
                  <FeaturedModelsPanel
                    onSelectFeatured={handleExploreSelectFeatured}
                    models={models}
                  />
                </div>
              )}
              <div
                className={cn(
                  "flex-1 overflow-hidden flex flex-col",
                  rightPanelTab !== "result" && "hidden",
                )}
              >
                {activeTab ? (
                  <>
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
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <p>{t("playground.selectModelPrompt")}</p>
                  </div>
                )}
              </div>
              <div
                className={cn(
                  "flex-1 overflow-hidden flex flex-col",
                  rightPanelTab !== "templates" && "hidden",
                )}
              >
                <TemplatesPanel onUseTemplate={handleUseTemplateFromPanel} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save Template Dialog */}
      <TemplateDialog
        open={showSaveTemplateDialog}
        onOpenChange={setShowSaveTemplateDialog}
        mode="create"
        onSave={handleSaveTemplate}
      />
    </div>
  );
}
