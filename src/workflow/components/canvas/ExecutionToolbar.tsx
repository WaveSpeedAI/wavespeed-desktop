/**
 * Execution control toolbar — Run All, Run Node, Continue From, Retry, Cancel.
 * Includes real-time cost estimate (Opt 10, 22) and daily budget display.
 */
import { useEffect, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkflowStore } from '../../stores/workflow.store'
import { useExecutionStore } from '../../stores/execution.store'
import { useUIStore } from '../../stores/ui.store'
import { costIpc } from '../../ipc/ipc-client'

export function ExecutionToolbar() {
  const workflowId = useWorkflowStore(s => s.workflowId)
  const nodes = useWorkflowStore(s => s.nodes)
  const saveWorkflow = useWorkflowStore(s => s.saveWorkflow)
  const selectedNodeId = useUIStore(s => s.selectedNodeId)
  const { runAll, runNode, continueFrom, retryNode, cancelNode, activeExecutions } = useExecutionStore()
  const isRunning = activeExecutions.size > 0

  // Helper: ensure workflow exists before running
  const ensureWorkflow = async (): Promise<string | null> => {
    if (workflowId) return workflowId
    if (nodes.length === 0) return null
    await saveWorkflow()
    return useWorkflowStore.getState().workflowId
  }

  // Opt 10/22: Cost estimate
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null)
  const [dailySpend, setDailySpend] = useState<number>(0)
  const [dailyLimit, setDailyLimit] = useState<number>(100)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Fetch cost estimate when nodes/params change
  useEffect(() => {
    if (!workflowId || nodes.length === 0) {
      setEstimatedCost(null)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const nodeIds = nodes.map(n => n.id)
        const est = await costIpc.estimate(workflowId, nodeIds)
        setEstimatedCost(est.totalEstimated)
      } catch { setEstimatedCost(null) }
    }, 800)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [workflowId, nodes])

  // Fetch daily spend and limit
  useEffect(() => {
    if (!workflowId) return
    costIpc.getDailySpend().then(setDailySpend).catch(() => {})
    costIpc.getBudget().then(b => setDailyLimit(b.dailyLimit)).catch(() => {})
  }, [workflowId])

  // Refresh daily spend after executions finish
  useEffect(() => {
    if (!isRunning && workflowId) {
      costIpc.getDailySpend().then(setDailySpend).catch(() => {})
    }
  }, [isRunning, workflowId])

  const spendPercent = dailyLimit > 0 ? (dailySpend / dailyLimit) * 100 : 0
  const spendColor = spendPercent > 80 ? 'text-red-400' : spendPercent > 50 ? 'text-orange-400' : 'text-green-400'

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-card">
      <Button variant="outline" size="sm" disabled={nodes.length === 0}
        onClick={async () => { const id = await ensureWorkflow(); if (id) runAll(id) }}>
        ▶ Run All
      </Button>
      <Button variant="outline" size="sm" disabled={nodes.length === 0 || !selectedNodeId}
        onClick={async () => { const id = await ensureWorkflow(); if (id && selectedNodeId) runNode(id, selectedNodeId) }}>
        ▶ Run Node
      </Button>
      <Button variant="outline" size="sm" disabled={nodes.length === 0 || !selectedNodeId}
        onClick={async () => { const id = await ensureWorkflow(); if (id && selectedNodeId) continueFrom(id, selectedNodeId) }}>
        ⏩ Continue
      </Button>
      <Button variant="outline" size="sm" disabled={nodes.length === 0 || !selectedNodeId}
        onClick={async () => { const id = await ensureWorkflow(); if (id && selectedNodeId) retryNode(id, selectedNodeId) }}>
        🔄 Retry
      </Button>
      {isRunning && selectedNodeId && (
        <Button variant="destructive" size="sm"
          onClick={() => workflowId && selectedNodeId && cancelNode(workflowId, selectedNodeId)}>
          ⏹ Cancel
        </Button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Cost estimate (Opt 22) */}
      {estimatedCost !== null && estimatedCost > 0 && (
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] px-2 py-0.5 rounded bg-[hsl(var(--muted))]">
          Cost <span className="font-semibold text-blue-400">${estimatedCost.toFixed(4)}</span>
        </span>
      )}

      {/* Daily budget (Opt 22) */}
      {workflowId && (
        <span className={`text-[11px] px-2 py-0.5 rounded bg-[hsl(var(--muted))] ${spendColor}`}>
          Daily: ${dailySpend.toFixed(2)} / ${dailyLimit.toFixed(0)}
        </span>
      )}
    </div>
  )
}
