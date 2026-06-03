import { randomUUID } from 'crypto'
import { getDb } from './Database.js'

export type SessionType = 'chat' | 'project' | 'terminal'

export interface PersistedSession {
  id:         string
  type:       SessionType
  title:      string
  rootPath?:  string
  modelName?: string
  summary?:   string
  createdAt:  string
  updatedAt:  string
}

export interface PersistedMessage {
  id:         string
  sessionId:  string
  role:       'user' | 'assistant' | 'system'
  content:    string
  agentName?: string
  createdAt:  string
}

export function initSessionTables(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      root_path   TEXT,
      model_name  TEXT,
      summary     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      agent_name  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
  `)

  // Clean up garbage sessions left by old title-gen code
  // These have IDs ending in -titlegentmp or titles that are empty / generic
  db.prepare(`
    DELETE FROM sessions
    WHERE id LIKE '%-titlegentmp'
       OR id LIKE '%titlegentmp%'
       OR title = ''
       OR title IS NULL
  `).run()

  const deleted = db.prepare(`
    SELECT changes() as n
  `).get() as any
  if (deleted?.n > 0) {
    console.log(`[DB] Cleaned ${deleted.n} garbage session(s) on startup`)
  }
}

export function upsertSession(s: Omit<PersistedSession, 'createdAt' | 'updatedAt'>): PersistedSession {
  const db  = getDb()
  const now = new Date().toISOString()
  const existing = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(s.id) as any

  if (existing) {
    db.prepare(`UPDATE sessions SET title=?, root_path=?, model_name=?, summary=?, updated_at=? WHERE id=?`)
      .run(s.title, s.rootPath ?? null, s.modelName ?? null, s.summary ?? null, now, s.id)
    return { ...existing, title: s.title, rootPath: s.rootPath, modelName: s.modelName, summary: s.summary, updatedAt: now }
  }

  db.prepare(`INSERT INTO sessions (id, type, title, root_path, model_name, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(s.id, s.type, s.title, s.rootPath ?? null, s.modelName ?? null, s.summary ?? null, now, now)

  return { ...s, createdAt: now, updatedAt: now }
}

export function saveMessage(m: Omit<PersistedMessage, 'createdAt'>): void {
  const db = getDb()
  db.prepare(`INSERT OR IGNORE INTO messages (id, session_id, role, content, agent_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(m.id, m.sessionId, m.role, m.content, m.agentName ?? null, new Date().toISOString())
  db.prepare(`UPDATE sessions SET updated_at=datetime('now') WHERE id=?`).run(m.sessionId)
}

export function getSession(id: string): PersistedSession | null {
  const row = getDb().prepare(`SELECT * FROM sessions WHERE id=?`).get(id) as any
  if (!row) return null
  return { id: row.id, type: row.type, title: row.title, rootPath: row.root_path, modelName: row.model_name, summary: row.summary, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function getAllSessions(): PersistedSession[] {
  return (getDb().prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all() as any[]).map(row => ({
    id: row.id, type: row.type, title: row.title, rootPath: row.root_path,
    modelName: row.model_name, summary: row.summary,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }))
}

export function getSessionMessages(sessionId: string): PersistedMessage[] {
  return (getDb().prepare(`SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC`).all(sessionId) as any[]).map(row => ({
    id: row.id, sessionId: row.session_id, role: row.role,
    content: row.content, agentName: row.agent_name, createdAt: row.created_at,
  }))
}

export function deleteSession(id: string): void {
  getDb().prepare(`DELETE FROM sessions WHERE id=?`).run(id)
}

export function updateSessionSummary(id: string, summary: string): void {
  getDb().prepare(`UPDATE sessions SET summary=?, updated_at=datetime('now') WHERE id=?`).run(summary, id)
}
