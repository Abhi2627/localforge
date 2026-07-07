import { randomUUID } from 'crypto'
import { getDb } from '../persistence/Database.js'
import { createTask, markTaskRunning, markTaskDone, markTaskFailed } from '../persistence/TaskLog.js'
import { saveFileSnapshot } from '../persistence/Checkpointer.js'
import { loadConfig } from '../ollama/ModelManager.js'
import { loadSettings } from '../settings/SettingsStore.js'
import { chat as ollamaChat, type ChatMessage } from '../ollama/OllamaClient.js'
import { cloudChat, type CloudProvider } from '../cloud/CloudClient.js'
import { writeFile, createDirectory, getProjectTree } from '../mcp/MCPClient.js'
import path from 'path'

// Route to Ollama or cloud depending on settings
async function agentChat(
  messages: ChatMessage[],
  onChunk?: (chunk: string) => void
): Promise<string> {
  const settings = loadSettings()
  const provider = settings.activeProvider

  if (provider === 'ollama') {
    const { selectedModel } = loadConfig()
    if (!selectedModel) throw new Error('No Ollama model selected')
    return ollamaChat(selectedModel, messages, onChunk ? c => onChunk(c.content) : undefined)
  }

  const model  = settings.cloudModels[provider as CloudProvider] ?? ''
  const keys   = settings.apiKeys
  let apiKey   = ''
  let baseUrl: string | undefined
  if (provider === 'openai') apiKey = keys.openai  ?? ''
  if (provider === 'gemini') apiKey = keys.gemini  ?? ''
  if (provider === 'claude') apiKey = keys.claude  ?? ''
  if (provider === 'groq')   apiKey = keys.groq    ?? ''
  if (provider === 'custom') { apiKey = keys.customKey ?? ''; baseUrl = keys.customUrl }
  if (!apiKey) throw new Error(`No API key for ${provider}`)

  return cloudChat(
    { provider: provider as CloudProvider, apiKey, model, baseUrl },
    messages as any,
    onChunk ? (c: any) => onChunk(c.content) : undefined,
    { temperature: settings.llmDefaults.temperature, maxTokens: settings.llmDefaults.maxTokens }
  )
}

export type AgentRole = 'frontend' | 'backend' | 'fullstack' | 'test' | 'review' | 'docs' | 'devops' | 'database'

export interface AgentConfig {
  id?: string
  projectId: string
  name: string
  role: AgentRole
  projectPath: string
  allowedPaths: string[]
}

export interface AgentEvent {
  type: 'status' | 'file_created' | 'file_written' | 'task_done' | 'task_failed' | 'stream_chunk'
  agentId: string
  agentName: string
  message: string
  filePath?: string
  taskId?: string
}

type EventListener = (event: AgentEvent) => void

const ROLE_PROMPTS: Record<AgentRole, string> = {
  frontend: `You are a frontend engineer agent. You write clean, modern React + TypeScript code.
You only create and modify files inside the frontend or src directory.
When writing a file, output the complete file content first, then on a new line write exactly:
FILE_WRITTEN: <relative-filepath>
Do not use markdown code fences. Output raw file content only.`,

  backend: `You are a backend engineer agent. You write clean Node.js + TypeScript with Fastify or Express.
You only create and modify files inside the backend or src directory.
When writing a file, output the complete file content first, then on a new line write exactly:
FILE_WRITTEN: <relative-filepath>
Do not use markdown code fences. Output raw file content only.`,

  fullstack: `You are a fullstack engineer agent. You write both frontend and backend code.
When writing a file, output the complete file content first, then on a new line write exactly:
FILE_WRITTEN: <relative-filepath>
Do not use markdown code fences. Output raw file content only.`,

  test: `You are a test engineer agent. You write comprehensive tests using Vitest or Jest.
You only create files with .test.ts or .spec.ts extensions.
When writing a file, output the complete file content first, then on a new line write exactly:
FILE_WRITTEN: <relative-filepath>
Do not use markdown code fences. Output raw file content only.`,

  review: `You are a code review agent. You read existing code and provide structured feedback.
You do NOT write or modify files. You only analyse and report issues.
Format each issue as: ISSUE: <description> | FILE: <path> | SEVERITY: low|medium|high`,

  docs: `You are a documentation agent. You write README files, API docs, and inline comments.
When writing a file, output the complete file content first, then on a new line write exactly:
FILE_WRITTEN: <relative-filepath>
Do not use markdown code fences. Output raw file content only.`,

  devops: `You are a DevOps agent. You write Dockerfiles, docker-compose files, CI/CD configs, and deployment scripts.
When writing a file, output the complete file content first, then on a new line write exactly:
FILE_WRITTEN: <relative-filepath>
Do not use markdown code fences. Output raw file content only.`,

  database: `You are a database agent. You write database schemas, migrations, and query files.
When writing a file, output the complete file content first, then on a new line write exactly:
FILE_WRITTEN: <relative-filepath>
Do not use markdown code fences. Output raw file content only.`
}

// Models often prefix file content with a path header like "# backend/package.json".
// That's fine in code (a comment) but BREAKS data files (JSON has no comments), which
// is exactly what produced the "Unexpected token #" npm error. Strip leading
// comment/header lines for formats that can't contain them.
function cleanFileContent(content: string, filePath: string): string {
  const ext = (filePath.split('.').pop() ?? '').toLowerCase()
  if (ext === 'json') {
    const lines = content.split('\n')
    while (lines.length && /^\s*(#|\/\/|<!--|```)/.test(lines[0])) lines.shift()
    while (lines.length && /^\s*(```)/.test(lines[lines.length - 1])) lines.pop()
    return lines.join('\n').replace(/^\s+/, '').trim()
  }
  return content
}

export class AgentSession {
  readonly id: string
  readonly config: AgentConfig
  private listeners: EventListener[] = []
  private conversationHistory: ChatMessage[] = []

  constructor(config: AgentConfig) {
    this.id = config.id ?? randomUUID()
    this.config = { ...config, id: this.id }
    this.persistToDb()
  }

  private persistToDb(): void {
    const db = getDb()
    db.prepare(`
      INSERT OR IGNORE INTO agents (id, project_id, name, role, system_prompt, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(this.id, this.config.projectId, this.config.name, this.config.role, ROLE_PROMPTS[this.config.role])
  }

  onEvent(listener: EventListener): void {
    this.listeners.push(listener)
  }

  private emit(event: Omit<AgentEvent, 'agentId' | 'agentName'>): void {
    const full: AgentEvent = { ...event, agentId: this.id, agentName: this.config.name }
    this.listeners.forEach(l => l(full))
  }

  async executeInstruction(instruction: string): Promise<void> {
    const task = createTask(this.config.projectId, this.id, 'write_code', instruction)
    markTaskRunning(task.id, this.config.projectId, this.id)
    this.emit({ type: 'status', message: `Working on: ${instruction.slice(0, 80)}…`, taskId: task.id })

    const messages: ChatMessage[] = [
      { role: 'system', content: ROLE_PROMPTS[this.config.role] },
      ...this.conversationHistory.slice(-6),
      { role: 'user', content: instruction }
    ]

    try {
      let fullResponse = ''
      // Watchdog: a hung Ollama/cloud call must never leave the agent 'running'
      // forever. Race the model call against a timeout; the timer is reset on every
      // streamed chunk so long-but-progressing generations aren't killed. If it
      // fires, we throw → task_failed → the phase/pipeline continues.
      const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 300_000) // 5 min of no output
      let timer: ReturnType<typeof setTimeout>
      let bail: (e: Error) => void = () => {}
      const watchdog = new Promise<never>((_, reject) => {
        bail = reject
        const arm = () => { timer = setTimeout(() => reject(new Error(`Agent "${this.config.name}" timed out — no model output for ${Math.round(AGENT_TIMEOUT_MS / 1000)}s`)), AGENT_TIMEOUT_MS) }
        ;(this as any).__rearm = () => { clearTimeout(timer); arm() }
        arm()
      })
      try {
        await Promise.race([
          agentChat(messages, (chunk) => {
            fullResponse += chunk
            ;(this as any).__rearm?.()
            this.emit({ type: 'stream_chunk', message: chunk, taskId: task.id })
          }),
          watchdog,
        ])
      } finally {
        clearTimeout(timer!)
        ;(this as any).__rearm = undefined
        void bail
      }
      await this.processResponse(fullResponse, task.id)
      this.conversationHistory.push({ role: 'user', content: instruction })
      this.conversationHistory.push({ role: 'assistant', content: fullResponse })
      markTaskDone(task.id, this.config.projectId, this.id, fullResponse)
      this.emit({ type: 'task_done', message: 'Task completed', taskId: task.id })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      markTaskFailed(task.id, this.config.projectId, this.id, errMsg)
      this.emit({ type: 'task_failed', message: errMsg, taskId: task.id })
      throw err
    }
  }

  private async processResponse(response: string, taskId: string): Promise<void> {
    const fileMarkerRegex = /FILE_WRITTEN:\s*(.+)/g
    const markers = [...response.matchAll(fileMarkerRegex)]
    if (markers.length === 0) return

    const blocks = response.split(/FILE_WRITTEN:\s*.+/g)

    for (let i = 0; i < markers.length; i++) {
      const rawPath = markers[i][1].trim()
      const filePath = path.isAbsolute(rawPath)
        ? rawPath
        : path.join(this.config.projectPath, rawPath)

      if (!this.isPathAllowed(filePath)) {
        console.warn(`[Agent ${this.config.name}] Blocked write to ${filePath}`)
        continue
      }

      const content = cleanFileContent(blocks[i]?.trim() ?? '', filePath)
      if (!content) continue

      const dir = path.dirname(filePath)
      try { await createDirectory(this.config.projectPath, dir) } catch { }

      await writeFile(this.config.projectPath, filePath, content)
      saveFileSnapshot(this.config.projectId, filePath, this.id)

      this.emit({
        type: 'file_written',
        message: `Written: ${path.relative(this.config.projectPath, filePath)}`,
        filePath,
        taskId
      })
    }
  }

  private isPathAllowed(filePath: string): boolean {
    const resolved = path.resolve(filePath)
    const root     = path.resolve(this.config.projectPath)
    // Hard boundary: never write outside the project root, even if the model
    // emits an absolute path. This also makes an empty allowedPaths mean
    // "anywhere inside the project" rather than "anywhere on disk".
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return false
    if (this.config.allowedPaths.length === 0) return true
    return this.config.allowedPaths.some(allowed => resolved.startsWith(path.resolve(allowed)))
  }

  async getProjectContext(): Promise<string> {
    try {
      const tree = await getProjectTree(this.config.projectPath)
      return `Current project structure:\n${tree}`
    } catch {
      return ''
    }
  }

  clearHistory(): void {
    this.conversationHistory = []
  }
}
