/**
 * Edge repository — CRUD operations for edges table.
 */
import { getDatabase, persistDatabase } from "./connection";
import type { WorkflowEdge } from "../../../src/workflow/types/workflow";

function rowToEdge(row: unknown[]): WorkflowEdge {
  return {
    id: row[0] as string,
    workflowId: row[1] as string,
    sourceNodeId: row[2] as string,
    sourceOutputKey: row[3] as string,
    targetNodeId: row[4] as string,
    targetInputKey: row[5] as string,
  };
}

const EDGE_COLS =
  "id, workflow_id, source_node_id, source_output_key, target_node_id, target_input_key";

export function getEdgesByWorkflowId(workflowId: string): WorkflowEdge[] {
  const db = getDatabase();
  const result = db.exec(
    `SELECT ${EDGE_COLS} FROM edges WHERE workflow_id = ?`,
    [workflowId],
  );
  if (!result.length) return [];
  return result[0].values.map(rowToEdge);
}

export function getEdgesBySourceNode(sourceNodeId: string): WorkflowEdge[] {
  const db = getDatabase();
  const result = db.exec(
    `SELECT ${EDGE_COLS} FROM edges WHERE source_node_id = ?`,
    [sourceNodeId],
  );
  if (!result.length) return [];
  return result[0].values.map(rowToEdge);
}

export function deleteEdge(edgeId: string): void {
  const db = getDatabase();
  db.run("DELETE FROM edges WHERE id = ?", [edgeId]);
  persistDatabase();
}
