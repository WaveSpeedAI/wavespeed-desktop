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
import type {
  WorkflowNode,
  WorkflowEdge,
  ExposedParam,
} from "@/workflow/types/workflow";
import type { PortDefinition } from "@/workflow/types/node-defs";
import { wouldCreateCycleInSubWorkflow } from "@/workflow/lib/cycle-detection";

/* ── Iterator bounding-box constants ──────────────────────────────── */
const MIN_ITERATOR_WIDTH = 600;
const MIN_ITERATOR_HEIGHT = 400;
const CHILD_PADDING = 40;

/**
 * Purge exposed params (and their port definitions + connected edges) from
 * iterator nodes when child nodes are removed or released.
 * Returns updated nodes and edges arrays.
 */
function purgeExposedParamsForChildren(
  removedChildIds: Set<string>,
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
): { nodes: ReactFlowNode[]; edges: ReactFlowEdge[] } {
  // Find all iterator nodes that reference any of the removed children
  const iteratorNodes = nodes.filter(
    (n) => n.data.nodeType === "control/iterator",
  );
  if (iteratorNodes.length === 0) return { nodes, edges };

  let updatedNodes = nodes;
  let updatedEdges = edges;

  for (const iter of iteratorNodes) {
    const params = iter.data.params ?? {};
    let dirty = false;

    for (const direction of ["input", "output"] as const) {
      const paramListKey =
        direction === "input" ? "exposedInputs" : "exposedOutputs";
      const defKey =
        direction === "input" ? "inputDefinitions" : "outputDefinitions";

      const currentList: ExposedParam[] = (() => {
        try {
          const raw = params[paramListKey];
          return typeof raw === "string"
            ? JSON.parse(raw)
            : Array.isArray(raw)
              ? raw
              : [];
        } catch {
          return [];
        }
      })();

      const filtered = currentList.filter(
        (p) => !removedChildIds.has(p.subNodeId),
      );
      if (filtered.length === currentList.length) continue; // nothing to remove
      dirty = true;

      // Keys to remove
      const removedKeys = new Set(
        currentList
          .filter((p) => removedChildIds.has(p.subNodeId))
          .map((p) => p.namespacedKey),
      );

      // Remove port definitions
      const currentDefs: PortDefinition[] = iter.data[defKey] ?? [];
      const filteredDefs = currentDefs.filter((d) => !removedKeys.has(d.key));

      // Remove connected edges (both external and internal handles + auto-edges)
      const extHandleIds = new Set<string>();
      const intHandleIds = new Set<string>();
      const autoEdgeIds = new Set<string>();
      for (const k of removedKeys) {
        if (direction === "input") {
          extHandleIds.add(`input-${k}`);
          intHandleIds.add(`input-inner-${k}`);
        } else {
          extHandleIds.add(`output-${k}`);
          intHandleIds.add(`output-inner-${k}`);
        }
        autoEdgeIds.add(`iter-auto-${iter.id}-${k}`);
      }
      updatedEdges = updatedEdges.filter((e) => {
        if (autoEdgeIds.has(e.id)) return false;
        if (direction === "input") {
          if (e.target === iter.id && extHandleIds.has(e.targetHandle ?? ""))
            return false;
          if (e.source === iter.id && intHandleIds.has(e.sourceHandle ?? ""))
            return false;
        } else {
          if (e.source === iter.id && extHandleIds.has(e.sourceHandle ?? ""))
            return false;
          if (e.target === iter.id && intHandleIds.has(e.targetHandle ?? ""))
            return false;
        }
        return true;
      });

      // Update the iterator node
      updatedNodes = updatedNodes.map((n) => {
        if (n.id !== iter.id) return n;
        return {
          ...n,
          data: {
            ...n.data,
            params: {
              ...n.data.params,
              [paramListKey]: JSON.stringify(filtered),
            },
            [defKey]: filteredDefs,
          },
        };
      });
    }

    // Also clean up childNodeIds
    if (dirty) {
      const currentChildIds: string[] = iter.data.childNodeIds ?? [];
      const filteredChildIds = currentChildIds.filter(
        (id: string) => !removedChildIds.has(id),
      );
      if (filteredChildIds.length !== currentChildIds.length) {
        updatedNodes = updatedNodes.map((n) => {
          if (n.id !== iter.id) return n;
          return { ...n, data: { ...n.data, childNodeIds: filteredChildIds } };
        });
      }
    }
  }

  return { nodes: updatedNodes, edges: updatedEdges };
}

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
    parentNodeId: n.parentNode ?? null,
  }));

  const wfEdges: WorkflowEdge[] = edges.map((e) => ({
    id: e.id,
    workflowId: workflowId!,
    sourceNodeId: e.source,
    sourceOutputKey: e.sourceHandle ?? "output",
    targetNodeId: e.target,
    targetInputKey: e.targetHandle ?? "input",
    isInternal: e.data?.isInternal === true,
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
  updateEdge: (oldEdge: ReactFlowEdge, newConnection: Connection) => void;
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
  adoptNode: (iteratorId: string, childId: string) => void;
  releaseNode: (iteratorId: string, childId: string) => void;
  updateBoundingBox: (iteratorId: string) => void;
  exposeParam: (iteratorId: string, param: ExposedParam) => void;
  unexposeParam: (
    iteratorId: string,
    namespacedKey: string,
    direction: "input" | "output",
  ) => void;
  updateExposedParamAlias: (
    iteratorId: string,
    namespacedKey: string,
    direction: "input" | "output",
    alias: string,
  ) => void;
  syncExposedParamsOnModelSwitch: (
    childNodeId: string,
    newLabel: string,
    newInputParamKeys: string[],
  ) => void;
  importWorkflowIntoGroup: (
    groupId: string,
    sourceWorkflowId: string,
  ) => Promise<void>;
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
      type: type === "control/iterator" ? "control/iterator" : "custom",
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

    // For HTTP Trigger: build dynamic outputDefinitions from default outputFields param
    if (
      type === "trigger/http" &&
      outputDefs.length === 0 &&
      defaultParams.outputFields
    ) {
      try {
        const raw = defaultParams.outputFields;
        const fields: Array<{ key: string; label: string; type: string }> =
          typeof raw === "string"
            ? JSON.parse(raw)
            : Array.isArray(raw)
              ? raw
              : [];
        if (fields.length > 0) {
          newNode.data.outputDefinitions = fields.map((f) => ({
            key: f.key,
            label: f.label || f.key,
            dataType: f.type || "any",
            required: true,
          }));
        }
      } catch {
        /* keep empty */
      }
    }

    // For HTTP Response: build dynamic inputDefinitions from default responseFields param
    if (
      type === "output/http-response" &&
      inputDefs.length === 0 &&
      defaultParams.responseFields
    ) {
      try {
        const raw = defaultParams.responseFields;
        const fields: Array<{ key: string; label: string; type: string }> =
          typeof raw === "string"
            ? JSON.parse(raw)
            : Array.isArray(raw)
              ? raw
              : [];
        if (fields.length > 0) {
          newNode.data.inputDefinitions = fields.map((f) => ({
            key: f.key,
            label: f.label || f.key,
            dataType: f.type || "any",
            required: false,
          }));
        }
      } catch {
        /* keep empty */
      }
    }

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

    // If this is an iterator, collect all child nodes to delete them too
    const nodeToDelete = nodes.find((n) => n.id === nodeId);
    const idsToRemove = new Set([nodeId]);
    if (nodeToDelete?.data?.nodeType === "control/iterator") {
      for (const n of nodes) {
        if (n.parentNode === nodeId) idsToRemove.add(n.id);
      }
    }

    // Purge exposed params from parent iterator if this is a child node
    const purged = purgeExposedParamsForChildren(idsToRemove, nodes, edges);

    set(() => ({
      nodes: purged.nodes.filter((n) => !idsToRemove.has(n.id)),
      edges: purged.edges.filter(
        (e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target),
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

    // If any iterator is being deleted, also delete its child nodes
    for (const nid of nodeIds) {
      const node = nodes.find((n) => n.id === nid);
      if (node?.data?.nodeType === "control/iterator") {
        for (const n of nodes) {
          if (n.parentNode === nid) removeSet.add(n.id);
        }
      }
    }

    // Purge exposed params from parent iterators
    const purged = purgeExposedParamsForChildren(removeSet, nodes, edges);

    set(() => ({
      nodes: purged.nodes.filter((n) => !removeSet.has(n.id)),
      edges: purged.edges.filter(
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

    // ── Sub-workflow cycle detection ──
    // If both source and target are inside the same Iterator, validate that
    // the new edge won't create a cycle within the sub-workflow.
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    const isInternal =
      sourceNode?.parentNode &&
      targetNode?.parentNode &&
      sourceNode.parentNode === targetNode.parentNode;

    if (isInternal) {
      const parentId = sourceNode!.parentNode!;
      const subNodeIds = nodes
        .filter((n) => n.parentNode === parentId)
        .map((n) => n.id);
      const internalEdges = edges
        .filter(
          (e) =>
            e.data?.isInternal &&
            subNodeIds.includes(e.source) &&
            subNodeIds.includes(e.target),
        )
        .map((e) => ({ sourceNodeId: e.source, targetNodeId: e.target }));

      const wouldCycle = wouldCreateCycleInSubWorkflow(
        subNodeIds,
        internalEdges,
        { sourceNodeId: connection.source, targetNodeId: connection.target },
      );
      if (wouldCycle) {
        // Reject the connection — dispatch a toast event for the UI
        window.dispatchEvent(
          new CustomEvent("workflow:toast", {
            detail: {
              type: "error",
              msg: "Cannot connect: this would create a cycle inside the Iterator",
            },
          }),
        );
        return;
      }
    }

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
        ...(isInternal ? { data: { isInternal: true } } : {}),
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
        ...(isInternal ? { data: { isInternal: true } } : {}),
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

  updateEdge: (oldEdge, newConnection) => {
    if (!newConnection.source || !newConnection.target) return;
    if (newConnection.source === newConnection.target) return;
    const newSource = newConnection.source;
    const newTarget = newConnection.target;
    const { nodes, edges } = get();
    const sourceHandle = newConnection.sourceHandle ?? "output";
    const targetHandle = newConnection.targetHandle ?? "input";
    // Guard: no duplicate connections
    const duplicate = edges.some(
      (e) =>
        e.id !== oldEdge.id &&
        e.source === newSource &&
        e.target === newTarget &&
        e.sourceHandle === sourceHandle &&
        e.targetHandle === targetHandle,
    );
    if (duplicate) return;
    // Guard: target handle can only have one incoming connection (except from the same edge being updated)
    const existingToTarget = edges.some(
      (e) =>
        e.id !== oldEdge.id &&
        e.target === newTarget &&
        e.targetHandle === targetHandle,
    );
    if (existingToTarget) {
      // Replace the conflicting edge
      const filtered = edges.filter(
        (e) =>
          e.id !== oldEdge.id &&
          !(e.target === newTarget && e.targetHandle === targetHandle),
      );
      pushUndo({ nodes, edges });
      set({
        edges: [
          ...filtered,
          {
            id: oldEdge.id,
            source: newSource,
            target: newTarget,
            sourceHandle,
            targetHandle,
            type: "custom",
          },
        ],
        isDirty: true,
        canUndo: true,
        canRedo: false,
      });
    } else {
      pushUndo({ nodes, edges });
      set({
        edges: edges.map((e) =>
          e.id === oldEdge.id
            ? {
                id: e.id,
                source: newSource,
                target: newTarget,
                sourceHandle,
                targetHandle,
                type: "custom",
              }
            : e,
        ),
        isDirty: true,
        canUndo: true,
        canRedo: false,
      });
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

    // Dynamic port sync for HTTP Trigger and HTTP Response nodes
    let extraData: Record<string, unknown> | null = null;
    const node = nodes.find((n) => n.id === nodeId);

    if (
      node?.data?.nodeType === "trigger/http" &&
      params.outputFields !== undefined
    ) {
      try {
        const raw = params.outputFields;
        const fields: Array<{ key: string; label: string; type: string }> =
          typeof raw === "string"
            ? JSON.parse(raw)
            : Array.isArray(raw)
              ? raw
              : [];
        extraData = {
          outputDefinitions: fields.map((f) => ({
            key: f.key,
            label: f.label || f.key,
            dataType: f.type || "any",
            required: true,
          })),
        };
      } catch {
        /* invalid JSON — leave unchanged */
      }
    }

    if (
      node?.data?.nodeType === "output/http-response" &&
      params.responseFields !== undefined
    ) {
      try {
        const raw = params.responseFields;
        const fields: Array<{ key: string; label: string; type: string }> =
          typeof raw === "string"
            ? JSON.parse(raw)
            : Array.isArray(raw)
              ? raw
              : [];
        extraData = {
          inputDefinitions: fields.map((f) => ({
            key: f.key,
            label: f.label || f.key,
            dataType: f.type || "any",
            required: true,
          })),
        };
      } catch {
        /* invalid JSON — leave unchanged */
      }
    }

    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                params,
                ...(extraData ?? {}),
              },
            }
          : n,
      ),
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));

    // If this node is a child of an Iterator, recalculate the bounding box
    if (node?.parentNode) {
      get().updateBoundingBox(node.parentNode);
    }
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

    // NOTE: We intentionally do NOT call updateBoundingBox on position changes.
    // The iterator border should only expand when child nodes are added or their
    // UI size changes (e.g. model switch), not when dragging children around.
    // Children are clamped within the iterator bounds by useIteratorAdoption.
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

    // Build a map of iteratorId → childNodeIds from parent relationships
    const iteratorChildMap = new Map<string, string[]>();
    for (const n of wf.graphDefinition.nodes) {
      if (n.parentNodeId) {
        const children = iteratorChildMap.get(n.parentNodeId) ?? [];
        children.push(n.id);
        iteratorChildMap.set(n.parentNodeId, children);
      }
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

      const isIterator = n.nodeType === "control/iterator";
      // Rebuild dynamic port definitions for HTTP Trigger / HTTP Response
      let inputDefs = def?.inputs ?? [];
      let outputDefs = def?.outputs ?? [];

      if (n.nodeType === "trigger/http" && cleanParams.outputFields) {
        try {
          const raw = cleanParams.outputFields;
          const fields: Array<{ key: string; label: string; type: string }> =
            typeof raw === "string"
              ? JSON.parse(raw)
              : Array.isArray(raw)
                ? raw
                : [];
          outputDefs = fields.map((f) => ({
            key: f.key,
            label: f.label || f.key,
            dataType: f.type || "any",
            required: true,
          }));
        } catch {
          /* keep static defs */
        }
      }

      if (n.nodeType === "output/http-response" && cleanParams.responseFields) {
        try {
          const raw = cleanParams.responseFields;
          const fields: Array<{ key: string; label: string; type: string }> =
            typeof raw === "string"
              ? JSON.parse(raw)
              : Array.isArray(raw)
                ? raw
                : [];
          inputDefs = fields.map((f) => ({
            key: f.key,
            label: f.label || f.key,
            dataType: f.type || "any",
            required: true,
          }));
        } catch {
          /* keep static defs */
        }
      }

      const rfNode: ReactFlowNode = {
        id: n.id,
        type: isIterator ? "control/iterator" : "custom",
        position: n.position,
        data: {
          nodeType: n.nodeType,
          params: cleanParams,
          label,
          modelInputSchema: modelInputSchema ?? [],
          paramDefinitions: def?.params ?? [],
          inputDefinitions: inputDefs,
          outputDefinitions: outputDefs,
          ...(isIterator
            ? { childNodeIds: iteratorChildMap.get(n.id) ?? [] }
            : {}),
        },
      };

      // Restore parent-child relationship for sub-nodes
      if (n.parentNodeId) {
        rfNode.parentNode = n.parentNodeId;
      }

      return rfNode;
    });
    const rfEdges: ReactFlowEdge[] = wf.graphDefinition.edges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      sourceHandle: e.sourceOutputKey,
      targetHandle: e.targetInputKey,
      type: "custom",
      ...(e.isInternal ? { data: { isInternal: true } } : {}),
    }));
    set({
      workflowId: wf.id,
      workflowName: wf.name,
      nodes: rfNodes,
      edges: rfEdges,
      isDirty: false,
    });

    // Exit subgraph editing when loading a different workflow
    try {
      const { useUIStore } = await import("./ui.store");
      useUIStore.getState().exitGroupEdit();
    } catch {
      /* ignore */
    }

    // Recalculate bounding boxes for all iterator nodes
    for (const iteratorId of iteratorChildMap.keys()) {
      get().updateBoundingBox(iteratorId);
    }

    // Clamp child nodes within their parent iterator bounds after load
    {
      const currentNodes = get().nodes;
      const clampUpdates: Array<{
        nodeId: string;
        pos: { x: number; y: number };
      }> = [];
      for (const iteratorId of iteratorChildMap.keys()) {
        const itNode = currentNodes.find((n) => n.id === iteratorId);
        if (!itNode) continue;
        const itW =
          (itNode.data?.params?.__nodeWidth as number) ?? MIN_ITERATOR_WIDTH;
        const itH =
          (itNode.data?.params?.__nodeHeight as number) ?? MIN_ITERATOR_HEIGHT;
        const children = currentNodes.filter(
          (n) => n.parentNode === iteratorId,
        );
        for (const child of children) {
          const cw = (child.data?.params?.__nodeWidth as number) ?? 300;
          const ch = (child.data?.params?.__nodeHeight as number) ?? 80;
          const minX = CHILD_PADDING;
          const maxX = Math.max(minX, itW - cw - CHILD_PADDING);
          const minY = CHILD_PADDING + 40; // 40 = title bar
          const maxY = Math.max(minY, itH - ch - CHILD_PADDING - 40);
          const cx = Math.min(Math.max(child.position.x, minX), maxX);
          const cy = Math.min(Math.max(child.position.y, minY), maxY);
          if (cx !== child.position.x || cy !== child.position.y) {
            clampUpdates.push({ nodeId: child.id, pos: { x: cx, y: cy } });
          }
        }
      }
      if (clampUpdates.length > 0) {
        set((state) => ({
          nodes: state.nodes.map((n) => {
            const upd = clampUpdates.find((u) => u.nodeId === n.id);
            return upd ? { ...n, position: upd.pos } : n;
          }),
        }));
      }
    }

    // Notify canvas to restore viewport
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("workflow:loaded", { detail: { workflowId: wf.id } }),
      );
    }

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

  adoptNode: (iteratorId, childId) => {
    const { nodes, edges } = get();

    const iteratorNode = nodes.find((n) => n.id === iteratorId);
    const childNode = nodes.find((n) => n.id === childId);
    if (!iteratorNode || !childNode) return;

    // Prevent nesting: reject if the child is itself an Iterator node
    if (childNode.data.nodeType === "control/iterator") return;

    // Reject if child already has a parent
    if (childNode.parentNode) return;

    pushUndo({ nodes, edges });

    // Convert child position to relative coordinates (relative to iterator)
    const relativePosition = {
      x: childNode.position.x - iteratorNode.position.x,
      y: childNode.position.y - iteratorNode.position.y,
    };

    // Update childNodeIds in iterator data
    const currentChildIds: string[] = iteratorNode.data.childNodeIds ?? [];
    const updatedChildIds = currentChildIds.includes(childId)
      ? currentChildIds
      : [...currentChildIds, childId];

    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id === childId) {
          return {
            ...n,
            position: relativePosition,
            parentNode: iteratorId,
            data: { ...n.data },
          };
        }
        if (n.id === iteratorId) {
          return {
            ...n,
            data: {
              ...n.data,
              childNodeIds: updatedChildIds,
            },
          };
        }
        return n;
      }),
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));

    // Recalculate bounding box after adopting the child
    get().updateBoundingBox(iteratorId);
  },

  releaseNode: (iteratorId, childId) => {
    const { nodes, edges } = get();

    const iteratorNode = nodes.find((n) => n.id === iteratorId);
    const childNode = nodes.find((n) => n.id === childId);
    if (!iteratorNode || !childNode) return;

    // Only release if the child actually belongs to this iterator
    if (childNode.parentNode !== iteratorId) return;

    pushUndo({ nodes, edges });

    // Purge exposed params for this child from the iterator
    const purged = purgeExposedParamsForChildren(
      new Set([childId]),
      nodes,
      edges,
    );

    // Convert child position back to absolute coordinates
    const absolutePosition = {
      x: childNode.position.x + iteratorNode.position.x,
      y: childNode.position.y + iteratorNode.position.y,
    };

    set(() => ({
      nodes: purged.nodes.map((n) => {
        if (n.id === childId) {
          // Remove parentNode and extent by spreading without them
          const { parentNode: _, extent: _e, ...rest } = n;
          return {
            ...rest,
            position: absolutePosition,
            data: { ...n.data },
          };
        }
        return n;
      }),
      edges: purged.edges,
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));

    // Recalculate bounding box after releasing the child
    get().updateBoundingBox(iteratorId);
  },

  updateBoundingBox: (iteratorId) => {
    const { nodes } = get();
    const iteratorNode = nodes.find((n) => n.id === iteratorId);
    if (!iteratorNode) return;

    const children = nodes.filter((n) => n.parentNode === iteratorId);
    const currentParams = iteratorNode.data.params ?? {};
    const currentW =
      (currentParams.__nodeWidth as number) ?? MIN_ITERATOR_WIDTH;
    const currentH =
      (currentParams.__nodeHeight as number) ?? MIN_ITERATOR_HEIGHT;

    // Only expand — never shrink. If children fit inside the current size, do nothing.
    let requiredWidth = MIN_ITERATOR_WIDTH;
    let requiredHeight = MIN_ITERATOR_HEIGHT;

    if (children.length > 0) {
      let maxRight = 0;
      let maxBottom = 0;
      for (const child of children) {
        const cw = (child.data?.params?.__nodeWidth as number) ?? 300;
        // Use DOM measurement for height when available (child nodes auto-size vertically)
        let ch = (child.data?.params?.__nodeHeight as number) ?? 80;
        try {
          const el = document.querySelector(
            `[data-id="${child.id}"]`,
          ) as HTMLElement | null;
          if (el) ch = Math.max(ch, el.offsetHeight);
        } catch {
          /* ignore DOM errors */
        }
        const right = child.position.x + cw + CHILD_PADDING;
        const bottom = child.position.y + ch + CHILD_PADDING;
        if (right > maxRight) maxRight = right;
        if (bottom > maxBottom) maxBottom = bottom;
      }
      requiredWidth = Math.max(MIN_ITERATOR_WIDTH, maxRight + CHILD_PADDING);
      requiredHeight = Math.max(MIN_ITERATOR_HEIGHT, maxBottom);
    }

    // Only grow, never shrink
    const newWidth = Math.max(currentW, requiredWidth);
    const newHeight = Math.max(currentH, requiredHeight);

    if (currentW === newWidth && currentH === newHeight) {
      return; // no change needed
    }

    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id === iteratorId) {
          return {
            ...n,
            data: {
              ...n.data,
              params: {
                ...n.data.params,
                __nodeWidth: newWidth,
                __nodeHeight: newHeight,
              },
            },
          };
        }
        return n;
      }),
      isDirty: true,
    }));
  },

  exposeParam: (iteratorId, param) => {
    const { nodes, edges } = get();
    const iteratorNode = nodes.find((n) => n.id === iteratorId);
    if (!iteratorNode) return;

    pushUndo({ nodes, edges });

    const params = iteratorNode.data.params ?? {};
    const paramListKey =
      param.direction === "input" ? "exposedInputs" : "exposedOutputs";
    const defKey =
      param.direction === "input" ? "inputDefinitions" : "outputDefinitions";

    // Parse existing exposed params
    const currentList: ExposedParam[] = (() => {
      try {
        const raw = params[paramListKey];
        return typeof raw === "string" ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    })();

    // Don't add duplicates
    if (
      currentList.some(
        (p: ExposedParam) => p.namespacedKey === param.namespacedKey,
      )
    )
      return;

    const updatedList = [...currentList, param];

    // Build new port definition — label shows "ParamName · NodeLabel"
    const readableParam = param.paramKey
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    // Use the subNodeLabel passed from the picker (may include #N numbering for duplicates)
    const shortNodeLabel = param.subNodeLabel.includes("/")
      ? param.subNodeLabel.split("/").pop()!
      : param.subNodeLabel;
    const newPort: PortDefinition = {
      key: param.namespacedKey,
      label: param.alias || `${readableParam} · ${shortNodeLabel}`,
      dataType: param.dataType,
      required: false,
    };

    const currentDefs: PortDefinition[] = iteratorNode.data[defKey] ?? [];
    const updatedDefs = [...currentDefs, newPort];

    // Auto-create internal edge between capsule inner handle and child node handle
    const autoEdgeId = `iter-auto-${iteratorId}-${param.namespacedKey}`;
    let autoEdge: ReactFlowEdge | null = null;

    if (param.direction === "input") {
      // Capsule inner source → child node input
      // The child node's input handle is either `input-{key}` or `param-{key}`
      // For ai-task model schema fields, the handle is `param-{key}`
      const childNode = nodes.find((n) => n.id === param.subNodeId);
      const childInputDefs = (childNode?.data?.inputDefinitions ??
        []) as PortDefinition[];
      const hasInputPort = childInputDefs.some(
        (d: PortDefinition) => d.key === param.paramKey,
      );
      const targetHandle = hasInputPort
        ? `input-${param.paramKey}`
        : `param-${param.paramKey}`;

      autoEdge = {
        id: autoEdgeId,
        source: iteratorId,
        sourceHandle: `input-inner-${param.namespacedKey}`,
        target: param.subNodeId,
        targetHandle,
        type: "custom",
        data: { isInternal: true },
      };
    } else {
      // Child node output → capsule inner target
      autoEdge = {
        id: autoEdgeId,
        source: param.subNodeId,
        sourceHandle: param.paramKey,
        target: iteratorId,
        targetHandle: `output-inner-${param.namespacedKey}`,
        type: "custom",
        data: { isInternal: true },
      };
    }

    // Update node definitions AND add auto-edge in a single state update
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id === iteratorId) {
          return {
            ...n,
            data: {
              ...n.data,
              params: {
                ...n.data.params,
                [paramListKey]: JSON.stringify(updatedList),
              },
              [defKey]: updatedDefs,
            },
          };
        }
        return n;
      }),
      edges: autoEdge ? [...state.edges, autoEdge] : state.edges,
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));
  },

  unexposeParam: (iteratorId, namespacedKey, direction) => {
    const { nodes, edges } = get();
    const iteratorNode = nodes.find((n) => n.id === iteratorId);
    if (!iteratorNode) return;

    pushUndo({ nodes, edges });

    const params = iteratorNode.data.params ?? {};
    const paramListKey =
      direction === "input" ? "exposedInputs" : "exposedOutputs";
    const defKey =
      direction === "input" ? "inputDefinitions" : "outputDefinitions";

    // Parse existing exposed params and remove the matching entry
    const currentList: ExposedParam[] = (() => {
      try {
        const raw = params[paramListKey];
        return typeof raw === "string" ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    })();

    const updatedList = currentList.filter(
      (p: ExposedParam) => p.namespacedKey !== namespacedKey,
    );

    // Remove the corresponding port definition
    const currentDefs: PortDefinition[] = iteratorNode.data[defKey] ?? [];
    const updatedDefs = currentDefs.filter(
      (d: PortDefinition) => d.key !== namespacedKey,
    );

    // Remove any connected edges to/from both external and internal handles
    const extHandleId =
      direction === "input"
        ? `input-${namespacedKey}`
        : `output-${namespacedKey}`;
    const intHandleId =
      direction === "input"
        ? `input-inner-${namespacedKey}`
        : `output-inner-${namespacedKey}`;
    const autoEdgeId = `iter-auto-${iteratorId}-${namespacedKey}`;

    const edgeIdsToRemove = new Set<string>();
    edgeIdsToRemove.add(autoEdgeId); // auto-created internal edge

    for (const e of edges) {
      if (direction === "input") {
        // External edges connecting to the external target handle
        if (e.target === iteratorId && e.targetHandle === extHandleId)
          edgeIdsToRemove.add(e.id);
        // Internal edges from the inner source handle
        if (e.source === iteratorId && e.sourceHandle === intHandleId)
          edgeIdsToRemove.add(e.id);
      } else {
        // External edges from the external source handle
        if (e.source === iteratorId && e.sourceHandle === extHandleId)
          edgeIdsToRemove.add(e.id);
        // Internal edges to the inner target handle
        if (e.target === iteratorId && e.targetHandle === intHandleId)
          edgeIdsToRemove.add(e.id);
      }
    }

    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id === iteratorId) {
          return {
            ...n,
            data: {
              ...n.data,
              params: {
                ...n.data.params,
                [paramListKey]: JSON.stringify(updatedList),
              },
              [defKey]: updatedDefs,
            },
          };
        }
        return n;
      }),
      edges:
        edgeIdsToRemove.size > 0
          ? state.edges.filter((e) => !edgeIdsToRemove.has(e.id))
          : state.edges,
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));
  },

  updateExposedParamAlias: (iteratorId, namespacedKey, direction, alias) => {
    const { nodes } = get();
    const iteratorNode = nodes.find((n) => n.id === iteratorId);
    if (!iteratorNode) return;

    const paramListKey =
      direction === "input" ? "exposedInputs" : "exposedOutputs";
    const currentList: ExposedParam[] = (() => {
      try {
        const raw = iteratorNode.data.params?.[paramListKey];
        return typeof raw === "string"
          ? JSON.parse(raw)
          : Array.isArray(raw)
            ? raw
            : [];
      } catch {
        return [];
      }
    })();

    const updatedList = currentList.map((p: ExposedParam) =>
      p.namespacedKey === namespacedKey
        ? { ...p, alias: alias || undefined }
        : p,
    );

    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id === iteratorId) {
          return {
            ...n,
            data: {
              ...n.data,
              params: {
                ...n.data.params,
                [paramListKey]: JSON.stringify(updatedList),
              },
            },
          };
        }
        return n;
      }),
      isDirty: true,
    }));
  },

  /**
   * Sync exposed params when a child node inside an iterator switches models.
   *
   * Scenarios handled:
   * 1. Label changed → update subNodeLabel + namespacedKey in all exposed params & edges
   * 2. Input param removed by new model → remove that exposed input + auto-edge + external edges
   * 3. Input param still exists in new model → keep it, update label
   * 4. Output always exists (key="output") → keep it, update label with new model name
   * 5. Multiple child nodes in same iterator → only affect the switched node's params
   */
  syncExposedParamsOnModelSwitch: (
    childNodeId,
    newLabel,
    newInputParamKeys,
  ) => {
    const { nodes, edges } = get();
    const childNode = nodes.find((n) => n.id === childNodeId);
    if (!childNode?.parentNode) return; // not inside an iterator

    const iteratorId = childNode.parentNode;
    const iteratorNode = nodes.find((n) => n.id === iteratorId);
    if (!iteratorNode || iteratorNode.data.nodeType !== "control/iterator")
      return;

    const params = iteratorNode.data.params ?? {};
    const newInputKeySet = new Set(newInputParamKeys);
    let updatedNodes = nodes;
    let updatedEdges = edges;
    let dirty = false;

    for (const direction of ["input", "output"] as const) {
      const paramListKey =
        direction === "input" ? "exposedInputs" : "exposedOutputs";
      const defKey =
        direction === "input" ? "inputDefinitions" : "outputDefinitions";

      const currentList: ExposedParam[] = (() => {
        try {
          const raw = params[paramListKey];
          return typeof raw === "string"
            ? JSON.parse(raw)
            : Array.isArray(raw)
              ? raw
              : [];
        } catch {
          return [];
        }
      })();

      // Only process params belonging to this child node
      const mine = currentList.filter((p) => p.subNodeId === childNodeId);
      const others = currentList.filter((p) => p.subNodeId !== childNodeId);
      if (mine.length === 0) continue;

      const kept: ExposedParam[] = [];
      const removedKeys = new Set<string>();

      for (const ep of mine) {
        if (direction === "input" && !newInputKeySet.has(ep.paramKey)) {
          // Input param no longer exists in new model → remove
          removedKeys.add(ep.namespacedKey);
        } else {
          // Param still valid → update label and namespacedKey
          const oldNk = ep.namespacedKey;
          const newNk = `${newLabel}.${ep.paramKey}`;
          const updated: ExposedParam = {
            ...ep,
            subNodeLabel: newLabel,
            namespacedKey: newNk,
          };
          kept.push(updated);

          if (oldNk !== newNk) {
            // Rename handle IDs in edges
            const oldAutoId = `iter-auto-${iteratorId}-${oldNk}`;
            const newAutoId = `iter-auto-${iteratorId}-${newNk}`;
            updatedEdges = updatedEdges.map((e) => {
              if (e.id === oldAutoId) {
                if (direction === "input") {
                  return {
                    ...e,
                    id: newAutoId,
                    sourceHandle: `input-inner-${newNk}`,
                  };
                } else {
                  return {
                    ...e,
                    id: newAutoId,
                    targetHandle: `output-inner-${newNk}`,
                  };
                }
              }
              // Update external edges referencing old handle IDs
              if (direction === "input") {
                if (
                  e.target === iteratorId &&
                  e.targetHandle === `input-${oldNk}`
                ) {
                  return { ...e, targetHandle: `input-${newNk}` };
                }
                if (
                  e.source === iteratorId &&
                  e.sourceHandle === `input-inner-${oldNk}`
                ) {
                  return { ...e, sourceHandle: `input-inner-${newNk}` };
                }
              } else {
                if (
                  e.source === iteratorId &&
                  e.sourceHandle === `output-${oldNk}`
                ) {
                  return { ...e, sourceHandle: `output-${newNk}` };
                }
                if (
                  e.target === iteratorId &&
                  e.targetHandle === `output-inner-${oldNk}`
                ) {
                  return { ...e, targetHandle: `output-inner-${newNk}` };
                }
              }
              return e;
            });
          }
        }
      }

      // Remove edges for removed params
      if (removedKeys.size > 0) {
        const removeHandles = new Set<string>();
        const removeAutoIds = new Set<string>();
        for (const k of removedKeys) {
          removeAutoIds.add(`iter-auto-${iteratorId}-${k}`);
          if (direction === "input") {
            removeHandles.add(`input-${k}`);
            removeHandles.add(`input-inner-${k}`);
          } else {
            removeHandles.add(`output-${k}`);
            removeHandles.add(`output-inner-${k}`);
          }
        }
        updatedEdges = updatedEdges.filter((e) => {
          if (removeAutoIds.has(e.id)) return false;
          if (direction === "input") {
            if (
              e.target === iteratorId &&
              removeHandles.has(e.targetHandle ?? "")
            )
              return false;
            if (
              e.source === iteratorId &&
              removeHandles.has(e.sourceHandle ?? "")
            )
              return false;
          } else {
            if (
              e.source === iteratorId &&
              removeHandles.has(e.sourceHandle ?? "")
            )
              return false;
            if (
              e.target === iteratorId &&
              removeHandles.has(e.targetHandle ?? "")
            )
              return false;
          }
          return true;
        });
      }

      const updatedList = [...others, ...kept];
      const currentDefs: PortDefinition[] = iteratorNode.data[defKey] ?? [];
      // Rebuild defs: keep others' defs, rebuild this child's defs from kept params
      const otherDefs = currentDefs.filter(
        (d) => !mine.some((m) => m.namespacedKey === d.key),
      );
      const keptDefs = kept.map((ep): PortDefinition => {
        const readableParam = ep.paramKey
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        const shortLabel = ep.subNodeLabel.includes("/")
          ? ep.subNodeLabel.split("/").pop()!
          : ep.subNodeLabel;
        return {
          key: ep.namespacedKey,
          label: `${readableParam} · ${shortLabel}`,
          dataType: ep.dataType,
          required: false,
        };
      });

      updatedNodes = updatedNodes.map((n) => {
        if (n.id !== iteratorId) return n;
        return {
          ...n,
          data: {
            ...n.data,
            params: {
              ...n.data.params,
              [paramListKey]: JSON.stringify(updatedList),
            },
            [defKey]: [...otherDefs, ...keptDefs],
          },
        };
      });
      dirty = true;
    }

    if (dirty) {
      set({ nodes: updatedNodes, edges: updatedEdges, isDirty: true });
    }
  },

  importWorkflowIntoGroup: async (groupId, sourceWorkflowId) => {
    const { nodes, edges } = get();
    const groupNode = nodes.find((n) => n.id === groupId);
    if (!groupNode) return;

    // Load source workflow
    const srcWf = await workflowIpc.load(sourceWorkflowId);
    const srcNodes = srcWf.graphDefinition.nodes;
    const srcEdges = srcWf.graphDefinition.edges;
    if (srcNodes.length === 0) return;

    pushUndo({ nodes, edges });

    // Build old→new ID mapping for cloned nodes
    const idMap = new Map<string, string>();
    for (const sn of srcNodes) {
      idMap.set(sn.id, uuid());
    }

    // Fetch node type definitions for label/param/port restoration
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
        defs.map((d) => [
          d.type,
          {
            params: d.params ?? [],
            inputs: d.inputs ?? [],
            outputs: d.outputs ?? [],
            label: d.label ?? d.type,
          },
        ]),
      );
    } catch {
      /* fallback */
    }

    // Clone nodes — skip nodes that are children of iterators within the source
    // (they'll be handled when their parent iterator is cloned)
    const clonedRfNodes: ReactFlowNode[] = [];
    for (const sn of srcNodes) {
      const newId = idMap.get(sn.id)!;
      const meta = (sn.params as Record<string, unknown>).__meta as
        | Record<string, unknown>
        | undefined;
      const def = defMap.get(sn.nodeType);
      const label = (meta?.label as string) || (def ? def.label : sn.nodeType);
      const { __meta: _, ...cleanParams } = sn.params as Record<
        string,
        unknown
      >;
      const isIterator = sn.nodeType === "control/iterator";

      // If this node has a parent within the source workflow, map it
      const srcParent = sn.parentNodeId;
      const newParent = srcParent ? idMap.get(srcParent) : undefined;

      const rfNode: ReactFlowNode = {
        id: newId,
        type: isIterator ? "control/iterator" : "custom",
        position: sn.position,
        data: {
          nodeType: sn.nodeType,
          params: cleanParams,
          label,
          modelInputSchema: meta?.modelInputSchema ?? [],
          paramDefinitions: def?.params ?? [],
          inputDefinitions: def?.inputs ?? [],
          outputDefinitions: def?.outputs ?? [],
          ...(isIterator ? { childNodeIds: [] as string[] } : {}),
        },
      };

      // If this node was a child of an iterator in the source, keep that relationship
      if (newParent) {
        rfNode.parentNode = newParent;
      }

      clonedRfNodes.push(rfNode);
    }

    // Rebuild childNodeIds for cloned iterators
    for (const sn of srcNodes) {
      if (sn.parentNodeId && idMap.has(sn.parentNodeId)) {
        const parentNewId = idMap.get(sn.parentNodeId)!;
        const parentNode = clonedRfNodes.find((n) => n.id === parentNewId);
        if (parentNode?.data?.childNodeIds) {
          parentNode.data.childNodeIds.push(idMap.get(sn.id)!);
        }
      }
    }

    // Remap exposed params in cloned iterator nodes
    for (const cn of clonedRfNodes) {
      if (cn.data.nodeType !== "control/iterator") continue;
      for (const paramKey of ["exposedInputs", "exposedOutputs"] as const) {
        try {
          const raw = cn.data.params[paramKey];
          const list: ExposedParam[] =
            typeof raw === "string"
              ? JSON.parse(raw)
              : Array.isArray(raw)
                ? raw
                : [];
          if (list.length === 0) continue;
          const remapped = list.map((ep) => ({
            ...ep,
            subNodeId: idMap.get(ep.subNodeId) ?? ep.subNodeId,
          }));
          cn.data.params[paramKey] = JSON.stringify(remapped);
        } catch {
          /* ignore */
        }
      }
    }

    // Clone edges — remap source/target IDs
    const clonedEdges: ReactFlowEdge[] = srcEdges
      .filter((e) => idMap.has(e.sourceNodeId) && idMap.has(e.targetNodeId))
      .map((e) => ({
        id: uuid(),
        source: idMap.get(e.sourceNodeId)!,
        target: idMap.get(e.targetNodeId)!,
        sourceHandle: e.sourceOutputKey,
        targetHandle: e.targetInputKey,
        type: "custom",
        ...(e.isInternal ? { data: { isInternal: true } } : {}),
      }));

    // Now adopt all top-level cloned nodes into the group
    // (nodes that already have a parent within the source stay nested)
    const topLevelCloned = clonedRfNodes.filter((n) => !n.parentNode);

    // Compute offset so cloned nodes are positioned relative to group
    // Place them starting at a reasonable internal position
    const startX = 60;
    const startY = 80;
    // Find bounding box of top-level source nodes to compute offset
    let minX = Infinity,
      minY = Infinity;
    for (const n of topLevelCloned) {
      if (n.position.x < minX) minX = n.position.x;
      if (n.position.y < minY) minY = n.position.y;
    }
    const offsetX = startX - minX;
    const offsetY = startY - minY;

    // Apply offset and set parentNode for top-level nodes
    for (const n of topLevelCloned) {
      n.position = { x: n.position.x + offsetX, y: n.position.y + offsetY };
      n.parentNode = groupId;
    }

    // Also offset nested children (children of iterators within the source keep their relative positions)

    // Build updated childNodeIds for the group
    const existingChildIds: string[] = groupNode.data.childNodeIds ?? [];
    const newChildIds = [
      ...existingChildIds,
      ...topLevelCloned.map((n) => n.id),
    ];

    set((state) => ({
      nodes: [
        ...state.nodes.map((n) =>
          n.id === groupId
            ? { ...n, data: { ...n.data, childNodeIds: newChildIds } }
            : n,
        ),
        ...clonedRfNodes,
      ],
      edges: [...state.edges, ...clonedEdges],
      isDirty: true,
      canUndo: true,
      canRedo: false,
    }));

    // Auto-save
    const wfId = get().workflowId;
    if (wfId) {
      setTimeout(() => {
        get().saveWorkflow().catch(console.error);
      }, 100);
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
