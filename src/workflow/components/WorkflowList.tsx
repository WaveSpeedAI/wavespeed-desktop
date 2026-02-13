/**
 * Workflow list — left-side panel (same style as NodePalette).
 * Click = open, double-click name = rename, right-click = context menu.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { workflowIpc, storageIpc } from '../ipc/ipc-client'
import { useWorkflowStore } from '../stores/workflow.store'
import { useUIStore } from '../stores/ui.store'
import { Input } from '@/components/ui/input'
import type { WorkflowSummary } from '@/workflow/types/ipc'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`
}

interface WorkflowListProps {
  onOpen?: (id: string) => Promise<void>
}

interface ContextMenuState {
  wfId: string
  x: number
  y: number
}

export function WorkflowList({ onOpen }: WorkflowListProps) {
  const { t } = useTranslation()
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [diskUsage, setDiskUsage] = useState<Record<string, number>>({})
  const [newName, setNewName] = useState('')
  const [cleaning, setCleaning] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [width, setWidth] = useState(220)
  const [dragging, setDragging] = useState(false)
  const { loadWorkflow, newWorkflow } = useWorkflowStore()
  const currentWorkflowId = useWorkflowStore(s => s.workflowId)
  const toggleWorkflowPanel = useUIStore(s => s.toggleWorkflowPanel)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    workflowIpc.list().then(list => {
      setWorkflows(list ?? [])
      ;(list ?? []).forEach(wf => {
        storageIpc.getWorkflowDiskUsage(wf.id).then(size => {
          setDiskUsage(prev => ({ ...prev, [wf.id]: size }))
        }).catch(() => {})
      })
    }).catch(() => {})
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  const handleCreate = async () => {
    if (!newName.trim()) return
    const trimmed = newName.trim()

    // Check for duplicate name
    const duplicate = workflows.find(w => w.name === trimmed)
    if (duplicate) {
      // Name already taken — don't create
      return
    }

    await newWorkflow(trimmed)
    setNewName('')
    refresh()
  }

  const handleOpen = async (id: string) => {
    if (onOpen) {
      await onOpen(id)
    } else {
      await loadWorkflow(id)
    }
  }

  const handleDelete = async (id: string) => {
    await workflowIpc.delete(id)
    await storageIpc.deleteWorkflowFiles(id).catch(() => {})
    setConfirmDeleteId(null)
    refresh()
  }

  const startRename = (wf: WorkflowSummary) => {
    setRenamingId(wf.id)
    setRenamingValue(wf.name)
    setContextMenu(null)
  }

  const commitRename = async () => {
    if (!renamingId) return
    const trimmed = renamingValue.trim()
    if (!trimmed) { setRenamingId(null); return }

    // Check for duplicate name in the current list (excluding self)
    const duplicate = workflows.find(w => w.id !== renamingId && w.name === trimmed)
    if (duplicate) {
      // Name already taken — don't allow
      setRenamingId(null)
      return
    }

    const result = await workflowIpc.rename(renamingId, trimmed) as unknown as { finalName: string } | void
    const actualName = (result && typeof result === 'object' && 'finalName' in result) ? result.finalName : trimmed

    if (currentWorkflowId === renamingId) {
      useWorkflowStore.getState().setWorkflowName(actualName)
    }
    setRenamingId(null)
    refresh()
  }

  const handleCleanOutputs = async (id: string) => {
    setCleaning(id)
    setContextMenu(null)
    try {
      await storageIpc.cleanWorkflowOutputs(id)
      const size = await storageIpc.getWorkflowDiskUsage(id)
      setDiskUsage(prev => ({ ...prev, [id]: size }))
    } catch (err) { console.error('Clean failed:', err) }
    setCleaning(null)
  }

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: MouseEvent) => {
      setWidth(Math.max(180, Math.min(400, startWidth + (ev.clientX - startX))))
    }
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width])

  const totalDiskUsage = Object.values(diskUsage).reduce((sum, v) => sum + v, 0)

  return (
    <div className="border-r border-border bg-card text-card-foreground flex flex-col relative overflow-hidden"
      style={{ flexBasis: width, flexShrink: 1, flexGrow: 0, minWidth: 0 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-semibold text-xs">{t('workflow.workflows', 'Workflows')}</span>
        <button onClick={toggleWorkflowPanel} className="text-muted-foreground hover:text-foreground text-xs px-1" title={t('common.close', 'Close')}>
          ✕
        </button>
      </div>

      {/* Create new */}
      <div className="px-2.5 py-2 border-b border-border flex gap-1.5">
        <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('workflow.newWorkflowName', 'New workflow...')}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          className={`flex-1 h-7 text-xs ${newName.trim() && workflows.some(w => w.name === newName.trim()) ? 'border-red-500 focus-visible:ring-red-500/50' : ''}`} />
        <button onClick={handleCreate} disabled={!newName.trim() || workflows.some(w => w.name === newName.trim())}
          className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          +
        </button>
      </div>

      {/* Workflow list */}
      <div className="flex-1 overflow-y-auto py-1">
        {workflows.map(wf => {
          const usage = diskUsage[wf.id]
          const isActive = currentWorkflowId === wf.id
          return (
            <div key={wf.id}
              onClick={() => handleOpen(wf.id)}
              onContextMenu={e => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenu({ wfId: wf.id, x: e.clientX, y: e.clientY })
              }}
              className={`group flex items-center gap-1.5 px-2.5 py-2 mx-1 rounded-md cursor-pointer text-xs transition-colors
                ${isActive ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
              <div className="flex-1 min-w-0">
                {renamingId === wf.id ? (
                  <input
                    type="text"
                    value={renamingValue}
                    onChange={e => setRenamingValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                    className={`w-full text-xs font-medium bg-transparent border-b outline-none ${
                      renamingValue.trim() && workflows.some(w => w.id !== renamingId && w.name === renamingValue.trim())
                        ? 'border-red-500 text-red-400'
                        : 'border-primary'
                    }`}
                  />
                ) : (
                  <div className="font-medium truncate" onDoubleClick={e => {
                    e.stopPropagation()
                    startRename(wf)
                  }}>{wf.name}</div>
                )}
                <div className="text-[10px] text-muted-foreground/70 flex items-center gap-1.5 mt-0.5">
                  <span>{wf.nodeCount} nodes</span>
                  {usage !== undefined && usage > 0 && (
                    <>
                      <span>·</span>
                      <span className={usage > 100 * 1024 * 1024 ? 'text-orange-400' : ''}>{formatBytes(usage)}</span>
                    </>
                  )}
                </div>
              </div>
              {/* Delete — visible on hover */}
              <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(wf.id) }}
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                title={t('workflow.deleteWorkflow', 'Delete')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          )
        })}
        {workflows.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            {t('workflow.noWorkflowsYet', 'No workflows yet')}
          </div>
        )}
      </div>

      {/* Footer — storage info */}
      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground/60 flex items-center justify-between">
        <span>{formatBytes(totalDiskUsage)}</span>
        <button onClick={() => storageIpc.openArtifactsFolder()} className="hover:text-foreground transition-colors" title={t('workflow.openStorageFolder', 'Open storage folder')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onResizeStart}
        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors ${dragging ? 'bg-primary' : 'hover:bg-primary/50'}`}
      />

      {/* ── Context menu (right-click) ────────────────────────── */}
      {contextMenu && (() => {
        const wf = workflows.find(w => w.id === contextMenu.wfId)
        if (!wf) return null
        const usage = diskUsage[wf.id]
        return (
          <div ref={contextMenuRef}
            className="fixed z-[9999] w-44 rounded-lg border border-border bg-popover shadow-xl py-1 text-xs"
            style={{ left: contextMenu.x, top: contextMenu.y }}>
            {/* Rename */}
            <button
              onClick={() => startRename(wf)}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-accent transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>
              </svg>
              {t('workflow.rename', 'Rename')}
            </button>
            {/* Clean outputs */}
            {usage !== undefined && usage > 0 && (
              <button
                onClick={() => handleCleanOutputs(wf.id)}
                disabled={cleaning === wf.id}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-accent transition-colors text-orange-500 dark:text-orange-400 disabled:opacity-40">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                {cleaning === wf.id ? t('workflow.cleaning', 'Cleaning...') : t('workflow.cleanOutputs', 'Clean outputs')}
                <span className="ml-auto text-[10px] opacity-60">{formatBytes(usage)}</span>
              </button>
            )}
            <div className="border-t border-border my-1" />
            {/* Delete */}
            <button
              onClick={() => { setConfirmDeleteId(wf.id); setContextMenu(null) }}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-accent transition-colors text-red-500 dark:text-red-400">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              {t('workflow.deleteWorkflow', 'Delete')}
            </button>
          </div>
        )
      })()}

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-[340px] rounded-xl border border-border bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">{t('workflow.deleteWorkflow', 'Delete Workflow')}</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {t('workflow.deleteConfirm', { name: workflows.find(w => w.id === confirmDeleteId)?.name, defaultValue: 'Are you sure you want to delete "{{name}}"? This cannot be undone.' })}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">{t('common.cancel', 'Cancel')}</button>
              <button onClick={() => handleDelete(confirmDeleteId)}
                className="px-4 py-1.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors">{t('common.delete', 'Delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
