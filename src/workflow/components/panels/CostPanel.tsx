/**
 * Cost panel — budget display and configuration.
 * Rewritten with Tailwind + shadcn/ui.
 */
import { useEffect, useState } from 'react'
import { costIpc } from '../../ipc/ipc-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BudgetConfig } from '@/workflow/types/ipc'

export function CostPanel() {
  const [budget, setBudget] = useState<BudgetConfig>({ perExecutionLimit: 10, dailyLimit: 100 })
  const [dailySpend, setDailySpend] = useState(0)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    costIpc.getBudget().then(setBudget).catch(() => {})
    costIpc.getDailySpend().then(setDailySpend).catch(() => {})
  }, [])

  const handleSave = async () => { await costIpc.setBudget(budget); setEditing(false) }

  return (
    <div className="p-3">
      <h3 className="text-sm font-semibold mb-3">Cost Control</h3>
      <p className="text-[11px] text-muted-foreground mb-3">
        Estimates use model base prices; actual API cost may vary with inputs (resolution, length, etc.).
      </p>
      <div className="mb-3">
        <div className="text-xs text-muted-foreground">Daily Spend</div>
        <div className={`text-lg font-bold ${dailySpend > budget.dailyLimit * 0.8 ? 'text-destructive' : 'text-green-400'}`}>
          ${dailySpend.toFixed(2)} / ${budget.dailyLimit.toFixed(2)}
        </div>
      </div>
      <div className="mb-3">
        <div className="text-xs text-muted-foreground">Per-Execution Limit</div>
        {editing ? (
          <Input type="number" step={0.5} min={0} value={budget.perExecutionLimit}
            onChange={e => setBudget(b => ({ ...b, perExecutionLimit: Number(e.target.value) }))} className="h-8 text-xs" />
        ) : (
          <div className="text-sm">${budget.perExecutionLimit.toFixed(2)}</div>
        )}
      </div>
      <div className="mb-3">
        <div className="text-xs text-muted-foreground">Daily Limit</div>
        {editing ? (
          <Input type="number" step={1} min={0} value={budget.dailyLimit}
            onChange={e => setBudget(b => ({ ...b, dailyLimit: Number(e.target.value) }))} className="h-8 text-xs" />
        ) : (
          <div className="text-sm">${budget.dailyLimit.toFixed(2)}</div>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={editing ? handleSave : () => setEditing(true)}>
        {editing ? 'Save' : 'Edit Budget'}
      </Button>
    </div>
  )
}
