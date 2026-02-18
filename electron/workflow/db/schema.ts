/**
 * SQLite database schema definitions and migrations (sql.js version).
 */

import type { Database as SqlJsDatabase } from 'sql.js'

const DEFAULT_PER_EXECUTION_LIMIT = 10.0
const DEFAULT_DAILY_LIMIT = 100.0

export function initializeSchema(db: SqlJsDatabase): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    graph_definition TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    current_output_id TEXT,
    FOREIGN KEY (current_output_id) REFERENCES node_executions(id) ON DELETE SET NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS node_executions (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    input_hash TEXT NOT NULL,
    params_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'error')),
    result_path TEXT,
    result_metadata TEXT,
    duration_ms INTEGER,
    cost REAL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    score REAL,
    starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    source_output_key TEXT NOT NULL,
    target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_input_key TEXT NOT NULL,
    UNIQUE(source_node_id, source_output_key, target_node_id, target_input_key)
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS budget_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    per_execution_limit REAL NOT NULL DEFAULT ${DEFAULT_PER_EXECUTION_LIMIT},
    daily_limit REAL NOT NULL DEFAULT ${DEFAULT_DAILY_LIMIT}
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS daily_spend (
    date TEXT PRIMARY KEY,
    total_cost REAL NOT NULL DEFAULT 0
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    wavespeed_key TEXT,
    llm_key TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    type TEXT NOT NULL CHECK (type IN ('public', 'custom')),
    template_type TEXT NOT NULL CHECK (template_type IN ('playground', 'workflow')),
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    author TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    thumbnail TEXT,
    playground_data TEXT,
    workflow_data TEXT
  )`)

  // Indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_wf_nodes_workflow ON nodes(workflow_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_wf_edges_workflow ON edges(workflow_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_wf_executions_node ON node_executions(node_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_wf_executions_workflow ON node_executions(workflow_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_wf_executions_created ON node_executions(created_at DESC)')
  db.run('CREATE INDEX IF NOT EXISTS idx_wf_executions_cache ON node_executions(node_id, input_hash, params_hash, status)')
  db.run('CREATE INDEX IF NOT EXISTS idx_wf_edges_source ON edges(source_node_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_wf_edges_target ON edges(target_node_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_wf_daily_spend_date ON daily_spend(date)')
  db.run('CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type)')
  db.run('CREATE INDEX IF NOT EXISTS idx_templates_template_type ON templates(template_type)')
  db.run('CREATE INDEX IF NOT EXISTS idx_templates_favorite ON templates(is_favorite)')
  db.run('CREATE INDEX IF NOT EXISTS idx_templates_created ON templates(created_at DESC)')
  db.run('CREATE INDEX IF NOT EXISTS idx_templates_use_count ON templates(use_count DESC)')

  // Default config
  db.run('INSERT OR IGNORE INTO budget_config (id, per_execution_limit, daily_limit) VALUES (1, ?, ?)',
    [DEFAULT_PER_EXECUTION_LIMIT, DEFAULT_DAILY_LIMIT])
  db.run('INSERT OR IGNORE INTO api_keys (id, wavespeed_key, llm_key) VALUES (1, NULL, NULL)')
  db.run('INSERT OR IGNORE INTO schema_version (version) VALUES (1)')
}

export function runMigrations(db: SqlJsDatabase): void {
  const result = db.exec('SELECT MAX(version) as version FROM schema_version')
  const currentVersion = (result[0]?.values?.[0]?.[0] as number) ?? 0

  const migrations: Array<{ version: number; apply: (db: SqlJsDatabase) => void }> = [
    // Migration 2: Add templates table
    {
      version: 2,
      apply: (db: SqlJsDatabase) => {
        console.log('[Schema] Applying migration 2: Add templates table')
        
        db.run(`CREATE TABLE IF NOT EXISTS templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          tags TEXT,
          type TEXT NOT NULL CHECK (type IN ('public', 'custom')),
          template_type TEXT NOT NULL CHECK (template_type IN ('playground', 'workflow')),
          is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          author TEXT,
          use_count INTEGER NOT NULL DEFAULT 0,
          thumbnail TEXT,
          playground_data TEXT,
          workflow_data TEXT
        )`)
        
        db.run('CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type)')
        db.run('CREATE INDEX IF NOT EXISTS idx_templates_template_type ON templates(template_type)')
        db.run('CREATE INDEX IF NOT EXISTS idx_templates_favorite ON templates(is_favorite)')
        db.run('CREATE INDEX IF NOT EXISTS idx_templates_created ON templates(created_at DESC)')
        db.run('CREATE INDEX IF NOT EXISTS idx_templates_use_count ON templates(use_count DESC)')
        
        db.run('INSERT INTO schema_version (version) VALUES (2)')
      }
    }
  ]

  for (const m of migrations) {
    if (m.version > currentVersion) {
      m.apply(db)
    }
  }
}
