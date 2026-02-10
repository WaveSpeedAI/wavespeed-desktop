/**
 * Shared constants for workflow module.
 */

import type { NodeStatus, EdgeStatus } from './types/execution'

/** Top status bar color */
export const NODE_STATUS_COLORS: Record<NodeStatus, string> = {
  idle: 'transparent',
  running: '#3B82F6',
  confirmed: '#22C55E',
  unconfirmed: '#F97316',
  error: '#EF4444'
} as const

/** Border CSS class per status */
export const NODE_STATUS_BORDER: Record<NodeStatus, string> = {
  idle: 'border-[hsl(var(--border))]',
  running: 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,.25)]',
  confirmed: 'border-green-500/60',
  unconfirmed: 'border-orange-500/60',
  error: 'border-red-500/60'
} as const

export const EDGE_STATUS_STYLES: Record<EdgeStatus, { strokeDasharray: string; opacity: number }> = {
  'no-data': { strokeDasharray: '5 5', opacity: 0.5 },
  'has-data': { strokeDasharray: 'none', opacity: 1.0 }
} as const

export const DEFAULT_BUDGET = {
  perExecutionLimit: 10.0,
  dailyLimit: 100.0
} as const

export const MAX_RETRIES = 3
export const RETRY_BACKOFF_BASE_MS = 1000
export const MAX_PARALLEL_EXECUTIONS = 5
export const DB_FILENAME = 'workflow.db'
export const ARTIFACTS_DIR = 'workflow-data'
export const WAVESPEED_API_BASE = 'https://api.wavespeed.ai'
export const TASK_TIMEOUT_MS = 30 * 60 * 1000
export const TASK_POLL_INTERVAL_MS = 3000
export const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Default naming template for output files.
 *  Variables: {model}, {node}, {date}, {time}, {index}, {seed}, {workflow}, {ext} */
export const DEFAULT_NAMING_TEMPLATE = '{model}_{date}_{index}.{ext}'
