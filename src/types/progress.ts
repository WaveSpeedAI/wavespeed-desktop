export type PhaseStatus = 'pending' | 'active' | 'completed' | 'error'

export interface ProgressDetail {
  current?: number
  total?: number
  unit?: 'bytes' | 'frames' | 'percent' | 'steps' | 'seconds'
}

export interface ProcessingPhase {
  id: string
  labelKey: string
  weight: number // Relative weight for overall progress (0-1)
  progress: number // 0-100 within phase
  status: PhaseStatus
  detail?: ProgressDetail
}

export interface MultiPhaseProgress {
  phases: ProcessingPhase[]
  currentPhaseIndex: number
  overallProgress: number
  startTime: number | null
  eta: string | null
  isActive: boolean
}

export interface PhaseConfig {
  id: string
  labelKey: string
  weight: number
}

export interface StandardProgressPayload {
  phase: string
  progress: number
  detail?: ProgressDetail
}

// Helper to format bytes for display
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// Helper to format time for display
export function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`
  }
  const mins = Math.floor(seconds / 60)
  const secs = Math.ceil(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}
