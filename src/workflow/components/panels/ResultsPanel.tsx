/**
 * Results panel — execution history for selected node.
 * Shows all executions grouped by run, with thumbnails for all outputs
 * (images, videos, 3D models). Matches the node's inline results design.
 *
 * When embedded in a node card with multiple results, shows a stacked-card
 * view with left/right navigation. Clicking the preview opens the full
 * gallery overlay with arrow key support.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useExecutionStore } from '../../stores/execution.store'
import { useWorkflowStore } from '../../stores/workflow.store'
import { historyIpc } from '../../ipc/ipc-client'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getOutputItemType, decodeDataText, isImageUrl } from '../../lib/outputDisplay'
import type { NodeExecutionRecord } from '@/workflow/types/execution'

interface ResultsPanelProps {
  /** When true, compact layout for embedding inside node card */
  embeddedInNode?: boolean
  /** When set (e.g. when embedded in a node card), show this node's results regardless of selection */
  nodeId?: string
}

export function ResultsPanel({ embeddedInNode, nodeId: nodeIdProp }: ResultsPanelProps = {}) {
  const { t } = useTranslation()
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const nodeId = nodeIdProp ?? selectedNodeId
  const openPreview = useUIStore(s => s.openPreview)
  const nodeStatuses = useExecutionStore(s => s.nodeStatuses)
  const clearNodeResults = useExecutionStore(s => s.clearNodeResults)
  const lastResults = useExecutionStore(s => s.lastResults)
  const [records, setRecords] = useState<NodeExecutionRecord[]>([])
  const [prevStatus, setPrevStatus] = useState<string>('idle')
  /** Index of the currently visible card in stacked (embedded) mode */
  const [stackIndex, setStackIndex] = useState(0)
  /** Track slide direction for animation */
  const prevIndexRef = useRef(0)
  const slideDirection = stackIndex > prevIndexRef.current ? 'left' : stackIndex < prevIndexRef.current ? 'right' : 'none'
  useEffect(() => { prevIndexRef.current = stackIndex }, [stackIndex])

  const loadRecords = useCallback(async () => {
    if (!nodeId) { setRecords([]); return }
    try {
      const r = await historyIpc.list(nodeId)
      setRecords(r || [])
    } catch { setRecords([]) }
  }, [nodeId])

  useEffect(() => { loadRecords() }, [loadRecords])

  // Auto-refresh when execution completes
  useEffect(() => {
    if (!nodeId) return
    const currentStatus = nodeStatuses[nodeId] || 'idle'
    if (prevStatus === 'running' && currentStatus !== 'running') setTimeout(loadRecords, 1500)
    setPrevStatus(currentStatus)
  }, [nodeId, nodeStatuses, loadRecords, prevStatus])

  /** Delete a single execution record + files, refresh list */
  const handleDeleteOne = useCallback(async (executionId: string) => {
    try {
      await historyIpc.delete(executionId)
      setRecords(prev => prev.filter(r => r.id !== executionId))
      if (nodeId) clearNodeResults(nodeId)
    } catch (err) {
      console.error('Failed to delete execution:', err)
    }
  }, [nodeId, clearNodeResults])

  /** Delete ALL execution records + files for this node */
  const handleDeleteAll = useCallback(async () => {
    if (!nodeId) return
    try {
      await historyIpc.deleteAll(nodeId)
      setRecords([])
      clearNodeResults(nodeId)
      const node = useWorkflowStore.getState().nodes.find(n => n.id === nodeId)
      if (node) {
        const { __hiddenRuns: _, __showLatestOnly: _2, ...rest } = node.data.params as Record<string, unknown>
        useWorkflowStore.getState().updateNodeParams(nodeId, rest)
      }
    } catch (err) {
      console.error('Failed to delete all executions:', err)
    }
  }, [nodeId, clearNodeResults])

  if (!nodeId) {
    return <div className="p-4 text-muted-foreground text-sm text-center">Select a node to view results</div>
  }

  const currentNodeStatus = nodeStatuses[nodeId]

  // When history is empty (e.g. just finished), show lastResults as synthetic records so preview is visible
  const lastResultsForNode = lastResults[nodeId] ?? []
  const displayRecords: NodeExecutionRecord[] =
    records.length > 0
      ? records
      : lastResultsForNode.map((item, idx) => ({
          id: `last-${idx}`,
          nodeId,
          workflowId: '',
          inputHash: '',
          paramsHash: '',
          status: 'success' as const,
          resultPath: item.urls[0] ?? '',
          resultMetadata: { resultUrls: item.urls },
          durationMs: item.durationMs ?? null,
          cost: item.cost ?? 0,
          createdAt: item.time,
          score: null,
          starred: false
        }))
  const isSyntheticRecord = (id: string) => id.startsWith('last-')

  // Extract all output URLs from a record
  const getUrls = (rec: NodeExecutionRecord): string[] => {
    const meta = rec.resultMetadata as Record<string, unknown> | null
    const metaUrls = meta?.resultUrls as string[] | undefined
    if (metaUrls && Array.isArray(metaUrls) && metaUrls.length > 0) {
      return metaUrls.filter(u => u && typeof u === 'string')
    }
    return rec.resultPath ? [rec.resultPath] : []
  }

  const panelImageUrls = displayRecords
    .filter(rec => rec.status === 'success')
    .flatMap(rec => getUrls(rec))
    .filter(isImageUrl)

  const handleDownload = (url: string) => {
    const filename = url.split('/').pop() || 'result'
    if (window.electronAPI?.downloadFile) {
      window.electronAPI.downloadFile(url, filename)
    } else {
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    }
  }

  // Clamp stackIndex when displayRecords changes
  const clampedIndex = Math.min(stackIndex, Math.max(0, displayRecords.length - 1))
  useEffect(() => {
    if (clampedIndex !== stackIndex) setStackIndex(clampedIndex)
  }, [clampedIndex, stackIndex])

  /* ── Stacked card view for embedded-in-node mode ─────────────── */
  if (embeddedInNode) {
    if (displayRecords.length === 0) {
      return (
        <div className="flex flex-col min-h-0 flex-1">
          <div className="flex justify-between items-center px-2 pt-1.5 pb-1">
            <h3 className="font-semibold text-xs">{t('workflow.results', 'Results')} (0)</h3>
          </div>
          <p className="text-muted-foreground text-xs py-4 text-center">{t('workflow.noExecutions', 'No executions yet')}</p>
        </div>
      )
    }

    const total = displayRecords.length
    const currentRec = displayRecords[clampedIndex]
    const currentUrls = currentRec.status === 'success' ? getUrls(currentRec) : []
    const currentError = currentRec.status === 'error' && currentRec.resultMetadata?.error ? String(currentRec.resultMetadata.error) : null

    return (
      <div className="flex flex-col min-h-0 flex-1">
        {/* Header — only clear-all button */}
        <div className="flex justify-end items-center px-2 pt-1.5 pb-1">
          {records.length > 0 && (
            <button onClick={handleDeleteAll}
              className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
              title={t('workflow.clearAllResults', 'Clear all results and delete files')}>
              {t('workflow.clearAll', 'Clear all')}
            </button>
          )}
        </div>

        {/* Result area */}
        <div className="px-2 pb-1">
          {/* Status bar */}
          <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-t-lg
            ${currentRec.status === 'success' ? 'bg-green-500/5' : currentRec.status === 'error' ? 'bg-red-500/5' : 'bg-[hsl(var(--muted))]'}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0
              ${currentRec.status === 'success' ? 'bg-green-500' : currentRec.status === 'error' ? 'bg-red-500' : 'bg-muted-foreground'}`} />
            <span className="text-[10px] text-muted-foreground flex-1 truncate leading-none">
              {new Date(currentRec.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
            {currentRec.durationMs != null && <span className="text-[9px] text-muted-foreground leading-none">⏱{(currentRec.durationMs / 1000).toFixed(1)}s</span>}
            <span className="text-[9px] text-muted-foreground leading-none">💰${currentRec.cost.toFixed(4)}</span>
            {currentNodeStatus && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded leading-none
                ${currentNodeStatus === 'running' ? 'bg-blue-500/20 text-blue-400' :
                  currentNodeStatus === 'confirmed' ? 'bg-green-500/20 text-green-400' :
                  currentNodeStatus === 'error' ? 'bg-red-500/20 text-red-400' :
                  'bg-muted text-muted-foreground'}`}>
                {currentNodeStatus === 'running' ? 'Running...' :
                 currentNodeStatus === 'confirmed' ? 'Done' :
                 currentNodeStatus === 'error' ? 'Error' : 'Idle'}
              </span>
            )}
          </div>

          {/* Result content — carousel with adjacent peeks for media, full-width for text */}
          {currentUrls.length > 0 && (() => {
            const isTextResult = currentUrls.every(u => getOutputItemType(u) === 'text')
            return isTextResult ? (
              <div className="px-1 py-1.5">
                {currentUrls.map((url, ui) => (
                  <StackedResultItem
                    key={ui}
                    url={url}
                    allImageUrls={panelImageUrls}
                    openPreview={openPreview}
                    onDownload={handleDownload}
                  />
                ))}
              </div>
            ) : (
            <div className="relative overflow-hidden rounded-b-lg flex justify-center py-1.5">
              <div className="relative w-fit">
                {/* Previous result peek — anchored to left edge of center image */}
                {total > 1 && clampedIndex > 0 && (() => {
                  const prevRec = displayRecords[clampedIndex - 1]
                  const prevUrls = prevRec.status === 'success' ? getUrls(prevRec) : []
                  const prevImg = prevUrls.find(u => isImageUrl(u))
                  return prevImg ? (
                    <div
                      className="absolute left-0 top-[15%] bottom-[15%] w-[26px] -translate-x-full cursor-pointer overflow-hidden rounded-l opacity-50 hover:opacity-80 transition-opacity z-0"
                      onClick={() => setStackIndex(i => Math.max(0, i - 1))}
                    >
                      <img src={prevImg} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : null
                })()}

                {/* Center image(s) — animated slide */}
                <div
                  key={clampedIndex}
                  className="relative z-10 flex gap-2 flex-wrap justify-center"
                  style={{
                    animation: slideDirection !== 'none'
                      ? `carousel-slide-${slideDirection} 0.25s ease-out`
                      : undefined,
                  }}
                >
                  {currentUrls.map((url, ui) => (
                    <StackedResultItem
                      key={ui}
                      url={url}
                      allImageUrls={panelImageUrls}
                      openPreview={openPreview}
                      onDownload={handleDownload}
                    />
                  ))}
                </div>

                {/* Next result peek — anchored to right edge of center image */}
                {total > 1 && clampedIndex < total - 1 && (() => {
                  const nextRec = displayRecords[clampedIndex + 1]
                  const nextUrls = nextRec.status === 'success' ? getUrls(nextRec) : []
                  const nextImg = nextUrls.find(u => isImageUrl(u))
                  return nextImg ? (
                    <div
                      className="absolute right-0 top-[15%] bottom-[15%] w-[26px] translate-x-full cursor-pointer overflow-hidden rounded-r opacity-50 hover:opacity-80 transition-opacity z-0"
                      onClick={() => setStackIndex(i => Math.min(total - 1, i + 1))}
                    >
                      <img src={nextImg} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : null
                })()}
              </div>
            </div>
            )
          })()}

          {/* Error */}
          {currentError && (
            <div className="py-1.5">
              <div className="text-[10px] text-red-400 p-1.5 rounded bg-red-500/10 border border-red-500/20 leading-tight truncate">
                ⚠ {currentError}
              </div>
            </div>
          )}

          {/* Navigation — only show when multiple results */}
          {total > 1 && (
            <div className="flex items-center justify-center gap-2 mt-1">
              <button
                onClick={() => setStackIndex(i => Math.max(0, i - 1))}
                disabled={clampedIndex === 0}
                className="p-0.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-default transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground tabular-nums min-w-[40px] text-center">
                {clampedIndex + 1} / {total}
              </span>
              <button
                onClick={() => setStackIndex(i => Math.min(total - 1, i + 1))}
                disabled={clampedIndex === total - 1}
                className="p-0.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-default transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ── Full list view (side panel / standalone) ────────────────── */
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex justify-between items-center flex-shrink-0 px-3 pt-3 pb-2">
        <h3 className="font-semibold text-sm">{t('workflow.results', 'Results')} ({displayRecords.length})</h3>
        <div className="flex items-center gap-2">
          {records.length > 0 && (
            <button onClick={handleDeleteAll}
              className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
              title={t('workflow.clearAllResults', 'Clear all results and delete files')}>
              {t('workflow.clearAll', 'Clear all')}
            </button>
          )}
          {currentNodeStatus && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded
              ${currentNodeStatus === 'running' ? 'bg-blue-500/20 text-blue-400' :
                currentNodeStatus === 'confirmed' ? 'bg-green-500/20 text-green-400' :
                currentNodeStatus === 'error' ? 'bg-red-500/20 text-red-400' :
                'bg-muted text-muted-foreground'}`}>
              {currentNodeStatus === 'running' ? 'Running...' :
               currentNodeStatus === 'confirmed' ? 'Done' :
               currentNodeStatus === 'error' ? 'Error' : 'Idle'}
            </span>
          )}
        </div>
      </div>

      {/* Execution list */}
      <ScrollArea className="flex-1 min-h-0 px-3 pb-3">
        {displayRecords.length === 0 && <p className="text-muted-foreground text-sm py-6 text-center">{t('workflow.noExecutions', 'No executions yet')}</p>}

        <div className="space-y-2">
          {displayRecords.map((rec, idx) => {
            const urls = rec.status === 'success' ? getUrls(rec) : []
            const errorMessage = rec.status === 'error' && rec.resultMetadata?.error ? String(rec.resultMetadata.error) : null
            const synthetic = isSyntheticRecord(rec.id)

            return (
              <div key={rec.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-hidden">
                {/* Header — status + timestamp + meta */}
                <div className={`flex items-center gap-2 px-3 py-1.5
                  ${rec.status === 'success' ? 'bg-green-500/5' : rec.status === 'error' ? 'bg-red-500/5' : 'bg-[hsl(var(--muted))]'}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0
                    ${rec.status === 'success' ? 'bg-green-500' : rec.status === 'error' ? 'bg-red-500' : 'bg-muted-foreground'}`} />
                  <span className={`text-[11px] font-medium flex-1
                    ${rec.status === 'success' ? 'text-green-400' : rec.status === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}>
                    #{displayRecords.length - idx} {rec.status}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {new Date(rec.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  {!synthetic && (
                    <button onClick={() => handleDeleteOne(rec.id)}
                      className="text-[10px] text-muted-foreground hover:text-red-400 transition-colors ml-1"
                      title={t('workflow.deleteResult', 'Delete this result and files')}>
                      ✕
                    </button>
                  )}
                </div>

                {/* Duration + cost */}
                <div className="flex items-center gap-3 px-3 py-1 text-[10px] text-muted-foreground border-b border-[hsl(var(--border))]">
                  {rec.durationMs != null && <span>⏱ {(rec.durationMs / 1000).toFixed(1)}s</span>}
                  <span>💰 ${rec.cost.toFixed(4)}</span>
                  {idx === 0 && <span className="text-green-400 ml-auto">{synthetic ? t('workflow.latestRun', 'Latest run') : 'Latest'}</span>}
                </div>

                {/* Result outputs — image, video, audio, text, 3D, file */}
                {urls.length > 0 && (
                  <div className="p-2 flex gap-2 flex-wrap">
                    {urls.map((url, ui) => {
                      const type = getOutputItemType(url)

                      if (type === 'text') {
                        const displayText = url.startsWith('data:text/') ? decodeDataText(url) : url
                        return (
                          <div key={ui} className="w-full min-w-0 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 p-2 max-h-[200px] overflow-y-auto">
                            <pre className="text-[11px] text-foreground/90 whitespace-pre-wrap break-words font-sans">{displayText}</pre>
                          </div>
                        )
                      }

                      if (type === 'image') {
                        return (
                          <div key={ui} className="relative group flex-1 min-w-[100px]">
                            <img src={url} alt="" onClick={() => openPreview(url, panelImageUrls)}
                              className="w-full max-h-[160px] rounded border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 bg-black/10" />
                            <button onClick={() => handleDownload(url)}
                              className="absolute top-1 right-1 h-7 px-2 rounded-md bg-blue-600 text-white text-[10px] font-medium flex items-center gap-1 hover:bg-blue-700 shadow-md transition-colors">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="4" y1="21" x2="20" y2="21"/>
                              </svg>
                              {t('workflow.download', 'Download')}
                            </button>
                          </div>
                        )
                      }

                      if (type === '3d') {
                        return (
                          <div key={ui} className="flex-1 min-w-[100px] cursor-pointer rounded border border-[hsl(var(--border))] bg-gradient-to-br from-[#1a1a2e] to-[#0f3460] p-3 flex flex-col items-center justify-center text-center hover:ring-2 hover:ring-blue-500/40 transition-all"
                            style={{ minHeight: 100 }}
                            onClick={() => openPreview(url)}>
                            <div className="text-xl mb-1">🧊</div>
                            <div className="text-[10px] text-blue-300 font-medium">3D Model</div>
                            <div className="text-[8px] text-white/30 truncate max-w-full mt-0.5">{url.startsWith('data:') ? 'Data' : url.split('/').pop()?.split('?')[0]}</div>
                          </div>
                        )
                      }

                      if (type === 'video') {
                        return (
                          <div key={ui} className="relative group flex-1 min-w-[100px]">
                            <video src={url} className="w-full max-h-[160px] rounded border border-[hsl(var(--border))] object-contain cursor-pointer"
                              onClick={() => openPreview(url)} />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
                              </div>
                            </div>
                            <button onClick={() => handleDownload(url)}
                              className="absolute top-1 right-1 h-7 px-2 rounded-md bg-blue-600 text-white text-[10px] font-medium flex items-center gap-1 hover:bg-blue-700 shadow-md transition-colors">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="4" y1="21" x2="20" y2="21"/>
                              </svg>
                              {t('workflow.download', 'Download')}
                            </button>
                          </div>
                        )
                      }

                      if (type === 'audio') {
                        return (
                          <div key={ui} className="flex-1 min-w-[100px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-2">
                            <audio src={url} controls className="w-full" />
                          </div>
                        )
                      }

                      return (
                        <div key={ui} className="flex-1 min-w-[100px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-2 text-center cursor-pointer hover:bg-accent transition-colors"
                          onClick={() => openPreview(url)}>
                          <div className="text-[10px] text-muted-foreground truncate">{url.startsWith('data:') ? 'Data' : url.split('/').pop()?.split('?')[0] || 'File'}</div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Error message */}
                {errorMessage && (
                  <div className="px-3 py-2">
                    <div className="text-[11px] text-red-400 p-2 rounded bg-red-500/10 border border-red-500/20 leading-tight">
                      ⚠ {errorMessage}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}


/* ── Compact result item used inside the stacked card view ──────── */
function StackedResultItem({ url, allImageUrls, openPreview, onDownload }: {
  url: string
  allImageUrls: string[]
  openPreview: (src: string, items?: string[]) => void
  onDownload: (url: string) => void
}) {
  const type = getOutputItemType(url)

  if (type === 'text') {
    const displayText = url.startsWith('data:text/') ? decodeDataText(url) : url
    return (
      <div className="w-full min-w-0 rounded-lg bg-[hsl(var(--muted))]/30 px-3 py-2 max-h-[120px] overflow-y-auto nodrag nowheel select-text cursor-text">
        <p className="text-[11px] text-foreground/80 whitespace-pre-wrap break-words leading-relaxed text-left select-text">{displayText}</p>
      </div>
    )
  }

  if (type === 'image') {
    return (
      <div className="relative group w-fit mx-auto">
        <img src={url} alt="" onClick={() => openPreview(url, allImageUrls)}
          className="max-w-full max-h-[160px] rounded object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40" />
        <button onClick={() => onDownload(url)}
          className="absolute top-1.5 right-1.5 h-7 w-7 rounded-md bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 shadow-lg transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="4" y1="21" x2="20" y2="21"/>
          </svg>
        </button>
      </div>
    )
  }

  if (type === 'video') {
    return (
      <div className="relative group flex-1 min-w-[80px]">
        <video src={url} className="w-full max-h-[140px] rounded border border-[hsl(var(--border))] object-contain cursor-pointer"
          onClick={() => openPreview(url)} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-7 h-7 rounded-full bg-black/50 flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
          </div>
        </div>
        <button onClick={() => onDownload(url)}
          className="absolute top-1.5 right-1.5 h-7 w-7 rounded-md bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 shadow-lg transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="4" y1="21" x2="20" y2="21"/>
          </svg>
        </button>
      </div>
    )
  }

  if (type === 'audio') {
    return (
      <div className="flex-1 min-w-[80px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-1.5">
        <audio src={url} controls className="w-full h-8" />
      </div>
    )
  }

  if (type === '3d') {
    return (
      <div className="flex-1 min-w-[80px] cursor-pointer rounded border border-[hsl(var(--border))] bg-gradient-to-br from-[#1a1a2e] to-[#0f3460] p-2 flex flex-col items-center justify-center text-center hover:ring-2 hover:ring-blue-500/40 transition-all"
        style={{ minHeight: 80 }}
        onClick={() => openPreview(url)}>
        <div className="text-lg mb-0.5">🧊</div>
        <div className="text-[9px] text-blue-300 font-medium">3D Model</div>
      </div>
    )
  }

  // Fallback — generic file
  return (
    <div className="flex-1 min-w-[80px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-2 text-center cursor-pointer hover:bg-accent transition-colors"
      onClick={() => openPreview(url)}>
      <div className="text-[9px] text-muted-foreground truncate">{url.startsWith('data:') ? 'Data' : url.split('/').pop()?.split('?')[0] || 'File'}</div>
    </div>
  )
}
