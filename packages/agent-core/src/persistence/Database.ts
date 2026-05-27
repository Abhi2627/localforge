import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import os from 'os'

const DB_DIR = path.join(os.homedir(), '.localforge')
const DB_PATH = path.join(DB_DIR, 'tasks.db')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true })
  }

  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const integrity = db.pragma('integrity_check', { simple: true })
  if (integrity !== 'ok') {
    console.warn('[DB] Integrity check failed — rebuilding database from scratch')
    db.close()
    fs.renameSync(DB_PATH, DB_PATH + '.corrupt.' + Date.now())
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  }

  runMigrations(db)
  return db
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      root_path   TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id),
      name        TEXT NOT NULL,
      role        TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id),
      agent_id      TEXT NOT NULL REFERENCES agents(id),
      action_type   TEXT NOT NULL,
      target_file   TEXT,
      instruction   TEXT NOT NULL,
      result        TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS file_snapshots (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id),
      file_path   TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      written_by  TEXT NOT NULL,
      written_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS knowledge_graph (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id),
      symbol_name TEXT NOT NULL,
      symbol_type TEXT NOT NULL,
      file_path   TEXT NOT NULL,
      signature   TEXT,
      written_by  TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project   ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_snapshots_file  ON file_snapshots(project_id, file_path);
    CREATE INDEX IF NOT EXISTS idx_kg_project      ON knowledge_graph(project_id);
  `)
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
