import type { PredictionResult } from './prediction'

export interface BatchConfig {
  enabled: boolean
  repeatCount: number // 2-4 for mobile (limited for performance)
  randomizeSeed: boolean // Auto-randomize seed for each run
  stopOnError: boolean // Stop batch on first error or continue
}

export interface BatchQueueItem {
  id: string
  index: number
  input: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  result?: PredictionResult
  error?: string
}

export interface BatchState {
  isRunning: boolean
  queue: BatchQueueItem[]
  currentIndex: number
  completedCount: number
  failedCount: number
  cancelRequested: boolean
}

export interface BatchResult {
  id: string
  index: number
  input: Record<string, unknown>
  prediction: PredictionResult | null
  outputs: (string | Record<string, unknown>)[]
  error: string | null
  timing?: number
}

// Mobile-specific limits: max 4 repeats to avoid memory issues
export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  enabled: false,
  repeatCount: 2, // Default to 2 for mobile
  randomizeSeed: true,
  stopOnError: false
}

// Mobile batch limits
export const MOBILE_BATCH_LIMITS = {
  minRepeat: 2,
  maxRepeat: 4, // Limited to 4 for mobile (desktop is 16)
}
