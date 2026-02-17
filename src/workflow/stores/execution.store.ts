/**
 * Execution Zustand store — manages node/edge execution status via IPC events.
 * Also tracks last result URL per node for inline canvas preview.
 * Includes RunSession tracking for the global execution monitor.
 */
import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { executionIpc, historyIpc } from '../ipc/ipc-client'
import { executeWorkflowInBrowser } from '../browser/run-in-browser'
import type { NodeStatus, EdgeStatus, NodeStatusUpdate, ProgressUpdate } from '@/workflow/types/execution'

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
}

const MAX_SESSIONS = 20

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

  runAll: (workflowId: string, workflowName?: string, nodeLabels?: Record<string, string>) => Promise<void>
  /** Run workflow in browser (no Electron). Uses current graph from args. */
  runAllInBrowser: (nodes: Array<{ id: string; data: { nodeType: string; params?: Record<string, unknown>; label?: string } }>, edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>) => Promise<void>
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

  runAll: async (workflowId, workflowName, nodeLabels) => {
    // Create a new run session
    const sessionId = uuid()
    const nodeIds = Object.keys(nodeLabels ?? {})
    const nodeResults: Record<string, 'running' | 'done' | 'error'> = {}
    for (const nid of nodeIds) nodeResults[nid] = 'running'
    const session: RunSession = {
      id: sessionId,
      workflowId,
      workflowName: workflowName ?? 'Workflow',
      startedAt: new Date().toISOString(),
      nodeIds,
      nodeLabels: nodeLabels ?? {},
      nodeResults,
      nodeCosts: {},
      status: 'running'
    }
    set(s => ({
      runSessions: [session, ...s.runSessions].slice(0, MAX_SESSIONS)
    }))

    try {
      await executionIpc.runAll(workflowId)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[ExecutionStore] runAll error:', msg)
      // Mark session as error
      set(s => ({
        runSessions: s.runSessions.map(rs => rs.id === sessionId ? { ...rs, status: 'error' as const } : rs)
      }))
    }
  },

  runAllInBrowser: async (nodes, edges) => {
    const nodeLabels: Record<string, string> = {}
    for (const n of nodes) {
      nodeLabels[n.id] = (n.data?.label as string) || n.data?.nodeType || n.id.slice(0, 8)
    }
    const sessionId = uuid()
    const nodeIds = nodes.map(n => n.id)
    const nodeResults: Record<string, 'running' | 'done' | 'error'> = {}
    for (const nid of nodeIds) nodeResults[nid] = 'running'
    set(s => ({
      runSessions: [{
        id: sessionId,
        workflowId: 'browser',
        workflowName: 'Browser run',
        startedAt: new Date().toISOString(),
        nodeIds,
        nodeLabels,
        nodeResults,
        nodeCosts: {},
        status: 'running'
      }, ...s.runSessions].slice(0, MAX_SESSIONS)
    }))

    try {
      await executeWorkflowInBrowser(nodes, edges, {
        onNodeStatus: (nodeId, status, errorMessage) => {
          get().updateNodeStatus(nodeId, status, errorMessage)
        },
        onProgress: (nodeId, progress, message) => {
          get().updateProgress(nodeId, progress, message)
        },
        onNodeComplete: (nodeId, { urls, cost }) => {
          set(s => ({
            lastResults: {
              ...s.lastResults,
              [nodeId]: [{ urls, time: new Date().toISOString(), cost }]
            }
          }))
        }
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[ExecutionStore] runAllInBrowser error:', msg)
      set(s => ({
        runSessions: s.runSessions.map(rs => rs.id === sessionId ? { ...rs, status: 'error' as const } : rs)
      }))
    }
  },

  runNode: async (workflowId, nodeId) => {
    // Guard: don't double-run
    if (get().activeExecutions.has(nodeId)) return
    try {
      await executionIpc.runNode(workflowId, nodeId)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[ExecutionStore] runNode error:', msg)
      get().updateNodeStatus(nodeId, 'error', msg)
    }
  },

  continueFrom: async (workflowId, nodeId) => {
    try { await executionIpc.continueFrom(workflowId, nodeId) }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[ExecutionStore] continueFrom error:', msg)
    }
  },
  retryNode: async (workflowId, nodeId) => {
    try { await executionIpc.retry(workflowId, nodeId) }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[ExecutionStore] retryNode error:', msg)
    }
  },
  cancelNode: async (workflowId, nodeId) => {
    try { await executionIpc.cancel(workflowId, nodeId) }
    catch (error) { console.error('Cancel failed:', error) }
  },
  cancelAll: async (workflowId) => {
    const activeNodes = Array.from(get().activeExecutions)
    await Promise.allSettled(
      activeNodes.map(nodeId => executionIpc.cancel(workflowId, nodeId))
    )
    // Mark running sessions for this workflow as cancelled
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
    executionIpc.onNodeStatus((update: NodeStatusUpdate) => {
      get().updateNodeStatus(update.nodeId, update.status, update.errorMessage)
    })
    executionIpc.onProgress((update: ProgressUpdate) => {
      get().updateProgress(update.nodeId, update.progress, update.message)
    })
    executionIpc.onEdgeStatus((update: { edgeId: string; status: EdgeStatus }) => {
      get().updateEdgeStatus(update.edgeId, update.status)
    })
  }
}))
