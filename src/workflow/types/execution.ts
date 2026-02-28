/**
 * Execution types — node execution records, status enums, and progress updates.
 */

export type ExecutionStatus = "pending" | "running" | "success" | "error";

export interface NodeExecutionRecord {
  id: string;
  nodeId: string;
  workflowId: string;
  inputHash: string;
  paramsHash: string;
  status: ExecutionStatus;
  resultPath: string | null;
  resultMetadata: Record<string, unknown> | null;
  durationMs: number | null;
  cost: number;
  createdAt: string;
  score: number | null;
  starred: boolean;
}

export type NodeStatus =
  | "idle"
  | "running"
  | "confirmed"
  | "unconfirmed"
  | "error";
export type EdgeStatus = "no-data" | "has-data";

export interface NodeStatusUpdate {
  workflowId: string;
  nodeId: string;
  status: NodeStatus;
  errorMessage?: string;
}

export interface ProgressUpdate {
  workflowId: string;
  nodeId: string;
  progress: number;
  message?: string;
  previewUrl?: string;
}
