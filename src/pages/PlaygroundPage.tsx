import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useTransition,
} from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  usePlaygroundStore,
  persistPlaygroundSession,
  hydratePlaygroundSession,
} from "@/stores/playgroundStore";
import { useModelsStore } from "@/stores/modelsStore";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import { apiClient } from "@/api/client";
import { useTemplateStore } from "@/stores/templateStore";
import { usePredictionInputsStore } from "@/stores/predictionInputsStore";
import { usePageActive } from "@/hooks/usePageActive";
import { getDefaultValues } from "@/lib/schemaToForm";
import { DynamicForm } from "@/components/playground/DynamicForm";
import { ModelSelector } from "@/components/playground/ModelSelector";
import { BatchControls } from "@/components/playground/BatchControls";
import { HistoryDrawer } from "@/components/playground/HistoryDrawer";
import { ResultPanel } from "@/components/playground/ResultPanel";
// TemplatesPanel removed from top bar (sidebar entry remains)
import { FeaturedModelsPanel } from "@/components/playground/FeaturedModelsPanel";
import { TemplatesPanel } from "@/components/playground/TemplatesPanel";
import {
  RotateCcw,
  Loader2,
  Plus,
  X,
  Save,
  Sparkles,
  PlayCircle,
  LayoutGrid,
  Compass,
  Layers,
  ChevronDown,
  Clock,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TemplateDialog,
  type TemplateFormData,
} from "@/components/templates/TemplateDialog";

type RightPanelTab = "result" | "featured" | "templates";

/** Format raw model name/id for display. e.g. "google/nano-banana-pro/text-to-image" → "Google / Nano Banana Pro" */

const isCapacitorNative = () => {
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

export function PlaygroundPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const isActive = usePageActive("/playground");
  // Extract modelId from pathname: /playground/some/model/id → "some/model/id"
  const modelId = useMemo(() => {
    const prefix = "/playground/";
    if (location.pathname.startsWith(prefix)) {
      const raw = location.pathname.slice(prefix.length);
      if (raw) {
        try {
          return decodeURIComponent(raw);
        } catch {
          return raw;
        }
      }
    }
    return undefined;
  }, [location.pathname]);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { models, fetchModels } = useModelsStore();
  const {
    apiKey,
    isLoading: isLoadingApiKey,
    isValidated,
    loadApiKey,
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
    abortRun,
    clearBatchResults,
    generateBatchInputs,
    setUploading,
    selectHistoryItem,
    reorderTab,
    consumePendingFormValues,
  } = usePlaygroundStore();
  const { templates, loadTemplates, createTemplate, migrateFromLocalStorage } =
    useTemplateStore();
  const {
    save: savePredictionInputs,
    load: loadPredictionInputs,
    isLoaded: inputsLoaded,
  } = usePredictionInputsStore();

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

  const historyLen = activeTab?.generationHistory.length ?? 0;
  const navigateHistory = useCallback(
    (direction: "prev" | "next") => {
      if (historyLen === 0) return;
      const cur = historyIndex ?? 0;
      if (direction === "prev") {
        selectHistoryItem(cur === 0 ? historyLen - 1 : cur - 1);
      } else {
        selectHistoryItem(cur === historyLen - 1 ? 0 : cur + 1);
      }
    },
    [historyLen, historyIndex, selectHistoryItem],
  );

  const templateLoadedRef = useRef<string | null>(null);
  const initialTabCreatedRef = useRef(false);

  // Dynamic pricing state
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [isPricingLoading, setIsPricingLoading] = useState(false);
  const pricingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Mobile view state: 'config' or 'output'
  const [mobileView, setMobileView] = useState<"config" | "output">("config");

  // Resizable left panel
  const [leftPanelWidth, setLeftPanelWidth] = useState(360);
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      const startX = e.clientX;
      const startWidth = leftPanelWidth;
      const onMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = ev.clientX - startX;
        const newWidth = Math.max(220, Math.min(500, startWidth + delta));
        setLeftPanelWidth(newWidth);
      };
      const onUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [leftPanelWidth],
  );

  // Right panel tab state
  const isMobile = isCapacitorNative();
  // Persist rightPanelTab across navigation using sessionStorage
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>(() => {
    // If arriving with a modelId in the URL, go straight to result
    if (modelId) return "result";
    const saved = sessionStorage.getItem(
      "pg_rightPanelTab",
    ) as RightPanelTab | null;
    return saved ?? (tabs.length > 0 ? "result" : "featured");
  });
  const [, startTransition] = useTransition();
  const switchTab = useCallback((tab: RightPanelTab) => {
    startTransition(() => {
      setRightPanelTab(tab);
      sessionStorage.setItem("pg_rightPanelTab", tab);
    });
  }, []);

  // When all tabs are closed and we're on the Result tab, switch to Featured
  useEffect(() => {
    if (!activeTab && rightPanelTab === "result") {
      setRightPanelTab("featured");
      sessionStorage.setItem("pg_rightPanelTab", "featured");
    }
  }, [activeTab, rightPanelTab, isMobile]);

  // Top search bar state — removed: search is now inline per tab

  // Workspace sessions dropdown state — removed, now using browser-style tabs

  // Tab scroll ref for overflow detection
  const pgTabScrollRef = useRef<HTMLDivElement>(null);

  // Tab list dropdown state
  const [tabListOpen, setTabListOpen] = useState(false);
  const tabListRef = useRef<HTMLDivElement>(null);

  // Tab drag-to-reorder state
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    tabId: string;
    side: "left" | "right";
  } | null>(null);

  // Close tab list dropdown on click outside
  useEffect(() => {
    if (!tabListOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        tabListRef.current &&
        !tabListRef.current.contains(e.target as Node)
      ) {
        setTabListOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tabListOpen]);

  // Tab drag handlers
  const handleTabDragStart = useCallback(
    (e: React.DragEvent, tabId: string) => {
      setDragTabId(tabId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tabId);
    },
    [],
  );

  const handleTabDragOver = useCallback(
    (e: React.DragEvent, tabId: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!dragTabId || tabId === dragTabId) {
        setDropIndicator(null);
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const side = e.clientX - rect.left < rect.width / 2 ? "left" : "right";
      setDropIndicator({ tabId, side });
    },
    [dragTabId],
  );

  const handleTabDrop = useCallback(
    (e: React.DragEvent, targetTabId: string) => {
      e.preventDefault();
      if (!dragTabId || dragTabId === targetTabId) {
        setDragTabId(null);
        setDropIndicator(null);
        return;
      }
      const fromIdx = tabs.findIndex((t) => t.id === dragTabId);
      const toIdx = tabs.findIndex((t) => t.id === targetTabId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const side = dropIndicator?.side ?? "right";
        const insertIdx =
          fromIdx < toIdx
            ? side === "left"
              ? toIdx - 1
              : toIdx
            : side === "left"
              ? toIdx
              : toIdx + 1;
        reorderTab(fromIdx, Math.max(0, insertIdx));
      }
      setDragTabId(null);
      setDropIndicator(null);
    },
    [dragTabId, dropIndicator, tabs, reorderTab],
  );

  const handleTabDragEnd = useCallback(() => {
    setDragTabId(null);
    setDropIndicator(null);
  }, []);

  // Template dialog states
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);

  // Generate batch preview inputs
  const batchPreviewInputs = useMemo(() => {
    if (!activeTab) return [];
    const { batchConfig } = activeTab;
    if (!batchConfig.enabled) return [];
    return generateBatchInputs();
  }, [activeTab, generateBatchInputs]);

  // Migrate templates and load on mount (runs once since page is persistent)
  useEffect(() => {
    const init = async () => {
      await migrateFromLocalStorage();
      await loadTemplates({ templateType: "playground" });
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!inputsLoaded) loadPredictionInputs();
  }, [loadApiKey, inputsLoaded, loadPredictionInputs]);

  useEffect(() => {
    if (isValidated) {
      fetchModels();
    }
  }, [isValidated, fetchModels]);

  // Save prediction inputs to local storage when prediction completes
  const lastSavedPredictionRef = useRef<string | null>(null);
  useEffect(() => {
    const prediction = activeTab?.currentPrediction;
    const model = activeTab?.selectedModel;
    const formValues = activeTab?.formValues;
    const outputs = activeTab?.outputs;
    const isRunning = activeTab?.isRunning;
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
      savePredictionInputs(
        prediction.id,
        model.model_id,
        model.name,
        formValues,
      );
      lastSavedPredictionRef.current = prediction.id;
    }
  }, [
    activeTab?.currentPrediction,
    activeTab?.selectedModel,
    activeTab?.formValues,
    activeTab?.outputs,
    activeTab?.isRunning,
    savePredictionInputs,
  ]);

  // Calculate dynamic pricing with debounce — deferred start
  useEffect(() => {
    if (!activeTab?.selectedModel || !apiKey) {
      setCalculatedPrice(null);
      return;
    }

    if (pricingTimeoutRef.current) {
      clearTimeout(pricingTimeoutRef.current);
    }

    pricingTimeoutRef.current = setTimeout(async () => {
      setIsPricingLoading(true);
      try {
        const price = await apiClient.calculatePricing(
          activeTab.selectedModel!.model_id,
          activeTab.formValues,
        );
        setCalculatedPrice(price);
      } catch {
        setCalculatedPrice(null);
      } finally {
        setIsPricingLoading(false);
      }
    }, 800);

    return () => {
      if (pricingTimeoutRef.current) {
        clearTimeout(pricingTimeoutRef.current);
      }
    };
  }, [activeTab?.selectedModel, activeTab?.formValues, apiKey]);

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
      navigate(`/playground/${modelId}`, { replace: true });
      if (rightPanelTab !== "result") {
        setRightPanelTab("result");
        sessionStorage.setItem("pg_rightPanelTab", "result");
      }
    }
  };

  const handleSetDefaults = useCallback(
    (defaults: Record<string, unknown>) => {
      const pending = consumePendingFormValues();
      if (pending) {
        setFormValues({ ...defaults, ...pending });
      } else {
        setFormValues(defaults);
      }
    },
    [setFormValues, consumePendingFormValues],
  );

  // When a tab is created with pendingFormValues (e.g. from History "Open in Playground")
  // and DynamicForm does NOT call onSetDefaults (same model, schema cached),
  // apply pending values merged with schema defaults so all fields are populated.
  useEffect(() => {
    const tab = getActiveTab();
    if (!tab?.pendingFormValues) return;
    const pending = consumePendingFormValues();
    if (pending) {
      // Read formFields from the store (may have been set by DynamicForm's effect)
      const currentTab = getActiveTab();
      const fields = currentTab?.formFields ?? [];
      const defaults = fields.length > 0 ? getDefaultValues(fields) : {};
      setFormValues({ ...defaults, ...currentTab?.formValues, ...pending });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // When a tab is created with pre-loaded outputs (e.g. from History/Assets "Customize"),
  // auto-switch to the Result tab so the user sees the output immediately.
  useEffect(() => {
    if (activeTab?.outputs && activeTab.outputs.length > 0 && rightPanelTab !== "result") {
      setRightPanelTab("result");
      sessionStorage.setItem("pg_rightPanelTab", "result");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  const handleRun = useCallback(async () => {
    if (!activeTab) return;

    // Switch to output view on mobile when running
    setMobileView("output");
    // Auto-switch to Result tab so user sees the output
    switchTab("result");

    const { batchConfig } = activeTab;
    if (batchConfig.enabled && batchConfig.repeatCount > 1) {
      await runBatch();
    } else {
      await runPrediction();
    }
  }, [activeTab, switchTab, runBatch, runPrediction]);

  // Ctrl+Enter / Cmd+Enter to run; Ctrl+W / Cmd+W to close active tab
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (activeTab?.selectedModel && !activeTab.isRunning) {
          handleRun();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, activeTab, activeTabId, handleRun, closeTab]);

  const handleReset = () => {
    resetForm();
    clearBatchResults();
  };

  const handleNewTab = () => {
    const currentModel = activeTab?.selectedModel;
    createTab(currentModel || undefined);
    // Stay on result panel, not featured
    setRightPanelTab("result");
    sessionStorage.setItem("pg_rightPanelTab", "result");
    if (currentModel) {
      navigate(`/playground/${currentModel.model_id}`);
    } else {
      navigate("/playground");
    }
    // Scroll to show the newest tab
    requestAnimationFrame(() => {
      if (pgTabScrollRef.current) {
        pgTabScrollRef.current.scrollLeft = pgTabScrollRef.current.scrollWidth;
      }
    });
  };

  // Explore: select a featured model → open in new tab
  const handleExploreSelectFeatured = useCallback(
    (primaryVariant: string) => {
      const model = models.find((m) => m.model_id === primaryVariant);
      if (model) {
        createTab(model);
        navigate(`/playground/${primaryVariant}`);
        setRightPanelTab("result");
        sessionStorage.setItem("pg_rightPanelTab", "result");
      }
    },
    [models, createTab, navigate],
  );

  // Templates panel: use a template
  const handleUseTemplateFromPanel = useCallback(
    (
      template: import("@/types/template").Template,
      mode?: "new" | "replace",
    ) => {
      if (template.playgroundData) {
        // Determine effective mode:
        // - explicit "replace" from overlay button
        // - explicit "new" from overlay button
        // - no mode (card click): default to "new" unless no active tab exists
        // - special case: if active tab has no model selected, auto-replace (fill empty tab)
        let effectiveMode: "new" | "replace";
        if (mode) {
          effectiveMode = mode;
        } else {
          effectiveMode = "new";
        }
        // Auto-replace empty tab (no model selected) even when mode is "new"
        if (effectiveMode === "new" && activeTab && !activeTab.selectedModel) {
          effectiveMode = "replace";
        }

        const shouldCreateNewTab = effectiveMode === "new" || !activeTab;

        flushSync(() => {
          if (shouldCreateNewTab) {
            const model = template.playgroundData!.modelId
              ? models.find(
                  (m) => m.model_id === template.playgroundData!.modelId,
                )
              : undefined;
            createTab(model);
          } else {
            // Replace current tab
            if (
              template.playgroundData!.modelId &&
              activeTab!.selectedModel?.model_id !==
                template.playgroundData!.modelId
            ) {
              const model = models.find(
                (m) => m.model_id === template.playgroundData!.modelId,
              );
              if (model) setSelectedModel(model);
            }
            setFormValues(template.playgroundData!.values);
          }
          setRightPanelTab("result");
          sessionStorage.setItem("pg_rightPanelTab", "result");
        });

        if (template.playgroundData.modelId) {
          navigate(`/playground/${template.playgroundData.modelId}`, {
            replace: true,
          });
        }

        // For new tab: set form values after tab is active
        if (shouldCreateNewTab) {
          setTimeout(() => {
            setFormValues(template.playgroundData!.values);
          }, 0);
        }
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
    ],
  );

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const handleTabClick = (tabId: string) => {
    if (tabId === activeTabId && rightPanelTab === "result") return;
    // Batch zustand + React state updates into a single synchronous commit to prevent flicker
    flushSync(() => {
      if (rightPanelTab !== "result") {
        setRightPanelTab("result");
        sessionStorage.setItem("pg_rightPanelTab", "result");
      }
      setActiveTab(tabId);
    });
    // Sync URL without triggering React Router re-render
    const tab = tabs.find((t) => t.id === tabId);
    const newUrl = tab?.selectedModel
      ? `/playground/${encodeURIComponent(tab.selectedModel.model_id)}`
      : "/playground";
    window.history.replaceState(null, "", newUrl);
  };

  // Block render only while the API key is being read from disk.
  // Once we have the key (or confirmed there's none), show the UI immediately.
  // Models come from localStorage cache instantly, so no need to wait for network.
  if (isLoadingApiKey || !hasAttemptedLoad) {
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

        <div
          ref={containerRef}
          className="flex flex-1 flex-col overflow-hidden md:flex-row animate-in fade-in duration-300 fill-mode-both"
          style={{ animationDelay: "80ms" }}
        >
          {/* Left Panel - Configuration (always visible) */}
          <div
            className={cn(
              "w-full md:w-auto flex flex-col min-h-0 border-b md:overflow-hidden md:border-r md:border-b-0 md:shrink-0 md:grow-0",
              mobileView === "config"
                ? "flex flex-1 md:flex-initial"
                : "hidden md:flex",
            )}
            style={{ flexBasis: `${leftPanelWidth}px` }}
          >
            {/* Page Title + quick-nav chips */}
            <div className="px-4 md:px-6 py-4 pt-14 md:pt-4 border-b border-border shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
              <div className="flex items-end gap-2">
                <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2 shrink-0 leading-none">
                  <PlayCircle className="h-5 w-5 text-primary" />
                  {t("playground.title")}
                </h1>
                <div className="flex items-center gap-1 ml-auto shrink-0 self-end translate-y-0.5">
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => switchTab("featured")}
                        className={cn(
                          "inline-flex items-center justify-center h-7 w-7 rounded-lg transition-all",
                          rightPanelTab === "featured"
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border",
                        )}
                      >
                        <Compass className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {t(
                        "playground.rightPanel.featuredModels",
                        "Featured Models",
                      )}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => switchTab("templates")}
                        className={cn(
                          "inline-flex items-center justify-center h-7 w-7 rounded-lg transition-all",
                          rightPanelTab === "templates"
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border",
                        )}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {t("nav.templates", "Templates")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>

            {/* Model Selector */}
            <div className="px-3 pb-1 shrink-0">
              <ModelSelector
                models={models}
                value={activeTab?.selectedModel?.model_id}
                onChange={handleModelChange}
              />
            </div>

            {/* Parameters */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
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
                      <Compass className="h-3.5 w-3.5" />
                      {t(
                        "playground.rightPanel.featuredModels",
                        "Featured Models",
                      )}
                    </button>
                    <button
                      onClick={() => navigate("/models")}
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
            <div className="border-t bg-background/80 px-3 py-3">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <BatchControls
                    disabled={!activeTab?.selectedModel}
                    isRunning={activeTab?.isRunning ?? false}
                    isUploading={(activeTab?.uploadingCount ?? 0) > 0}
                    onRun={handleRun}
                    onAbort={abortRun}
                    runLabel={t("playground.run")}
                    runningLabel={
                      activeTab?.batchState?.isRunning
                        ? `${t("playground.abort", "Abort")} (${activeTab.batchState.queue.length})`
                        : t("playground.abort", "Abort")
                    }
                    price={
                      isPricingLoading
                        ? "..."
                        : calculatedPrice != null
                          ? `${calculatedPrice.toFixed(4)}`
                          : activeTab?.selectedModel?.base_price != null
                            ? `${activeTab.selectedModel.base_price.toFixed(4)}`
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

          {/* Resize handle */}
          <div
            onMouseDown={handleResizeStart}
            className="hidden md:flex w-1 cursor-col-resize items-center justify-center hover:bg-primary/20 active:bg-primary/30 transition-colors group shrink-0"
          >
            <div className="w-px h-8 bg-border group-hover:bg-primary/50 transition-colors" />
          </div>

          {/* Right Panel - always visible */}
          <div
            className={cn(
              "flex-1 flex flex-col min-w-0 overflow-hidden",
              mobileView === "output" ? "flex" : "hidden md:flex",
            )}
          >
            {/* Content Tabs - browser-style tab bar */}
            <div className="flex items-center border-b border-border pl-0 pr-2 gap-1 h-10 shrink-0">
              {/* Tab list dropdown button */}
              <div ref={tabListRef} className="relative shrink-0">
                <button
                  onClick={() => setTabListOpen(!tabListOpen)}
                  className={cn(
                    "flex items-center justify-center w-7 h-7 rounded-md transition-colors shrink-0",
                    tabListOpen
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                  title={t("playground.tabs.allTabs", "All Tabs")}
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      tabListOpen && "rotate-180",
                    )}
                  />
                </button>
                {tabListOpen && (
                  <div className="absolute z-50 mt-1 left-0 min-w-[320px] max-h-[400px] overflow-y-auto rounded-xl border border-border/80 bg-popover shadow-xl animate-in fade-in-0 zoom-in-95">
                    <div className="p-1.5">
                      {tabs.length === 0 ? (
                        <div className="py-4 text-center text-xs text-muted-foreground">
                          {t("playground.noTabs", "No open tabs")}
                        </div>
                      ) : (
                        tabs.map((tab) => (
                          <div
                            key={tab.id}
                            title={
                              tab.selectedModel?.model_id ||
                              t("playground.tabs.newTab")
                            }
                            onClick={() => {
                              handleTabClick(tab.id);
                              setTabListOpen(false);
                            }}
                            className={cn(
                              "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors cursor-pointer",
                              "hover:bg-accent hover:text-accent-foreground",
                              tab.id === activeTabId &&
                                "bg-primary/10 text-foreground font-medium",
                            )}
                          >
                            {tab.isRunning ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-primary" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="truncate font-medium">
                                {tab.selectedModel?.model_id ||
                                  t("playground.tabs.newTab")}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                                {tab.selectedModel?.type && (
                                  <span>{tab.selectedModel.type}</span>
                                )}
                                <span className="flex items-center gap-0.5">
                                  <Clock className="h-2.5 w-2.5" />
                                  {new Date(tab.createdAt).toLocaleTimeString(
                                    [],
                                    { hour: "2-digit", minute: "2-digit" },
                                  )}
                                </span>
                              </div>
                            </div>
                            {tab.id === activeTabId && (
                              <span className="text-[9px] bg-primary/20 text-primary rounded px-1 py-0.5 font-medium shrink-0">
                                active
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCloseTab(e, tab.id);
                              }}
                              className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity shrink-0 text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="border-t border-border/60 p-1.5">
                      <button
                        onClick={() => {
                          handleNewTab();
                          setTabListOpen(false);
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

              {/* Scrollable session tabs */}
              <div
                ref={pgTabScrollRef}
                className="flex-1 min-w-0 overflow-x-auto hide-scrollbar"
                onWheel={(e) => {
                  if (pgTabScrollRef.current && e.deltaY !== 0) {
                    e.preventDefault();
                    pgTabScrollRef.current.scrollLeft += e.deltaY;
                  }
                }}
              >
                <div className="flex items-center gap-1">
                  {tabs.map((tab) => {
                    const isActive =
                      tab.id === activeTabId && rightPanelTab === "result";
                    return (
                      <div
                        key={tab.id}
                        draggable
                        onDragStart={(e) => handleTabDragStart(e, tab.id)}
                        onDragOver={(e) => handleTabDragOver(e, tab.id)}
                        onDrop={(e) => handleTabDrop(e, tab.id)}
                        onDragEnd={handleTabDragEnd}
                        onClick={() => {
                          handleTabClick(tab.id);
                        }}
                        title={
                          tab.selectedModel?.model_id ||
                          t("playground.tabs.newTab")
                        }
                        className={cn(
                          "group relative flex h-8 items-center gap-1.5 px-3 text-xs transition-colors cursor-pointer select-none min-w-[80px] max-w-[240px] hover:bg-primary/10 dark:hover:bg-muted/60",
                          dragTabId === tab.id && "opacity-40",
                          isActive
                            ? "bg-primary/15 dark:bg-primary/10 text-foreground font-medium"
                            : "bg-primary/[0.06] dark:bg-muted/20 text-muted-foreground",
                        )}
                      >
                        {/* Drop indicator lines */}
                        {dropIndicator?.tabId === tab.id &&
                          dropIndicator.side === "left" && (
                            <div className="absolute -left-px top-1 bottom-1 w-0.5 rounded-full bg-primary" />
                          )}
                        {dropIndicator?.tabId === tab.id &&
                          dropIndicator.side === "right" && (
                            <div className="absolute -right-px top-1 bottom-1 w-0.5 rounded-full bg-primary" />
                          )}
                        {tab.isRunning && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                        )}
                        <span className="truncate flex-1">
                          {tab.selectedModel?.model_id ||
                            t("playground.tabs.newTab")}
                        </span>
                        <button
                          onClick={(e) => handleCloseTab(e, tab.id)}
                          className={cn(
                            "ml-1 rounded p-0.5 transition-opacity hover:bg-muted text-muted-foreground hover:text-foreground",
                            isActive
                              ? "opacity-70"
                              : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                  {/* + button inside scroll area, right after last tab */}
                  <button
                    onClick={handleNewTab}
                    className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                    title={t("playground.tabs.newTab", "New Tab")}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Right Panel Content — all panels stacked via absolute positioning, no hidden/show remount */}
            <div className="flex-1 overflow-hidden relative">
              {/* Featured panel */}
              {!isMobile && (
                <div
                  className="absolute inset-0 flex flex-col overflow-hidden transition-opacity duration-150"
                  style={{
                    opacity: rightPanelTab === "featured" ? 1 : 0,
                    pointerEvents:
                      rightPanelTab === "featured" ? "auto" : "none",
                    visibility:
                      rightPanelTab === "featured" ? "visible" : "hidden",
                  }}
                >
                  <FeaturedModelsPanel
                    onSelectFeatured={handleExploreSelectFeatured}
                    models={models}
                  />
                </div>
              )}

              {/* Templates panel */}
              {!isMobile && (
                <div
                  className="absolute inset-0 flex flex-col overflow-hidden transition-opacity duration-150"
                  style={{
                    opacity: rightPanelTab === "templates" ? 1 : 0,
                    pointerEvents:
                      rightPanelTab === "templates" ? "auto" : "none",
                    visibility:
                      rightPanelTab === "templates" ? "visible" : "hidden",
                  }}
                >
                  <TemplatesPanel onUseTemplate={handleUseTemplateFromPanel} />
                </div>
              )}

              {/* Result panel */}
              <div
                className="absolute inset-0 flex flex-col overflow-hidden transition-opacity duration-150"
                style={{
                  opacity: rightPanelTab === "result" ? 1 : 0,
                  pointerEvents: rightPanelTab === "result" ? "auto" : "none",
                  visibility: rightPanelTab === "result" ? "visible" : "hidden",
                }}
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
                      batchEnabled={activeTab.batchConfig.enabled}
                      batchIsRunning={activeTab.batchState?.isRunning}
                      batchTotalCount={
                        activeTab.batchState?.queue.length ||
                        (activeTab.batchConfig.enabled
                          ? activeTab.batchConfig.repeatCount
                          : undefined)
                      }
                      batchQueue={activeTab.batchState?.queue}
                      onClearBatch={clearBatchResults}
                      batchPreviewInputs={batchPreviewInputs}
                      historyIndex={historyIndex}
                      historyLength={historyLen}
                      onNavigateHistory={navigateHistory}
                      idleFallback={
                        <FeaturedModelsPanel
                          onSelectFeatured={handleExploreSelectFeatured}
                          models={models}
                        />
                      }
                    />
                    <HistoryDrawer
                      history={activeTab.generationHistory}
                      selectedIndex={activeTab.selectedHistoryIndex}
                      onSelect={selectHistoryItem}
                      onDuplicateToNewTab={(index) => {
                        const item = activeTab.generationHistory[index];
                        if (item && activeTab.selectedModel) {
                          createTab(activeTab.selectedModel, item.formValues);
                        }
                      }}
                      onApplySettings={(index) => {
                        const item = activeTab.generationHistory[index];
                        if (item?.formValues) {
                          setFormValues(item.formValues);
                        }
                      }}
                    />
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
                    <div className="rounded-2xl bg-primary/10 p-4">
                      <LayoutGrid className="h-8 w-8 text-primary" />
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
                        <Compass className="h-3.5 w-3.5" />
                        {t(
                          "playground.rightPanel.featuredModels",
                          "Featured Models",
                        )}
                      </button>
                      <button
                        onClick={() => navigate("/models")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        {t("playground.rightPanel.models", "All Models")}
                      </button>
                    </div>
                  </div>
                )}
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
