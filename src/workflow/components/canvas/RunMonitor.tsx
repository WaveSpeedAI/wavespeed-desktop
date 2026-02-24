/**
 * RunMonitor — global execution monitor panel.
 * Shows real-time per-node progress for each workflow run session.
 * Click a node row to see its input/output data (like Dify).
 */
import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useExecutionStore, type RunSession } from '../../stores/execution.store'
import { useUIStore } from '../../stores/ui.store'
import { historyIpc } from '../../ipc/ipc-client'
import { getOutputItemType, decodeDataText } from '../../lib/outputDisplay'
import type { NodeStatus, NodeExecutionRecord } from '@/workflow/types/execution'

/** Compact output preview: image/video/audio/text/3d/file (used in LastResultOutput and NodeIODetail) */
function OutputPreview({ urls, durationMs, cost, label = 'Output' }: {
  urls: string[]
  durationMs?: number | null
  cost?: number
  label?: string
}) {
  const openPreview = useUIStore(s => s.openPreview)
  const validItems = urls.filter((u): u is string => u != null && typeof u === 'string')
  if (validItems.length === 0) return null

  return (
    <div className="text-[10px]">
      <div className="text-[9px] text-green-400 font-semibold uppercase tracking-wider mb-1">{label}</div>
      {(durationMs != null || (cost != null && cost !== undefined)) && (
        <div className="flex items-center gap-3 px-0 py-0.5 text-muted-foreground mb-1">
          {durationMs != null && <span>⏱ {(durationMs / 1000).toFixed(1)}s</span>}
          {cost != null && cost !== undefined && <span>💰 ${Number(cost).toFixed(4)}</span>}
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {validItems.map((item, i) => {
          const type = getOutputItemType(item)
          if (type === 'text') {
            const displayText = item.startsWith('data:text/') ? decodeDataText(item) : item
            return (
              <div key={i} className="w-full min-w-0 rounded border border-border bg-muted/20 p-2 max-h-[140px] overflow-y-auto">
                <pre className="text-[9px] text-foreground/90 whitespace-pre-wrap break-words font-sans">{displayText}</pre>
              </div>
            )
          }
          if (type === 'image') {
            return (
              <div key={i} className="relative group flex-1 min-w-[80px] max-w-[140px]">
                <img
                  src={item}
                  alt=""
                  onClick={() => openPreview(item, validItems.filter(u => getOutputItemType(u) === 'image'))}
                  className="w-full h-20 rounded border border-border object-cover cursor-pointer hover:ring-2 hover:ring-blue-500/50 bg-black/10"
                />
              </div>
            )
          }
          if (type === 'video') {
            return (
              <div key={i} className="relative flex-1 min-w-[80px] max-w-[140px] rounded border border-border overflow-hidden bg-black/10">
                <video src={item} className="w-full h-20 object-cover" onClick={() => openPreview(item)} />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
                  </div>
                </div>
              </div>
            )
          }
          if (type === 'audio') {
            return (
              <div key={i} className="flex-1 min-w-[120px] rounded border border-border bg-muted/30 p-1.5">
                <audio src={item} controls className="w-full h-7" />
              </div>
            )
          }
          if (type === '3d') {
            return (
              <div key={i} className="flex-1 min-w-[80px] rounded border border-border bg-muted/30 p-2 text-center cursor-pointer hover:bg-muted/50" onClick={() => openPreview(item)}>
                <span className="text-xs">🧊 3D</span>
              </div>
            )
          }
          return (
            <a key={i} href={item} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-400 hover:underline truncate max-w-[180px] block">
              {item.startsWith('data:') ? 'Data' : item.split('/').pop() || 'File'}
            </a>
          )
        })}
      </div>
    </div>
  )
}

/** Fallback output UI when we have lastResults but no persisted record yet. */
function LastResultOutput({ nodeId }: { nodeId: string }) {
  const lastResults = useExecutionStore(s => s.lastResults[nodeId] ?? [])
  const latest = lastResults[0]
  if (!latest?.urls?.length) return null
  return (
    <div className="px-1">
      <OutputPreview urls={latest.urls} durationMs={latest.durationMs} cost={latest.cost} label="Output (latest run)" />
    </div>
  )
}

export function RunMonitor({ workflowId }: { workflowId?: string | null }) {
  const runSessions = useExecutionStore(s => s.runSessions)
  const showRunMonitor = useExecutionStore(s => s.showRunMonitor)
  const toggleRunMonitor = useExecutionStore(s => s.toggleRunMonitor)
  const nodeStatuses = useExecutionStore(s => s.nodeStatuses)
  const progressMap = useExecutionStore(s => s.progressMap)
  const errorMessages = useExecutionStore(s => s.errorMessages)
  const cancelAll = useExecutionStore(s => s.cancelAll)

  // Filter sessions to current workflow when we have one; otherwise show all sessions.
  // If filtering by workflowId yields none but sessions exist, show all (avoids empty list after run/save race).
  const byWorkflow = workflowId ? runSessions.filter(s => s.workflowId === workflowId) : runSessions
  const filteredSessions = byWorkflow.length > 0 ? byWorkflow : runSessions

  const activeCount = filteredSessions.filter(s => s.status === 'running').length
  const errorCount = filteredSessions.filter(s => s.status === 'error').length
  const completedCount = filteredSessions.filter(s => s.status === 'completed').length
  const statusIndicator =
    activeCount > 0
      ? { color: 'bg-blue-500 animate-pulse', label: `${activeCount} running` }
      : errorCount > 0
        ? { color: 'bg-orange-500', label: `${errorCount} with errors` }
        : completedCount > 0
          ? { color: 'bg-green-500', label: `${completedCount} completed` }
          : { color: 'bg-muted-foreground', label: 'No runs' }

  return (
    <div className={`flex-shrink-0 border-t border-border bg-card flex flex-col min-h-0 w-full ${showRunMonitor ? 'max-h-[360px]' : ''}`}>
      {/* Header bar — click entire row to toggle expand/collapse */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border cursor-pointer hover:bg-muted/70 transition-colors flex-shrink-0"
        onClick={() => toggleRunMonitor()}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold truncate">Execution Monitor</span>
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${statusIndicator.color}`}
            title={statusIndicator.label}
          />
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); toggleRunMonitor() }}
          className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
          title={showRunMonitor ? 'Collapse' : 'Expand'}
        >
          {showRunMonitor ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* Content — collapsible, fixed height so panel doesn't grow infinitely */}
      {showRunMonitor && (
        <div className="flex-1 min-h-0 overflow-y-auto max-h-[320px]">
          {filteredSessions.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">No runs yet</div>
          )}
          {filteredSessions.map(session => (
            <SessionCard key={session.id} session={session} nodeStatuses={nodeStatuses}
              progressMap={progressMap} errorMessages={errorMessages} onCancel={() => cancelAll(session.workflowId)} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Session Card ──────────────────────────────────────────────────── */

function SessionCard({ session, nodeStatuses, progressMap, errorMessages, onCancel }: {
  session: RunSession
  nodeStatuses: Record<string, NodeStatus>
  progressMap: Record<string, { progress: number; message?: string }>
  errorMessages: Record<string, string>
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
        <span className="text-muted-foreground w-4 h-4 flex items-center justify-center flex-shrink-0">
          {collapsed ? <ChevronDown className="w-3.5 h-3.5 rotate-[-90deg]" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
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
                progress={progressMap[nodeId]}
                errorMessage={errorMessages[nodeId]} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Node Row (clickable, expandable with I/O data) ────────────────── */

function NodeRow({ nodeId, label, sessionResult, isSessionRunning, liveStatus, progress, errorMessage }: {
  nodeId: string; label: string; sessionResult: 'running' | 'done' | 'error'
  isSessionRunning: boolean; liveStatus?: NodeStatus
  progress?: { progress: number; message?: string }
  errorMessage?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [record, setRecord] = useState<NodeExecutionRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const lastResults = useExecutionStore(s => s.lastResults[nodeId] ?? [])
  const hasLastResult = lastResults.length > 0 && (lastResults[0].urls?.length ?? 0) > 0
  const isLiveRunning = isSessionRunning && liveStatus === 'running'
  const isDone = sessionResult === 'done' || sessionResult === 'error'
  const displayError = errorMessage ?? (record?.resultMetadata as Record<string, unknown> | undefined)?.error as string | undefined

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
        {isDone && (
          <span className="text-muted-foreground ml-1 flex-shrink-0">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
        )}
      </div>

      {/* Inline error preview for failed nodes */}
      {sessionResult === 'error' && errorMessage && (
        <div className="mx-2 mt-0.5 mb-1 px-2 py-1.5 rounded-md border border-red-500/30 bg-red-500/10 text-[10px] text-red-400/90 leading-tight break-words line-clamp-2" title={errorMessage}>
          {errorMessage}
        </div>
      )}

      {/* Expanded I/O data */}
      {expanded && (
        <div className="mx-2 mb-1 rounded-md border border-border bg-background overflow-hidden">
          {loading && <div className="p-3 text-[10px] text-muted-foreground animate-pulse text-center">Loading...</div>}
          {!loading && record && <NodeIODetail record={record} liveErrorMessage={errorMessage} />}
          {!loading && !record && (
            <div className="p-3 text-[10px] text-muted-foreground">
              {sessionResult === 'error' && (
                <div>
                  <div className="text-[9px] text-red-400 font-semibold uppercase tracking-wider mb-1">Error</div>
                  <div className="text-[10px] text-red-400/90 whitespace-pre-wrap break-words p-2 rounded bg-red-500/10">
                    {displayError || 'Execution failed. No details were captured.'}
                  </div>
                </div>
              )}
              {sessionResult !== 'error' && (hasLastResult ? <LastResultOutput nodeId={nodeId} /> : <div className="text-center">No data available</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Node I/O Detail ───────────────────────────────────────────────── */

function NodeIODetail({ record, liveErrorMessage }: { record: NodeExecutionRecord; liveErrorMessage?: string }) {
  const meta = record.resultMetadata as Record<string, unknown> | null
  const resultUrls = (meta?.resultUrls as string[]) ?? (record.resultPath ? [record.resultPath] : [])
  const error = liveErrorMessage ?? (meta?.error as string | undefined)
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

      {/* Output — thumbnails / preview (meta bar above already shows duration & cost) */}
      {resultUrls.length > 0 && (
        <div className="px-3 py-2">
          <OutputPreview urls={resultUrls} label="Output" />
        </div>
      )}

      {/* Error — show detailed message with scroll when long */}
      {(record.status === 'error' || error) && error && (
        <div className="px-3 pb-2">
          <div className="text-[9px] text-red-400 font-semibold uppercase tracking-wider mb-1">Error</div>
          <div className="text-[10px] text-red-400/90 p-2 rounded bg-red-500/10 leading-tight whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">{error}</div>
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
