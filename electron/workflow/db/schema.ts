/**
 * SQLite database schema definitions and migrations (sql.js version).
 *
 * Uses named migrations instead of sequential version numbers to avoid
 * conflicts when multiple branches define migrations independently.
 * Each migration has a unique string ID and an idempotent apply function.
 */

import type { Database as SqlJsDatabase } from "sql.js";

const DEFAULT_PER_EXECUTION_LIMIT = 10.0;
const DEFAULT_DAILY_LIMIT = 100.0;

/** Map old numeric versions to the named migration IDs they correspond to. */
const LEGACY_VERSION_MAP: Record<number, string[]> = {
  1: ["001_initial_schema"],
  2: ["001_initial_schema", "002_add_templates"],
  3: ["001_initial_schema", "002_add_templates"],
};

interface NamedMigration {
  id: string;
  apply: (db: SqlJsDatabase) => void;
}

/**
 * All migrations in order. Each `apply` MUST be idempotent so that
 * re-running a migration on a database that already has the change
 * is safe (e.g. use IF NOT EXISTS, check columns before ALTER).
 */
const migrations: NamedMigration[] = [
  {
    id: "001_initial_schema",
    apply: (_db: SqlJsDatabase) => {
      // Handled by initializeSchema — listed here for completeness.
    },
  },
  {
    id: "002_add_templates",
    apply: (db: SqlJsDatabase) => {
      console.log("[Schema] Applying migration: 002_add_templates");
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
      )`);

      db.run(
        "CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type)",
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_templates_template_type ON templates(template_type)",
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_templates_favorite ON templates(is_favorite)",
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_templates_created ON templates(created_at DESC)",
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_templates_use_count ON templates(use_count DESC)",
      );
    },
  },
  {
    id: "003_add_search_text",
    apply: (db: SqlJsDatabase) => {
      console.log("[Schema] Applying migration: 003_add_search_text");
      const cols = db.exec("PRAGMA table_info(templates)");
      const hasColumn = cols[0]?.values?.some(
        (row) => row[1] === "search_text",
      );
      if (!hasColumn) {
        db.run("ALTER TABLE templates ADD COLUMN search_text TEXT");
      }
    },
  },
];

export function initializeSchema(db: SqlJsDatabase): void {
  // Use the new named migrations table from the start
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    graph_definition TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    current_output_id TEXT,
    FOREIGN KEY (current_output_id) REFERENCES node_executions(id) ON DELETE SET NULL
  )`);

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
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    source_output_key TEXT NOT NULL,
    target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_input_key TEXT NOT NULL,
    UNIQUE(source_node_id, source_output_key, target_node_id, target_input_key)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS budget_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    per_execution_limit REAL NOT NULL DEFAULT ${DEFAULT_PER_EXECUTION_LIMIT},
    daily_limit REAL NOT NULL DEFAULT ${DEFAULT_DAILY_LIMIT}
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS daily_spend (
    date TEXT PRIMARY KEY,
    total_cost REAL NOT NULL DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    wavespeed_key TEXT,
    llm_key TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

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
    workflow_data TEXT,
    search_text TEXT
  )`);

  // Indexes
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_wf_nodes_workflow ON nodes(workflow_id)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_wf_edges_workflow ON edges(workflow_id)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_wf_executions_node ON node_executions(node_id)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_wf_executions_workflow ON node_executions(workflow_id)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_wf_executions_created ON node_executions(created_at DESC)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_wf_executions_cache ON node_executions(node_id, input_hash, params_hash, status)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_wf_edges_source ON edges(source_node_id)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_wf_edges_target ON edges(target_node_id)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_wf_daily_spend_date ON daily_spend(date)",
  );
  db.run("CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type)");
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_templates_template_type ON templates(template_type)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_templates_favorite ON templates(is_favorite)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_templates_created ON templates(created_at DESC)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_templates_use_count ON templates(use_count DESC)",
  );

  // Default config
  db.run(
    "INSERT OR IGNORE INTO budget_config (id, per_execution_limit, daily_limit) VALUES (1, ?, ?)",
    [DEFAULT_PER_EXECUTION_LIMIT, DEFAULT_DAILY_LIMIT],
  );
  db.run(
    "INSERT OR IGNORE INTO api_keys (id, wavespeed_key, llm_key) VALUES (1, NULL, NULL)",
  );

  // Mark all migrations as applied for a fresh database
  for (const m of migrations) {
    db.run("INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)", [m.id]);
  }
}

export function runMigrations(db: SqlJsDatabase): void {
  // --- Step 1: Detect and upgrade from legacy numeric schema_version ---
  const tables = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('schema_version', 'schema_migrations')",
  );
  const tableNames = tables[0]?.values?.map((r) => r[0] as string) ?? [];
  const hasLegacyTable = tableNames.includes("schema_version");
  const hasNewTable = tableNames.includes("schema_migrations");

  if (hasLegacyTable && !hasNewTable) {
    // Migrate from old numeric system to named migrations
    console.log(
      "[Schema] Upgrading from legacy schema_version to named migrations",
    );

    const result = db.exec(
      "SELECT MAX(version) as version FROM schema_version",
    );
    const legacyVersion = (result[0]?.values?.[0]?.[0] as number) ?? 0;

    // Create the new table
    db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    // Map old version number to known migration IDs
    const knownApplied = LEGACY_VERSION_MAP[legacyVersion] ?? [
      "001_initial_schema",
    ];
    for (const id of knownApplied) {
      db.run("INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)", [id]);
    }

    // Drop the old table
    db.run("DROP TABLE IF EXISTS schema_version");
  }

  if (!hasLegacyTable && !hasNewTable) {
    // No migration tracking at all — treat as version 1 (initial schema exists)
    db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.run("INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)", [
      "001_initial_schema",
    ]);
  }

  // --- Step 2: Run any missing migrations ---
  const applied = db.exec("SELECT id FROM schema_migrations");
  const appliedSet = new Set(
    applied[0]?.values?.map((r) => r[0] as string) ?? [],
  );

  for (const m of migrations) {
    if (!appliedSet.has(m.id)) {
      console.log(`[Schema] Running migration: ${m.id}`);
      m.apply(db);
      db.run("INSERT INTO schema_migrations (id) VALUES (?)", [m.id]);
    }
  }
}
