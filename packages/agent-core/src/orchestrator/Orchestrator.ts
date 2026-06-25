import { randomUUID } from 'crypto'
import { getDb } from '../persistence/Database.js'
import { recoverProject } from '../persistence/Checkpointer.js'
import { TaskQueue, type ExecutionMode } from './TaskQueue.js'
import { AgentSession, type AgentConfig, type AgentRole, type AgentEvent } from './AgentSession.js'
import { connectMCP, disconnectMCP } from '../mcp/MCPClient.js'
import { writeJournal } from '../persistence/Journal.js'

export interface ProjectConfig {
  id?: string
  name: string
  rootPath: string
  executionMode?: ExecutionMode
  maxParallel?: number
}

export interface Project {
  id: string
  name: string
  rootPath: string
  agents: AgentSession[]
  queue: TaskQueue
}

type GlobalEventListener = (projectId: string, event: AgentEvent) => void

export class Orchestrator {
  private projects: Map<string, Project> = new Map()
  private globalListeners: GlobalEventListener[] = []

  onEvent(listener: GlobalEventListener): void {
    this.globalListeners.push(listener)
  }

  async createProject(config: ProjectConfig): Promise<Project> {
    const db = getDb()
    const id = config.id ?? randomUUID()

    db.prepare(`
      INSERT OR IGNORE INTO projects (id, name, root_path, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(id, config.name, config.rootPath)

    writeJournal({ event: 'PROJECT_CREATED', projectId: id, detail: config.name })

    const queue = new TaskQueue(
      config.executionMode ?? 'sequential',
      config.maxParallel ?? 1
    )

    const project: Project = { id, name: config.name, rootPath: config.rootPath, agents: [], queue }
    this.projects.set(id, project)

    // Connect MCP to project root
    await connectMCP(config.rootPath)
    console.log(`[Orchestrator] Project created: ${config.name} (${id})`)

    // Run crash recovery for this project
    const recovery = recoverProject(id)
    if (recovery.recovered > 0 || recovery.requeued > 0) {
      console.log(`[Orchestrator] Recovery: ${recovery.recovered} verified, ${recovery.requeued} requeued`)
      recovery.details.forEach(d => console.log(`  ${d}`))
    }

    return project
  }

  addAgent(projectId: string, agentConfig: Omit<AgentConfig, 'projectId'>): AgentSession {
    const project = this.getProject(projectId)

    const session = new AgentSession({
      ...agentConfig,
      projectId,
      projectPath: project.rootPath
    })

    // Forward agent events to global listeners
    session.onEvent((event) => {
      this.globalListeners.forEach(l => l(projectId, event))
    })

    project.agents.push(session)
    console.log(`[Orchestrator] Agent added: ${agentConfig.name} (${agentConfig.role}) → project ${projectId}`)
    return session
  }

  async runInstruction(
    projectId: string,
    agentId: string,
    instruction: string
  ): Promise<void> {
    const project = this.getProject(projectId)
    const agent = project.agents.find(a => a.id === agentId)
    if (!agent) throw new Error(`Agent ${agentId} not found in project ${projectId}`)

    project.queue.enqueue({
      id: randomUUID(),
      agentId,
      projectId,
      run: () => agent.executeInstruction(instruction)
    })
  }

  async runInstructionDirect(
    projectId: string,
    agentId: string,
    instruction: string
  ): Promise<void> {
    const project = this.getProject(projectId)
    const agent = project.agents.find(a => a.id === agentId)
    if (!agent) throw new Error(`Agent ${agentId} not found in project ${projectId}`)
    await agent.executeInstruction(instruction)
  }

  getProject(projectId: string): Project {
    const project = this.projects.get(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    return project
  }

  listProjects(): Array<{ id: string; name: string; rootPath: string; agentCount: number }> {
    return [...this.projects.values()].map(p => ({
      id: p.id,
      name: p.name,
      rootPath: p.rootPath,
      agentCount: p.agents.length
    }))
  }

  listAgents(projectId: string): Array<{ id: string; name: string; role: AgentRole }> {
    const project = this.getProject(projectId)
    return project.agents.map(a => ({
      id: a.id,
      name: a.config.name,
      role: a.config.role
    }))
  }

  setExecutionMode(projectId: string, mode: ExecutionMode, maxParallel?: number): void {
    const project = this.getProject(projectId)
    project.queue.setMode(mode, maxParallel)
  }

  async closeProject(projectId: string): Promise<void> {
    const project = this.projects.get(projectId)
    this.projects.delete(projectId)
    // Disconnect ONLY this project's MCP client — passing no arg would tear down
    // the filesystem connection for every other open project too.
    if (project) await disconnectMCP(project.rootPath)
    console.log(`[Orchestrator] Project closed: ${projectId}`)
  }
}

// Singleton instance
export const orchestrator = new Orchestrator()
