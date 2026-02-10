/**
 * Results panel — execution history for selected node.
 * Shows all executions grouped by run, with thumbnails for all outputs
 * (images, videos, 3D models). Matches the node's inline results design.
 */
import { useEffect, useState, useCallback } from 'react'
import { useUIStore } from '../../stores/ui.store'
import { useExecutionStore } from '../../stores/execution.store'
import { historyIpc } from '../../ipc/ipc-client'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { NodeExecutionRecord } from '@/workflow/types/execution'

export function ResultsPanel() {
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const openPreview = useUIStore(s => s.openPreview)
  const nodeStatuses = useExecutionStore(s => s.nodeStatuses)
  const [records, setRecords] = useState<NodeExecutionRecord[]>([])
  const [prevStatus, setPrevStatus] = useState<string>('idle')

  const loadRecords = useCallback(async () => {
    if (!selectedNodeId) { setRecords([]); return }
    try {
      const r = await historyIpc.list(selectedNodeId)
      setRecords(r || [])
    } catch { setRecords([]) }
  }, [selectedNodeId])

  useEffect(() => { loadRecords() }, [loadRecords])

  // Auto-refresh when execution completes
  useEffect(() => {
    if (!selectedNodeId) return
    const currentStatus = nodeStatuses[selectedNodeId] || 'idle'
    if (prevStatus === 'running' && currentStatus !== 'running') setTimeout(loadRecords, 1500)
    setPrevStatus(currentStatus)
  }, [selectedNodeId, nodeStatuses, loadRecords, prevStatus])

  if (!selectedNodeId) {
    return <div className="p-4 text-muted-foreground text-sm text-center">Select a node to view results</div>
  }

  const currentNodeStatus = nodeStatuses[selectedNodeId]

  // Extract all output URLs from a record
  const getUrls = (rec: NodeExecutionRecord): string[] => {
    const meta = rec.resultMetadata as Record<string, unknown> | null
    const metaUrls = meta?.resultUrls as string[] | undefined
    if (metaUrls && Array.isArray(metaUrls) && metaUrls.length > 0) {
      return metaUrls.filter(u => u && typeof u === 'string')
    }
    return rec.resultPath ? [rec.resultPath] : []
  }

  const handleDownload = (url: string) => {
    const filename = url.split('/').pop() || 'result'
    if (window.electronAPI?.downloadFile) {
      window.electronAPI.downloadFile(url, filename)
    } else {
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex justify-between items-center px-3 pt-3 pb-2">
        <h3 className="text-sm font-semibold">Results ({records.length})</h3>
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

      {/* Execution list */}
      <ScrollArea className="flex-1 px-3 pb-3">
        {records.length === 0 && <p className="text-muted-foreground text-sm py-6 text-center">No executions yet</p>}

        <div className="space-y-2">
          {records.map((rec, idx) => {
            const urls = rec.status === 'success' ? getUrls(rec) : []
            const errorMessage = rec.status === 'error' && rec.resultMetadata?.error ? String(rec.resultMetadata.error) : null

            return (
              <div key={rec.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-hidden">
                {/* Header — status + timestamp + meta */}
                <div className={`flex items-center gap-2 px-3 py-1.5
                  ${rec.status === 'success' ? 'bg-green-500/5' : rec.status === 'error' ? 'bg-red-500/5' : 'bg-[hsl(var(--muted))]'}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0
                    ${rec.status === 'success' ? 'bg-green-500' : rec.status === 'error' ? 'bg-red-500' : 'bg-muted-foreground'}`} />
                  <span className={`text-[11px] font-medium flex-1
                    ${rec.status === 'success' ? 'text-green-400' : rec.status === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}>
                    #{records.length - idx} {rec.status}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {new Date(rec.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>

                {/* Duration + cost */}
                <div className="flex items-center gap-3 px-3 py-1 text-[10px] text-muted-foreground border-b border-[hsl(var(--border))]">
                  {rec.durationMs != null && <span>⏱ {(rec.durationMs / 1000).toFixed(1)}s</span>}
                  <span>💰 ${rec.cost.toFixed(4)}</span>
                  {idx === 0 && <span className="text-green-400 ml-auto">Latest</span>}
                </div>

                {/* Result outputs — images, videos, 3D models */}
                {urls.length > 0 && (
                  <div className="p-2 flex gap-2 flex-wrap">
                    {urls.map((url, ui) => {
                      const is3D = url.match(/\.(glb|gltf)(\?.*)?$/i)
                      const isImage = url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)
                      const isVideo = url.match(/\.(mp4|webm|mov)(\?.*)?$/i)

                      if (isImage) {
                        return (
                          <div key={ui} className="relative group flex-1 min-w-[100px]">
                            <img src={url} alt="" onClick={() => openPreview(url)}
                              className="w-full max-h-[160px] rounded border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 bg-black/10" />
                            <button onClick={() => handleDownload(url)}
                              className="absolute top-1 right-1 w-6 h-6 rounded bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="4" y1="21" x2="20" y2="21"/>
                              </svg>
                            </button>
                          </div>
                        )
                      }

                      if (is3D) {
                        return (
                          <div key={ui} className="flex-1 min-w-[100px] cursor-pointer rounded border border-[hsl(var(--border))] bg-gradient-to-br from-[#1a1a2e] to-[#0f3460] p-3 flex flex-col items-center justify-center text-center hover:ring-2 hover:ring-blue-500/40 transition-all"
                            style={{ minHeight: 100 }}
                            onClick={() => openPreview(url)}>
                            <div className="text-xl mb-1">🧊</div>
                            <div className="text-[10px] text-blue-300 font-medium">3D Model</div>
                            <div className="text-[8px] text-white/30 truncate max-w-full mt-0.5">{url.split('/').pop()?.split('?')[0]}</div>
                          </div>
                        )
                      }

                      if (isVideo) {
                        return (
                          <div key={ui} className="relative group flex-1 min-w-[100px]">
                            <video src={url} className="w-full max-h-[160px] rounded border border-[hsl(var(--border))] object-contain cursor-pointer"
                              onClick={() => openPreview(url)} />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
                              </div>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div key={ui} className="flex-1 min-w-[100px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-2 text-center cursor-pointer hover:bg-accent transition-colors"
                          onClick={() => openPreview(url)}>
                          <div className="text-[10px] text-muted-foreground truncate">{url.split('/').pop()?.split('?')[0] || 'File'}</div>
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
