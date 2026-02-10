/**
 * IPC channel type definitions for workflow module.
 */

import type { Workflow, WorkflowNode, WorkflowEdge } from './workflow'
import type { NodeExecutionRecord, NodeStatusUpdate, ProgressUpdate } from './execution'
import type { NodeTypeDefinition, WaveSpeedModel } from './node-defs'

export interface CreateWorkflowInput {
  name: string
}

export interface SaveWorkflowInput {
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  status?: Workflow['status']
}

export interface WorkflowSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  status: string
  nodeCount: number
}

export interface CostEstimate {
  totalEstimated: number
  breakdown: { nodeId: string; nodeType: string; estimated: number }[]
  withinBudget: boolean
  reason?: string
}

export interface BudgetConfig {
  perExecutionLimit: number
  dailyLimit: number
}

export interface ApiKeyConfig {
  wavespeedKey?: string
  llmKey?: string
}

export type IpcChannels = {
  'workflow:create': { args: CreateWorkflowInput; result: Workflow }
  'workflow:save': { args: SaveWorkflowInput; result: void }
  'workflow:load': { args: { id: string }; result: Workflow }
  'workflow:list': { args: void; result: WorkflowSummary[] }
  'workflow:delete': { args: { id: string }; result: void }
  'execution:run-all': { args: { workflowId: string }; result: void }
  'execution:run-node': { args: { workflowId: string; nodeId: string }; result: void }
  'execution:continue-from': { args: { workflowId: string; nodeId: string }; result: void }
  'execution:retry': { args: { workflowId: string; nodeId: string }; result: void }
  'execution:cancel': { args: { workflowId: string; nodeId: string }; result: void }
  'execution:node-status': { args: NodeStatusUpdate; result: void }
  'execution:progress': { args: ProgressUpdate; result: void }
  'execution:edge-status': { args: { edgeId: string; status: 'no-data' | 'has-data' }; result: void }
  'history:list': { args: { nodeId: string }; result: NodeExecutionRecord[] }
  'history:set-current': { args: { nodeId: string; executionId: string }; result: void }
  'history:star': { args: { executionId: string; starred: boolean }; result: void }
  'history:score': { args: { executionId: string; score: number }; result: void }
  'cost:estimate': { args: { workflowId: string; nodeIds: string[] }; result: CostEstimate }
  'cost:get-budget': { args: void; result: BudgetConfig }
  'cost:set-budget': { args: BudgetConfig; result: void }
  'cost:get-daily-spend': { args: void; result: number }
  'settings:get-api-keys': { args: void; result: ApiKeyConfig }
  'settings:set-api-keys': { args: ApiKeyConfig; result: void }
  'registry:get-all': { args: void; result: NodeTypeDefinition[] }
  'models:list': { args: void; result: WaveSpeedModel[] }
  'models:search': { args: { query: string; category?: string; provider?: string }; result: WaveSpeedModel[] }
  'models:refresh': { args: void; result: WaveSpeedModel[] }
  'models:get-schema': { args: { modelId: string }; result: WaveSpeedModel | null }
  'models:refresh-progress': { args: { loaded: number; total: number }; result: void }
}

export type IpcChannelName = keyof IpcChannels
export type IpcArgs<C extends IpcChannelName> = IpcChannels[C]['args']
export type IpcResult<C extends IpcChannelName> = IpcChannels[C]['result']
