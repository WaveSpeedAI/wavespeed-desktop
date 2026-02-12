/**
 * Workflow list — create, open, delete workflows.
 * Includes storage space visualization (Opt 15) with clean outputs button.
 */
import { useEffect, useState } from 'react'
import { workflowIpc, storageIpc } from '../ipc/ipc-client'
import { useWorkflowStore } from '../stores/workflow.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { WorkflowSummary } from '@/workflow/types/ipc'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`
}

interface WorkflowListProps {
  onClose: () => void
  onOpen?: (id: string) => Promise<void>
}

export function WorkflowList({ onClose, onOpen }: WorkflowListProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [diskUsage, setDiskUsage] = useState<Record<string, number>>({})
  const [newName, setNewName] = useState('')
  const [cleaning, setCleaning] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const { loadWorkflow, newWorkflow } = useWorkflowStore()

  const refresh = () => {
    workflowIpc.list().then(list => {
      setWorkflows(list ?? [])
      // Fetch disk usage for each workflow
      ;(list ?? []).forEach(wf => {
        storageIpc.getWorkflowDiskUsage(wf.id).then(size => {
          setDiskUsage(prev => ({ ...prev, [wf.id]: size }))
        }).catch(() => {})
      })
    }).catch(() => {})
  }
  useEffect(() => { refresh() }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await newWorkflow(newName.trim())
    setNewName(''); onClose()
  }

  const handleOpen = async (id: string) => {
    if (onOpen) {
      await onOpen(id)
    } else {
      await loadWorkflow(id)
      onClose()
    }
  }

  const handleDelete = async (id: string) => {
    await workflowIpc.delete(id)
    await storageIpc.deleteWorkflowFiles(id).catch(() => {})
    refresh()
  }

  const startRename = (wf: WorkflowSummary) => {
    setRenamingId(wf.id)
    setRenamingValue(wf.name)
  }

  const commitRename = async () => {
    if (!renamingId) return
    const trimmed = renamingValue.trim()
    if (!trimmed) {
      setRenamingId(null)
      return
    }
    await workflowIpc.rename(renamingId, trimmed)
    // If this workflow is currently active in the store, update its name too
    const currentId = useWorkflowStore.getState().workflowId
    if (currentId === renamingId) {
      useWorkflowStore.getState().setWorkflowName(trimmed)
    }
    setRenamingId(null)
    refresh()
  }

  const handleCleanOutputs = async (id: string) => {
    setCleaning(id)
    try {
      await storageIpc.cleanWorkflowOutputs(id)
      // Refresh disk usage
      const size = await storageIpc.getWorkflowDiskUsage(id)
      setDiskUsage(prev => ({ ...prev, [id]: size }))
    } catch (err) {
      console.error('Clean failed:', err)
    }
    setCleaning(null)
  }

  const totalDiskUsage = Object.values(diskUsage).reduce((sum, v) => sum + v, 0)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[480px] max-h-[70vh] rounded-xl border border-border bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-semibold">Workflows</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">✕</button>
        </div>

        <div className="flex gap-2 mb-4">
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New workflow name"
            onKeyDown={e => e.key === 'Enter' && handleCreate()} className="flex-1 h-8 text-xs" />
          <Button variant="outline" size="sm" onClick={handleCreate}>Create</Button>
        </div>

        <ScrollArea className="max-h-[400px]">
          {workflows.map(wf => {
            const usage = diskUsage[wf.id]
            return (
              <div key={wf.id} className="flex justify-between items-start py-2.5 border-b border-border gap-2">
                <div className="flex-1 min-w-0">
                  {renamingId === wf.id ? (
                    <input
                      type="text"
                      value={renamingValue}
                      onChange={e => setRenamingValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      autoFocus
                      className="w-full font-semibold text-sm bg-transparent border-b border-primary outline-none"
                    />
                  ) : (
                    <div className="font-semibold text-sm truncate cursor-pointer" onDoubleClick={() => startRename(wf)}>{wf.name}</div>
                  )}
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                    <span>{wf.nodeCount} nodes</span>
                    <span>·</span>
                    <span>{wf.status}</span>
                    {usage !== undefined && (
                      <>
                        <span>·</span>
                        <span className={usage > 100 * 1024 * 1024 ? 'text-orange-400' : ''}>{formatBytes(usage)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleOpen(wf.id)}>Open</Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => startRename(wf)}>Rename</Button>
                  {usage !== undefined && usage > 0 && (
                    <Button variant="outline" size="sm" className="h-7 text-[10px] text-orange-400" disabled={cleaning === wf.id}
                      onClick={() => handleCleanOutputs(wf.id)}>
                      {cleaning === wf.id ? '...' : 'Clean'}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-xs text-destructive" onClick={() => handleDelete(wf.id)}>Delete</Button>
                </div>
              </div>
            )
          })}
          {workflows.length === 0 && <p className="text-muted-foreground text-sm py-4 text-center">No workflows yet</p>}
        </ScrollArea>

        {/* Total storage — always show open folder button */}
        <div className="mt-3 pt-2 border-t border-border text-[11px] text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Storage: <span className="font-medium text-foreground">{formatBytes(totalDiskUsage)}</span></span>
            <button onClick={() => storageIpc.openArtifactsFolder()} className="underline hover:text-foreground">
              Open storage folder
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
