import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { getDb, closeDb } from './persistence/Database.js'
import { profileSystem } from './orchestrator/SystemProfiler.js'
import { TaskQueue } from './orchestrator/TaskQueue.js'
import { orchestrator } from './orchestrator/Orchestrator.js'
import {
  getInstalledModels,
  selectModel,
  setFallbackModels,
  loadConfig,
  saveConfig
} from './ollama/ModelManager.js'

const server = Fastify({ logger: false })

let taskQueue: TaskQueue
const wsClients = new Set<any>()

function broadcast(data: object) {
  const msg = JSON.stringify(data)
  wsClients.forEach(ws => {
    try { ws.send(msg) } catch { wsClients.delete(ws) }
  })
}

async function bootstrap() {
  await server.register(cors, { origin: true })
  await server.register(websocket)

  const profile = await profileSystem()
  const config = loadConfig()
  const mode = config.executionMode ?? profile.recommendedMode
  const maxParallel = config.maxParallel ?? profile.recommendedMaxParallel
  taskQueue = new TaskQueue(mode, maxParallel)

  getDb()

  // Forward all orchestrator events to connected WebSocket clients
  orchestrator.onEvent((projectId, event) => {
    broadcast({ type: 'agent_event', projectId, event })
  })

  // ── WebSocket ─────────────────────────────────────────────────────────────
  server.get('/ws', { websocket: true }, (socket) => {
    wsClients.add(socket)
    socket.send(JSON.stringify({ type: 'connected', message: 'LocalForge agent server connected' }))
    socket.on('close', () => wsClients.delete(socket))
  })

  // ── Health ────────────────────────────────────────────────────────────────
  server.get('/health', async () => ({
    status: 'ok',
    mode: taskQueue.currentMode,
    pending: taskQueue.pendingCount,
    running: taskQueue.runningCount
  }))

  // ── System ────────────────────────────────────────────────────────────────
  server.get('/system', async () => profileSystem())

  server.post<{ Body: { mode: 'sequential' | 'parallel'; maxParallel?: number } }>(
    '/system/mode', async (req) => {
      const { mode, maxParallel } = req.body
      taskQueue.setMode(mode, maxParallel)
      saveConfig({ executionMode: mode, maxParallel: maxParallel ?? 1 })
      return { success: true, mode, maxParallel }
    }
  )

  // ── Models ────────────────────────────────────────────────────────────────
  server.get('/models', async () => {
    try {
      return { models: await getInstalledModels() }
    } catch {
      return { error: 'Ollama not reachable. Run: ollama serve' }
    }
  })

  server.get('/models/config', async () => loadConfig())

  server.post<{ Body: { model: string } }>('/models/select', async (req) => {
    const { model } = req.body
    if (!model) return { success: false, message: 'model field is required' }
    return await selectModel(model)
  })

  server.post<{ Body: { models: string[] } }>('/models/fallback', async (req) => {
    const { models } = req.body
    if (!Array.isArray(models)) return { success: false, message: 'models must be an array' }
    return { success: true, config: await setFallbackModels(models) }
  })

  // ── Projects ──────────────────────────────────────────────────────────────
  server.get('/projects', async () => ({
    projects: orchestrator.listProjects()
  }))

  server.post<{ Body: { name: string; rootPath: string } }>(
    '/projects', async (req) => {
      const { name, rootPath } = req.body
      if (!name || !rootPath) return { success: false, message: 'name and rootPath are required' }
      const project = await orchestrator.createProject({ name, rootPath })
      return { success: true, project: { id: project.id, name: project.name, rootPath: project.rootPath } }
    }
  )

  // ── Agents ────────────────────────────────────────────────────────────────
  server.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/agents', async (req) => {
      return { agents: orchestrator.listAgents(req.params.projectId) }
    }
  )

  server.post<{
    Params: { projectId: string }
    Body: { name: string; role: string; allowedPaths?: string[] }
  }>('/projects/:projectId/agents', async (req) => {
    const { projectId } = req.params
    const { name, role, allowedPaths } = req.body
    if (!name || !role) return { success: false, message: 'name and role are required' }
    const agent = orchestrator.addAgent(projectId, {
      name,
      role: role as any,
      allowedPaths: allowedPaths ?? [],
      projectPath: orchestrator.getProject(projectId).rootPath
    })
    return { success: true, agent: { id: agent.id, name: agent.config.name, role: agent.config.role } }
  })

  // ── Instructions ──────────────────────────────────────────────────────────
  server.post<{
    Params: { projectId: string; agentId: string }
    Body: { instruction: string; queue?: boolean }
  }>('/projects/:projectId/agents/:agentId/instruct', async (req) => {
    const { projectId, agentId } = req.params
    const { instruction, queue = true } = req.body
    if (!instruction) return { success: false, message: 'instruction is required' }

    if (queue) {
      await orchestrator.runInstruction(projectId, agentId, instruction)
      return { success: true, message: 'Instruction queued' }
    } else {
      await orchestrator.runInstructionDirect(projectId, agentId, instruction)
      return { success: true, message: 'Instruction completed' }
    }
  })

  const PORT = Number(process.env.PORT ?? 3001)
  await server.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`\n🔨 LocalForge agent server running on port ${PORT}`)
  console.log(`   Mode: ${mode} | Model: ${loadConfig().selectedModel}`)
  console.log(`   WebSocket: ws://localhost:${PORT}/ws\n`)
}

process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...')
  await server.close()
  closeDb()
  process.exit(0)
})

bootstrap().catch(err => {
  console.error('[Server] Fatal startup error:', err)
  process.exit(1)
})
