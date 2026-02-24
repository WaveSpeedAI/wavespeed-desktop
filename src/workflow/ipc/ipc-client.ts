/**
 * Type-safe IPC client for workflow renderer process.
 * In Electron: uses window.workflowAPI (preload). In browser: uses browser adapter
 * (localStorage workflows + static node defs). Workflow execution runs in-browser only.
 */
import type {
  IpcChannelName,
  IpcArgs,
  IpcResult,
  CreateWorkflowInput,
  SaveWorkflowInput,
  WorkflowSummary,
  CostEstimate,
  BudgetConfig,
  ApiKeyConfig
} from '@/workflow/types/ipc'
import type { Workflow } from '@/workflow/types/workflow'
import type { NodeExecutionRecord, EdgeStatus } from '@/workflow/types/execution'
import type { NodeTypeDefinition, WaveSpeedModel } from '@/workflow/types/node-defs'
import { browserWorkflowAPI } from '@/workflow/browser/workflow-api'

function getApi() {
  if (typeof window === 'undefined') return undefined
  return window.workflowAPI ?? browserWorkflowAPI
}

export function invoke<C extends IpcChannelName>(
  channel: C,
  args: IpcArgs<C>
): Promise<IpcResult<C>> {
  const api = getApi()
  if (!api) return Promise.reject(new Error('Workflow API not available'))
  return api.invoke(channel, args) as Promise<IpcResult<C>>
}

export function on<C extends IpcChannelName>(
  channel: C,
  callback: (args: IpcArgs<C>) => void
): void {
  const api = getApi()
  if (!api) return
  api.on(channel, callback as (...args: unknown[]) => void)
}

export function removeListener<C extends IpcChannelName>(
  channel: C,
  callback: (args: IpcArgs<C>) => void
): void {
  const api = getApi()
  if (!api) return
  api.removeListener(channel, callback as (...args: unknown[]) => void)
}


// ─── Workflow IPC ────────────────────────────────────────────────────────────

export const workflowIpc = {
  create: (input: CreateWorkflowInput): Promise<Workflow> =>
    invoke('workflow:create', input),
  save: (input: SaveWorkflowInput): Promise<void> =>
    invoke('workflow:save', input),
  load: (id: string): Promise<Workflow> =>
    invoke('workflow:load', { id }),
  list: (): Promise<WorkflowSummary[]> =>
    invoke('workflow:list', undefined as void),
  rename: (id: string, name: string): Promise<void> =>
    invoke('workflow:rename', { id, name }),
  delete: (id: string): Promise<void> =>
    invoke('workflow:delete', { id }),
  duplicate: (id: string): Promise<Workflow> =>
    invoke('workflow:duplicate', { id })
}

// ─── History IPC ─────────────────────────────────────────────────────────────

export const historyIpc = {
  list: (nodeId: string): Promise<NodeExecutionRecord[]> =>
    invoke('history:list', { nodeId }),
  /** Delete a single execution record and its local result files */
  delete: (executionId: string): Promise<void> =>
    invoke('history:delete', { executionId }),
  /** Delete ALL execution records for a node and their local result files */
  deleteAll: (nodeId: string): Promise<void> =>
    invoke('history:delete-all', { nodeId }),
  setCurrent: (nodeId: string, executionId: string): Promise<void> =>
    invoke('history:set-current', { nodeId, executionId }),
  star: (executionId: string, starred: boolean): Promise<void> =>
    invoke('history:star', { executionId, starred }),
  score: (executionId: string, score: number): Promise<void> =>
    invoke('history:score', { executionId, score })
}

// ─── Cost IPC ────────────────────────────────────────────────────────────────

export const costIpc = {
  estimate: (workflowId: string, nodeIds: string[]): Promise<CostEstimate> =>
    invoke('cost:estimate', { workflowId, nodeIds }),
  getBudget: (): Promise<BudgetConfig> =>
    invoke('cost:get-budget', undefined as void),
  setBudget: (config: BudgetConfig): Promise<void> =>
    invoke('cost:set-budget', config),
  getDailySpend: (): Promise<number> =>
    invoke('cost:get-daily-spend', undefined as void)
}

// ─── Settings IPC ────────────────────────────────────────────────────────────

export const settingsIpc = {
  getApiKeys: (): Promise<ApiKeyConfig> =>
    invoke('settings:get-api-keys', undefined as void),
  setApiKeys: (config: ApiKeyConfig): Promise<void> =>
    invoke('settings:set-api-keys', config)
}

// ─── Registry IPC ────────────────────────────────────────────────────────────

export const registryIpc = {
  getAll: (): Promise<NodeTypeDefinition[]> =>
    invoke('registry:get-all', undefined as void)
}

// ─── Models IPC ──────────────────────────────────────────────────────────────

export const modelsIpc = {
  /** Sync Desktop's model list to main process for workflow execution. */
  sync: (models: unknown[]): Promise<void> =>
    rawInvoke('models:sync', models) as Promise<void>,
  list: (): Promise<WaveSpeedModel[]> =>
    invoke('models:list', undefined as void),
  search: (query: string, category?: string, provider?: string): Promise<WaveSpeedModel[]> =>
    invoke('models:search', { query, category, provider }),
  getSchema: (modelId: string): Promise<WaveSpeedModel | null> =>
    invoke('models:get-schema', { modelId })
}

// ─── Storage IPC ─────────────────────────────────────────────────────────────

// Storage channels are not in the typed IpcChannelName union, so we use raw invoke
const rawInvoke = (channel: string, args?: unknown): Promise<unknown> => {
  const api = getApi()
  if (!api) return Promise.reject(new Error('Workflow API not available (run in Electron)'))
  return api.invoke(channel, args)
}

export const storageIpc = {
  getWorkflowSnapshot: (workflowId: string) =>
    rawInvoke('storage:get-workflow-snapshot', { workflowId }),
  getExecutionCache: (workflowId: string, nodeId: string, executionId: string) =>
    rawInvoke('storage:get-execution-cache', { workflowId, nodeId, executionId }),
  listNodeExecutions: (workflowId: string, nodeId: string) =>
    rawInvoke('storage:list-node-executions', { workflowId, nodeId }) as Promise<string[]>,
  listUploadedFiles: (workflowId: string, nodeId: string) =>
    rawInvoke('storage:list-uploaded-files', { workflowId, nodeId }) as Promise<string[]>,
  saveUploadedFile: (workflowId: string, nodeId: string, filename: string, data: ArrayBuffer) =>
    rawInvoke('storage:save-uploaded-file', { workflowId, nodeId, filename, data }) as Promise<string>,
  copyUploadedFile: (workflowId: string, nodeId: string, sourcePath: string) =>
    rawInvoke('storage:copy-uploaded-file', { workflowId, nodeId, sourcePath }) as Promise<string>,
  getWorkflowDiskUsage: (workflowId: string) =>
    rawInvoke('storage:get-workflow-disk-usage', { workflowId }) as Promise<number>,
  deleteWorkflowFiles: (workflowId: string) =>
    rawInvoke('storage:delete-workflow-files', { workflowId }) as Promise<void>,
  exportWorkflowJson: (workflowId: string, workflowName: string, graphDefinition: unknown) =>
    rawInvoke('storage:export-workflow-json', { workflowId, workflowName, graphDefinition }) as Promise<string | null>,
  openArtifactsFolder: () =>
    rawInvoke('storage:open-artifacts-folder', {}) as Promise<void>,
  openWorkflowFolder: (workflowId: string) =>
    rawInvoke('storage:open-workflow-folder', { workflowId }) as Promise<void>,
  importWorkflowJson: () =>
    rawInvoke('storage:import-workflow-json') as Promise<{ id: string; name: string } | null>,
  cleanWorkflowOutputs: (workflowId: string) =>
    rawInvoke('storage:clean-workflow-outputs', { workflowId }) as Promise<void>,
  deleteNodeOutputs: (workflowId: string, nodeId: string) =>
    rawInvoke('storage:delete-node-outputs', { workflowId, nodeId }) as Promise<void>
}

// ─── Free-tool (renderer execution) IPC ─────────────────────────────────────

export const freeToolIpc = {
  complete: (payload: { requestId: string; workflowId: string; nodeId: string; outputData: string; outputExt: string; outputPrefix: string }) =>
    rawInvoke('free-tool:complete', payload),
  error: (payload: { requestId: string; error: string }) =>
    rawInvoke('free-tool:error', payload)
}

// ─── Upload IPC ──────────────────────────────────────────────────────────────

export const uploadIpc = {
  uploadFile: async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer()
    return rawInvoke('upload:file', { fileData: arrayBuffer, filename: file.name }) as Promise<string>
  }
}

// ─── Default export ──────────────────────────────────────────────────────────

export const ipcClient = {
  workflow: workflowIpc,
  history: historyIpc,
  cost: costIpc,
  settings: settingsIpc,
  registry: registryIpc,
  models: modelsIpc,
  storage: storageIpc,
  upload: uploadIpc,
  freeTool: freeToolIpc
}

export default ipcClient
