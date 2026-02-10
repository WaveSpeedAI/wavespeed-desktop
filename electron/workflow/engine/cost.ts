/**
 * Cost control service — estimate costs and enforce budgets.
 */
import { getBudgetConfig, setBudgetConfig, getDailySpend, addDailySpend } from '../db/budget.repo'
import type { BudgetConfig, CostEstimate } from '../../../src/workflow/types/ipc'

export class CostService {
  estimate(nodeIds: string[], nodeTypes: Map<string, string>, costPerType: Map<string, number>): CostEstimate {
    const breakdown = nodeIds.map(nodeId => {
      const nodeType = nodeTypes.get(nodeId) ?? 'unknown'
      const estimated = costPerType.get(nodeType) ?? 0
      return { nodeId, nodeType, estimated }
    })
    const totalEstimated = breakdown.reduce((sum, b) => sum + b.estimated, 0)
    const budget = this.getBudget()
    const withinPerExecution = totalEstimated <= budget.perExecutionLimit
    const dailySpend = getDailySpend()
    const withinDaily = (dailySpend + totalEstimated) <= budget.dailyLimit
    const withinBudget = withinPerExecution && withinDaily
    const reason = !withinPerExecution
      ? `Exceeds per-execution limit (${totalEstimated} > ${budget.perExecutionLimit})`
      : !withinDaily ? `Exceeds daily limit (${dailySpend + totalEstimated} > ${budget.dailyLimit})` : undefined
    return { totalEstimated, breakdown, withinBudget, reason }
  }

  recordSpend(cost: number): void { addDailySpend(cost) }
  getBudget(): BudgetConfig { return getBudgetConfig() }
  setBudget(config: BudgetConfig): void { setBudgetConfig(config) }
}
