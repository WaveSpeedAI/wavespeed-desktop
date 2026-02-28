/**
 * Workflow Zustand store — manages canvas nodes, edges, and workflow metadata.
 * Includes snapshot-based undo/redo (Ctrl+Z / Ctrl+Shift+Z).
 */
import { create } from "zustand";
import {
  type Node as ReactFlowNode,
  type Edge as ReactFlowEdge,
  type Connection,
  type XYPosition,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
} from "reactflow";
import { v4 as uuid } from "uuid";
import { workflowIpc, registryIpc } from "../ipc/ipc-client";
import type { WorkflowNode, WorkflowEdge } from "@/workflow/types/workflow";

/** Lazy getter to avoid circular import with execution.store */
function getActiveExecutions(): Set<string> {
  try {
    // Dynamic import resolved at runtime, not at module load
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./execution.store");
    const executionStore = resolveStoreExport<{
      activeExecutions: Set<string>;
    }>(mod, "useExecutionStore");
    return executionStore?.getState().activeExecutions ?? new Set();
  } catch {
    return new Set();
  }
}

type StoreWithGetState<TState> = {
  getState: () => TState;
};

function resolveStoreExport<TState>(
  mod: unknown,
  name: string,
): StoreWithGetState<TState> | null {
  if (!mod || typeof mod !== "object") return null;
  const moduleObj = mod as Record<string, unknown>;
  const direct = moduleObj[name] as StoreWithGetState<TState> | undefined;
  if (direct && typeof direct.getState === "function") return direct;

  const defaultExport = moduleObj.default as
    | Record<string, unknown>
    | undefined;
  if (!defaultExport || typeof defaultExport !== "object") return null;

  const nested = defaultExport[name] as StoreWithGetState<TState> | undefined;
  if (nested && typeof nested.getState === "function") return nested;

  const defaultStore = defaultExport as unknown as StoreWithGetState<TState>;
  if (typeof defaultStore.getState === "function") return defaultStore;

  return null;
}

/* ── Default content for new workflows ─────────────────────────────────── */

const DEFAULT_NEW_WORKFLOW_MODEL = "bytedance/seedream-v4.5";
const DEFAULT_NEW_WORKFLOW_PROMPT =
  "An ethereal female elf with long platinum-blonde hair and pointed ears, wearing an elegant dress made of leaves and vines. She stands barefoot in an ancient forest illuminated by magical light spots, one hand gently touching a glowing mushroom. Her expression is otherworldly and curious. Dreamy soft focus, Tyndall effect light beams filtering through the canopy, magical realism photography.";

/** Returns one AI task node (and no edges) for a new workflow. */
export function getDefaultNewWorkflowContent(): {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
} {
  const nodeId = uuid();
  return {
    nodes: [
      {
        id: nodeId,
        type: "custom",
        position: { x: 120, y: 120 },
        data: {
          nodeType: "ai-task/run",
          params: {
            modelId: DEFAULT_NEW_WORKFLOW_MODEL,
            prompt: DEFAULT_NEW_WORKFLOW_PROMPT,
          },
          label: "",
          paramDefinitions: [],
          inputDefinitions: [],
          outputDefinitions: [],
        },
      },
    ],
    edges: [],
  };
}

/* ── Undo / Redo history (snapshot-based) ──────────────────────────────── */

const MAX_UNDO = 50;

interface Snapshot {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
}

let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];

function pushUndo(s: Snapshot) {
  undoStack = [...undoStack.slice(-(MAX_UNDO - 1)), s];
  redoStack = []; // any new change clears redo
}

/** Time-debounced undo push — avoids creating a snapshot on every keystroke
 *  during rapid text editing (especially CJK IME input). */
let _lastUndoPushTime = 0;
const UNDO_DEBOUNCE_MS = 600;

function pushUndoDebounced(s: Snapshot) {
  const now = Date.now();
  if (now - _lastUndoPushTime > UNDO_DEBOUNCE_MS) {
    pushUndo(s);
    _lastUndoPushTime = now;
  }
}

/** Snapshot captured at the start of a node drag — pushed to undo when drag ends. */
let _dragStartSnapshot: Snapshot | null = null;

/* ── Save concurrency guard ────────────────────────────────────────────── */
let _saveInProgress = false;

export interface SaveWorkflowOptions {
  /** When true, untitled workflows are saved with an auto-generated name instead of prompting. */
  forRun?: boolean;
}

/** Internal save implementation — extracted so the concurrency guard stays clean. */
async function _doSaveWorkflow(
  get: () => WorkflowState,
  set: (partial: Partial<WorkflowState>) => void,
  options?: SaveWorkflowOptions,
) {
  let { workflowId } = get();
  const { workflowName, nodes, edges } = get();

  // Don't save unnamed workflows — prompt user for a name via UI dialog (unless saving for run)
  const isUntitled =
    !workflowName || /^Untitled Workflow(\s+\d+)?$/.test(workflowName);
  if (isUntitled) {
    if (options?.forRun) {
      // Auto-generate a name so Run Workflow never requires naming
      const autoName = `Workflow ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
      set({ workflowName: autoName });
    } else {
      const uiStoreModule = await import("./ui.store");
      const uiStore = resolveStoreExport<{
        promptWorkflowName: (
          defaultName?: string,
        ) => Promise<{ name: string; overwriteId?: string } | null>;
      }>(uiStoreModule, "useUIStore");
      const promptWorkflowName = uiStore?.getState().promptWorkflowName;
      if (typeof promptWorkflowName !== "function") {
        throw new Error("Workflow naming dialog is unavailable");
      }
      const result = await promptWorkflowName(workflowName || "");
      if (
        !result ||
        !result.name.trim() ||
        /^Untitled Workflow(\s+\d+)?$/.test(result.name.trim())
      )
        return;
      set({ workflowName: result.name.trim() });
      // If user chose to overwrite an existing workflow, use that workflow's ID
      if (result.overwriteId) {
        workflowId = result.overwriteId;
        set({ workflowId: result.overwriteId });
      }
    }
  }

  let finalName = get().workflowName;

  // Session restore may carry a stale workflowId (e.g. after reinstall or DB path migration).
  // Validate it before save; if not found, create a new workflow on this save.
  if (workflowId) {
    try {
      await workflowIpc.load(workflowId);
    } catch {
      workflowId = null;
      set({ workflowId: null });
    }
  }

  // Auto-create workflow on first save (lazy creation)
  if (!workflowId) {
    if (nodes.length === 0) return;
    const wf = await workflowIpc.create({ name: finalName });
    workflowId = wf.id;
    // Use the actual name returned by create (may have been deduplicated)
    finalName = wf.name;
    set({ workflowId: wf.id, workflowName: wf.name });
  }

  const wfNodes: WorkflowNode[] = nodes.map((n) => ({
    id: n.id,
    workflowId: workflowId!,
    nodeType: n.data.nodeType,
    position: n.position,
    params: {
      ...(n.data.params ?? {}),
      __meta: {
        label: n.data.label,
        modelInputSchema: n.data.modelInputSchema ?? [],
      },
    },
    currentOutputId: null, // placeholder — repo will preserve existing DB value
  }));

  const wfEdges: WorkflowEdge[] = edges.map((e) => ({
    id: e.id,
    workflowId: workflowId!,
    sourceNodeId: e.source,
    sourceOutputKey: e.sourceHandle ?? "output",
    targetNodeId: e.target,
    targetInputKey: e.targetHandle ?? "input",
  }));

  await workflowIpc.save({
    id: workflowId!,
    name: finalName,
    nodes: wfNodes,
    edges: wfEdges,
  });
  // Sync name back — backend may have deduplicated it
  try {
    const saved = await workflowIpc.load(workflowId!);
    if (saved.name !== finalName) {
      set({ workflowName: saved.name });
    }
  } catch {
    /* ignore */
  }
  set({ isDirty: false });
}

/* ── Store ─────────────────────────────────────────────────────────────── */

export interface WorkflowState {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
  workflowId: string | null;
  workflowName: string;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;

  addNode: (
    type: string,
    position: XYPosition,
    defaultParams?: Record<string, unknown>,
    label?: string,
    paramDefs?: unknown[],
    inputDefs?: unknown[],
    outputDefs?: unknown[],
  ) => string;
  removeNode: (nodeId: string) => void;
  removeNodes: (nodeIds: string[]) => void;
  duplicateNode: (nodeId: string) => string;
  addEdge: (connection: Connection) => void;
  removeEdge: (edgeId: string) => void;
  removeEdgesByIds: (edgeIds: string[]) => void;
  updateNodeParams: (nodeId: string, params: Record<string, unknown>) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  undo: () => void;
  redo: () => void;
  saveWorkflow: (options?: SaveWorkflowOptions) => Promise<void>;
  loadWorkflow: (id: string) => Promise<void>;
  newWorkflow: (name: string) => Promise<void>;
  setWorkflowName: (name: string) => void;
  renameWorkflow: (newName: string) => Promise<void>;
  reset: () => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  workflowId: null,
  workflowName: "Untitled Workflow",
  isDirty: false,
  canUndo: false,
  canRedo: false,

  addNode: (
    type,
    position,
    defaultParams = {},
    label,
    paramDefs = [],
    inputDefs = [],
    outputDefs = [],
  ) => {
    const { nodes, edges, workflowId } = get();
    pushUndo({ nodes, edges });
    const id = uuid();
    const newNode: ReactFlowNode = {
      id,
      type: "custom",
      position,
      data: {
        nodeType: type,
        params: defaultParams,
        label: label ?? type,
        paramDefinitions: paramDefs,
        inputDefinitions: inputDefs,
        outputDefinitions: outputDefs,
      },
    };
    set((state) => ({
      nodes: [...state.nodes, newNode],
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));

    // Only auto-save if workflow already exists; don't auto-create on node add
    if (workflowId) {
      setTimeout(() => {
        get().saveWorkflow().catch(console.error);
      }, 100);
    }
    return id;
  },

  removeNode: (nodeId) => {
    // Guard: prevent deleting a running node
    if (getActiveExecutions().has(nodeId)) {
      alert("Cannot delete a running node. Cancel execution first.");
      return;
    }
    const { nodes, edges } = get();
    pushUndo({ nodes, edges });
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId,
      ),
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));
  },

  removeNodes: (nodeIds) => {
    if (nodeIds.length === 0) return;
    const activeExecs = getActiveExecutions();
    const blocked = nodeIds.filter((id) => activeExecs.has(id));
    if (blocked.length > 0) {
      alert("Cannot delete running nodes. Cancel execution first.");
      return;
    }
    const { nodes, edges } = get();
    pushUndo({ nodes, edges });
    const removeSet = new Set(nodeIds);
    set((state) => ({
      nodes: state.nodes.filter((n) => !removeSet.has(n.id)),
      edges: state.edges.filter(
        (e) => !removeSet.has(e.source) && !removeSet.has(e.target),
      ),
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));
  },

  duplicateNode: (nodeId) => {
    const state = get();
    const orig = state.nodes.find((n) => n.id === nodeId);
    if (!orig) return "";
    pushUndo({ nodes: state.nodes, edges: state.edges });
    const id = uuid();
    const newNode: ReactFlowNode = {
      ...orig,
      id,
      position: { x: orig.position.x + 50, y: orig.position.y + 50 },
      data: { ...orig.data, params: { ...orig.data.params } },
    };
    set((state) => ({
      nodes: [...state.nodes, newNode],
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));
    return id;
  },

  addEdge: (connection) => {
    if (!connection.source || !connection.target) return;
    // Guard: no self-connections
    if (connection.source === connection.target) return;
    const { nodes, edges } = get();
    // Guard: no duplicate connections (same source handle → same target handle)
    const duplicate = edges.some(
      (e) =>
        e.source === connection.source &&
        e.target === connection.target &&
        e.sourceHandle === (connection.sourceHandle ?? "output") &&
        e.targetHandle === (connection.targetHandle ?? "input"),
    );
    if (duplicate) return;
    // Guard: a target handle can only have one incoming connection
    const targetHandle = connection.targetHandle ?? "input";
    const existingToTarget = edges.some(
      (e) => e.target === connection.target && e.targetHandle === targetHandle,
    );
    if (existingToTarget) {
      // Replace the existing connection
      const filtered = edges.filter(
        (e) =>
          !(e.target === connection.target && e.targetHandle === targetHandle),
      );
      pushUndo({ nodes, edges });
      const id = uuid();
      const newEdge: ReactFlowEdge = {
        id,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? "output",
        targetHandle,
        type: "custom",
      };
      set({
        edges: [...filtered, newEdge],
        isDirty: true,
        canUndo: true,
        canRedo: false,
      });
    } else {
      pushUndo({ nodes, edges });
      const id = uuid();
      const newEdge: ReactFlowEdge = {
        id,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? "output",
        targetHandle,
        type: "custom",
      };
      set((state) => ({
        edges: [...state.edges, newEdge],
        isDirty: true,
        canUndo: true,
        canRedo: false,
      }));
    }
    setTimeout(() => {
      const state = get();
      if (state.workflowId) state.saveWorkflow().catch(console.error);
    }, 100);
  },

  removeEdge: (edgeId) => {
    const { nodes, edges } = get();
    pushUndo({ nodes, edges });
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));
  },

  removeEdgesByIds: (edgeIds) => {
    if (edgeIds.length === 0) return;
    const { nodes, edges } = get();
    pushUndo({ nodes, edges });
    const removeSet = new Set(edgeIds);
    set((state) => ({
      edges: state.edges.filter((e) => !removeSet.has(e.id)),
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));
  },

  updateNodeParams: (nodeId, params) => {
    const { nodes, edges } = get();
    pushUndoDebounced({ nodes, edges });
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, params } } : n,
      ),
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));
  },

  updateNodeData: (nodeId, dataUpdate) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...dataUpdate } } : n,
      ),
      isDirty: true,
    }));
  },

  onNodesChange: (changes) => {
    // Structural changes (add/remove) always push undo immediately
    const isStructural = changes.some(
      (c) => c.type === "remove" || c.type === "add",
    );
    if (isStructural) {
      const { nodes, edges } = get();
      pushUndo({ nodes, edges });
    }

    // Track node drag: capture snapshot at drag start, push undo at drag end
    const posChanges = changes.filter(
      (c): c is NodeChange & { type: "position"; dragging?: boolean } =>
        c.type === "position",
    );
    if (posChanges.length > 0) {
      const anyDragging = posChanges.some((c) => c.dragging === true);
      const anyDragEnd = posChanges.some((c) => c.dragging === false);

      if (anyDragging && !_dragStartSnapshot) {
        // Drag just started — capture current state before positions change
        const { nodes, edges } = get();
        _dragStartSnapshot = { nodes, edges };
      }
      if (anyDragEnd && _dragStartSnapshot) {
        // Drag ended — push the pre-drag snapshot to undo stack
        pushUndo(_dragStartSnapshot);
        _dragStartSnapshot = null;
      }
    }

    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      isDirty: true,
      ...(isStructural || posChanges.some((c) => c.dragging === false)
        ? { canUndo: true, canRedo: false }
        : {}),
    }));
  },

  onEdgesChange: (changes) => {
    const isStructural = changes.some(
      (c) => c.type === "remove" || c.type === "add",
    );
    if (isStructural) {
      const { nodes, edges } = get();
      pushUndo({ nodes, edges });
    }
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      isDirty: true,
      ...(isStructural ? { canUndo: true, canRedo: false } : {}),
    }));
  },

  undo: () => {
    if (undoStack.length === 0) return;
    const { nodes, edges } = get();
    redoStack = [...redoStack, { nodes, edges }];
    const prev = undoStack[undoStack.length - 1];
    undoStack = undoStack.slice(0, -1);
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      isDirty: true,
      canUndo: undoStack.length > 0,
      canRedo: true,
    });
  },

  redo: () => {
    if (redoStack.length === 0) return;
    const { nodes, edges } = get();
    undoStack = [...undoStack, { nodes, edges }];
    const next = redoStack[redoStack.length - 1];
    redoStack = redoStack.slice(0, -1);
    set({
      nodes: next.nodes,
      edges: next.edges,
      isDirty: true,
      canUndo: true,
      canRedo: redoStack.length > 0,
    });
  },

  saveWorkflow: async (options) => {
    // Prevent concurrent saves — two overlapping calls can both see workflowId=null
    // and each create a separate workflow, resulting in duplicates.
    if (_saveInProgress) return;
    _saveInProgress = true;
    try {
      await _doSaveWorkflow(get, set, options);
    } finally {
      _saveInProgress = false;
    }
  },

  loadWorkflow: async (id) => {
    const wf = await workflowIpc.load(id);
    let defMap = new Map<
      string,
      {
        params: unknown[];
        inputs: unknown[];
        outputs: unknown[];
        label: string;
      }
    >();
    try {
      const defs = await registryIpc.getAll();
      defMap = new Map(
        defs.map((def) => [
          def.type,
          {
            params: def.params ?? [],
            inputs: def.inputs ?? [],
            outputs: def.outputs ?? [],
            label: def.label ?? def.type,
          },
        ]),
      );
    } catch {
      // Keep empty map as fallback; nodes still load with persisted params.
    }

    const rfNodes: ReactFlowNode[] = wf.graphDefinition.nodes.map((n) => {
      // Restore modelInputSchema and label from saved params metadata
      const meta = (n.params as Record<string, unknown>).__meta as
        | Record<string, unknown>
        | undefined;
      const modelInputSchema = meta?.modelInputSchema as unknown[] | undefined;
      const def = defMap.get(n.nodeType);
      const label = (meta?.label as string) || (def ? def.label : n.nodeType);
      // Strip __meta from the params passed to the node
      const { __meta: _, ...cleanParams } = n.params as Record<string, unknown>;
      return {
        id: n.id,
        type: "custom",
        position: n.position,
        data: {
          nodeType: n.nodeType,
          params: cleanParams,
          label,
          modelInputSchema: modelInputSchema ?? [],
          paramDefinitions: def?.params ?? [],
          inputDefinitions: def?.inputs ?? [],
          outputDefinitions: def?.outputs ?? [],
        },
      };
    });
    const rfEdges: ReactFlowEdge[] = wf.graphDefinition.edges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      sourceHandle: e.sourceOutputKey,
      targetHandle: e.targetInputKey,
      type: "custom",
    }));
    set({
      workflowId: wf.id,
      workflowName: wf.name,
      nodes: rfNodes,
      edges: rfEdges,
      isDirty: false,
    });

    // Restore previous execution results for all nodes
    try {
      const executionStoreModule = await import("./execution.store");
      const executionStore = resolveStoreExport<{
        restoreResultsForNodes: (nodeIds: string[]) => Promise<void>;
      }>(executionStoreModule, "useExecutionStore");
      executionStore
        ?.getState()
        .restoreResultsForNodes(rfNodes.map((n) => n.id));
    } catch {
      /* ignore */
    }
  },

  newWorkflow: async (name) => {
    const wf = await workflowIpc.create({ name });
    const { nodes, edges } = getDefaultNewWorkflowContent();
    set({
      workflowId: wf.id,
      workflowName: wf.name,
      nodes,
      edges,
      isDirty: false,
    });
  },

  setWorkflowName: (name) => set({ workflowName: name, isDirty: true }),

  renameWorkflow: async (newName) => {
    const { workflowId } = get();
    set({ workflowName: newName });
    if (workflowId) {
      const result = (await workflowIpc.rename(
        workflowId,
        newName,
      )) as unknown as { finalName: string } | void;
      // If the backend deduplicated the name, sync it back
      if (
        result &&
        typeof result === "object" &&
        "finalName" in result &&
        result.finalName !== newName
      ) {
        set({ workflowName: result.finalName });
      }
    }
  },

  reset: () => {
    const { nodes, edges } = getDefaultNewWorkflowContent();
    set({
      nodes,
      edges,
      workflowId: null,
      workflowName: "Untitled Workflow",
      isDirty: false,
    });
  },
}));
