import { randomUUID } from 'crypto'
import { getDb } from './Database.js'
import { writeJournal } from './Journal.js'

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed'
export type ActionType = 'create_file' | 'write_code' | 'run_test' | 'run_command' | 'read_file' | 'git_commit'

export interface Task {
  id: string
  projectId: string
  agentId: string
  actionType: ActionType
  targetFile?: string
  instruction: string
  result?: string
  status: TaskStatus
  createdAt: string
  completedAt?: string
}

export function createTask(
  projectId: string,
  agentId: string,
  actionType: ActionType,
  instruction: string,
  targetFile?: string
): Task {
  const db = getDb()
  const task: Task = {
    id: randomUUID(),
    projectId,
    agentId,
    actionType,
    targetFile,
    instruction,
    status: 'pending',
    createdAt: new Date().toISOString()
  }

  db.prepare(`
    INSERT INTO tasks (id, project_id, agent_id, action_type, target_file, instruction, status, created_at)
    VALUES (@id, @projectId, @agentId, @actionType, @targetFile, @instruction, @status, @createdAt)
  `).run({
    id: task.id,
    projectId: task.projectId,
    agentId: task.agentId,
    actionType: task.actionType,
    targetFile: task.targetFile ?? null,
    instruction: task.instruction,
    status: task.status,
    createdAt: task.createdAt
  })

  writeJournal({ event: 'TASK_CREATED', projectId, taskId: task.id, agentId, detail: actionType })
  return task
}

export function markTaskRunning(taskId: string, projectId: string, agentId: string): void {
  const db = getDb()
  db.prepare(`UPDATE tasks SET status = 'running' WHERE id = ?`).run(taskId)
  writeJournal({ event: 'TASK_STARTED', projectId, taskId, agentId })
}

export function markTaskDone(taskId: string, projectId: string, agentId: string, result?: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE tasks SET status = 'done', result = ?, completed_at = datetime('now') WHERE id = ?
  `).run(result ?? null, taskId)
  writeJournal({ event: 'TASK_COMPLETED', projectId, taskId, agentId })
}

export function markTaskFailed(taskId: string, projectId: string, agentId: string, error: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?
  `).run(error, taskId)
  writeJournal({ event: 'TASK_FAILED', projectId, taskId, agentId, detail: error })
}

export function getPendingTasks(projectId: string): Task[] {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM tasks WHERE project_id = ? AND status IN ('pending', 'running')
    ORDER BY created_at ASC
  `).all(projectId) as Task[]
}

export function getAllTasks(projectId: string): Task[] {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC
  `).all(projectId) as Task[]
}
