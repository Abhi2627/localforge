import fs from 'fs'
import crypto from 'crypto'
import { getDb } from './Database.js'
import { getPendingTasks, markTaskDone, type Task } from './TaskLog.js'
import { writeJournal } from './Journal.js'

export interface RecoveryResult {
  recovered: number
  requeued: number
  details: string[]
}

export function computeChecksum(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(content).digest('hex')
  } catch {
    return null
  }
}

export function saveFileSnapshot(
  projectId: string,
  filePath: string,
  writtenBy: string
): void {
  const db = getDb()
  const checksum = computeChecksum(filePath)
  if (!checksum) return

  const id = crypto.randomUUID()
  db.prepare(`
    INSERT OR REPLACE INTO file_snapshots (id, project_id, file_path, checksum, written_by, written_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(id, projectId, filePath, checksum, writtenBy)

  writeJournal({ event: 'FILE_WRITTEN', projectId, filePath, agentId: writtenBy })
}

export function getLastSnapshot(projectId: string, filePath: string) {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM file_snapshots
    WHERE project_id = ? AND file_path = ?
    ORDER BY written_at DESC LIMIT 1
  `).get(projectId, filePath) as { checksum: string; written_by: string } | undefined
}

export function recoverProject(projectId: string): RecoveryResult {
  const result: RecoveryResult = { recovered: 0, requeued: 0, details: [] }

  writeJournal({ event: 'RECOVERY_STARTED', projectId })

  const pendingTasks = getPendingTasks(projectId)

  if (pendingTasks.length === 0) {
    result.details.push('No pending tasks found — project is clean')
    writeJournal({ event: 'RECOVERY_COMPLETED', projectId, detail: 'clean' })
    return result
  }

  for (const task of pendingTasks) {
    const resolution = resolveTask(task, projectId)
    if (resolution === 'done') {
      markTaskDone(task.id, projectId, task.agentId, 'Verified complete via filesystem on recovery')
      result.recovered++
      result.details.push(`✓ Task ${task.id} (${task.targetFile ?? task.actionType}) — verified done from disk`)
    } else {
      result.requeued++
      result.details.push(`↻ Task ${task.id} (${task.targetFile ?? task.actionType}) — will re-execute`)
    }
  }

  writeJournal({
    event: 'RECOVERY_COMPLETED',
    projectId,
    detail: `recovered=${result.recovered} requeued=${result.requeued}`
  })

  return result
}

function resolveTask(task: Task, projectId: string): 'done' | 'requeue' {
  // Only file-writing tasks can be auto-verified from disk
  if (!task.targetFile) return 'requeue'

  const fileExists = fs.existsSync(task.targetFile)
  if (!fileExists) return 'requeue'

  const currentChecksum = computeChecksum(task.targetFile)
  if (!currentChecksum) return 'requeue'

  const snapshot = getLastSnapshot(projectId, task.targetFile)

  // File exists and checksum matches last known state — task completed before crash
  if (snapshot && snapshot.checksum === currentChecksum) return 'done'

  // File exists but no snapshot yet — it was created during this task, likely complete
  if (!snapshot && fileExists) return 'done'

  return 'requeue'
}

export function rebuildSnapshotsFromDisk(projectId: string, rootPath: string): void {
  const db = getDb()
  const files = walkDir(rootPath)
  const agentId = 'recovery'

  for (const filePath of files) {
    const checksum = computeChecksum(filePath)
    if (!checksum) continue
    const id = crypto.randomUUID()
    db.prepare(`
      INSERT OR REPLACE INTO file_snapshots (id, project_id, file_path, checksum, written_by, written_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, projectId, filePath, checksum, agentId)
  }
}

function walkDir(dir: string): string[] {
  const results: string[] = []
  const IGNORE = new Set(['.git', 'node_modules', '.localforge', 'dist', '.next'])

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue
      const fullPath = `${current}/${entry.name}`
      if (entry.isDirectory()) walk(fullPath)
      else results.push(fullPath)
    }
  }

  walk(dir)
  return results
}
