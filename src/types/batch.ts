import type { PredictionResult } from "./prediction";

export interface BatchConfig {
  enabled: boolean;
  repeatCount: number; // 2-16
  randomizeSeed: boolean; // Auto-randomize seed for each run
  stopOnError: boolean; // Stop batch on first error or continue
}

export interface BatchQueueItem {
  id: string;
  index: number;
  input: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result?: PredictionResult;
  error?: string;
}

export interface BatchState {
  isRunning: boolean;
  queue: BatchQueueItem[];
  currentIndex: number;
  completedCount: number;
  failedCount: number;
  cancelRequested: boolean;
}

export interface BatchResult {
  id: string;
  index: number;
  input: Record<string, unknown>;
  prediction: PredictionResult | null;
  outputs: (string | Record<string, unknown>)[];
  error: string | null;
  timing?: number;
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  enabled: false,
  repeatCount: 4,
  randomizeSeed: true,
  stopOnError: false,
};
