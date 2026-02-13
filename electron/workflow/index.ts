/**
 * Workflow module entry point — initializes DB, nodes, engine, and IPC handlers.
 * Called from electron/main.ts during app.whenReady().
 */
import { openDatabase, closeDatabase } from './db/connection'
import { getFileStorageInstance } from './utils/file-storage'
import { listWorkflows } from './db/workflow.repo'
import { registerAllNodes } from './nodes/register-all'
import { nodeRegistry } from './nodes/registry'
import { ExecutionEngine } from './engine/executor'
import { CacheService } from './engine/cache'
import { CostService } from './engine/cost'
import { CircuitBreaker } from './engine/circuit-breaker'
import {
  setExecutionEngine,
  registerExecutionIpc,
  emitNodeStatus,
  emitProgress,
  emitEdgeStatus
} from './ipc/execution.ipc'
import { registerWorkflowIpc } from './ipc/workflow.ipc'
import { registerHistoryIpc, setMarkDownstreamStale } from './ipc/history.ipc'
import { registerCostIpc, setCostDeps } from './ipc/cost.ipc'
import { registerModelsIpc } from './ipc/models.ipc'
import { registerStorageIpc } from './ipc/storage.ipc'
import { registerUploadIpc } from './ipc/upload.ipc'
import { registerSettingsIpc } from './ipc/settings.ipc'
import { registerFreeToolIpc } from './ipc/free-tool.ipc'

export async function initWorkflowModule(): Promise<void> {
  console.log('[Workflow] Initializing workflow module...')

  // Register lightweight model IPC first to avoid startup race:
  // renderer may call models:sync before DB initialization completes.
  registerModelsIpc()

  // 1. Open database and ensure storage directories
  await openDatabase()
  const fileStorage = getFileStorageInstance()
  fileStorage.ensureBaseDir()
  console.log('[Workflow] Storage root:', fileStorage.getRootPath())

  // Load all workflow names into the name map so file paths resolve correctly
  try {
    const workflows = listWorkflows()
    for (const wf of workflows) {
      fileStorage.registerWorkflowName(wf.id, wf.name)
    }
    console.log(`[Workflow] Registered ${workflows.length} workflow name mappings`)
  } catch (err) {
    console.error('[Workflow] Failed to load workflow names:', err)
  }

  // 2. Register node types
  registerAllNodes()

  // 3. Create engine dependencies
  const cache = new CacheService()
  const costService = new CostService()
  const circuitBreaker = new CircuitBreaker()

  // 4. Create execution engine with IPC callbacks
  const engine = new ExecutionEngine(nodeRegistry, cache, costService, circuitBreaker, {
    onNodeStatus: emitNodeStatus,
    onProgress: emitProgress,
    onEdgeStatus: emitEdgeStatus
  })

  // 5. Wire up singletons
  setExecutionEngine(engine)
  setCostDeps(costService, nodeRegistry)
  setMarkDownstreamStale((workflowId, nodeId) => engine.markDownstreamStale(workflowId, nodeId))

  // 6. Register all IPC handlers
  registerWorkflowIpc()
  registerExecutionIpc()
  registerHistoryIpc()
  registerCostIpc()
  registerStorageIpc()
  registerUploadIpc()
  registerSettingsIpc()
  registerFreeToolIpc()

  console.log('[Workflow] Module initialized successfully')
}

export function closeWorkflowDatabase(): void {
  closeDatabase()
  console.log('[Workflow] Database closed')
}
