/**
 * SQLite database connection management using sql.js (WASM-based).
 */

import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { app } from "electron";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "fs";
import { dirname } from "path";
import { initializeSchema, runMigrations } from "./schema";

const DB_FILENAME = "workflow.db";

let db: SqlJsDatabase | null = null;
let dbPath: string = "";

function getWorkflowDataRoot(): string {
  // Packaged app runs from app.asar (read-only). Persist workflow data in userData.
  if (app.isPackaged) {
    return join(app.getPath("userData"), "workflow-data");
  }
  // In dev mode keep current behavior for easier local inspection.
  return join(app.getAppPath(), "workflow-data");
}

export type { SqlJsDatabase };

export function getDatabasePath(): string {
  if (!dbPath) {
    try {
      dbPath = join(getWorkflowDataRoot(), DB_FILENAME);
    } catch {
      dbPath = join(process.cwd(), "workflow-data", DB_FILENAME);
    }
  }
  return dbPath;
}

function saveToDisk(): void {
  if (!db) return;
  const filePath = getDatabasePath();
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(filePath, buffer);
}

export async function openDatabase(): Promise<SqlJsDatabase> {
  if (db) return db;

  const SQL = await initSqlJs();
  const filePath = getDatabasePath();
  const dbExists = existsSync(filePath);
  let isCorrupt = false;

  if (dbExists) {
    try {
      const fileBuffer = readFileSync(filePath);
      db = new SQL.Database(fileBuffer);
      const result = db.exec("PRAGMA integrity_check");
      const ok = result[0]?.values?.[0]?.[0];
      if (ok !== "ok") throw new Error("integrity_check failed");
    } catch (error) {
      console.error("[Workflow DB] Database corrupt or unreadable:", error);
      isCorrupt = true;
      if (db) {
        db.close();
        db = null;
      }
      const backupPath = `${filePath}.corrupt.${Date.now()}`;
      renameSync(filePath, backupPath);
      console.warn(
        `[Workflow DB] Corrupt database backed up to: ${backupPath}`,
      );
    }
  }

  if (!db) {
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys = ON");

  if (!dbExists || isCorrupt) {
    initializeSchema(db);
    saveToDisk();
  } else {
    runMigrations(db);
    saveToDisk(); // Save after running migrations
  }

  return db;
}

export function getDatabase(): SqlJsDatabase {
  if (!db)
    throw new Error(
      "[Workflow DB] Database not initialized. Call openDatabase() first.",
    );
  return db;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persist — batches rapid writes into a single disk flush (max 500ms delay) */
export function persistDatabase(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveToDisk();
  }, 500);
}

/** Immediate persist — for critical moments like close/shutdown */
export function persistDatabaseNow(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  saveToDisk();
}

export function closeDatabase(): void {
  if (db) {
    try {
      persistDatabaseNow();
      db.close();
    } catch (error) {
      console.error("[Workflow DB] Error closing database:", error);
    } finally {
      db = null;
    }
  }
}

export function transaction<T>(fn: (db: SqlJsDatabase) => T): T {
  const database = getDatabase();
  database.run("BEGIN TRANSACTION");
  try {
    const result = fn(database);
    database.run("COMMIT");
    saveToDisk();
    return result;
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
}
