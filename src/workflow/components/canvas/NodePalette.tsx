/**
 * Node palette — categorised list of available node types.
 * Drag to canvas or click to add. Resizable width via drag handle.
 */
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../../stores/ui.store";
import { useWorkflowStore } from "../../stores/workflow.store";
import { useModelsStore } from "@/stores/modelsStore";
import { getFormFieldsFromModel } from "@/lib/schemaToForm";
import { formFieldsToModelParamSchema } from "../../lib/model-converter";
import type { NodeTypeDefinition } from "@/workflow/types/node-defs";
import { fuzzySearch } from "@/lib/fuzzySearch";
import { Search, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNodeIcon } from "./custom-node/NodeIcons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { toast } from "@/hooks/useToast";

/* ── category colour dots ─────────────────────────────────── */
const catDot: Record<string, string> = {
  "ai-task": "bg-violet-500",
  input: "bg-blue-500",
  output: "bg-emerald-500",
  processing: "bg-amber-500",
  "free-tool": "bg-rose-500",
  control: "bg-cyan-500",
};

const RECENT_NODE_TYPES_KEY = "workflowRecentNodeTypes";
const MAX_RECENT_NODE_TYPES = 8;

function recordRecentNodeType(nodeType: string) {
  try {
    const raw = localStorage.getItem(RECENT_NODE_TYPES_KEY);
    const prev = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(prev)
      ? prev.filter((v): v is string => typeof v === "string")
      : [];
    const next = [nodeType, ...list.filter((t) => t !== nodeType)].slice(
      0,
      MAX_RECENT_NODE_TYPES,
    );
    localStorage.setItem(RECENT_NODE_TYPES_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
}

interface NodePaletteProps {
  definitions: NodeTypeDefinition[];
}

export function NodePalette({ definitions }: NodePaletteProps) {
  const { t } = useTranslation();
  const toggleNodePalette = useUIStore((s) => s.toggleNodePalette);
  const addNode = useWorkflowStore((s) => s.addNode);
  const width = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const pendingIteratorParentId = useUIStore((s) => s.pendingIteratorParentId);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Model search
  const storeModels = useModelsStore((s) => s.models);
  const fetchModels = useModelsStore((s) => s.fetchModels);
  useEffect(() => {
    if (storeModels.length === 0) fetchModels();
  }, [storeModels.length, fetchModels]);

  const matchedModels = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return fuzzySearch(storeModels, q, (m) => [
      m.name,
      m.model_id,
      m.type ?? "",
    ])
      .map((r) => r.item)
      .slice(0, 12);
  }, [query, storeModels]);

  // Auto-focus search input when palette opens
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const onDragStart = (event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow-nodetype", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleClick = useCallback(
    (def: NodeTypeDefinition) => {
      // Don't allow creating iterators inside iterators
      const pendingParentId = useUIStore.getState().pendingIteratorParentId;
      const editGroupId = useUIStore.getState().editingGroupId;
      const adoptParent = pendingParentId || editGroupId;
      if (adoptParent && def.type === "control/iterator") return;

      // Only one trigger node per workflow
      if (def.category === "trigger") {
        const existingTrigger = useWorkflowStore
          .getState()
          .nodes.find(
            (n) =>
              n.type?.startsWith("trigger/") ||
              n.data?.nodeType?.startsWith("trigger/"),
          );
        if (existingTrigger) {
          toast({
            title: t("workflow.triggerLimitTitle", "Only one trigger allowed"),
            description: t(
              "workflow.triggerLimitDesc",
              "A workflow can only have one trigger node. Remove the existing trigger first.",
            ),
            variant: "destructive",
          });
          return;
        }
      }

      const defaultParams: Record<string, unknown> = {};
      for (const p of def.params) {
        if (p.default !== undefined) defaultParams[p.key] = p.default;
      }

      let x: number, y: number;

      if (adoptParent) {
        // Creating inside an Iterator — compute absolute position in the internal canvas area
        const iteratorNode = useWorkflowStore
          .getState()
          .nodes.find((n) => n.id === adoptParent);
        if (iteratorNode) {
          const itW = (iteratorNode.data?.params?.__nodeWidth as number) ?? 600;
          const itH =
            (iteratorNode.data?.params?.__nodeHeight as number) ?? 400;
          const childW = (defaultParams.__nodeWidth as number) ?? 300;
          // Account for port strips — width depends on whether ports are exposed
          const inputDefs = iteratorNode.data?.inputDefinitions ?? [];
          const outputDefs = iteratorNode.data?.outputDefinitions ?? [];
          const leftStrip = (inputDefs as unknown[]).length > 0 ? 140 : 24;
          const rightStrip = (outputDefs as unknown[]).length > 0 ? 140 : 24;
          const internalW = itW - leftStrip - rightStrip;
          // Center the child in the internal canvas area
          x =
            iteratorNode.position.x +
            leftStrip +
            Math.max(10, (internalW - childW) / 2);
          y = iteratorNode.position.y + Math.max(60, itH / 2 - 40);
        } else {
          const center = useUIStore.getState().getViewportCenter();
          x = center.x + (Math.random() - 0.5) * 60;
          y = center.y + (Math.random() - 0.5) * 60;
        }
      } else {
        const center = useUIStore.getState().getViewportCenter();
        x = center.x + (Math.random() - 0.5) * 60;
        y = center.y + (Math.random() - 0.5) * 60;
      }

      const localizedLabel = t(
        `workflow.nodeDefs.${def.type}.label`,
        def.label,
      );

      const newNodeId = addNode(
        def.type,
        { x, y },
        defaultParams,
        localizedLabel,
        def.params,
        def.inputs,
        def.outputs,
      );

      // If creating inside an Iterator, adopt immediately
      // adoptNode converts absolute position to relative and sets parentNode + extent
      if (adoptParent) {
        useWorkflowStore.getState().adoptNode(adoptParent, newNodeId);
        if (pendingParentId)
          useUIStore.getState().setPendingIteratorParentId(null);
      }

      recordRecentNodeType(def.type);
      // Auto-close palette after adding a node
      toggleNodePalette();
    },
    [addNode, t, toggleNodePalette],
  );

  const handleModelClick = useCallback(
    (model: { model_id: string; name: string }) => {
      const pendingParentId = useUIStore.getState().pendingIteratorParentId;
      const editGroupId = useUIStore.getState().editingGroupId;
      const adoptParent = pendingParentId || editGroupId;
      const aiTaskDef = definitions.find((d) => d.type === "ai-task/run");
      const defaultParams: Record<string, unknown> = {};
      if (aiTaskDef) {
        for (const p of aiTaskDef.params) {
          if (p.default !== undefined) defaultParams[p.key] = p.default;
        }
      }
      defaultParams.modelId = model.model_id;

      let x: number, y: number;

      if (adoptParent) {
        const iteratorNode = useWorkflowStore
          .getState()
          .nodes.find((n) => n.id === adoptParent);
        if (iteratorNode) {
          const itW = (iteratorNode.data?.params?.__nodeWidth as number) ?? 600;
          const itH =
            (iteratorNode.data?.params?.__nodeHeight as number) ?? 400;
          const childW = (defaultParams.__nodeWidth as number) ?? 300;
          const inputDefs = iteratorNode.data?.inputDefinitions ?? [];
          const outputDefs = iteratorNode.data?.outputDefinitions ?? [];
          const leftStrip = (inputDefs as unknown[]).length > 0 ? 140 : 24;
          const rightStrip = (outputDefs as unknown[]).length > 0 ? 140 : 24;
          const internalW = itW - leftStrip - rightStrip;
          x =
            iteratorNode.position.x +
            leftStrip +
            Math.max(10, (internalW - childW) / 2);
          y = iteratorNode.position.y + Math.max(60, itH / 2 - 40);
        } else {
          const center = useUIStore.getState().getViewportCenter();
          x = center.x + (Math.random() - 0.5) * 60;
          y = center.y + (Math.random() - 0.5) * 60;
        }
      } else {
        const center = useUIStore.getState().getViewportCenter();
        x = center.x + (Math.random() - 0.5) * 60;
        y = center.y + (Math.random() - 0.5) * 60;
      }

      const desktopModel = useModelsStore
        .getState()
        .models.find((m) => m.model_id === model.model_id);
      let modelSchema: Array<{ name: string; default?: unknown }> = [];
      if (desktopModel) {
        modelSchema = formFieldsToModelParamSchema(
          getFormFieldsFromModel(desktopModel),
        );
      }

      const newNodeId = addNode(
        "ai-task/run",
        { x, y },
        defaultParams,
        model.name,
        aiTaskDef?.params ?? [],
        aiTaskDef?.inputs ?? [],
        aiTaskDef?.outputs ?? [],
      );

      const { updateNodeParams, updateNodeData } = useWorkflowStore.getState();
      const nextParams: Record<string, unknown> = { ...defaultParams };
      for (const p of modelSchema) {
        if (p.default !== undefined) nextParams[p.name] = p.default;
      }
      nextParams.modelId = model.model_id;
      updateNodeParams(newNodeId, nextParams);
      updateNodeData(newNodeId, {
        modelInputSchema: modelSchema,
        label: model.name,
      });

      // If creating inside an Iterator, adopt immediately
      if (adoptParent) {
        useWorkflowStore.getState().adoptNode(adoptParent, newNodeId);
        if (pendingParentId)
          useUIStore.getState().setPendingIteratorParentId(null);
      }

      recordRecentNodeType("ai-task/run");
      toggleNodePalette();
    },
    [addNode, definitions, toggleNodePalette],
  );

  const categoryOrder = [
    "trigger",
    "ai-task",
    "input",
    "output",
    "processing",
    "control",
    "free-tool",
  ];
  const categoryLabel = useCallback(
    (cat: string) => t(`workflow.nodeCategory.${cat}`, cat),
    [t],
  );

  const editingGroupId = useUIStore((s) => s.editingGroupId);

  const displayDefs = useMemo(() => {
    let defs = definitions;
    // When inside a Group subgraph, filter out the iterator type (no nesting allowed)
    if (pendingIteratorParentId || editingGroupId) {
      defs = defs.filter((d) => d.type !== "control/iterator");
    }
    const q = query.trim();
    if (!q) return defs;
    return fuzzySearch(defs, q, (def) => [
      def.type,
      def.label,
      t(`workflow.nodeDefs.${def.type}.label`, def.label),
      def.category,
    ]).map((r) => r.item);
  }, [definitions, query, t, pendingIteratorParentId, editingGroupId]);

  const groupedDefs = useMemo(() => {
    const groups = new Map<string, NodeTypeDefinition[]>();
    for (const def of displayDefs) {
      const arr = groups.get(def.category) ?? [];
      arr.push(def);
      groups.set(def.category, arr);
    }
    return [...groups.entries()].sort((a, b) => {
      const ai = categoryOrder.indexOf(a[0]);
      const bi = categoryOrder.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [displayDefs]);

  // Flat list of all visible items for keyboard navigation
  type PaletteItem =
    | { kind: "def"; def: NodeTypeDefinition }
    | { kind: "model"; model: (typeof storeModels)[number] };
  const flatItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    for (const [category, defs] of groupedDefs) {
      if (collapsed[category]) continue;
      for (const def of defs) items.push({ kind: "def", def });
    }
    for (const model of matchedModels) items.push({ kind: "model", model });
    return items;
  }, [groupedDefs, matchedModels, collapsed]);

  // Reset highlight when search changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => (i < flatItems.length - 1 ? i + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => (i > 0 ? i - 1 : flatItems.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (flatItems.length > 0) {
          const idx = Math.min(highlightIndex, flatItems.length - 1);
          const item = flatItems[idx];
          if (item.kind === "def") handleClick(item.def);
          else handleModelClick(item.model);
        }
      }
    },
    [flatItems, highlightIndex, handleClick, handleModelClick],
  );

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: MouseEvent) =>
        setSidebarWidth(startWidth + (ev.clientX - startX));
      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, setSidebarWidth],
  );

  /* ── render ──────────────────────────────────────────────── */

  return (
    <div
      className="border-r border-border/70 bg-background/95 backdrop-blur flex flex-col relative overflow-hidden h-full"
      data-guide="node-palette"
      style={{ width, minWidth: 0 }}
    >
      {/* ── header ── */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border/70 shrink-0">
        <span className="font-semibold text-[13px] text-foreground">
          {t("workflow.nodes", "Nodes")}
        </span>
        <button
          onClick={toggleNodePalette}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title={t("common.close", "Close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── iterator context banner ── */}
      {pendingIteratorParentId && (
        <div className="px-3 py-1.5 bg-cyan-500/10 border-b border-cyan-500/20 flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-cyan-500 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          <span className="text-[11px] text-cyan-400 font-medium">
            {t("workflow.addingInsideIterator", "Adding inside Iterator")}
          </span>
        </div>
      )}

      {/* ── search ── */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                toggleNodePalette();
                return;
              }
              handleKeyDown(e);
            }}
            placeholder={t(
              "workflow.searchNodesPlaceholder",
              "Search nodes or models...",
            )}
            className="w-full h-8 rounded-lg border border-border/70 bg-muted/40 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
          />
        </div>
      </div>

      {/* ── node list ── */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {(() => {
          let flatIdx = 0;
          return (
            <>
              {groupedDefs.map(([category, defs]) => {
                const isCollapsed = collapsed[category] ?? false;
                const dot = catDot[category] ?? "bg-gray-400";
                return (
                  <div key={category} className="mb-0.5">
                    {/* category header */}
                    <button
                      onClick={() =>
                        setCollapsed((prev) => ({
                          ...prev,
                          [category]: !isCollapsed,
                        }))
                      }
                      className="w-full flex items-center gap-2 px-2 h-7 rounded-lg text-muted-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      <span
                        className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot)}
                      />
                      <span className="text-[11px] font-semibold uppercase tracking-wide">
                        {categoryLabel(category)}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground/50 tabular-nums mr-0.5">
                        {defs.length}
                      </span>
                      <ChevronDown
                        className={cn(
                          "w-3 h-3 text-muted-foreground/40 transition-transform duration-200",
                          isCollapsed && "-rotate-90",
                        )}
                      />
                    </button>

                    {/* node items */}
                    {!isCollapsed && (
                      <div className="py-0.5">
                        {defs.map((def) => {
                          const myIdx = flatIdx++;
                          const isHighlighted = myIdx === highlightIndex;
                          const isAiTask = def.category === "ai-task";
                          const hint = t(
                            `workflow.nodeDefs.${def.type}.hint`,
                            "",
                          );
                          return (
                            <Tooltip key={def.type} delayDuration={0}>
                              <TooltipTrigger asChild>
                                <div
                                  ref={(el) => {
                                    if (isHighlighted && el)
                                      el.scrollIntoView({ block: "nearest" });
                                  }}
                                  data-guide-node={def.type}
                                  draggable
                                  onDragStart={(e) => onDragStart(e, def.type)}
                                  onClick={() => handleClick(def)}
                                  onMouseEnter={() => setHighlightIndex(myIdx)}
                                  className={cn(
                                    "flex items-center gap-2 h-8 px-2 rounded-lg cursor-grab select-none",
                                    "text-[12px] text-foreground/70 transition-colors duration-100",
                                    isHighlighted
                                      ? "bg-accent text-accent-foreground"
                                      : "hover:bg-muted hover:text-foreground",
                                    "active:cursor-grabbing active:bg-muted/80",
                                  )}
                                >
                                  {(() => {
                                    const Icon = getNodeIcon(def.type);
                                    return Icon ? (
                                      <div className="rounded-md bg-primary/10 p-1 flex-shrink-0">
                                        <Icon className="w-3 h-3 text-primary" />
                                      </div>
                                    ) : null;
                                  })()}
                                  <span className="truncate">
                                    {t(
                                      `workflow.nodeDefs.${def.type}.label`,
                                      def.label,
                                    )}
                                  </span>
                                  {isAiTask && (
                                    <span className="ml-auto shrink-0 text-[9px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">
                                      AI
                                    </span>
                                  )}
                                </div>
                              </TooltipTrigger>
                              {hint && (
                                <TooltipContent
                                  side="right"
                                  className="max-w-[220px]"
                                >
                                  {hint}
                                </TooltipContent>
                              )}
                            </Tooltip>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── Model search results ── */}
              {matchedModels.length > 0 && (
                <div className="mb-0.5">
                  <div className="w-full flex items-center gap-2 px-2 h-7 text-muted-foreground/80">
                    <span className="text-[11px] font-semibold uppercase tracking-wide">
                      MODELS
                    </span>
                  </div>
                  <div className="py-0.5">
                    {matchedModels.map((model) => {
                      const myIdx = flatIdx++;
                      const isHighlighted = myIdx === highlightIndex;
                      const parts = model.model_id.split("/");
                      const provider = parts[0] || "";
                      const shortName =
                        parts.slice(1).join("/") || model.model_id;
                      return (
                        <div
                          key={model.model_id}
                          ref={(el) => {
                            if (isHighlighted && el)
                              el.scrollIntoView({ block: "nearest" });
                          }}
                          onClick={() => handleModelClick(model)}
                          onMouseEnter={() => setHighlightIndex(myIdx)}
                          title={model.model_id}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer select-none",
                            "transition-colors duration-100",
                            isHighlighted ? "bg-primary/10" : "hover:bg-muted",
                          )}
                        >
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-[12px] font-semibold text-foreground truncate">
                              {shortName}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60 truncate">
                              {provider}/
                            </span>
                          </div>
                          <span className="shrink-0 text-[9px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">
                            API
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {displayDefs.length === 0 && matchedModels.length === 0 && (
                <div className="px-3 py-6 text-xs text-muted-foreground/60 text-center">
                  {t("workflow.noNodesAvailable", "No nodes available")}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* ── footer hint ── */}
      <div className="px-4 py-2 border-t border-border/70 text-[10px] text-muted-foreground/40">
        {t("workflow.dragOrClickToAdd", "Drag to canvas or click to add")}
      </div>

      {/* ── resize handle ── */}
      <div
        onMouseDown={onResizeStart}
        className={cn(
          "absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors",
          dragging ? "bg-primary" : "hover:bg-primary/50",
        )}
      />
    </div>
  );
}
