import fs from 'fs'
import path from 'path'
import os from 'os'

const JOURNAL_DIR = path.join(os.homedir(), '.localforge')
const JOURNAL_PATH = path.join(JOURNAL_DIR, 'journal.log')

export type JournalEvent =
  | 'TASK_CREATED'
  | 'TASK_STARTED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'FILE_WRITTEN'
  | 'AGENT_STARTED'
  | 'AGENT_STOPPED'
  | 'PROJECT_CREATED'
  | 'RECOVERY_STARTED'
  | 'RECOVERY_COMPLETED'

export interface JournalEntry {
  ts: string
  event: JournalEvent
  projectId: string
  taskId?: string
  agentId?: string
  filePath?: string
  detail?: string
}

export function writeJournal(entry: Omit<JournalEntry, 'ts'>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
  try {
    fs.appendFileSync(JOURNAL_PATH, line, { encoding: 'utf8', flag: 'a' })
  } catch (err) {
    console.error('[Journal] Failed to write journal entry:', err)
  }
}

export function readJournal(): JournalEntry[] {
  try {
    if (!fs.existsSync(JOURNAL_PATH)) return []
    const lines = fs.readFileSync(JOURNAL_PATH, 'utf8').split('\n').filter(Boolean)
    return lines.map(line => JSON.parse(line) as JournalEntry)
  } catch (err) {
    console.error('[Journal] Failed to read journal:', err)
    return []
  }
}

export function getLastJournalEntryForTask(taskId: string): JournalEntry | null {
  const entries = readJournal()
  const taskEntries = entries.filter(e => e.taskId === taskId)
  return taskEntries.length > 0 ? taskEntries[taskEntries.length - 1] : null
}
