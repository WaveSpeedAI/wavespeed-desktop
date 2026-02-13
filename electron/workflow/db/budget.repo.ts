/**
 * Budget repository — get/set budget config and daily spend.
 */
import { getDatabase, persistDatabase } from './connection'
import type { BudgetConfig } from '../../../src/workflow/types/ipc'

export function getBudgetConfig(): BudgetConfig {
  const db = getDatabase()
  const result = db.exec('SELECT per_execution_limit, daily_limit FROM budget_config WHERE id = 1')
  if (!result.length || !result[0].values.length) return { perExecutionLimit: 10, dailyLimit: 100 }
  const row = result[0].values[0]
  return { perExecutionLimit: row[0] as number, dailyLimit: row[1] as number }
}

export function setBudgetConfig(config: BudgetConfig): void {
  const db = getDatabase()
  db.run('UPDATE budget_config SET per_execution_limit = ?, daily_limit = ? WHERE id = 1',
    [config.perExecutionLimit, config.dailyLimit])
  persistDatabase()
}

export function getDailySpend(date?: string): number {
  const db = getDatabase()
  const d = date ?? new Date().toISOString().slice(0, 10)
  const result = db.exec('SELECT total_cost FROM daily_spend WHERE date = ?', [d])
  if (!result.length || !result[0].values.length) return 0
  return result[0].values[0][0] as number
}

export function addDailySpend(cost: number, date?: string): void {
  const db = getDatabase()
  const d = date ?? new Date().toISOString().slice(0, 10)
  db.run(`INSERT INTO daily_spend (date, total_cost) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET total_cost = total_cost + ?`,
    [d, cost, cost])
  persistDatabase()
}
