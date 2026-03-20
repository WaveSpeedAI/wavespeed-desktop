/**
 * WorkflowCanvas — ReactFlow wrapper with zoom, pan, drag-drop, and context menu.
 * Rewritten with Tailwind classes.
 */
import React, {
  useCallback,
  useRef,
  useState,
  useEffect,
  useMemo,
  type DragEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";
import ReactFlow, {
  ReactFlowProvider,
  useReactFlow,
  Background,
  BackgroundVariant,
  SelectionMode,
  type Connection,
  type ReactFlowInstance,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type OnSelectionChangeParams,
} from "reactflow";
import "reactflow/dist/style.css";
import { useWorkflowStore } from "../../stores/workflow.store";
import { useExecutionStore } from "../../stores/execution.store";
import { useUIStore } from "../../stores/ui.store";
import { CustomNode } from "./CustomNode";
import { CustomEdge } from "./CustomEdge";
import { AnnotationNode } from "./AnnotationNode";
import GroupNodeContainer from "./group-node/GroupNodeContainer";
import { GroupIONode } from "./group-node/GroupIONode";
import { useGroupAdoption } from "../../hooks/useGroupAdoption";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import type {
  NodeTypeDefinition,
  NodeCategory,
} from "@/workflow/types/node-defs";
import type { ExposedParam } from "@/workflow/types/workflow";
import { fuzzySearch } from "@/lib/fuzzySearch";
import { getNodeIcon } from "./custom-node/NodeIcons";
import { useModelsStore } from "@/stores/modelsStore";
import { getFormFieldsFromModel } from "@/lib/schemaToForm";
import { formFieldsToModelParamSchema } from "../../lib/model-converter";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Search,
  ChevronDown,
} from "lucide-react";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { SubgraphBreadcrumb } from "./SubgraphBreadcrumb";

const CATEGORY_ORDER: NodeCategory[] = [
  "ai-task",
  "input",
  "output",
  "processing",
  "control",
  "free-tool",
  "ai-generation",
];

const catDot: Record<string, string> = {
  "ai-task": "bg-violet-500",
  input: "bg-blue-500",
  output: "bg-emerald-500",
  processing: "bg-amber-500",
  "free-tool": "bg-rose-500",
  "ai-generation": "bg-violet-500",
  control: "bg-cyan-500",
};
const RECENT_NODE_TYPES_KEY = "workflowRecentNodeTypes";
const MAX_RECENT_NODE_TYPES = 8;

function loadRecentNodeTypes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_NODE_TYPES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function saveRecentNodeTypes(types: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RECENT_NODE_TYPES_KEY, JSON.stringify(types));
  } catch {
    // noop
  }
}

const nodeTypes = {
  custom: CustomNode,
  annotation: AnnotationNode,
  "control/iterator": GroupNodeContainer,
  "group-io": GroupIONode,
};
const edgeTypes = { custom: CustomEdge };

/** Zoom in/out and fit view controls, positioned on the right of the canvas. */
function CanvasZoomControls() {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const interactionMode = useUIStore((s) => s.interactionMode);
  const setInteractionMode = useUIStore((s) => s.setInteractionMode);
  const showGrid = useUIStore((s) => s.showGrid);
  const toggleGrid = useUIStore((s) => s.toggleGrid);
  const nodes = useWorkflowStore((s) => s.nodes);
  const updateNodeParams = useWorkflowStore((s) => s.updateNodeParams);

  // Check if any non-annotation node is currently expanded (not collapsed)
  const hasExpandedNodes = nodes.some(
    (n) => n.type !== "annotation" && n.data?.nodeType !== "control/iterator" && !n.data?.params?.__nodeCollapsed,
  );

  const toggleAllCollapsed = useCallback(() => {
    const shouldCollapse = hasExpandedNodes;
    for (const n of nodes) {
      if (n.type === "annotation") continue;
      // Group nodes are not collapsible — skip them
      if (n.data?.nodeType === "control/iterator") continue;
      const current = Boolean(n.data?.params?.__nodeCollapsed);
      if (current !== shouldCollapse) {
        updateNodeParams(n.id, {
          ...n.data.params,
          __nodeCollapsed: shouldCollapse,
        });
      }
    }
  }, [nodes, hasExpandedNodes, updateNodeParams]);
  return (
    <div
      className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex flex-col rounded-lg border border-border bg-card shadow-lg overflow-hidden"
      data-guide="canvas-tools"
    >
      {/* Grid toggle */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={toggleGrid}
            className={`flex items-center justify-center w-9 h-9 transition-colors ${showGrid ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M3 15h18" />
              <path d="M9 3v18" />
              <path d="M15 3v18" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {t("workflow.toggleGrid", "Toggle Grid")}
        </TooltipContent>
      </Tooltip>
      <div className="h-px bg-border" />
      {/* Select / Hand toggle */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() =>
              setInteractionMode(interactionMode === "hand" ? "select" : "hand")
            }
            className={`flex items-center justify-center w-9 h-9 transition-colors ${interactionMode === "select" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
          >
            {interactionMode === "select" ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                <path d="M13 13l6 6" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
                <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
                <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
                <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
              </svg>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {interactionMode === "select"
            ? t("workflow.selectMode", "Select (V / Space)")
            : t("workflow.handMode", "Hand (H / Space)")}
        </TooltipContent>
      </Tooltip>
      <div className="h-px bg-border" />
      {/* Zoom in */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => zoomIn({ duration: 200 })}
            className="flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <span className="text-lg font-medium leading-none">+</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {t("workflow.zoomIn", "Zoom in")}
        </TooltipContent>
      </Tooltip>
      {/* Zoom out */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => zoomOut({ duration: 200 })}
            className="flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-t border-border"
          >
            <span className="text-lg font-medium leading-none">−</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {t("workflow.zoomOut", "Zoom out")}
        </TooltipContent>
      </Tooltip>
      {/* Collapse / Expand all nodes */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={toggleAllCollapsed}
            className="flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-t border-border"
          >
            {hasExpandedNodes ? (
              <ChevronsDownUp className="w-[15px] h-[15px]" />
            ) : (
              <ChevronsUpDown className="w-[15px] h-[15px]" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {hasExpandedNodes
            ? t("workflow.collapseAll", "Collapse All")
            : t("workflow.expandAll", "Expand All")}
        </TooltipContent>
      </Tooltip>
      <div className="h-px bg-border" />
      {/* Fit view */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() =>
              fitView({
                padding: 0.2,
                duration: 300,
                minZoom: 0.05,
                maxZoom: 1.5,
              })
            }
            className="flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {t("workflow.fitView", "Fit View")}
        </TooltipContent>
      </Tooltip>
      {/* Auto layout */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new Event("workflow:auto-layout"))
            }
            className="flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-t border-border"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <rect x="15" y="3" width="6" height="6" rx="1" />
              <rect x="9" y="15" width="6" height="6" rx="1" />
              <path d="M9 6h6" />
              <path d="M12 9v6" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {t("workflow.autoLayout", "Auto Layout")}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

interface WorkflowCanvasProps {
  nodeDefs?: NodeTypeDefinition[];
}

export function WorkflowCanvas({ nodeDefs = [] }: WorkflowCanvasProps) {
  const { t } = useTranslation();
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    addEdge,
    updateEdge: updateEdgeInStore,
    addNode,
    removeNode,
    removeNodes,
    undo,
    redo,
    saveWorkflow,
  } = useWorkflowStore();
  const selectedNodeId = useUIStore((s) => s.selectedNodeId);
  const selectedNodeIds = useUIStore((s) => s.selectedNodeIds);
  const selectNode = useUIStore((s) => s.selectNode);
  const selectNodes = useUIStore((s) => s.selectNodes);
  const interactionMode = useUIStore((s) => s.interactionMode);
  const setInteractionMode = useUIStore((s) => s.setInteractionMode);
  const showGrid = useUIStore((s) => s.showGrid);
  const editingGroupId = useUIStore((s) => s.editingGroupId);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "node" | "canvas" | "addNode" | "edge";
    nodeId?: string;
    edgeId?: string;
  } | null>(null);
  // When the add-node menu is opened from a node's side button, store placement info
  const sideAddRef = useRef<{
    sourceNodeId: string;
    side: "left" | "right";
  } | null>(null);
  const [addNodeQuery, setAddNodeQuery] = useState("");
  const [addNodeHighlightIndex, setAddNodeHighlightIndex] = useState(0);
  const addNodeListRef = useRef<HTMLDivElement>(null);
  const [addNodeCollapsed, setAddNodeCollapsed] = useState<
    Record<string, boolean>
  >({});
  const [recentNodeTypes, setRecentNodeTypes] = useState<string[]>(() =>
    loadRecentNodeTypes(),
  );

  const recordRecentNodeType = useCallback((nodeType: string) => {
    setRecentNodeTypes((prev) => {
      const next = [nodeType, ...prev.filter((t) => t !== nodeType)].slice(
        0,
        MAX_RECENT_NODE_TYPES,
      );
      saveRecentNodeTypes(next);
      return next;
    });
  }, []);

  // ── Iterator adoption: drag-in/out detection, auto-adopt on create, release on delete ──
  const {
    handleNodesChangeForAdoption,
    handleNodeCreated,
    handleNodesDeleted,
  } = useGroupAdoption();

  // Track virtual IO node positions across re-renders (they're not in the store).
  // Use state (not ref) so displayNodes memo recomputes when drag ends.
  const [ioNodePositions, setIoNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const lastEditingGroupIdRef = useRef<string | null>(null);

  // Reset IO positions when entering a different group
  if (editingGroupId !== lastEditingGroupIdRef.current) {
    lastEditingGroupIdRef.current = editingGroupId;
    // Schedule state update (can't setState during render directly in strict mode)
    // Using a ref flag to batch it
    if (Object.keys(ioNodePositions).length > 0) {
      // Will be reset via the effect below
    }
  }
  useEffect(() => {
    if (!editingGroupId) {
      setIoNodePositions({});
      return;
    }
    // Restore saved IO node positions from group params, or compute defaults.
    const currentNodes = useWorkflowStore.getState().nodes;
    const groupNode = currentNodes.find((n) => n.id === editingGroupId);
    const savedPositions = groupNode?.data?.params?.__ioNodePositions as
      | Record<string, { x: number; y: number }>
      | undefined;

    const inputId = `__group-input-${editingGroupId}`;
    const outputId = `__group-output-${editingGroupId}`;

    if (savedPositions && savedPositions[inputId] && savedPositions[outputId]) {
      setIoNodePositions(savedPositions);
    } else {
      // Compute initial positions from child bounding box
      const childNodes = currentNodes.filter((n) => n.parentNode === editingGroupId);
      let minX = 0, minY = 0, maxX = 400, maxY = 300;
      if (childNodes.length > 0) {
        minX = Math.min(...childNodes.map((n) => n.position.x));
        minY = Math.min(...childNodes.map((n) => n.position.y));
        maxX = Math.max(...childNodes.map((n) => n.position.x + 380));
        maxY = Math.max(...childNodes.map((n) => n.position.y + 200));
      }
      const centerY = (minY + maxY) / 2 - 60;
      const IO_MARGIN = 400;
      const positions = {
        [inputId]: { x: minX - IO_MARGIN, y: centerY },
        [outputId]: { x: maxX + IO_MARGIN - 220, y: centerY },
      };
      setIoNodePositions(positions);
      // Persist the computed defaults
      useWorkflowStore.getState().updateNodeParams(editingGroupId, {
        ...groupNode?.data?.params,
        __ioNodePositions: positions,
      });
    }
  }, [editingGroupId]);

  /** Wrapped onNodesChange that also triggers iterator adoption detection */
  const onNodesChangeWithAdoption = useCallback(
    (changes: NodeChange[]) => {
      // Collect IO node position updates — commit to state when drag ends
      // so displayNodes memo recomputes and the node stays in place.
      const ioUpdates: Record<string, { x: number; y: number }> = {};
      let hasIoUpdate = false;
      let ioDragEnded = false;
      for (const c of changes) {
        const cid = (c as any).id as string | undefined;
        if (cid && String(cid).startsWith("__group-") && c.type === "position") {
          const posChange = c as any;
          if (posChange.position) {
            ioUpdates[cid] = { ...posChange.position };
            hasIoUpdate = true;
          }
          if (posChange.dragging === false) {
            ioDragEnded = true;
          }
        }
      }
      if (hasIoUpdate) {
        setIoNodePositions((prev) => {
          const next = { ...prev, ...ioUpdates };
          // Persist to group node params when drag ends
          if (ioDragEnded && editingGroupId) {
            const groupNode = useWorkflowStore.getState().nodes.find((n) => n.id === editingGroupId);
            if (groupNode) {
              useWorkflowStore.getState().updateNodeParams(editingGroupId, {
                ...groupNode.data?.params,
                __ioNodePositions: next,
              });
            }
          }
          return next;
        });
      }

      // Only pass real (non-IO) changes to the store
      const storeChanges = changes.filter((c) => {
        const id = (c as any).id;
        return !id || !String(id).startsWith("__group-");
      });
      if (storeChanges.length > 0) {
        onNodesChange(storeChanges);
      }
      handleNodesChangeForAdoption(storeChanges);
    },
    [onNodesChange, handleNodesChangeForAdoption, editingGroupId],
  );

  /** Wrapped onEdgesChange that filters out virtual IO edge changes */
  const onEdgesChangeFiltered = useCallback(
    (changes: EdgeChange[]) => {
      const realChanges = changes.filter((c) => {
        const id = (c as any).id;
        return !id || !String(id).startsWith("__io-");
      });
      if (realChanges.length > 0) {
        onEdgesChange(realChanges);
      }
    },
    [onEdgesChange],
  );

  /* ── Subgraph filtering: when editing a Group, show only its children ── */
  const displayNodes = useMemo(() => {
    if (!editingGroupId) {
      // Main view: hide children of all groups (they're inside subgraphs)
      return nodes.map((n) => (n.parentNode ? { ...n, hidden: true } : n));
    }
    // Subgraph view: show only children of the editing group, as top-level nodes
    const childNodes: Node[] = nodes
      .filter((n) => n.parentNode === editingGroupId)
      .map((n) => ({
        ...n,
        parentNode: undefined,
        hidden: false,
        position: { ...n.position },
      }));

    // Inject virtual Group Input / Group Output proxy nodes pinned to screen edges
    const groupNode = nodes.find((n) => n.id === editingGroupId);
    if (!groupNode) return childNodes;

    const parseExposed = (key: string): ExposedParam[] => {
      try {
        const raw = groupNode.data?.params?.[key];
        return typeof raw === "string"
          ? JSON.parse(raw)
          : Array.isArray(raw)
            ? raw
            : [];
      } catch {
        return [];
      }
    };
    const exposedInputs = parseExposed("exposedInputs");
    const exposedOutputs = parseExposed("exposedOutputs");

    const inputId = `__group-input-${editingGroupId}`;
    const outputId = `__group-output-${editingGroupId}`;

    // IO node positions are initialized once when entering the group (via useEffect)
    // and updated only by user dragging. They never recalculate from child bounding box.
    const inputPos = ioNodePositions[inputId] ?? { x: -280, y: 0 };
    const outputPos = ioNodePositions[outputId] ?? { x: 460, y: 0 };

    const result: Node[] = [...childNodes];
    // Always inject IO nodes so users can configure params even when none are exposed yet
    result.push({
      id: inputId,
      type: "group-io",
      position: inputPos,
      data: {
        direction: "input",
        exposedParams: exposedInputs,
        groupId: editingGroupId,
      },
      selectable: true,
      draggable: true,
      connectable: false,
      deletable: false,
    });
    result.push({
      id: outputId,
      type: "group-io",
      position: outputPos,
      data: {
        direction: "output",
        exposedParams: exposedOutputs,
        groupId: editingGroupId,
      },
      selectable: true,
      draggable: true,
      connectable: false,
      deletable: false,
    });

    return result;
  }, [nodes, editingGroupId, ioNodePositions]);

  const displayEdges = useMemo(() => {
    if (!editingGroupId) return edges;
    const childIds = new Set(
      nodes.filter((n) => n.parentNode === editingGroupId).map((n) => n.id),
    );

    // Regular edges between children
    const childEdges = edges.filter(
      (e) => childIds.has(e.source) && childIds.has(e.target),
    );

    // Remap auto-edges from Group capsule inner handles to virtual IO nodes
    const groupNode = nodes.find((n) => n.id === editingGroupId);
    if (!groupNode) return childEdges;

    const parseExposed = (key: string): ExposedParam[] => {
      try {
        const raw = groupNode.data?.params?.[key];
        return typeof raw === "string"
          ? JSON.parse(raw)
          : Array.isArray(raw)
            ? raw
            : [];
      } catch {
        return [];
      }
    };
    const exposedInputs = parseExposed("exposedInputs");
    const exposedOutputs = parseExposed("exposedOutputs");

    const ioEdges: typeof edges = [];
    const inputProxyId = `__group-input-${editingGroupId}`;
    const outputProxyId = `__group-output-${editingGroupId}`;

    // For each auto-edge from Group inner handle → child, remap to virtual IO node
    for (const e of edges) {
      if (!e.data?.isInternal) continue;
      // Input auto-edges: source=groupId, sourceHandle=input-inner-{nk} → target=child
      if (
        e.source === editingGroupId &&
        e.sourceHandle?.startsWith("input-inner-") &&
        childIds.has(e.target)
      ) {
        const nk = e.sourceHandle.replace("input-inner-", "");
        if (exposedInputs.some((ep) => ep.namespacedKey === nk)) {
          ioEdges.push({
            ...e,
            id: `__io-${e.id}`,
            source: inputProxyId,
            sourceHandle: `group-io-${nk}`,
            type: "custom",
          });
        }
      }
      // Output auto-edges: source=child → target=groupId, targetHandle=output-inner-{nk}
      if (
        e.target === editingGroupId &&
        e.targetHandle?.startsWith("output-inner-") &&
        childIds.has(e.source)
      ) {
        const nk = e.targetHandle.replace("output-inner-", "");
        if (exposedOutputs.some((ep) => ep.namespacedKey === nk)) {
          ioEdges.push({
            ...e,
            id: `__io-${e.id}`,
            target: outputProxyId,
            targetHandle: `group-io-${nk}`,
            type: "custom",
          });
        }
      }
    }

    return [...childEdges, ...ioEdges];
  }, [edges, nodes, editingGroupId]);

  /** Wrapped removeNode that releases child from iterator before deletion */
  const removeNodeWithRelease = useCallback(
    (nodeId: string) => {
      handleNodesDeleted([nodeId]);
      removeNode(nodeId);
    },
    [removeNode, handleNodesDeleted],
  );

  /** Wrapped removeNodes that releases children from iterators before deletion */
  const removeNodesWithRelease = useCallback(
    (nodeIds: string[]) => {
      handleNodesDeleted(nodeIds);
      removeNodes(nodeIds);
    },
    [removeNodes, handleNodesDeleted],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;
      if (event.isComposing || event.key === "Process") return;
      const ctrlOrCmd =
        navigator.platform.toUpperCase().indexOf("MAC") >= 0
          ? event.metaKey
          : event.ctrlKey;

      // Ctrl+A: select all nodes — but let inputs handle their own select-all
      if (ctrlOrCmd && event.key === "a") {
        if (isInputFocused) return; // let the browser select text in the input
        event.preventDefault();
        // Update our store
        selectNodes(nodes.map((n) => n.id));
        // Also update React Flow's internal selection state
        const changes: NodeChange[] = nodes.map((n) => ({
          type: "select" as const,
          id: n.id,
          selected: true,
        }));
        onNodesChange(changes);
        return;
      }

      // Other shortcuts only work when not in an input field
      if (isInputFocused) return;

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedNodeIds.size > 0
      ) {
        // Don't delete virtual IO nodes
        const deletableIds = [...selectedNodeIds].filter(
          (nid) => !nid.startsWith("__group-"),
        );
        if (deletableIds.length === 0) return;
        event.preventDefault();
        if (deletableIds.length === 1) {
          removeNodeWithRelease(deletableIds[0]);
          selectNode(null);
        } else {
          removeNodesWithRelease(deletableIds);
          selectNode(null);
        }
      }
      if (ctrlOrCmd && event.key === "c" && selectedNodeId) {
        // Don't intercept if user has selected text (e.g. in results panel)
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        event.preventDefault();
        const node = nodes.find((n) => n.id === selectedNodeId);
        if (node) localStorage.setItem("copiedNode", JSON.stringify(node));
      }
      if (ctrlOrCmd && event.key === "s") {
        event.preventDefault();
        saveWorkflow().catch(console.error);
      }
      if (ctrlOrCmd && event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      }
      if (ctrlOrCmd && event.key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      }
      if (ctrlOrCmd && event.key === "y") {
        event.preventDefault();
        redo();
      }
      // V = Select mode, H = Hand (pan) mode, Space = Toggle
      if (event.key === "v" || event.key === "V") {
        if (!ctrlOrCmd) {
          setInteractionMode("select");
        }
      }
      if (event.key === "h" || event.key === "H") {
        if (!ctrlOrCmd) {
          setInteractionMode("hand");
        }
      }
      if (event.key === " ") {
        event.preventDefault();
        const current = useUIStore.getState().interactionMode;
        setInteractionMode(current === "select" ? "hand" : "select");
      }
      // `/` — toggle Node Palette (add node panel)
      if (event.key === "/") {
        event.preventDefault();
        useUIStore.getState().toggleNodePalette();
      }
      if (ctrlOrCmd && event.key === "v") {
        event.preventDefault();
        const copiedNode = localStorage.getItem("copiedNode");
        if (copiedNode && reactFlowInstance.current) {
          try {
            const node = JSON.parse(copiedNode);
            const center = useUIStore.getState().getViewportCenter();
            const pastedNodeId = addNode(
              node.data.nodeType,
              {
                x: center.x + (Math.random() - 0.5) * 60,
                y: center.y + (Math.random() - 0.5) * 60,
              },
              node.data.params,
              node.data.label,
              node.data.paramDefinitions ?? [],
              node.data.inputDefinitions ?? [],
              node.data.outputDefinitions ?? [],
            );
            handleNodeCreated(pastedNodeId);
            if (typeof node.data?.nodeType === "string")
              recordRecentNodeType(node.data.nodeType);
          } catch (e) {
            console.error("Failed to paste node:", e);
          }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [
    selectedNodeId,
    selectedNodeIds,
    removeNodeWithRelease,
    removeNodesWithRelease,
    selectNode,
    selectNodes,
    nodes,
    addNode,
    undo,
    redo,
    saveWorkflow,
    recordRecentNodeType,
    handleNodeCreated,
    onNodesChangeWithAdoption,
  ]);

  // Touch gesture handling: 2 fingers = pan, 3 fingers = select, pinch = zoom (native)
  useEffect(() => {
    const wrapper = reactFlowWrapper.current;
    if (!wrapper) return;

    let modeBeforeTouch: "select" | "hand" | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 3) {
        // 3+ fingers → select mode
        modeBeforeTouch = useUIStore.getState().interactionMode;
        if (modeBeforeTouch !== "select") {
          setInteractionMode("select");
        }
      } else if (e.touches.length === 2) {
        // 2 fingers → pan mode (pinch zoom handled natively by ReactFlow)
        modeBeforeTouch = useUIStore.getState().interactionMode;
        if (modeBeforeTouch !== "hand") {
          setInteractionMode("hand");
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      // Restore previous mode when all fingers are lifted
      if (e.touches.length === 0 && modeBeforeTouch !== null) {
        setInteractionMode(modeBeforeTouch);
        modeBeforeTouch = null;
      }
    };

    wrapper.addEventListener("touchstart", onTouchStart, { passive: true });
    wrapper.addEventListener("touchend", onTouchEnd, { passive: true });
    wrapper.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      wrapper.removeEventListener("touchstart", onTouchStart);
      wrapper.removeEventListener("touchend", onTouchEnd);
      wrapper.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [setInteractionMode]);

  const onConnect = useCallback(
    (connection: Connection) => addEdge(connection),
    [addEdge],
  );

  // Edge reconnection: drag an existing edge endpoint to a different handle
  const edgeUpdateSuccessful = useRef(true);
  const onEdgeUpdateStart = useCallback(() => {
    edgeUpdateSuccessful.current = false;
  }, []);
  const onEdgeUpdate = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      edgeUpdateSuccessful.current = true;
      updateEdgeInStore(oldEdge, newConnection);
      // After reconnection the node UI changes (connected params show badges
      // instead of form controls), which moves handle DOM positions internally
      // even though the node's outer size may stay the same. React Flow only
      // re-measures handles via ResizeObserver when the outer size changes.
      // Workaround: after the DOM settles, force React Flow to re-measure by
      // dispatching dimension changes for affected nodes.
      requestAnimationFrame(() => {
        const affectedNodeIds = new Set<string>();
        if (oldEdge.source) affectedNodeIds.add(oldEdge.source);
        if (oldEdge.target) affectedNodeIds.add(oldEdge.target);
        if (newConnection.source) affectedNodeIds.add(newConnection.source);
        if (newConnection.target) affectedNodeIds.add(newConnection.target);
        // Nudge each affected node's width by ±1px to trigger ResizeObserver,
        // then restore it on the next frame.
        for (const nid of affectedNodeIds) {
          const el = document.querySelector(
            `.react-flow__node[data-id="${nid}"]`,
          ) as HTMLElement | null;
          if (el) {
            const origWidth = el.style.width;
            el.style.width = `${el.offsetWidth + 1}px`;
            requestAnimationFrame(() => {
              el.style.width = origWidth;
            });
          }
        }
      });
    },
    [updateEdgeInStore],
  );
  const onEdgeUpdateEnd = useCallback(
    (_: MouseEvent | TouchEvent, _edge: Edge) => {
      // If the drag didn't land on a valid handle, snap back — do NOT delete the edge
      edgeUpdateSuccessful.current = true;
    },
    [],
  );
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => selectNode(node.id),
    [selectNode],
  );

  // Select node on drag start so users can drag any node immediately
  // without needing to click-select it first.
  const onNodeDragStart = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === "control/iterator") {
      useUIStore.getState().enterGroupEdit(node.id);
    }
  }, []);
  const onPaneClick = useCallback(() => {
    selectNode(null);
    setContextMenu(null);
    // Clear stale pending iterator parent when clicking on empty canvas
    useUIStore.getState().setPendingIteratorParentId(null);
  }, [selectNode]);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      const ids = selectedNodes.map((n) => n.id);
      if (ids.length === 0) return; // pane click handles deselect
      selectNodes(ids);
    },
    [selectNodes],
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        type: "node",
        nodeId: node.id,
      });
    },
    [],
  );

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, type: "canvas" });
  }, []);

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: { id: string }) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        type: "edge",
        edgeId: edge.id,
      });
    },
    [],
  );

  const openAddNodeMenu = useCallback((x: number, y: number) => {
    setAddNodeQuery("");
    setAddNodeHighlightIndex(0);
    setContextMenu({ x, y, type: "addNode" });
  }, []);

  const projectMenuPosition = useCallback((x: number, y: number) => {
    if (!reactFlowInstance.current || !reactFlowWrapper.current)
      return { x, y };
    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    return reactFlowInstance.current.project({
      x: x - bounds.left,
      y: y - bounds.top,
    });
  }, []);

  const addNodeAtMenuPosition = useCallback(
    (def: NodeTypeDefinition) => {
      if (!contextMenu) return;
      const defaultParams: Record<string, unknown> = {};
      for (const p of def.params) {
        if (p.default !== undefined) defaultParams[p.key] = p.default;
      }
      // Iterator nodes need default bounding box dimensions
      if (def.type === "control/iterator") {
        defaultParams.__nodeWidth = 600;
        defaultParams.__nodeHeight = 400;
      }
      const localizedLabel = t(
        `workflow.nodeDefs.${def.type}.label`,
        def.label,
      );

      // If opened from a node's side button, place the new node beside the source node
      let position: { x: number; y: number };
      const sideInfo = sideAddRef.current;
      if (sideInfo) {
        const sourceNode = nodes.find((n) => n.id === sideInfo.sourceNodeId);
        if (sourceNode) {
          const sourceEl = document.querySelector(
            `.react-flow__node[data-id="${sideInfo.sourceNodeId}"]`,
          ) as HTMLElement | null;
          const sourceW = sourceEl?.offsetWidth ?? 380;
          const GAP = 80;

          // If source node is inside an iterator, its position is relative to the parent.
          // Convert to absolute coordinates so the new node is placed correctly.
          let absX = sourceNode.position.x;
          let absY = sourceNode.position.y;
          if (sourceNode.parentNode) {
            const parentNode = nodes.find(
              (n) => n.id === sourceNode.parentNode,
            );
            if (parentNode) {
              absX += parentNode.position.x;
              absY += parentNode.position.y;
            }
          }

          if (sideInfo.side === "right") {
            position = {
              x: absX + sourceW + GAP,
              y: absY,
            };
          } else {
            // Place to the left; estimate new node width as default
            const newNodeW = (defaultParams.__nodeWidth as number) ?? 380;
            position = {
              x: absX - newNodeW - GAP,
              y: absY,
            };
          }
        } else {
          position = projectMenuPosition(contextMenu.x, contextMenu.y);
        }
        sideAddRef.current = null;
      } else {
        position = projectMenuPosition(contextMenu.x, contextMenu.y);
      }

      const newNodeId = addNode(
        def.type,
        position,
        defaultParams,
        localizedLabel,
        def.params,
        def.inputs,
        def.outputs,
      );
      recordRecentNodeType(def.type);
      handleNodeCreated(newNodeId);

      // If pendingIteratorParentId is set (e.g. from child node "+" button),
      // adopt the new node into the iterator
      const pendingItId = useUIStore.getState().pendingIteratorParentId;
      const editGroupId = useUIStore.getState().editingGroupId;
      const adoptParent = pendingItId || editGroupId;
      if (adoptParent) {
        // When in subgraph editing mode, the viewport shows child nodes at their
        // relative positions (parentNode stripped). projectMenuPosition gives coords
        // in that relative space. But adoptNode subtracts the group's absolute
        // position, so we pre-add it to compensate.
        if (editGroupId) {
          const storeState = useWorkflowStore.getState();
          const groupNode = storeState.nodes.find((n) => n.id === editGroupId);
          if (groupNode) {
            storeState.onNodesChange([{
              type: "position" as const,
              id: newNodeId,
              position: {
                x: position.x + groupNode.position.x,
                y: position.y + groupNode.position.y,
              },
            }]);
          }
        }
        const { adoptNode } = useWorkflowStore.getState();
        adoptNode(adoptParent, newNodeId);
        if (pendingItId) useUIStore.getState().setPendingIteratorParentId(null);
      }

      setContextMenu(null);
    },
    [
      addNode,
      contextMenu,
      nodes,
      projectMenuPosition,
      t,
      recordRecentNodeType,
      handleNodeCreated,
    ],
  );

  const addNodeDisplayDefs = useMemo(() => {
    let defs = nodeDefs;
    // When inside a Group subgraph, hide the iterator type (no nesting allowed)
    if (editingGroupId) {
      defs = defs.filter((d) => d.type !== "control/iterator");
    }
    const q = addNodeQuery.trim();
    if (!q) return defs;
    return fuzzySearch(defs, q, (def) => [
      def.type,
      def.category,
      def.label,
      t(`workflow.nodeDefs.${def.type}.label`, def.label),
    ]).map((r) => r.item);
  }, [addNodeQuery, nodeDefs, t, editingGroupId]);

  const groupedAddNodeDefs = useMemo(() => {
    const recentVisible = recentNodeTypes
      .map((type) => nodeDefs.find((def) => def.type === type))
      .filter((def): def is NodeTypeDefinition => Boolean(def))
      .filter((def) =>
        addNodeDisplayDefs.some((visible) => visible.type === def.type),
      );
    const recentTypeSet = new Set(recentVisible.map((def) => def.type));

    const groups = new Map<string, NodeTypeDefinition[]>();
    for (const def of addNodeDisplayDefs) {
      if (recentTypeSet.has(def.type)) continue;
      const arr = groups.get(def.category) ?? [];
      arr.push(def);
      groups.set(def.category, arr);
    }

    const sorted = [...groups.entries()].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0] as NodeCategory);
      const bi = CATEGORY_ORDER.indexOf(b[0] as NodeCategory);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    if (recentVisible.length > 0) {
      return [
        ["recent", recentVisible] as [string, NodeTypeDefinition[]],
        ...sorted,
      ];
    }
    return sorted;
  }, [addNodeDisplayDefs, nodeDefs, recentNodeTypes]);

  // ── Model search: when user types a query, also fuzzy-search WaveSpeed models ──
  const storeModels = useModelsStore((s) => s.models);
  const fetchModels = useModelsStore((s) => s.fetchModels);
  useEffect(() => {
    if (storeModels.length === 0) fetchModels();
  }, [storeModels.length, fetchModels]);

  const matchedModels = useMemo(() => {
    const q = addNodeQuery.trim();
    if (!q) return [];
    return fuzzySearch(storeModels, q, (m) => [
      m.name,
      m.model_id,
      m.type ?? "",
    ])
      .map((r) => r.item)
      .slice(0, 12);
  }, [addNodeQuery, storeModels]);

  // Flat list of all selectable items for keyboard navigation in add-node menu
  type AddNodeItem =
    | { kind: "def"; def: NodeTypeDefinition }
    | { kind: "model"; model: (typeof storeModels)[number] };
  const addNodeFlatItems = useMemo<AddNodeItem[]>(() => {
    const items: AddNodeItem[] = [];
    for (const [category, defs] of groupedAddNodeDefs) {
      if (addNodeCollapsed[category]) continue;
      for (const def of defs) items.push({ kind: "def", def });
    }
    for (const model of matchedModels) items.push({ kind: "model", model });
    return items;
  }, [groupedAddNodeDefs, matchedModels, addNodeCollapsed]);

  // Reset highlight when search changes
  useEffect(() => {
    setAddNodeHighlightIndex(0);
  }, [addNodeQuery]);

  /** Add an ai-task/run node with a specific model pre-selected */
  const addModelNode = useCallback(
    (model: { model_id: string; name: string }) => {
      if (!contextMenu) return;

      const aiTaskDef = nodeDefs.find((d) => d.type === "ai-task/run");
      const defaultParams: Record<string, unknown> = {};
      if (aiTaskDef) {
        for (const p of aiTaskDef.params) {
          if (p.default !== undefined) defaultParams[p.key] = p.default;
        }
      }
      defaultParams.modelId = model.model_id;

      // Compute position (same logic as addNodeAtMenuPosition)
      let position: { x: number; y: number };
      const sideInfo = sideAddRef.current;
      if (sideInfo) {
        const sourceNode = nodes.find((n) => n.id === sideInfo.sourceNodeId);
        if (sourceNode) {
          const sourceEl = document.querySelector(
            `.react-flow__node[data-id="${sideInfo.sourceNodeId}"]`,
          ) as HTMLElement | null;
          const sourceW = sourceEl?.offsetWidth ?? 380;
          const GAP = 80;
          if (sideInfo.side === "right") {
            position = {
              x: sourceNode.position.x + sourceW + GAP,
              y: sourceNode.position.y,
            };
          } else {
            position = {
              x: sourceNode.position.x - 380 - GAP,
              y: sourceNode.position.y,
            };
          }
        } else {
          position = projectMenuPosition(contextMenu.x, contextMenu.y);
        }
        sideAddRef.current = null;
      } else {
        position = projectMenuPosition(contextMenu.x, contextMenu.y);
      }

      // Build model input schema from the desktop model store
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
        position,
        defaultParams,
        model.name,
        aiTaskDef?.params ?? [],
        aiTaskDef?.inputs ?? [],
        aiTaskDef?.outputs ?? [],
      );

      // After creation, set the model schema and label on the node data
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

      recordRecentNodeType("ai-task/run");
      handleNodeCreated(newNodeId);

      // If pendingIteratorParentId is set, adopt the new node into the iterator
      const pendingItId = useUIStore.getState().pendingIteratorParentId;
      const editGroupId = useUIStore.getState().editingGroupId;
      const adoptParent = pendingItId || editGroupId;
      if (adoptParent) {
        if (editGroupId) {
          const storeState = useWorkflowStore.getState();
          const groupNode = storeState.nodes.find((n) => n.id === editGroupId);
          if (groupNode) {
            storeState.onNodesChange([{
              type: "position" as const,
              id: newNodeId,
              position: {
                x: position.x + groupNode.position.x,
                y: position.y + groupNode.position.y,
              },
            }]);
          }
        }
        const { adoptNode: adopt } = useWorkflowStore.getState();
        adopt(adoptParent, newNodeId);
        if (pendingItId) useUIStore.getState().setPendingIteratorParentId(null);
      }

      selectNode(newNodeId);
      setContextMenu(null);
    },
    [
      addNode,
      contextMenu,
      nodes,
      nodeDefs,
      projectMenuPosition,
      recordRecentNodeType,
      handleNodeCreated,
      selectNode,
    ],
  );

  const handleAddNodeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        useUIStore.getState().setPendingIteratorParentId(null);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAddNodeHighlightIndex((i) =>
          i < addNodeFlatItems.length - 1 ? i + 1 : 0,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setAddNodeHighlightIndex((i) =>
          i > 0 ? i - 1 : addNodeFlatItems.length - 1,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (addNodeFlatItems.length > 0) {
          const idx = Math.min(
            addNodeHighlightIndex,
            addNodeFlatItems.length - 1,
          );
          const item = addNodeFlatItems[idx];
          if (item.kind === "def") addNodeAtMenuPosition(item.def);
          else addModelNode(item.model);
        }
      }
    },
    [
      addNodeFlatItems,
      addNodeHighlightIndex,
      addNodeAtMenuPosition,
      addModelNode,
    ],
  );

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (!contextMenu) return [];

    if (contextMenu.type === "edge" && contextMenu.edgeId) {
      const edgeId = contextMenu.edgeId;
      return [
        {
          label: t("workflow.deleteConnection", "Delete Connection"),
          icon: "✕",
          action: () => useWorkflowStore.getState().removeEdge(edgeId),
          destructive: true,
        },
      ];
    }

    if (contextMenu.type === "node" && contextMenu.nodeId) {
      const nodeId = contextMenu.nodeId;
      const {
        runNode: rn,
        cancelNode: cn,
        continueFrom: cf,
        retryNode: rt,
        activeExecutions,
        nodeStatuses,
      } = useExecutionStore.getState();
      const isRunning = activeExecutions.has(nodeId);
      const nodeStatus = nodeStatuses[nodeId];
      const items: ContextMenuItem[] = [];

      // Run actions — no save required; execution uses current graph from store
      const wfId = useWorkflowStore.getState().workflowId ?? "";
      const runAction =
        (action: (wfId: string, nId: string) => Promise<void>) => () => {
          action(wfId, nodeId);
        };

      if (isRunning) {
        items.push({
          label: t("workflow.cancel", "Cancel"),
          icon: "⏹",
          action: () => {
            if (wfId) cn(wfId, nodeId);
          },
        });
      } else {
        items.push({
          label: t("workflow.runNode", "Run Node"),
          icon: "▶",
          action: runAction(rn),
        });
        items.push({
          label: t("workflow.continueFrom", "Continue From"),
          icon: "⏩",
          action: runAction(cf),
        });
        if (nodeStatus === "error") {
          items.push({
            label: t("workflow.retry", "Retry"),
            icon: "🔄",
            action: runAction(rt),
          });
        }
      }

      items.push({ label: "", action: () => {}, divider: true });
      // Clear results + delete files — only show when node has results
      const hasResults =
        (useExecutionStore.getState().lastResults[nodeId] ?? []).length > 0;
      if (hasResults) {
        items.push({
          label: t("workflow.clearResults", "Clear Results"),
          icon: "🧹",
          action: async () => {
            try {
              const { historyIpc } = await import("../../ipc/ipc-client");
              await historyIpc.deleteAll(nodeId);
            } catch {
              /* best-effort */
            }
            useExecutionStore.getState().clearNodeResults(nodeId);
            // Also clear hidden runs metadata from node params
            const node = useWorkflowStore
              .getState()
              .nodes.find((n) => n.id === nodeId);
            if (node) {
              const {
                __hiddenRuns: _,
                __showLatestOnly: _2,
                ...rest
              } = node.data.params as Record<string, unknown>;
              useWorkflowStore.getState().updateNodeParams(nodeId, rest);
            }
          },
        });
      }
      items.push({
        label: t("common.copy", "Copy"),
        icon: "📋",
        shortcut: "Ctrl+C",
        action: () => {
          const n = nodes.find((n) => n.id === nodeId);
          if (n) localStorage.setItem("copiedNode", JSON.stringify(n));
        },
      });
      if (selectedNodeIds.size > 1 && selectedNodeIds.has(nodeId)) {
        items.push({
          label: t("workflow.deleteSelected", "Delete Selected ({{count}})", {
            count: selectedNodeIds.size,
          }),
          icon: "🗑️",
          shortcut: "Del",
          action: () => {
            removeNodesWithRelease([...selectedNodeIds]);
            selectNode(null);
          },
          destructive: true,
        });
      } else {
        items.push({
          label: t("workflow.delete", "Delete"),
          icon: "🗑️",
          shortcut: "Del",
          action: () => removeNodeWithRelease(nodeId),
          destructive: true,
        });
      }
      return items;
    }

    /** Convert context menu screen coords to flow position, accounting for wrapper offset */
    const menuToFlowPosition = () => {
      if (!reactFlowInstance.current || !reactFlowWrapper.current)
        return { x: contextMenu.x, y: contextMenu.y };
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      return reactFlowInstance.current.project({
        x: contextMenu.x - bounds.left,
        y: contextMenu.y - bounds.top,
      });
    };

    if (contextMenu.type === "addNode") return [];

    // Canvas context menu
    const copiedNode = localStorage.getItem("copiedNode");
    const items: ContextMenuItem[] = [
      {
        label: t("workflow.addNode", "Add Node"),
        icon: "➕",
        keepOpen: true,
        action: () => openAddNodeMenu(contextMenu.x, contextMenu.y),
      },
      {
        label: t("workflow.addNote", "Add Note"),
        icon: "📝",
        action: () => {
          const position = menuToFlowPosition();
          const noteId = uuidv4();
          useWorkflowStore.setState((state) => ({
            nodes: [
              ...state.nodes,
              {
                id: noteId,
                type: "annotation",
                position,
                data: {
                  nodeType: "annotation",
                  params: { title: "", body: "", color: "hsl(var(--muted))" },
                  label: t("workflow.note", "Note"),
                },
              },
            ],
            isDirty: true,
          }));
        },
      },
    ];
    if (copiedNode) {
      items.push({
        label: t("workflow.paste", "Paste"),
        icon: "📋",
        shortcut: "Ctrl+V",
        action: () => {
          try {
            const node = JSON.parse(copiedNode);
            const position = menuToFlowPosition();
            const pastedId = addNode(
              node.data.nodeType,
              position,
              node.data.params,
              node.data.label,
              node.data.paramDefinitions ?? [],
              node.data.inputDefinitions ?? [],
              node.data.outputDefinitions ?? [],
            );
            handleNodeCreated(pastedId);
            if (typeof node.data?.nodeType === "string")
              recordRecentNodeType(node.data.nodeType);
          } catch (e) {
            console.error("Failed to paste node:", e);
          }
        },
      });
    }
    return items;
  }, [
    contextMenu,
    removeNodeWithRelease,
    removeNodesWithRelease,
    selectedNodeIds,
    selectNode,
    nodes,
    addNode,
    openAddNodeMenu,
    t,
    recordRecentNodeType,
  ]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      if (!reactFlowInstance.current || !reactFlowWrapper.current) return;

      const nodeType = event.dataTransfer.getData(
        "application/reactflow-nodetype",
      );

      // --- Drop from node palette (existing behaviour) ---
      if (nodeType) {
        // Prevent nesting Group inside Group
        if (nodeType === "control/iterator" && useUIStore.getState().editingGroupId) {
          return;
        }
        // Only one trigger node per workflow
        if (nodeType.startsWith("trigger/")) {
          const existingTrigger = useWorkflowStore
            .getState()
            .nodes.find(
              (n) =>
                n.type?.startsWith("trigger/") ||
                n.data?.nodeType?.startsWith("trigger/"),
            );
          if (existingTrigger) {
            toast({
              title: t(
                "workflow.triggerLimitTitle",
                "Only one trigger allowed",
              ),
              description: t(
                "workflow.triggerLimitDesc",
                "A workflow can only have one trigger node. Remove the existing trigger first.",
              ),
              variant: "destructive",
            });
            return;
          }
        }

        const bounds = reactFlowWrapper.current.getBoundingClientRect();
        const position = reactFlowInstance.current.project({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });

        // If dropping inside an iterator, adopt the new node into it
        // DISABLED: nodes should only be added to groups via subgraph editing mode
        // Skip this check when in subgraph editing mode (children shown as top-level)

        const def = nodeDefs.find((d) => d.type === nodeType);
        const defaultParams: Record<string, unknown> = {};
        if (def) {
          for (const p of def.params) {
            if (p.default !== undefined) defaultParams[p.key] = p.default;
          }
        }
        // Iterator nodes need default bounding box dimensions
        if (nodeType === "control/iterator") {
          defaultParams.__nodeWidth = 600;
          defaultParams.__nodeHeight = 400;
        }
        const newNodeId = addNode(
          nodeType,
          position,
          defaultParams,
          def ? t(`workflow.nodeDefs.${def.type}.label`, def.label) : nodeType,
          def?.params ?? [],
          def?.inputs ?? [],
          def?.outputs ?? [],
        );
        recordRecentNodeType(nodeType);
        handleNodeCreated(newNodeId);
        // If in subgraph editing mode, adopt the node into the group
        if (useUIStore.getState().editingGroupId) {
          useWorkflowStore
            .getState()
            .adoptNode(useUIStore.getState().editingGroupId!, newNodeId);
        }
        selectNode(newNodeId);
        return;
      }

      // --- Drop media file from OS onto empty canvas → auto-create upload node ---
      const file = event.dataTransfer.files?.[0];
      if (!file) return;

      // Only handle media files (image / video / audio)
      const isMedia =
        file.type.startsWith("image/") ||
        file.type.startsWith("video/") ||
        file.type.startsWith("audio/");
      if (!isMedia) return;

      // If the drop landed on an existing node, let the node handle it (don't interfere)
      const target = event.target as HTMLElement;
      if (target.closest(".react-flow__node")) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.current.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const uploadDef = nodeDefs.find((d) => d.type === "input/media-upload");
      const defaultParams: Record<string, unknown> = {};
      if (uploadDef) {
        for (const p of uploadDef.params) {
          if (p.default !== undefined) defaultParams[p.key] = p.default;
        }
      }

      const newNodeId = addNode(
        "input/media-upload",
        position,
        defaultParams,
        uploadDef
          ? t(`workflow.nodeDefs.${uploadDef.type}.label`, uploadDef.label)
          : "Upload",
        uploadDef?.params ?? [],
        uploadDef?.inputs ?? [],
        uploadDef?.outputs ?? [],
      );
      recordRecentNodeType("input/media-upload");
      handleNodeCreated(newNodeId);
      selectNode(newNodeId);

      // Upload the file and update the newly created node's params
      const detectMediaType = (name: string): string => {
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext))
          return "image";
        if (["mp4", "mov", "webm", "avi", "mkv"].includes(ext)) return "video";
        if (["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(ext))
          return "audio";
        return "file";
      };

      const mediaType = detectMediaType(file.name);
      const { updateNodeParams } = useWorkflowStore.getState();

      // Show local preview immediately
      const blobUrl = URL.createObjectURL(file);
      updateNodeParams(newNodeId, {
        ...defaultParams,
        uploadedUrl: blobUrl,
        fileName: file.name,
        mediaType,
      });

      // Upload to CDN in background
      import("@/api/client").then(({ apiClient }) => {
        apiClient
          .uploadFile(file)
          .then((url) => {
            URL.revokeObjectURL(blobUrl);
            const current =
              useWorkflowStore.getState().nodes.find((n) => n.id === newNodeId)
                ?.data?.params ?? {};
            updateNodeParams(newNodeId, {
              ...current,
              uploadedUrl: url,
              fileName: file.name,
              mediaType,
            });
          })
          .catch((err) => {
            console.error("Auto-upload failed:", err);
            // Keep the blob preview so user can see what they dropped
          });
      });
    },
    [addNode, nodeDefs, recordRecentNodeType, handleNodeCreated, selectNode, t],
  );

  useEffect(() => {
    const handleFitView = () => {
      reactFlowInstance.current?.fitView({
        padding: 0.2,
        duration: 300,
        minZoom: 0.05,
        maxZoom: 1.5,
      });
    };
    window.addEventListener("workflow:fit-view", handleFitView);
    return () => window.removeEventListener("workflow:fit-view", handleFitView);
  }, []);

  // FitView when entering/exiting subgraph editing mode
  useEffect(() => {
    // Delay to let displayNodes update and render (including virtual IO nodes)
    const timer = setTimeout(() => {
      reactFlowInstance.current?.fitView({
        padding: 0.3,
        duration: 300,
        minZoom: 0.5,
        maxZoom: 1.2,
        includeHiddenNodes: false,
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [editingGroupId]);

  // Restore saved viewport when a workflow is loaded
  useEffect(() => {
    const handleWorkflowLoaded = (e: Event) => {
      const wfId = (e as CustomEvent).detail?.workflowId;
      if (!wfId || !reactFlowInstance.current) return;
      try {
        const raw = localStorage.getItem(`wf_viewport_${wfId}`);
        if (raw) {
          const vp = JSON.parse(raw);
          if (
            typeof vp.x === "number" &&
            typeof vp.y === "number" &&
            typeof vp.zoom === "number"
          ) {
            setTimeout(() => {
              reactFlowInstance.current?.setViewport(vp, { duration: 0 });
            }, 50);
            return;
          }
        }
      } catch {
        /* ignore */
      }
      // No saved viewport — fit to content
      setTimeout(() => {
        reactFlowInstance.current?.fitView({
          padding: 0.2,
          duration: 0,
          minZoom: 0.05,
          maxZoom: 1.5,
        });
      }, 50);
    };
    window.addEventListener("workflow:loaded", handleWorkflowLoaded);
    return () =>
      window.removeEventListener("workflow:loaded", handleWorkflowLoaded);
  }, []);

  // Listen for "add node" button clicks from CustomNode side buttons
  useEffect(() => {
    const handleOpenAddNodeMenu = (e: Event) => {
      const { x, y, sourceNodeId, side } = (e as CustomEvent).detail;
      if (sourceNodeId && side) {
        sideAddRef.current = { sourceNodeId, side };
        // If the source node is inside an iterator, set pendingIteratorParentId
        // so the new node is also created inside the same iterator
        const sourceNode = useWorkflowStore
          .getState()
          .nodes.find((n) => n.id === sourceNodeId);
        if (sourceNode?.parentNode) {
          useUIStore
            .getState()
            .setPendingIteratorParentId(sourceNode.parentNode);
        } else {
          // Source node is NOT inside a group — clear any stale pending parent
          useUIStore.getState().setPendingIteratorParentId(null);
        }
      } else {
        sideAddRef.current = null;
        // Not from a node's side button — clear any stale pending parent
        useUIStore.getState().setPendingIteratorParentId(null);
      }
      openAddNodeMenu(x, y);
    };
    window.addEventListener(
      "workflow:open-add-node-menu",
      handleOpenAddNodeMenu,
    );
    return () =>
      window.removeEventListener(
        "workflow:open-add-node-menu",
        handleOpenAddNodeMenu,
      );
  }, [openAddNodeMenu]);

  // Capture-phase wheel: when target is a text field or scrollable element (or inside one), scroll it and prevent React Flow from zooming
  useEffect(() => {
    const wrapper = reactFlowWrapper.current;
    if (!wrapper) return;
    const onWheelCapture = (e: WheelEvent) => {
      let el = e.target as Node | null;
      if (!el || !(el instanceof HTMLElement)) return;
      const tag = el.tagName.toLowerCase();
      const isInputOrTextarea = tag === "textarea" || tag === "input";
      const isContentEditable = el.isContentEditable;

      // Find scrollable: the element itself or the nearest scrollable ancestor (e.g. ModelSelector dropdown list)
      const getScrollable = (elem: HTMLElement): HTMLElement | null => {
        for (
          let n: HTMLElement | null = elem;
          n && n !== wrapper;
          n = n.parentElement
        ) {
          const oy =
            typeof getComputedStyle === "function"
              ? getComputedStyle(n).overflowY
              : "";
          if (/auto|scroll|overlay/.test(oy)) return n;
        }
        return null;
      };

      let scrollable: HTMLElement | null = null;
      if (isInputOrTextarea || isContentEditable) {
        scrollable = el as HTMLElement;
      } else {
        scrollable = getScrollable(el);
      }

      if (!scrollable) return;
      // Prevent zoom whenever we're over a scroll container (even if it has no overflow yet)
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const s = scrollable as HTMLElement & {
        scrollTop: number;
        scrollHeight: number;
        clientHeight: number;
      };
      if (typeof s.scrollTop === "number" && s.scrollHeight > s.clientHeight) {
        s.scrollTop = Math.max(
          0,
          Math.min(s.scrollHeight - s.clientHeight, s.scrollTop + e.deltaY),
        );
      }
    };
    wrapper.addEventListener("wheel", onWheelCapture, { capture: true });
    return () =>
      wrapper.removeEventListener("wheel", onWheelCapture, { capture: true });
  }, []);

  // Auto-layout: arrange nodes in a clean left-to-right DAG layout
  // Uses actual DOM measurements for node sizes to prevent overlap
  useEffect(() => {
    const handleAutoLayout = () => {
      const editGroupId = useUIStore.getState().editingGroupId;

      // ── Subgraph editing mode: layout children + virtual IO nodes ──
      if (editGroupId) {
        const {
          nodes: currentNodes,
          edges: currentEdges,
          onNodesChange: applyChanges,
        } = useWorkflowStore.getState();

        const childNodes = currentNodes.filter((n) => n.parentNode === editGroupId);
        if (childNodes.length === 0) return;

        const groupNode = currentNodes.find((n) => n.id === editGroupId);
        if (!groupNode) return;

        const inputProxyId = `__group-input-${editGroupId}`;
        const outputProxyId = `__group-output-${editGroupId}`;
        const childIds = new Set(childNodes.map((n) => n.id));

        // Collect all layout nodes: IO proxies + real children
        // We'll treat IO proxies as virtual entries in the DAG
        const allIds = new Set([inputProxyId, outputProxyId, ...childIds]);

        // Build edges: child-to-child + IO proxy edges
        const layoutEdges: { source: string; target: string }[] = [];

        // Child-to-child edges
        for (const e of currentEdges) {
          if (childIds.has(e.source) && childIds.has(e.target)) {
            layoutEdges.push({ source: e.source, target: e.target });
          }
        }

        // IO proxy edges (from internal auto-edges)
        const parseExposed = (key: string): ExposedParam[] => {
          try {
            const raw = groupNode.data?.params?.[key];
            return typeof raw === "string"
              ? JSON.parse(raw)
              : Array.isArray(raw)
                ? raw
                : [];
          } catch {
            return [];
          }
        };
        const exposedInputs = parseExposed("exposedInputs");
        const exposedOutputs = parseExposed("exposedOutputs");

        for (const e of currentEdges) {
          if (!e.data?.isInternal) continue;
          if (
            e.source === editGroupId &&
            e.sourceHandle?.startsWith("input-inner-") &&
            childIds.has(e.target)
          ) {
            const nk = e.sourceHandle.replace("input-inner-", "");
            if (exposedInputs.some((ep) => ep.namespacedKey === nk)) {
              layoutEdges.push({ source: inputProxyId, target: e.target });
            }
          }
          if (
            e.target === editGroupId &&
            e.targetHandle?.startsWith("output-inner-") &&
            childIds.has(e.source)
          ) {
            const nk = e.targetHandle.replace("output-inner-", "");
            if (exposedOutputs.some((ep) => ep.namespacedKey === nk)) {
              layoutEdges.push({ source: e.source, target: outputProxyId });
            }
          }
        }

        // Measure node sizes from DOM
        const nodeSize = new Map<string, { w: number; h: number }>();
        for (const id of allIds) {
          const el = document.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
          if (el) {
            nodeSize.set(id, { w: el.offsetWidth, h: el.offsetHeight });
          } else {
            nodeSize.set(id, { w: id.startsWith("__group-") ? 260 : 380, h: 250 });
          }
        }

        // Build adjacency
        const outgoing = new Map<string, string[]>();
        const incoming = new Map<string, string[]>();
        for (const id of allIds) {
          outgoing.set(id, []);
          incoming.set(id, []);
        }
        for (const e of layoutEdges) {
          if (allIds.has(e.source) && allIds.has(e.target)) {
            outgoing.get(e.source)?.push(e.target);
            incoming.get(e.target)?.push(e.source);
          }
        }

        // Assign layers via longest-path
        const layer = new Map<string, number>();
        const visited = new Set<string>();
        function assignSubgraphLayer(id: string): number {
          if (layer.has(id)) return layer.get(id)!;
          if (visited.has(id)) return 0;
          visited.add(id);
          const parents = incoming.get(id) ?? [];
          const depth = parents.length === 0
            ? 0
            : Math.max(...parents.map((p) => assignSubgraphLayer(p) + 1));
          layer.set(id, depth);
          return depth;
        }
        for (const id of allIds) assignSubgraphLayer(id);

        // Force Group Input to layer 0 and Group Output to max+1
        layer.set(inputProxyId, 0);
        // Shift any child nodes that were at layer 0 to layer 1
        for (const id of childIds) {
          if (layer.get(id) === 0) {
            if ((outgoing.get(inputProxyId) ?? []).length > 0) {
              layer.set(id, (layer.get(id) ?? 0) + 1);
            }
          }
        }
        // Recompute max after shifts
        const maxLayerAfterShift = Math.max(...layer.values(), 0);
        layer.set(outputProxyId, maxLayerAfterShift + 1);

        // Group by layer
        const layers = new Map<number, string[]>();
        for (const [id, l] of layer) {
          if (!layers.has(l)) layers.set(l, []);
          layers.get(l)!.push(id);
        }
        const sortedLayerKeys = [...layers.keys()].sort((a, b) => a - b);

        // Barycenter ordering
        const nodeOrder = new Map<string, number>();
        for (const l of sortedLayerKeys) {
          const ids = layers.get(l)!;
          ids.forEach((id, i) => nodeOrder.set(id, i));
        }
        for (let pass = 0; pass < 4; pass++) {
          const keys = pass % 2 === 0 ? sortedLayerKeys : [...sortedLayerKeys].reverse();
          for (const l of keys) {
            const ids = layers.get(l)!;
            const bary = new Map<string, number>();
            for (const id of ids) {
              const neighbors = pass % 2 === 0
                ? (incoming.get(id) ?? [])
                : (outgoing.get(id) ?? []);
              bary.set(id, neighbors.length > 0
                ? neighbors.reduce((sum, nid) => sum + (nodeOrder.get(nid) ?? 0), 0) / neighbors.length
                : (nodeOrder.get(id) ?? 0));
            }
            ids.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0));
            ids.forEach((id, i) => nodeOrder.set(id, i));
          }
        }

        // Compute column X positions
        const SG_H_GAP = 120;
        const SG_V_GAP = 60;
        const layerX = new Map<number, number>();
        let cx = 0;
        for (const l of sortedLayerKeys) {
          layerX.set(l, cx);
          const ids = layers.get(l)!;
          const maxW = Math.max(...ids.map((id) => nodeSize.get(id)?.w ?? 380));
          cx += maxW + SG_H_GAP;
        }

        // Position all nodes
        const ioPositions: Record<string, { x: number; y: number }> = {};
        const childChanges: NodeChange[] = [];

        for (const l of sortedLayerKeys) {
          const ids = layers.get(l)!;
          const heights = ids.map((id) => nodeSize.get(id)?.h ?? 250);
          const totalHeight = heights.reduce((sum, h) => sum + h, 0) + (ids.length - 1) * SG_V_GAP;
          let y = -totalHeight / 2;

          ids.forEach((id, i) => {
            const pos = { x: layerX.get(l) ?? 0, y };
            if (id === inputProxyId || id === outputProxyId) {
              ioPositions[id] = pos;
            } else {
              // Child nodes: position is relative to parent, so store as relative
              childChanges.push({
                type: "position",
                id,
                position: pos,
              } as NodeChange);
            }
            y += heights[i] + SG_V_GAP;
          });
        }

        // Apply child position changes to store
        if (childChanges.length > 0) {
          applyChanges(childChanges);
        }

        // Update IO node positions via state setter and persist to group params
        setIoNodePositions(ioPositions);
        const gNode = currentNodes.find((n) => n.id === editGroupId);
        if (gNode) {
          useWorkflowStore.getState().updateNodeParams(editGroupId, {
            ...gNode.data?.params,
            __ioNodePositions: ioPositions,
          });
        }

        // Update bounding box
        useWorkflowStore.getState().updateBoundingBox(editGroupId);

        // Fit view
        setTimeout(() => {
          reactFlowInstance.current?.fitView({
            padding: 0.3,
            duration: 300,
            minZoom: 0.5,
            maxZoom: 1.2,
          });
        }, 50);
        return;
      }

      // ── Main view layout (not in subgraph editing mode) ──
      const {
        nodes: currentNodes,
        edges: currentEdges,
        onNodesChange: applyChanges,
      } = useWorkflowStore.getState();
      if (currentNodes.length === 0) return;

      // ── Separate top-level nodes from group children ──
      const topLevelNodes = currentNodes.filter((n) => !n.parentNode);
      const childNodesByParent = new Map<string, typeof currentNodes>();
      for (const n of currentNodes) {
        if (n.parentNode) {
          const arr = childNodesByParent.get(n.parentNode) ?? [];
          arr.push(n);
          childNodesByParent.set(n.parentNode, arr);
        }
      }

      // Only use top-level nodes for the DAG layout
      // Filter edges to only include connections between top-level nodes
      const topLevelIds = new Set(topLevelNodes.map((n) => n.id));
      const topLevelEdges = currentEdges.filter(
        (e) => topLevelIds.has(e.source) && topLevelIds.has(e.target),
      );

      // ── Measure actual node sizes from DOM ──
      const executionResults = useExecutionStore.getState().lastResults;
      const nodeSize = new Map<string, { w: number; h: number }>();
      const RESULTS_RESERVE = 260;
      for (const n of topLevelNodes) {
        const el = document.querySelector(
          `[data-id="${n.id}"]`,
        ) as HTMLElement | null;
        const hasResults = (executionResults[n.id] ?? []).length > 0;
        if (el) {
          const measuredH = el.offsetHeight;
          const h =
            hasResults && measuredH < 300
              ? measuredH + RESULTS_RESERVE
              : measuredH;
          nodeSize.set(n.id, { w: el.offsetWidth, h });
        } else {
          const w = (n.data?.params?.__nodeWidth as number) ?? 380;
          nodeSize.set(n.id, { w, h: hasResults ? 500 : 250 });
        }
      }

      // ── Build adjacency (top-level only) ──
      const outgoing = new Map<string, string[]>();
      const incoming = new Map<string, string[]>();
      for (const n of topLevelNodes) {
        outgoing.set(n.id, []);
        incoming.set(n.id, []);
      }
      for (const e of topLevelEdges) {
        outgoing.get(e.source)?.push(e.target);
        incoming.get(e.target)?.push(e.source);
      }

      // ── Assign layers via longest-path (ensures proper depth) ──
      const layer = new Map<string, number>();
      const visited = new Set<string>();

      function assignLayer(id: string): number {
        if (layer.has(id)) return layer.get(id)!;
        if (visited.has(id)) return 0; // cycle guard
        visited.add(id);
        const parents = incoming.get(id) ?? [];
        const depth =
          parents.length === 0
            ? 0
            : Math.max(...parents.map((p) => assignLayer(p) + 1));
        layer.set(id, depth);
        return depth;
      }
      for (const n of topLevelNodes) assignLayer(n.id);

      // ── Group by layer ──
      const layers = new Map<number, string[]>();
      for (const [id, l] of layer) {
        if (!layers.has(l)) layers.set(l, []);
        layers.get(l)!.push(id);
      }

      // Sort layers by key
      const sortedLayerKeys = [...layers.keys()].sort((a, b) => a - b);

      // ── Barycenter ordering to minimize edge crossings ──
      const nodeOrder = new Map<string, number>();
      for (const l of sortedLayerKeys) {
        const ids = layers.get(l)!;
        ids.sort((a, b) => {
          const na = topLevelNodes.find((n) => n.id === a);
          const nb = topLevelNodes.find((n) => n.id === b);
          return (na?.position?.y ?? 0) - (nb?.position?.y ?? 0);
        });
        ids.forEach((id, i) => nodeOrder.set(id, i));
      }

      // Barycenter passes (forward + backward)
      for (let pass = 0; pass < 4; pass++) {
        const keys =
          pass % 2 === 0 ? sortedLayerKeys : [...sortedLayerKeys].reverse();
        for (const l of keys) {
          const ids = layers.get(l)!;
          const bary = new Map<string, number>();
          for (const id of ids) {
            const neighbors =
              pass % 2 === 0
                ? (incoming.get(id) ?? [])
                : (outgoing.get(id) ?? []);
            if (neighbors.length > 0) {
              const avg =
                neighbors.reduce(
                  (sum, nid) => sum + (nodeOrder.get(nid) ?? 0),
                  0,
                ) / neighbors.length;
              bary.set(id, avg);
            } else {
              bary.set(id, nodeOrder.get(id) ?? 0);
            }
          }
          ids.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0));
          ids.forEach((id, i) => nodeOrder.set(id, i));
        }
      }

      // ── Compute column X positions based on max width per layer ──
      const H_GAP = 100; // horizontal gap between columns
      const V_GAP = 60; // vertical gap between nodes in same column
      const layerX = new Map<number, number>();
      let currentX = 0;
      for (const l of sortedLayerKeys) {
        layerX.set(l, currentX);
        const ids = layers.get(l)!;
        const maxW = Math.max(...ids.map((id) => nodeSize.get(id)?.w ?? 380));
        currentX += maxW + H_GAP;
      }

      // ── Position top-level nodes: center each column vertically ──
      const changes: NodeChange[] = [];
      for (const l of sortedLayerKeys) {
        const ids = layers.get(l)!;
        const heights = ids.map((id) => nodeSize.get(id)?.h ?? 250);
        const totalHeight =
          heights.reduce((sum, h) => sum + h, 0) + (ids.length - 1) * V_GAP;
        let y = -totalHeight / 2;

        ids.forEach((id, i) => {
          changes.push({
            type: "position",
            id,
            position: {
              x: layerX.get(l) ?? 0,
              y,
            },
          } as NodeChange);
          y += heights[i] + V_GAP;
        });
      }
      applyChanges(changes);

      // ── Re-arrange children inside their parent groups ──
      // Perform a mini left-to-right DAG layout within each group
      const TITLE_BAR_H = 40;
      const CLAMP_PAD = 20;
      const CHILD_H_GAP = 80;
      const CHILD_V_GAP = 30;
      const childChanges: NodeChange[] = [];

      for (const [parentId, children] of childNodesByParent) {
        const parentNode = currentNodes.find((n) => n.id === parentId);
        if (!parentNode) continue;
        let pw = (parentNode.data?.params?.__nodeWidth as number) ?? 600;
        let ph = (parentNode.data?.params?.__nodeHeight as number) ?? 400;

        // Measure child sizes from DOM
        const childSize = new Map<string, { w: number; h: number }>();
        for (const c of children) {
          const el = document.querySelector(
            `[data-id="${c.id}"]`,
          ) as HTMLElement | null;
          if (el) {
            childSize.set(c.id, { w: el.offsetWidth, h: el.offsetHeight });
          } else {
            const w = (c.data?.params?.__nodeWidth as number) ?? 300;
            childSize.set(c.id, { w, h: 250 });
          }
        }

        const childIds = new Set(children.map((c) => c.id));

        // Build internal adjacency (edges between children of this group)
        const childOutgoing = new Map<string, string[]>();
        const childIncoming = new Map<string, string[]>();
        for (const c of children) {
          childOutgoing.set(c.id, []);
          childIncoming.set(c.id, []);
        }
        for (const e of currentEdges) {
          if (childIds.has(e.source) && childIds.has(e.target)) {
            childOutgoing.get(e.source)?.push(e.target);
            childIncoming.get(e.target)?.push(e.source);
          }
        }

        // Assign layers via longest-path
        const cLayer = new Map<string, number>();
        const cVisited = new Set<string>();
        function assignChildLayer(cid: string): number {
          if (cLayer.has(cid)) return cLayer.get(cid)!;
          if (cVisited.has(cid)) return 0;
          cVisited.add(cid);
          const parents = childIncoming.get(cid) ?? [];
          const depth =
            parents.length === 0
              ? 0
              : Math.max(...parents.map((p) => assignChildLayer(p) + 1));
          cLayer.set(cid, depth);
          return depth;
        }
        for (const c of children) assignChildLayer(c.id);

        // Group by layer
        const cLayers = new Map<number, string[]>();
        for (const [cid, l] of cLayer) {
          if (!cLayers.has(l)) cLayers.set(l, []);
          cLayers.get(l)!.push(cid);
        }
        const cSortedKeys = [...cLayers.keys()].sort((a, b) => a - b);

        // Sort within each layer by original Y position
        for (const l of cSortedKeys) {
          const ids = cLayers.get(l)!;
          ids.sort((a, b) => {
            const na = children.find((c) => c.id === a);
            const nb = children.find((c) => c.id === b);
            return (na?.position?.y ?? 0) - (nb?.position?.y ?? 0);
          });
        }

        // Compute column X positions
        const colX = new Map<number, number>();
        let cx = CLAMP_PAD;
        for (const l of cSortedKeys) {
          colX.set(l, cx);
          const ids = cLayers.get(l)!;
          const maxW = Math.max(
            ...ids.map((cid) => childSize.get(cid)?.w ?? 300),
          );
          cx += maxW + CHILD_H_GAP;
        }
        const totalW = cx - CHILD_H_GAP + CLAMP_PAD;

        // Position children within each column
        let maxBottom = 0;
        for (const l of cSortedKeys) {
          const ids = cLayers.get(l)!;
          const heights = ids.map((cid) => childSize.get(cid)?.h ?? 250);
          let cy = TITLE_BAR_H + CLAMP_PAD;
          ids.forEach((cid, i) => {
            childChanges.push({
              type: "position",
              id: cid,
              position: { x: colX.get(l) ?? CLAMP_PAD, y: cy },
            } as NodeChange);
            cy += heights[i] + CHILD_V_GAP;
          });
          maxBottom = Math.max(maxBottom, cy - CHILD_V_GAP + CLAMP_PAD);
        }

        // Expand group if children overflow
        let needsUpdate = false;
        if (totalW > pw) {
          pw = totalW;
          needsUpdate = true;
        }
        if (maxBottom > ph) {
          ph = maxBottom;
          needsUpdate = true;
        }
        if (needsUpdate) {
          useWorkflowStore.getState().updateNodeParams(parentId, {
            ...parentNode.data.params,
            __nodeWidth: pw,
            __nodeHeight: ph,
          });
        }
      }
      if (childChanges.length > 0) {
        applyChanges(childChanges);
      }

      // Update bounding boxes for all groups
      for (const parentId of childNodesByParent.keys()) {
        useWorkflowStore.getState().updateBoundingBox(parentId);
      }

      // Fit view after layout
      setTimeout(() => {
        reactFlowInstance.current?.fitView({
          padding: 0.2,
          duration: 300,
          minZoom: 0.05,
          maxZoom: 1.5,
        });
      }, 50);
    };
    window.addEventListener("workflow:auto-layout", handleAutoLayout);
    return () =>
      window.removeEventListener("workflow:auto-layout", handleAutoLayout);
  }, []);

  return (
    <ReactFlowProvider>
      <div ref={reactFlowWrapper} className="flex-1 h-full relative">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChangeWithAdoption}
          onEdgesChange={onEdgesChangeFiltered}
          onConnect={onConnect}
          onEdgeUpdate={onEdgeUpdate}
          onEdgeUpdateStart={onEdgeUpdateStart}
          onEdgeUpdateEnd={onEdgeUpdateEnd}
          onNodeClick={onNodeClick}
          onNodeDragStart={onNodeDragStart}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          onSelectionChange={onSelectionChange}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          proOptions={{ hideAttribution: true }}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onInit={(instance) => {
            reactFlowInstance.current = instance;
            useUIStore.getState().setGetViewportCenter(() => {
              const vp = instance.getViewport();
              const el = reactFlowWrapper.current;
              const w = el ? el.clientWidth : 800;
              const h = el ? el.clientHeight : 600;
              return {
                x: (-vp.x + w / 2) / vp.zoom,
                y: (-vp.y + h / 2) / vp.zoom,
              };
            });
            // Restore saved viewport for this workflow
            const wfId = useWorkflowStore.getState().workflowId;
            if (wfId) {
              try {
                const raw = localStorage.getItem(`wf_viewport_${wfId}`);
                if (raw) {
                  const vp = JSON.parse(raw);
                  if (
                    typeof vp.x === "number" &&
                    typeof vp.y === "number" &&
                    typeof vp.zoom === "number"
                  ) {
                    instance.setViewport(vp, { duration: 0 });
                  }
                } else {
                  instance.fitView({
                    padding: 0.2,
                    duration: 0,
                    minZoom: 0.05,
                    maxZoom: 1.5,
                  });
                }
              } catch {
                instance.fitView({
                  padding: 0.2,
                  duration: 0,
                  minZoom: 0.05,
                  maxZoom: 1.5,
                });
              }
            } else {
              instance.fitView({
                padding: 0.2,
                duration: 0,
                minZoom: 0.05,
                maxZoom: 1.5,
              });
            }
            // Initialize viewport state
          }}
          onMoveEnd={(_event, viewport) => {
            const wfId = useWorkflowStore.getState().workflowId;
            if (wfId && viewport) {
              try {
                localStorage.setItem(
                  `wf_viewport_${wfId}`,
                  JSON.stringify({
                    x: viewport.x,
                    y: viewport.y,
                    zoom: viewport.zoom,
                  }),
                );
              } catch {
                /* ignore */
              }
            }
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          edgesUpdatable
          reconnectRadius={6}
          selectionOnDrag={interactionMode === "select"}
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode="Shift"
          panOnDrag={interactionMode === "hand"}
          panOnScroll
          deleteKeyCode={null}
          minZoom={0.05}
          maxZoom={2.5}
          className="bg-background"
        >
          {showGrid && (
            <Background
              variant={BackgroundVariant.Lines}
              gap={20}
              lineWidth={1}
              color="hsl(var(--border))"
            />
          )}
        </ReactFlow>
        <SubgraphBreadcrumb />
        <CanvasZoomControls />
        {contextMenu && contextMenu.type !== "addNode" && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={getContextMenuItems()}
            onClose={() => setContextMenu(null)}
          />
        )}
        {contextMenu && contextMenu.type === "addNode" && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            width={280}
            estimatedHeight={420}
          >
            <div className="w-[280px] max-h-[420px] flex flex-col bg-background/95 backdrop-blur">
              {/* ── header ── */}
              <div className="flex items-center justify-between px-4 h-10 border-b border-border/70 shrink-0">
                <span className="font-semibold text-[13px] text-foreground">
                  {t("workflow.addNode", "Add Node")}
                </span>
              </div>

              {/* ── search ── */}
              <div className="px-3 py-2 shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
                  <input
                    autoFocus
                    type="text"
                    value={addNodeQuery}
                    onChange={(e) => setAddNodeQuery(e.target.value)}
                    onKeyDown={handleAddNodeKeyDown}
                    placeholder={t(
                      "workflow.searchNodesPlaceholder",
                      "Search nodes or models...",
                    )}
                    className="w-full h-8 rounded-lg border border-border/70 bg-muted/40 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
                  />
                </div>
              </div>

              {/* ── node list ── */}
              <div
                ref={addNodeListRef}
                className="flex-1 overflow-y-auto px-2 py-1"
              >
                {(() => {
                  let flatIdx = 0;
                  return (
                    <>
                      {groupedAddNodeDefs.map(([category, defs]) => {
                        const isCollapsed = addNodeCollapsed[category] ?? false;
                        const dot = catDot[category] ?? "bg-gray-400";
                        return (
                          <div key={category} className="mb-0.5">
                            <button
                              onClick={() =>
                                setAddNodeCollapsed((prev) => ({
                                  ...prev,
                                  [category]: !isCollapsed,
                                }))
                              }
                              className="w-full flex items-center gap-2 px-2 h-7 rounded-lg text-muted-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
                            >
                              <span
                                className={cn(
                                  "w-1.5 h-1.5 rounded-full shrink-0",
                                  dot,
                                )}
                              />
                              <span className="text-[11px] font-semibold uppercase tracking-wide">
                                {t(
                                  `workflow.nodeCategory.${category}`,
                                  category,
                                )}
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
                            {!isCollapsed && (
                              <div className="py-0.5">
                                {defs.map((def) => {
                                  const myIdx = flatIdx++;
                                  const isHighlighted =
                                    myIdx === addNodeHighlightIndex;
                                  const DefIcon = getNodeIcon(def.type);
                                  const hint = t(
                                    `workflow.nodeDefs.${def.type}.hint`,
                                    "",
                                  );
                                  const isAiTask = def.category === "ai-task";
                                  return (
                                    <Tooltip key={def.type} delayDuration={0}>
                                      <TooltipTrigger asChild>
                                        <div
                                          ref={(el) => {
                                            if (isHighlighted && el)
                                              el.scrollIntoView({
                                                block: "nearest",
                                              });
                                          }}
                                          onClick={() =>
                                            addNodeAtMenuPosition(def)
                                          }
                                          onMouseEnter={() =>
                                            setAddNodeHighlightIndex(myIdx)
                                          }
                                          className={cn(
                                            "flex items-center gap-2 h-8 px-2 rounded-lg cursor-pointer select-none",
                                            "text-[12px] text-foreground/70 transition-colors duration-100",
                                            isHighlighted
                                              ? "bg-accent text-accent-foreground"
                                              : "hover:bg-muted hover:text-foreground",
                                          )}
                                        >
                                          {DefIcon && (
                                            <div className="rounded-md bg-primary/10 p-1 flex-shrink-0">
                                              <DefIcon className="w-3 h-3 text-primary" />
                                            </div>
                                          )}
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
                                          className="max-w-[220px] z-[1001]"
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
                              const isHighlighted =
                                myIdx === addNodeHighlightIndex;
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
                                  onClick={() => addModelNode(model)}
                                  onMouseEnter={() =>
                                    setAddNodeHighlightIndex(myIdx)
                                  }
                                  title={model.model_id}
                                  className={cn(
                                    "flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer select-none",
                                    "transition-colors duration-100",
                                    isHighlighted
                                      ? "bg-primary/10"
                                      : "hover:bg-muted",
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

                      {addNodeDisplayDefs.length === 0 &&
                        matchedModels.length === 0 && (
                          <div className="px-3 py-6 text-xs text-muted-foreground/60 text-center">
                            {t(
                              "workflow.noNodesAvailable",
                              "No nodes available",
                            )}
                          </div>
                        )}
                    </>
                  );
                })()}
              </div>

              {/* ── footer hint ── */}
              <div className="px-4 py-2 border-t border-border/70 text-[10px] text-muted-foreground/40">
                {t(
                  "workflow.dragOrClickToAdd",
                  "Drag to canvas or click to add",
                )}
              </div>
            </div>
          </ContextMenu>
        )}
      </div>
    </ReactFlowProvider>
  );
}
