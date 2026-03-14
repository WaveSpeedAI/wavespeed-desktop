/**
 * Iteration state repository — CRUD for workflow_iterations table.
 * Manages batch processing state for workflows with iterator nodes.
 */
import { getDatabase, persistDatabase } from "./connection";

export interface IterationState {
  workflowId: string;
  currentIndex: number;
  totalItems: number;
  iterationData: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToState(row: unknown[]): IterationState {
  return {
    workflowId: row[0] as string,
    currentIndex: row[1] as number,
    totalItems: row[2] as number,
    iterationData: JSON.parse(row[3] as string) as string[],
    isActive: (row[4] as number) === 1,
    createdAt: row[5] as string,
    updatedAt: row[6] as string,
  };
}

export function getIterationState(workflowId: string): IterationState | null {
  const db = getDatabase();
  const result = db.exec(
    `SELECT workflow_id, current_index, total_items, iteration_data, is_active, created_at, updated_at 
     FROM workflow_iterations 
     WHERE workflow_id = ?`,
    [workflowId],
  );
  if (!result.length || !result[0].values.length) return null;
  return rowToState(result[0].values[0]);
}

export function initIterationState(
  workflowId: string,
  items: string[],
): IterationState {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.run(
    `INSERT OR REPLACE INTO workflow_iterations 
     (workflow_id, current_index, total_items, iteration_data, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [workflowId, 0, items.length, JSON.stringify(items), 1, now, now],
  );
  persistDatabase();

  return {
    workflowId,
    currentIndex: 0,
    totalItems: items.length,
    iterationData: items,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function advanceIteration(workflowId: string): boolean {
  const state = getIterationState(workflowId);
  if (!state) return false;

  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.totalItems) {
    return false;
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  db.run(
    `UPDATE workflow_iterations 
     SET current_index = ?, updated_at = ? 
     WHERE workflow_id = ?`,
    [nextIndex, now, workflowId],
  );
  persistDatabase();

  return true;
}

export function resetIteration(workflowId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.run(
    `UPDATE workflow_iterations 
     SET current_index = 0, updated_at = ? 
     WHERE workflow_id = ?`,
    [now, workflowId],
  );
  persistDatabase();
}

export function setIterationActive(
  workflowId: string,
  isActive: boolean,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.run(
    `UPDATE workflow_iterations 
     SET is_active = ?, updated_at = ? 
     WHERE workflow_id = ?`,
    [isActive ? 1 : 0, now, workflowId],
  );
  persistDatabase();
}

export function clearIterationState(workflowId: string): void {
  const db = getDatabase();
  db.run("DELETE FROM workflow_iterations WHERE workflow_id = ?", [workflowId]);
  persistDatabase();
}

export function getAllActiveIterations(): IterationState[] {
  const db = getDatabase();
  const result = db.exec(
    `SELECT workflow_id, current_index, total_items, iteration_data, is_active, created_at, updated_at 
     FROM workflow_iterations 
     WHERE is_active = 1`,
  );
  if (!result.length) return [];
  return result[0].values.map(rowToState);
}
