/**
 * RunMonitor — global execution monitor panel.
 * Shows real-time per-node progress for each workflow run session.
 * Click a node row to see its input/output data (like Dify).
 */
import { useState, useEffect } from 'react'
import { useExecutionStore, type RunSession } from '../../stores/execution.store'
import { historyIpc } from '../../ipc/ipc-client'
import type { NodeStatus, NodeExecutionRecord } from '@/workflow/types/execution'

export function RunMonitor({ workflowId }: { workflowId?: string | null }) {
  const runSessions = useExecutionStore(s => s.runSessions)
  const showRunMonitor = useExecutionStore(s => s.showRunMonitor)
  const toggleRunMonitor = useExecutionStore(s => s.toggleRunMonitor)
  const nodeStatuses = useExecutionStore(s => s.nodeStatuses)
  const progressMap = useExecutionStore(s => s.progressMap)
  const cancelAll = useExecutionStore(s => s.cancelAll)

  // Filter sessions to current workflow (empty if no workflow loaded)
  const filteredSessions = workflowId
    ? runSessions.filter(s => s.workflowId === workflowId)
    : []

  if (!showRunMonitor) return null

  return (
    <>
      <div className="absolute top-[72px] right-2 z-50 w-[400px] max-h-[520px] rounded-xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/50 flex-shrink-0">
          <span className="text-xs font-semibold">Execution Monitor</span>
          <button onClick={toggleRunMonitor} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredSessions.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">No runs yet</div>
          )}
          {filteredSessions.map(session => (
            <SessionCard key={session.id} session={session} nodeStatuses={nodeStatuses}
              progressMap={progressMap} onCancel={() => cancelAll(session.workflowId)} />
          ))}
        </div>
      </div>
    </>
  )
}

/* ── Session Card ──────────────────────────────────────────────────── */

function SessionCard({ session, nodeStatuses, progressMap, onCancel }: {
  session: RunSession
  nodeStatuses: Record<string, NodeStatus>
  progressMap: Record<string, { progress: number; message?: string }>
  onCancel: () => void
}) {
  const [collapsed, setCollapsed] = useState(session.status !== 'running')
  const { nodeIds, nodeLabels, nodeResults, nodeCosts, status } = session
  const total = nodeIds.length
  const completed = Object.values(nodeResults).filter(v => v === 'done').length
  const errors = Object.values(nodeResults).filter(v => v === 'error').length
  const pct = total > 0 ? Math.round(((completed + errors) / total) * 100) : 0
  const totalCost = Object.values(nodeCosts).reduce((sum, c) => sum + c, 0)

  const statusColor = status === 'running' ? 'text-blue-400' :
    status === 'completed' ? 'text-green-400' :
    status === 'error' ? 'text-orange-400' : 'text-muted-foreground'
  const statusLabel = status === 'running' ? 'Running' :
    status === 'completed' ? 'Completed' :
    status === 'error' ? 'Has errors' : 'Cancelled'

  const elapsed = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000)
  const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 px-4 py-2 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setCollapsed(!collapsed)}>
        <span className="text-[10px] text-muted-foreground w-3">{collapsed ? '▶' : '▼'}</span>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          status === 'running' ? 'bg-blue-500 animate-pulse' :
          status === 'completed' ? 'bg-green-500' :
          status === 'error' ? 'bg-orange-500' : 'bg-muted-foreground'}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium truncate">{session.workflowName}</div>
          <div className="text-[9px] text-muted-foreground">
            {new Date(session.startedAt).toLocaleTimeString()} · {elapsedStr}
            {totalCost > 0 && <span className="text-amber-400/80 ml-1">· 💰 ${totalCost.toFixed(4)}</span>}
          </div>
        </div>
        <span className={`text-[10px] font-medium ${statusColor}`}>{statusLabel}</span>
        <span className="text-[9px] text-muted-foreground">{completed + errors}/{total}</span>
        {status === 'running' && (
          <button onClick={e => { e.stopPropagation(); onCancel() }}
            className="text-[10px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors flex-shrink-0">
            Stop
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="px-4 py-1.5">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${errors > 0 ? 'bg-orange-500' : status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="px-3 pb-2 space-y-px">
            {nodeIds.map(nodeId => (
              <NodeRow key={nodeId} nodeId={nodeId} label={nodeLabels[nodeId] || nodeId.slice(0, 8)}
                sessionResult={nodeResults[nodeId]}
                isSessionRunning={status === 'running'}
                liveStatus={nodeStatuses[nodeId]}
                progress={progressMap[nodeId]} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Node Row (clickable, expandable with I/O data) ────────────────── */

function NodeRow({ nodeId, label, sessionResult, isSessionRunning, liveStatus, progress }: {
  nodeId: string; label: string; sessionResult: 'running' | 'done' | 'error'
  isSessionRunning: boolean; liveStatus?: NodeStatus
  progress?: { progress: number; message?: string }
}) {
  const [expanded, setExpanded] = useState(false)
  const [record, setRecord] = useState<NodeExecutionRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const isLiveRunning = isSessionRunning && liveStatus === 'running'
  const isDone = sessionResult === 'done' || sessionResult === 'error'

  // Fetch execution record when expanded
  useEffect(() => {
    if (!expanded || !isDone) return
    if (record) return // already loaded
    setLoading(true)
    historyIpc.list(nodeId).then(records => {
      if (records && records.length > 0) setRecord(records[0])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [expanded, isDone, nodeId, record])

  return (
    <div className="rounded-md overflow-hidden">
      {/* Row header */}
      <div className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors rounded-md
        ${expanded ? 'bg-accent/50' : 'hover:bg-accent/30'}`}
        onClick={() => isDone && setExpanded(!expanded)}>
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          isLiveRunning ? 'bg-blue-500 animate-pulse' :
          sessionResult === 'done' ? 'bg-green-500' :
          sessionResult === 'error' ? 'bg-red-500' : 'bg-muted-foreground/30'}`} />
        <span className="text-[10px] truncate flex-1 min-w-0">{label}</span>
        {isLiveRunning && progress && <span className="text-[9px] text-blue-400">{Math.round(progress.progress)}%</span>}
        {isLiveRunning && !progress && <span className="text-[9px] text-blue-400 animate-pulse">...</span>}
        {!isLiveRunning && sessionResult === 'done' && <span className="text-[9px] text-green-400">done</span>}
        {!isLiveRunning && sessionResult === 'error' && <span className="text-[9px] text-red-400">error</span>}
        {isDone && <span className="text-[8px] text-muted-foreground ml-1">{expanded ? '▲' : '▼'}</span>}
      </div>

      {/* Expanded I/O data */}
      {expanded && (
        <div className="mx-2 mb-1 rounded-md border border-border bg-background overflow-hidden">
          {loading && <div className="p-3 text-[10px] text-muted-foreground animate-pulse text-center">Loading...</div>}
          {!loading && record && <NodeIODetail record={record} />}
          {!loading && !record && <div className="p-3 text-[10px] text-muted-foreground text-center">No data available</div>}
        </div>
      )}
    </div>
  )
}

/* ── Node I/O Detail ───────────────────────────────────────────────── */

function NodeIODetail({ record }: { record: NodeExecutionRecord }) {
  const meta = record.resultMetadata as Record<string, unknown> | null
  const resultUrls = (meta?.resultUrls as string[]) ?? (record.resultPath ? [record.resultPath] : [])
  const error = meta?.error as string | undefined
  const modelId = meta?.modelId as string | undefined

  // Extract input params (stored in raw response sometimes)
  const raw = meta?.raw as Record<string, unknown> | undefined

  return (
    <div className="text-[10px]">
      {/* Meta bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/30 border-b border-border text-muted-foreground">
        {record.durationMs != null && <span>⏱ {(record.durationMs / 1000).toFixed(1)}s</span>}
        <span>💰 ${record.cost.toFixed(4)}</span>
        {modelId && <span className="truncate">{modelId}</span>}
      </div>

      {/* Output */}
      <div className="px-3 py-2">
        <div className="text-[9px] text-green-400 font-semibold uppercase tracking-wider mb-1">Output</div>
        <pre className="text-[9px] text-foreground/70 font-mono bg-muted/30 rounded p-2 overflow-x-auto max-h-[140px] overflow-y-auto whitespace-pre-wrap break-all">
          {JSON.stringify({ resultUrls, ...(meta ? Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'raw')) : {}) }, null, 2)}
        </pre>
      </div>

      {/* Error */}
      {record.status === 'error' && error && (
        <div className="px-3 pb-2">
          <div className="text-[9px] text-red-400 font-semibold uppercase tracking-wider mb-1">Error</div>
          <div className="text-[10px] text-red-400/80 p-1.5 rounded bg-red-500/10 leading-tight">{error}</div>
        </div>
      )}

      {/* Raw input (if available from API response) */}
      {raw && (
        <div className="px-3 pb-2 border-t border-border pt-2">
          <div className="text-[9px] text-blue-400 font-semibold uppercase tracking-wider mb-1">Input</div>
          <pre className="text-[9px] text-foreground/60 font-mono bg-muted/30 rounded p-2 overflow-x-auto max-h-[120px] overflow-y-auto whitespace-pre-wrap break-all">
            {JSON.stringify(raw, null, 2).slice(0, 1000)}
          </pre>
        </div>
      )}
    </div>
  )
}
