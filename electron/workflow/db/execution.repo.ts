/**
 * Execution record repository — CRUD for node_executions table.
 */
import { getDatabase, persistDatabase } from './connection'
import type { NodeExecutionRecord } from '../../../src/workflow/types/execution'

function rowToRecord(row: unknown[]): NodeExecutionRecord {
  return {
    id: row[0] as string, nodeId: row[1] as string, workflowId: row[2] as string,
    inputHash: row[3] as string, paramsHash: row[4] as string,
    status: row[5] as NodeExecutionRecord['status'],
    resultPath: row[6] as string | null,
    resultMetadata: row[7] ? JSON.parse(row[7] as string) : null,
    durationMs: row[8] as number | null, cost: row[9] as number,
    createdAt: row[10] as string, score: row[11] as number | null,
    starred: (row[12] as number) === 1
  }
}

const EXEC_COLS = 'id, node_id, workflow_id, input_hash, params_hash, status, result_path, result_metadata, duration_ms, cost, created_at, score, starred'

export function insertExecution(record: Omit<NodeExecutionRecord, 'createdAt'>): NodeExecutionRecord {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO node_executions (id, node_id, workflow_id, input_hash, params_hash, status, result_path, result_metadata, duration_ms, cost, created_at, score, starred)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.nodeId, record.workflowId, record.inputHash, record.paramsHash,
     record.status, record.resultPath, record.resultMetadata ? JSON.stringify(record.resultMetadata) : null,
     record.durationMs, record.cost, now, record.score, record.starred ? 1 : 0]
  )
  persistDatabase()
  return { ...record, createdAt: now }
}

export function getExecutionsByNodeId(nodeId: string): NodeExecutionRecord[] {
  const db = getDatabase()
  const result = db.exec(`SELECT ${EXEC_COLS} FROM node_executions WHERE node_id = ? ORDER BY created_at DESC`, [nodeId])
  if (!result.length) return []
  return result[0].values.map(rowToRecord)
}

export function getExecutionById(id: string): NodeExecutionRecord | null {
  const db = getDatabase()
  const result = db.exec(`SELECT ${EXEC_COLS} FROM node_executions WHERE id = ?`, [id])
  if (!result.length || !result[0].values.length) return null
  return rowToRecord(result[0].values[0])
}

export function updateExecutionScore(executionId: string, score: number): void {
  const db = getDatabase()
  db.run('UPDATE node_executions SET score = ? WHERE id = ?', [score, executionId])
  persistDatabase()
}

export function updateExecutionStarred(executionId: string, starred: boolean): void {
  const db = getDatabase()
  db.run('UPDATE node_executions SET starred = ? WHERE id = ?', [starred ? 1 : 0, executionId])
  persistDatabase()
}

export function deleteExecution(executionId: string): void {
  const db = getDatabase()
  db.run('DELETE FROM node_executions WHERE id = ?', [executionId])
  persistDatabase()
}

export function deleteExecutionsByNodeId(nodeId: string): void {
  const db = getDatabase()
  db.run('DELETE FROM node_executions WHERE node_id = ?', [nodeId])
  persistDatabase()
}

export function findByCache(nodeId: string, inputHash: string, paramsHash: string): NodeExecutionRecord | null {
  const db = getDatabase()
  const result = db.exec(
    `SELECT ${EXEC_COLS} FROM node_executions WHERE node_id = ? AND input_hash = ? AND params_hash = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1`,
    [nodeId, inputHash, paramsHash]
  )
  if (!result.length || !result[0].values.length) return null
  return rowToRecord(result[0].values[0])
}
