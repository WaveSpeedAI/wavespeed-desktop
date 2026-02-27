/**
 * Execution Zustand store — manages node/edge execution status via IPC events.
 * Also tracks last result URL per node for inline canvas preview.
 * Includes RunSession tracking for the global execution monitor.
 */
import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { historyIpc } from '../ipc/ipc-client'
import { executeWorkflowInBrowser } from '../browser/run-in-browser'
import { useAssetsStore, detectAssetType } from '@/stores/assetsStore'
import type { NodeStatus, EdgeStatus } from '@/workflow/types/execution'

export interface RunSession {
  id: string
  workflowId: string
  workflowName: string
  startedAt: string
  nodeIds: string[]
  nodeLabels: Record<string, string>
  /** Per-node final status within THIS session (frozen when session ends) */
  nodeResults: Record<string, 'running' | 'done' | 'error'>
  /** Per-node cost within THIS session */
  nodeCosts: Record<string, number>
  status: 'running' | 'completed' | 'error' | 'cancelled'
  /** Execution scope: 'full' = Run All, 'node' = single node Run, 'continue' = Run from here */
  scope?: 'full' | 'node' | 'continue'
}

const MAX_SESSIONS = 20

/** AbortController for the current in-browser run; Stop calls abort() on it. */
let browserRunAbortController: AbortController | null = null

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError' ||
    (e instanceof Error && e.message?.toLowerCase().includes('abort'))
}

/** Node types whose results should be auto-saved to My Assets */
const SAVEABLE_NODE_TYPES = ['ai-task/run']
function isSaveableNodeType(nodeType: string): boolean {
  return SAVEABLE_NODE_TYPES.includes(nodeType) || nodeType.startsWith('free-tool/')
}

/** Lazy-loaded workflow store reference (avoids circular import) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let importedWorkflowStore: { getState: () => { workflowName: string } } | null = null
import('./workflow.store').then(m => { importedWorkflowStore = m.useWorkflowStore }).catch(() => {})

/** Auto-save workflow node results to My Assets (browser mode). Fire-and-forget. */
function autoSaveWorkflowResults(
  nodeId: string,
  nodeType: string,
  urls: string[],
  params: Record<string, unknown> | undefined,
  workflowName?: string
): void {
  if (!isSaveableNodeType(nodeType)) return
  const { settings, saveAsset, hasAssetForExecution } = useAssetsStore.getState()
  if (!settings.autoSaveAssets) return

  const modelId = String(params?.modelId ?? nodeType)
  const executionId = `browser-${nodeId}-${Date.now().toString(36)}`

  // Skip if already saved (unlikely in browser but safe)
  if (hasAssetForExecution(executionId)) return

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    if (!url) continue
    const assetType = detectAssetType(url)
    if (!assetType) continue
    saveAsset(url, assetType, {
      modelId,
      resultIndex: i,
      source: 'workflow',
      executionId,
      workflowName: workflowName || undefined
    }).catch(err => console.error('[ExecutionStore] Failed to auto-save to assets:', err))
  }
}

export interface ExecutionState {
  nodeStatuses: Record<string, NodeStatus>
  edgeStatuses: Record<string, EdgeStatus>
  activeExecutions: Set<string>
  progressMap: Record<string, { progress: number; message?: string }>
  errorMessages: Record<string, string>
  lastResults: Record<string, Array<{ urls: string[]; time: string; cost?: number; durationMs?: number }>>
  _wasRunning: boolean
  _fetchedNodes: Set<string>

  /** Run sessions for the global monitor panel */
  runSessions: RunSession[]
  showRunMonitor: boolean
  toggleRunMonitor: () => void

  /** Run entire workflow in browser (only execution path). */
  runAllInBrowser: (nodes: Array<{ id: string; data: { nodeType: string; params?: Record<string, unknown>; label?: string } }>, edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>) => Promise<void>
  /** Run single node (and its upstream) in browser. */
  runNodeInBrowser: (nodes: Array<{ id: string; data: { nodeType: string; params?: Record<string, unknown>; label?: string } }>, edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>, nodeId: string) => Promise<void>
  runNode: (workflowId: string, nodeId: string) => Promise<void>
  continueFrom: (workflowId: string, nodeId: string) => Promise<void>
  retryNode: (workflowId: string, nodeId: string) => Promise<void>
  cancelNode: (workflowId: string, nodeId: string) => Promise<void>
  cancelAll: (workflowId: string) => Promise<void>
  updateNodeStatus: (nodeId: string, status: NodeStatus, errorMessage?: string) => void
  updateEdgeStatus: (edgeId: string, status: EdgeStatus) => void
  updateProgress: (nodeId: string, progress: number, message?: string) => void
  resetStatuses: () => void
  restoreResultsForNodes: (nodeIds: string[]) => Promise<void>
  initListeners: () => void
  fetchLastResult: (nodeId: string, force?: boolean) => void
  clearNodeResults: (nodeId: string) => void
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  nodeStatuses: {},
  edgeStatuses: {},
  activeExecutions: new Set(),
  progressMap: {},
  errorMessages: {},
  lastResults: {},
  _wasRunning: false,
  _fetchedNodes: new Set(),
  runSessions: [],
  showRunMonitor: false,

  toggleRunMonitor: () => set(s => ({ showRunMonitor: !s.showRunMonitor })),

  runAllInBrowser: async (nodes, edges) => {
    const nodeLabels: Record<string, string> = {}
    for (const n of nodes) {
      nodeLabels[n.id] = (n.data?.label as string) || n.data?.nodeType || n.id.slice(0, 8)
    }
    const sessionId = uuid()
    const nodeIds = nodes.map(n => n.id)
    const nodeResults: Record<string, 'running' | 'done' | 'error'> = {}
    for (const nid of nodeIds) nodeResults[nid] = 'running'

    // Get actual workflow identity for session tracking
    const { useWorkflowStore } = await import('./workflow.store')
    const wfState = useWorkflowStore.getState()
    const actualWorkflowId = wfState.workflowId || 'browser'
    const actualWorkflowName = wfState.workflowName || 'Workflow'

    set(s => ({
      runSessions: [{
        id: sessionId,
        workflowId: actualWorkflowId,
        workflowName: actualWorkflowName,
        startedAt: new Date().toISOString(),
        nodeIds,
        nodeLabels,
        nodeResults,
        nodeCosts: {},
        status: 'running' as const,
        scope: 'full' as const
      }, ...s.runSessions].slice(0, MAX_SESSIONS)
    }))

    const controller = new AbortController()
    browserRunAbortController = controller
    try {
      await executeWorkflowInBrowser(nodes, edges, {
        onNodeStatus: (nodeId, status, errorMessage) => {
          get().updateNodeStatus(nodeId, status, errorMessage)
        },
        onProgress: (nodeId, progress, message) => {
          get().updateProgress(nodeId, progress, message)
        },
        onNodeComplete: (nodeId, { urls, cost }) => {
          set(s => {
            const existing = s.lastResults[nodeId] ?? []
            return {
              lastResults: {
                ...s.lastResults,
                [nodeId]: [{ urls, time: new Date().toISOString(), cost }, ...existing].slice(0, 50)
              }
            }
          })
          // Auto-save to My Assets
          const node = nodes.find(n => n.id === nodeId)
          if (node) {
            const wfName = importedWorkflowStore?.getState().workflowName
            autoSaveWorkflowResults(nodeId, node.data.nodeType, urls, node.data.params, wfName)
          }
        }
      }, { signal: controller.signal })
    } catch (error) {
      if (isAbortError(error)) {
        set(s => ({
          runSessions: s.runSessions.map(rs => rs.id === sessionId ? { ...rs, status: 'cancelled' as const } : rs)
        }))
        for (const nid of nodeIds) get().updateNodeStatus(nid, 'idle')
      } else {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[ExecutionStore] runAllInBrowser error:', msg)
        set(s => ({
          runSessions: s.runSessions.map(rs => rs.id === sessionId ? { ...rs, status: 'error' as const } : rs)
        }))
      }
    } finally {
      browserRunAbortController = null
    }
  },

  runNodeInBrowser: async (nodes, edges, nodeId) => {
    const upstream = new Set<string>([nodeId])
    const reverse = new Map<string, string[]>()
    for (const e of edges) {
      const list = reverse.get(e.target) ?? []
      list.push(e.source)
      reverse.set(e.target, list)
    }
    let queue = [nodeId]
    while (queue.length > 0) {
      const next: string[] = []
      for (const id of queue) {
        for (const src of reverse.get(id) ?? []) {
          if (!upstream.has(src)) {
            upstream.add(src)
            next.push(src)
          }
        }
      }
      queue = next
    }
    const nodeIds = nodes.map(n => n.id).filter(id => upstream.has(id))
    const nodeLabels: Record<string, string> = {}
    for (const n of nodes) {
      if (upstream.has(n.id)) nodeLabels[n.id] = (n.data?.label as string) || n.data?.nodeType || n.id.slice(0, 8)
    }
    const sessionId = uuid()
    const nodeResults: Record<string, 'running' | 'done' | 'error'> = {}
    for (const nid of nodeIds) nodeResults[nid] = 'running'

    // Get actual workflow identity for session tracking
    const { useWorkflowStore: wfStore } = await import('./workflow.store')
    const wfState = wfStore.getState()
    const actualWorkflowId = wfState.workflowId || 'browser'

    set(s => ({
      runSessions: [{
        id: sessionId,
        workflowId: actualWorkflowId,
        workflowName: 'Run node',
        startedAt: new Date().toISOString(),
        nodeIds,
        nodeLabels,
        nodeResults,
        nodeCosts: {},
        status: 'running' as const,
        scope: 'node' as const
      }, ...s.runSessions].slice(0, MAX_SESSIONS)
    }))
    // Collect existing result URLs so upstream nodes can feed the target node
    const existingResults = new Map<string, string>()
    const lastResults = get().lastResults
    for (const [nid, groups] of Object.entries(lastResults)) {
      if (groups && groups.length > 0 && groups[0].urls.length > 0) {
        existingResults.set(nid, groups[0].urls[0])
      }
    }

    const controller = new AbortController()
    browserRunAbortController = controller
    try {
      await executeWorkflowInBrowser(nodes, edges, {
        onNodeStatus: (nid, status, errorMessage) => { get().updateNodeStatus(nid, status, errorMessage) },
        onProgress: (nid, progress, message) => { get().updateProgress(nid, progress, message) },
        onNodeComplete: (nid, { urls, cost }) => {
          set(s => {
            const existing = s.lastResults[nid] ?? []
            return {
              lastResults: {
                ...s.lastResults,
                [nid]: [{ urls, time: new Date().toISOString(), cost }, ...existing].slice(0, 50)
              }
            }
          })
          // Auto-save to My Assets
          const node = nodes.find(n => n.id === nid)
          if (node) {
            const wfName = importedWorkflowStore?.getState().workflowName
            autoSaveWorkflowResults(nid, node.data.nodeType, urls, node.data.params, wfName)
          }
        }
      }, { runOnlyNodeId: nodeId, existingResults, signal: controller.signal })
    } catch (error) {
      if (isAbortError(error)) {
        set(s => ({
          runSessions: s.runSessions.map(rs => rs.id === sessionId ? { ...rs, status: 'cancelled' as const } : rs)
        }))
        for (const nid of nodeIds) get().updateNodeStatus(nid, 'idle')
      } else {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[ExecutionStore] runNodeInBrowser error:', msg)
        set(s => ({
          runSessions: s.runSessions.map(rs => rs.id === sessionId ? { ...rs, status: 'error' as const } : rs)
        }))
      }
    } finally {
      browserRunAbortController = null
    }
  },

  runNode: async (_workflowId, nodeId) => {
    const { useWorkflowStore } = await import('./workflow.store')
    const { nodes, edges } = useWorkflowStore.getState()
    const browserNodes = nodes.map(n => ({
      id: n.id,
      data: {
        nodeType: n.data?.nodeType ?? '',
        params: { ...(n.data?.params ?? {}), __meta: { modelInputSchema: n.data?.modelInputSchema ?? [] } },
        label: n.data?.label
      }
    }))
    const browserEdges = edges.map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined }))
    get().runNodeInBrowser(browserNodes, browserEdges, nodeId)
  },
  continueFrom: async (_workflowId, nodeId) => {
    const { useWorkflowStore } = await import('./workflow.store')
    const { nodes, edges } = useWorkflowStore.getState()
    const browserNodes = nodes.map(n => ({
      id: n.id,
      data: {
        nodeType: n.data?.nodeType ?? '',
        params: { ...(n.data?.params ?? {}), __meta: { modelInputSchema: n.data?.modelInputSchema ?? [] } },
        label: n.data?.label
      }
    }))
    const browserEdges = edges.map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined }))

    // Collect existing result URLs so upstream nodes can feed downstream
    const existingResults = new Map<string, string>()
    const lastResults = get().lastResults
    for (const [nid, groups] of Object.entries(lastResults)) {
      if (groups && groups.length > 0 && groups[0].urls.length > 0) {
        existingResults.set(nid, groups[0].urls[0])
      }
    }

    const nodeLabels: Record<string, string> = {}
    for (const n of nodes) {
      nodeLabels[n.id] = (n.data?.label as string) || n.data?.nodeType || n.id.slice(0, 8)
    }
    const sessionId = uuid()
    const nodeIds = nodes.map(n => n.id)
    const nodeResults: Record<string, 'running' | 'done' | 'error'> = {}
    for (const nid of nodeIds) nodeResults[nid] = 'running'
    const actualWorkflowId = useWorkflowStore.getState().workflowId || 'browser'
    set(s => ({
      runSessions: [{
        id: sessionId,
        workflowId: actualWorkflowId,
        workflowName: 'Run from here',
        startedAt: new Date().toISOString(),
        nodeIds,
        nodeLabels,
        nodeResults,
        nodeCosts: {},
        status: 'running' as const,
        scope: 'continue' as const
      }, ...s.runSessions].slice(0, MAX_SESSIONS)
    }))

    const controller = new AbortController()
    browserRunAbortController = controller
    try {
      await executeWorkflowInBrowser(browserNodes, browserEdges, {
        onNodeStatus: (nid, status, errorMessage) => { get().updateNodeStatus(nid, status, errorMessage) },
        onProgress: (nid, progress, message) => { get().updateProgress(nid, progress, message) },
        onNodeComplete: (nid, { urls, cost }) => {
          set(s => {
            const existing = s.lastResults[nid] ?? []
            return {
              lastResults: {
                ...s.lastResults,
                [nid]: [{ urls, time: new Date().toISOString(), cost }, ...existing].slice(0, 50)
              }
            }
          })
        }
      }, { continueFromNodeId: nodeId, existingResults, signal: controller.signal })
    } catch (error) {
      if (isAbortError(error)) {
        set(s => ({
          runSessions: s.runSessions.map(rs => rs.id === sessionId ? { ...rs, status: 'cancelled' as const } : rs)
        }))
        for (const nid of nodeIds) get().updateNodeStatus(nid, 'idle')
      } else {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[ExecutionStore] continueFrom error:', msg)
        set(s => ({
          runSessions: s.runSessions.map(rs => rs.id === sessionId ? { ...rs, status: 'error' as const } : rs)
        }))
      }
    } finally {
      browserRunAbortController = null
    }
  },
  retryNode: async () => { /* Only Run All is supported (browser execution) */ },
  cancelNode: async () => {
    if (browserRunAbortController) {
      browserRunAbortController.abort()
    }
  },
  cancelAll: async (workflowId) => {
    if (browserRunAbortController) {
      browserRunAbortController.abort()
    }
    set(s => ({
      runSessions: s.runSessions.map(rs =>
        rs.workflowId === workflowId && rs.status === 'running' ? { ...rs, status: 'cancelled' as const } : rs
      )
    }))
  },

  updateNodeStatus: (nodeId, status, errorMessage) => {
    set(state => {
      const newStatuses = { ...state.nodeStatuses, [nodeId]: status }
      const newActive = new Set(state.activeExecutions)
      const newErrors = { ...state.errorMessages }
      let wasRunning = state._wasRunning
      if (status === 'running') {
        newActive.add(nodeId)
        wasRunning = true // mark that execution started
        delete newErrors[nodeId]
      } else {
        newActive.delete(nodeId)
      }
      if (status === 'error' && errorMessage) {
        newErrors[nodeId] = errorMessage
      } else if (status !== 'error') {
        delete newErrors[nodeId]
      }
      const newProgress = status !== 'running' ? (() => { const p = { ...state.progressMap }; delete p[nodeId]; return p })() : state.progressMap
      return { nodeStatuses: newStatuses, activeExecutions: newActive, errorMessages: newErrors, _wasRunning: wasRunning, progressMap: newProgress }
    })

    // When a node finishes successfully, force-refresh its results
    if (status === 'confirmed' || status === 'unconfirmed') {
      setTimeout(() => get().fetchLastResult(nodeId, true), 1500)
    }

    // Update the LATEST running session that contains this node
    if (status === 'confirmed' || status === 'unconfirmed' || status === 'error') {
      set(s => {
        const idx = s.runSessions.findIndex(rs => rs.status === 'running' && rs.nodeIds.includes(nodeId))
        if (idx === -1) return {}
        const rs = s.runSessions[idx]
        const newResults = { ...rs.nodeResults, [nodeId]: status === 'error' ? 'error' as const : 'done' as const }
        const allDone = rs.nodeIds.every(nid => newResults[nid] === 'done' || newResults[nid] === 'error')
        const hasError = Object.values(newResults).some(v => v === 'error')
        const newStatus = allDone ? (hasError ? 'error' as const : 'completed' as const) : 'running' as const
        const updated = [...s.runSessions]
        updated[idx] = { ...rs, nodeResults: newResults, status: newStatus }
        return { runSessions: updated }
      })

      // Fetch cost for this node and update the session
      if (status === 'confirmed' || status === 'unconfirmed') {
        historyIpc.list(nodeId).then(records => {
          if (!records || records.length === 0) return
          const cost = records[0].cost ?? 0
          set(s => ({
            runSessions: s.runSessions.map(rs =>
              rs.nodeIds.includes(nodeId) && rs.nodeCosts[nodeId] === undefined
                ? { ...rs, nodeCosts: { ...rs.nodeCosts, [nodeId]: cost } }
                : rs
            )
          }))
        }).catch(() => {})
      }
    }

    // Reset _wasRunning when all done
    const currentState = get()
    if (currentState._wasRunning && currentState.activeExecutions.size === 0) {
      setTimeout(() => set({ _wasRunning: false }), 100)
    }
  },

  updateEdgeStatus: (edgeId, status) => {
    set(state => ({ edgeStatuses: { ...state.edgeStatuses, [edgeId]: status } }))
  },

  updateProgress: (nodeId, progress, message) => {
    set(state => ({ progressMap: { ...state.progressMap, [nodeId]: { progress, message } } }))
  },

  resetStatuses: () => {
    set({ nodeStatuses: {}, edgeStatuses: {}, activeExecutions: new Set(), progressMap: {}, errorMessages: {} })
  },

  /** Restore results for all nodes in a workflow (call after loadWorkflow).
   *  Skips nodes that are already cached to avoid redundant IPC calls on tab switch. */
  restoreResultsForNodes: async (nodeIds: string[]) => {
    const fetched = get()._fetchedNodes
    const toFetch = nodeIds.filter(id => !fetched.has(id))
    if (toFetch.length === 0) return
    for (const nodeId of toFetch) {
      get().fetchLastResult(nodeId)
    }
  },

  fetchLastResult: async (nodeId, force) => {
    // Skip if already cached (unless forced, e.g. after new execution)
    if (!force && get()._fetchedNodes.has(nodeId) && get().lastResults[nodeId]) return
    try {
      const records = await historyIpc.list(nodeId)
      if (records && records.length > 0) {
        const groups: Array<{ urls: string[]; time: string; cost?: number; durationMs?: number }> = []
        for (const r of records) {
          if (r.status !== 'success') continue
          const meta = r.resultMetadata as Record<string, unknown> | null
          const metaUrls = meta?.resultUrls as string[] | undefined
          const urls: string[] = []
          if (metaUrls && Array.isArray(metaUrls) && metaUrls.length > 0) {
            for (const u of metaUrls) { if (u && typeof u === 'string') urls.push(u) }
          } else if (r.resultPath) {
            urls.push(r.resultPath)
          }
          if (urls.length > 0) {
            groups.push({ urls, time: r.createdAt, cost: r.cost, durationMs: r.durationMs ?? undefined })
          }
        }
        if (groups.length > 0) {
          // Merge with existing groups: deduplicate by time, keep newest first
          set(state => {
            const existing = state.lastResults[nodeId] ?? []
            const existingTimes = new Set(existing.map(g => g.time))
            const newGroups = groups.filter(g => !existingTimes.has(g.time))
            const merged = [...newGroups, ...existing].sort((a, b) =>
              new Date(b.time).getTime() - new Date(a.time).getTime()
            ).slice(0, 50) // cap at 50 entries per node
            const newFetched = new Set(state._fetchedNodes)
            newFetched.add(nodeId)
            return { lastResults: { ...state.lastResults, [nodeId]: merged }, _fetchedNodes: newFetched }
          })
        } else {
          // No results but mark as fetched so we don't re-query
          set(state => {
            const newFetched = new Set(state._fetchedNodes)
            newFetched.add(nodeId)
            return { _fetchedNodes: newFetched }
          })
        }
      }
    } catch { /* ignore */ }
  },

  clearNodeResults: (nodeId) => {
    set(state => {
      const newResults = { ...state.lastResults }
      delete newResults[nodeId]
      const newFetched = new Set(state._fetchedNodes)
      newFetched.delete(nodeId)
      return { lastResults: newResults, _fetchedNodes: newFetched }
    })
  },

  initListeners: () => {
    // Execution is browser-only; state updates come from runAllInBrowser callbacks
  }
}))
