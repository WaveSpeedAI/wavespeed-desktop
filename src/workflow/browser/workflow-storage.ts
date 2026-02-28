/**
 * In-browser workflow persistence (localStorage).
 * Used when running without Electron so users can create/edit workflows in the browser.
 */
import { v4 as uuidv4 } from "uuid";
import type { Workflow, GraphDefinition } from "@/workflow/types/workflow";
import type { WorkflowSummary } from "@/workflow/types/ipc";

const STORAGE_KEY = "wavespeed_workflows";

interface StoredWorkflow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  graphDefinition: GraphDefinition;
  status: Workflow["status"];
}

function loadAll(): StoredWorkflow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(workflows: StoredWorkflow[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
  } catch {
    // quota or disabled
  }
}

function ensureUniqueName(
  workflows: StoredWorkflow[],
  name: string,
  excludeId: string | null,
): string {
  const trimmed = (name || "").trim() || "Untitled Workflow";
  const names = new Set(
    workflows.filter((w) => w.id !== excludeId).map((w) => w.name),
  );
  if (!names.has(trimmed)) return trimmed;
  let n = 2;
  while (names.has(`${trimmed} (${n})`)) n++;
  return `${trimmed} (${n})`;
}

export function createWorkflow(name: string): Workflow {
  const workflows = loadAll();
  const id = uuidv4();
  const now = new Date().toISOString();
  const finalName = ensureUniqueName(workflows, name, null);
  const wf: StoredWorkflow = {
    id,
    name: finalName,
    createdAt: now,
    updatedAt: now,
    graphDefinition: { nodes: [], edges: [] },
    status: "draft",
  };
  workflows.unshift(wf);
  saveAll(workflows);
  return { ...wf };
}

export function getWorkflowById(id: string): Workflow | null {
  const workflows = loadAll();
  const w = workflows.find((w) => w.id === id);
  return w ? { ...w } : null;
}

export function listWorkflows(): WorkflowSummary[] {
  const workflows = loadAll();
  return workflows.map((w) => ({
    id: w.id,
    name: w.name,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    status: w.status,
    nodeCount: w.graphDefinition?.nodes?.length ?? 0,
  }));
}

export function updateWorkflow(
  id: string,
  name: string,
  graphDefinition: GraphDefinition,
  status?: Workflow["status"],
): void {
  const workflows = loadAll();
  const idx = workflows.findIndex((w) => w.id === id);
  if (idx === -1) return;
  const existing = workflows[idx];
  const now = new Date().toISOString();
  const finalName =
    name !== existing.name ? ensureUniqueName(workflows, name, id) : name;
  workflows[idx] = {
    ...existing,
    name: finalName,
    updatedAt: now,
    graphDefinition,
    ...(status != null && { status }),
  };
  saveAll(workflows);
}

export function renameWorkflow(id: string, newName: string): string {
  const workflows = loadAll();
  const idx = workflows.findIndex((w) => w.id === id);
  if (idx === -1) return newName;
  const finalName = ensureUniqueName(workflows, newName, id);
  workflows[idx] = {
    ...workflows[idx],
    name: finalName,
    updatedAt: new Date().toISOString(),
  };
  saveAll(workflows);
  return finalName;
}

export function deleteWorkflow(id: string): void {
  const workflows = loadAll().filter((w) => w.id !== id);
  saveAll(workflows);
}

/**
 * Clone a workflow: new id, name "${originalName} (copy)" (deduplicated), same graph with new node/edge IDs.
 */
export function duplicateWorkflow(sourceId: string): Workflow {
  const workflows = loadAll();
  const source = workflows.find((w) => w.id === sourceId);
  if (!source) throw new Error(`Workflow ${sourceId} not found`);

  const id = uuidv4();
  const now = new Date().toISOString();
  const copyName = ensureUniqueName(workflows, `${source.name} (copy)`, null);

  const nodeIdMap = new Map<string, string>();
  for (const n of source.graphDefinition?.nodes ?? []) {
    nodeIdMap.set(n.id, uuidv4());
  }

  const clonedNodes = (source.graphDefinition?.nodes ?? []).map((n) => ({
    ...n,
    id: nodeIdMap.get(n.id)!,
    workflowId: id,
    currentOutputId: null as string | null,
  }));

  const clonedEdges = (source.graphDefinition?.edges ?? []).map((e) => ({
    ...e,
    id: uuidv4(),
    workflowId: id,
    sourceNodeId: nodeIdMap.get(e.sourceNodeId)!,
    targetNodeId: nodeIdMap.get(e.targetNodeId)!,
  }));

  const cloned: StoredWorkflow = {
    id,
    name: copyName,
    createdAt: now,
    updatedAt: now,
    graphDefinition: { nodes: clonedNodes, edges: clonedEdges },
    status: "draft",
  };
  workflows.unshift(cloned);
  saveAll(workflows);
  return { ...cloned };
}
