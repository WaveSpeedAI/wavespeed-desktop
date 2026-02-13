/**
 * Workflow repository — CRUD operations for workflows table.
 */
import { v4 as uuid } from 'uuid'
import { getDatabase, persistDatabase } from './connection'
import { getFileStorageInstance } from '../utils/file-storage'
import type { Workflow, GraphDefinition } from '../../../src/workflow/types/workflow'

function getFileStorage() { return getFileStorageInstance() }

/**
 * Ensure a workflow name is unique across all workflows.
 * If a collision is found (excluding the workflow with `excludeId`),
 * appends (2), (3), etc. until unique.
 */
function ensureUniqueName(db: ReturnType<typeof getDatabase>, name: string, excludeId: string | null): string {
  const trimmed = name.trim() || 'Untitled Workflow'
  const existingNames = new Set<string>()
  const result = excludeId
    ? db.exec('SELECT name FROM workflows WHERE id != ?', [excludeId])
    : db.exec('SELECT name FROM workflows')
  if (result.length > 0) {
    for (const row of result[0].values) {
      existingNames.add(row[0] as string)
    }
  }

  if (!existingNames.has(trimmed)) return trimmed

  let counter = 2
  while (existingNames.has(`${trimmed} (${counter})`)) counter++
  return `${trimmed} (${counter})`
}

export function createWorkflow(name: string): Workflow {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  const graphDef: GraphDefinition = { nodes: [], edges: [] }

  // Ensure unique name — append (2), (3), etc. if needed
  const finalName = ensureUniqueName(db, name, null)

  db.run(
    `INSERT INTO workflows (id, name, created_at, updated_at, graph_definition, status) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, finalName, now, now, JSON.stringify(graphDef), 'draft']
  )
  persistDatabase()
  // Also create the workflow directory and initial snapshot on disk
  getFileStorage().saveWorkflowSnapshot(id, finalName, graphDef)
  return { id, name: finalName, createdAt: now, updatedAt: now, graphDefinition: graphDef, status: 'draft' }
}

export function getWorkflowById(id: string): Workflow | null {
  const db = getDatabase()
  const result = db.exec(
    'SELECT id, name, created_at, updated_at, graph_definition, status FROM workflows WHERE id = ?', [id]
  )
  if (!result.length || !result[0].values.length) return null
  const row = result[0].values[0]
  return {
    id: row[0] as string, name: row[1] as string, createdAt: row[2] as string,
    updatedAt: row[3] as string, graphDefinition: JSON.parse(row[4] as string),
    status: row[5] as Workflow['status']
  }
}

export function listWorkflows(): Array<{ id: string; name: string; createdAt: string; updatedAt: string; status: string; nodeCount: number }> {
  const db = getDatabase()
  const result = db.exec(
    `SELECT w.id, w.name, w.created_at, w.updated_at, w.status,
            (SELECT COUNT(*) FROM nodes n WHERE n.workflow_id = w.id) as node_count
     FROM workflows w ORDER BY w.updated_at DESC`
  )
  if (!result.length) return []
  return result[0].values.map(row => ({
    id: row[0] as string, name: row[1] as string, createdAt: row[2] as string,
    updatedAt: row[3] as string, status: row[4] as string, nodeCount: row[5] as number
  }))
}

export function updateWorkflow(id: string, name: string, graphDefinition: GraphDefinition, status?: Workflow['status']): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  // Get old name to detect rename
  const existing = getWorkflowById(id)
  const oldName = existing?.name ?? name

  // Ensure unique name if it changed
  const finalName = (name !== oldName) ? ensureUniqueName(db, name, id) : name

  if (status) {
    db.run('UPDATE workflows SET name = ?, graph_definition = ?, updated_at = ?, status = ? WHERE id = ?',
      [finalName, JSON.stringify(graphDefinition), now, status, id])
  } else {
    db.run('UPDATE workflows SET name = ?, graph_definition = ?, updated_at = ? WHERE id = ?',
      [finalName, JSON.stringify(graphDefinition), now, id])
  }
  // Preserve existing currentOutputId for nodes that already have execution results
  const existingOutputIds = new Map<string, string | null>()
  const existingNodes = db.exec('SELECT id, current_output_id FROM nodes WHERE workflow_id = ?', [id])
  if (existingNodes.length > 0) {
    for (const row of existingNodes[0].values) {
      existingOutputIds.set(row[0] as string, row[1] as string | null)
    }
  }

  // Temporarily disable FK checks: DELETE FROM nodes cascades to node_executions,
  // which would destroy execution history. Instead, detach nodes first, then re-insert.
  db.run('PRAGMA foreign_keys = OFF')
  try {
    db.run('DELETE FROM nodes WHERE workflow_id = ?', [id])
    db.run('DELETE FROM edges WHERE workflow_id = ?', [id])
    for (const node of graphDefinition.nodes) {
      // Insert with NULL first (safe), then restore outputId
      db.run(`INSERT INTO nodes (id, workflow_id, node_type, position_x, position_y, params, current_output_id) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        [node.id, id, node.nodeType, node.position.x, node.position.y, JSON.stringify(node.params)])
    }
    for (const edge of graphDefinition.edges) {
      db.run(`INSERT INTO edges (id, workflow_id, source_node_id, source_output_key, target_node_id, target_input_key) VALUES (?, ?, ?, ?, ?, ?)`,
        [edge.id, id, edge.sourceNodeId, edge.sourceOutputKey, edge.targetNodeId, edge.targetInputKey])
    }
    // Restore currentOutputId where the execution record still exists
    for (const node of graphDefinition.nodes) {
      const outputId = node.currentOutputId ?? existingOutputIds.get(node.id) ?? null
      if (outputId) {
        // Only set if the execution record actually exists
        const exists = db.exec('SELECT 1 FROM node_executions WHERE id = ?', [outputId])
        if (exists.length > 0 && exists[0].values.length > 0) {
          db.run('UPDATE nodes SET current_output_id = ? WHERE id = ?', [outputId, node.id])
        }
      }
    }
  } finally {
    db.run('PRAGMA foreign_keys = ON')
  }
  persistDatabase()

  // Rename directory on disk if name changed
  if (finalName !== oldName) {
    getFileStorage().renameWorkflowDir(id, oldName, finalName)
  }
  getFileStorage().saveWorkflowSnapshot(id, finalName, graphDefinition)
}

export function renameWorkflow(id: string, newName: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  // Get old name before rename (needed for directory rename)
  const existing = getWorkflowById(id)
  if (!existing) return

  const oldName = existing.name

  // Ensure unique name — append (2), (3), etc. if collides with another workflow
  const finalName = ensureUniqueName(db, newName, id)

  db.run('UPDATE workflows SET name = ?, updated_at = ? WHERE id = ?', [finalName, now, id])
  persistDatabase()

  // Rename the data directory on disk (handles collision cleanup)
  const fs = getFileStorage()
  fs.renameWorkflowDir(id, oldName, finalName)

  // Update the snapshot file with the new name
  fs.saveWorkflowSnapshot(id, finalName, existing.graphDefinition)
}

export function deleteWorkflow(id: string): void {
  const db = getDatabase()
  db.run('DELETE FROM workflows WHERE id = ?', [id])
  persistDatabase()
  getFileStorage().deleteWorkflowFiles(id)
}
