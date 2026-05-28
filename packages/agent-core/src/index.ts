import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { getDb, closeDb } from './persistence/Database.js'
import { initSessionTables, upsertSession, saveMessage, getAllSessions, getSession, getSessionMessages, deleteSession } from './persistence/SessionStore.js'
import { profileSystem } from './orchestrator/SystemProfiler.js'
import { TaskQueue } from './orchestrator/TaskQueue.js'
import { orchestrator } from './orchestrator/Orchestrator.js'
import { chat } from './ollama/OllamaClient.js'
import { getInstalledModels, selectModel, setFallbackModels, loadConfig, saveConfig } from './ollama/ModelManager.js'
import { scanProjectFiles, generateProjectSummary } from './mcp/ProjectScanner.js'
import { connectMCP } from './mcp/MCPClient.js'

const server  = Fastify({ logger: false })
let taskQueue: TaskQueue
const wsClients = new Set<any>()

function broadcast(data: object) {
  const msg = JSON.stringify(data)
  wsClients.forEach(ws => { try { ws.send(msg) } catch { wsClients.delete(ws) } })
}

async function bootstrap() {
  await server.register(cors, { origin: true })
  await server.register(websocket)

  const profile     = await profileSystem()
  const config      = loadConfig()
  const mode        = config.executionMode ?? profile.recommendedMode
  const maxParallel = config.maxParallel   ?? profile.recommendedMaxParallel
  taskQueue = new TaskQueue(mode, maxParallel)

  getDb()
  initSessionTables()

  orchestrator.onEvent((projectId, event) => broadcast({ type: 'agent_event', projectId, event }))

  // ── WebSocket ──────────────────────────────────────────────────────────────
  server.get('/ws', { websocket: true }, (socket) => {
    wsClients.add(socket)
    socket.send(JSON.stringify({ type: 'connected' }))
    socket.on('close', () => wsClients.delete(socket))
  })

  // ── Health / System ────────────────────────────────────────────────────────
  server.get('/health', async () => ({ status: 'ok', mode: taskQueue.currentMode }))
  server.get('/system', async () => profileSystem())
  server.post<{ Body: { mode: 'sequential' | 'parallel'; maxParallel?: number } }>('/system/mode', async (req) => {
    taskQueue.setMode(req.body.mode, req.body.maxParallel)
    saveConfig({ executionMode: req.body.mode, maxParallel: req.body.maxParallel ?? 1 })
    return { success: true }
  })

  // ── Models ─────────────────────────────────────────────────────────────────
  server.get('/models', async () => {
    try { return { models: await getInstalledModels() } }
    catch { return { error: 'Ollama not reachable' } }
  })
  server.get('/models/config', async () => loadConfig())
  server.post<{ Body: { model: string } }>('/models/select', async (req) => {
    if (!req.body.model) return { success: false, message: 'model required' }
    return selectModel(req.body.model)
  })
  server.post<{ Body: { models: string[] } }>('/models/fallback', async (req) => {
    return { success: true, config: await setFallbackModels(req.body.models) }
  })

  // ── Sessions (persist chat + project history) ──────────────────────────────
  server.get('/sessions', async () => ({ sessions: getAllSessions() }))

  server.get<{ Params: { id: string } }>('/sessions/:id', async (req) => {
    const session = getSession(req.params.id)
    if (!session) return { error: 'Not found' }
    const messages = getSessionMessages(req.params.id)
    return { session, messages }
  })

  server.post<{ Body: { id: string; type: string; title: string; rootPath?: string; modelName?: string } }>(
    '/sessions', async (req) => {
      const { id, type, title, rootPath, modelName } = req.body
      const session = upsertSession({ id, type: type as any, title, rootPath, modelName })
      return { success: true, session }
    }
  )

  server.delete<{ Params: { id: string } }>('/sessions/:id', async (req) => {
    deleteSession(req.params.id)
    return { success: true }
  })

  // Save a message to a session
  server.post<{ Body: { id: string; sessionId: string; role: string; content: string; agentName?: string } }>(
    '/sessions/message', async (req) => {
      const { id, sessionId, role, content, agentName } = req.body
      saveMessage({ id, sessionId, role: role as any, content, agentName })
      return { success: true }
    }
  )

  // ── Open project — scan existing files + generate summary ─────────────────
  server.post<{ Body: { sessionId: string; rootPath: string } }>(
    '/project/open', async (req) => {
      const { sessionId, rootPath } = req.body
      if (!rootPath) return { success: false, message: 'rootPath required' }

      // Connect MCP
      await connectMCP(rootPath)

      // Scan existing files
      const scan = scanProjectFiles(rootPath)

      // Fire-and-forget: generate summary in background, broadcast when ready
      generateProjectSummary(sessionId, rootPath, scan).then(summary => {
        broadcast({ type: 'project_summary', sessionId, summary })
      })

      return {
        success:   true,
        isEmpty:   scan.isEmpty,
        fileList:  scan.fileList,
        fileTree:  scan.fileTree,
        fileCount: scan.fileList.length,
      }
    }
  )

  // Get project summary (may not be ready yet if still generating)
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/summary', async (req) => {
    const session = getSession(req.params.sessionId)
    return { summary: session?.summary ?? null }
  })

  // ── Chat (conversational, no MCP) ─────────────────────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{role: string; content: string}> } }>(
    '/chat', async (req) => {
      const { message, sessionId, history = [] } = req.body
      if (!message) return { success: false, reply: 'No message' }

      const { selectedModel } = loadConfig()
      const session = getSession(sessionId)

      // Build context: system prompt + project summary if available + history + message
      const systemContent = `You are a helpful AI assistant running locally inside LocalForge, powered by ${selectedModel} via Ollama on this machine.
You are NOT ChatGPT, Claude, or any cloud model. You are ${selectedModel} running locally.
If asked what you are, say you are ${selectedModel} running locally via Ollama inside LocalForge.
Keep responses clear and concise. Do not add thinking steps or preamble.${session?.summary ? `\n\nProject context:\n${session.summary}` : ''}`

      const messages = [
        { role: 'system' as const, content: systemContent },
        ...history.slice(-10).map((h: any) => ({ role: h.role as any, content: h.content })),
        { role: 'user' as const, content: message }
      ]

      const reply = await chat(selectedModel, messages)

      // Persist both turns
      const { randomUUID } = await import('crypto')
      saveMessage({ id: randomUUID(), sessionId, role: 'user',      content: message })
      saveMessage({ id: randomUUID(), sessionId, role: 'assistant', content: reply })

      return { success: true, reply }
    }
  )

  // ── Projects / Agents / Instructions (existing) ────────────────────────────
  server.get('/projects', async () => ({ projects: orchestrator.listProjects() }))

  server.post<{ Body: { name: string; rootPath: string } }>('/projects', async (req) => {
    const { name, rootPath } = req.body
    if (!name || !rootPath) return { success: false, message: 'name and rootPath required' }
    const project = await orchestrator.createProject({ name, rootPath })
    return { success: true, project: { id: project.id, name: project.name, rootPath: project.rootPath } }
  })

  server.get<{ Params: { projectId: string } }>('/projects/:projectId/agents', async (req) => {
    return { agents: orchestrator.listAgents(req.params.projectId) }
  })

  server.post<{ Params: { projectId: string }; Body: { name: string; role: string; allowedPaths?: string[] } }>(
    '/projects/:projectId/agents', async (req) => {
      const { projectId } = req.params
      const { name, role, allowedPaths } = req.body
      if (!name || !role) return { success: false, message: 'name and role required' }
      const agent = orchestrator.addAgent(projectId, {
        name, role: role as any, allowedPaths: allowedPaths ?? [],
        projectPath: orchestrator.getProject(projectId).rootPath
      })
      return { success: true, agent: { id: agent.id, name: agent.config.name, role: agent.config.role } }
    }
  )

  server.post<{ Params: { projectId: string; agentId: string }; Body: { instruction: string; queue?: boolean } }>(
    '/projects/:projectId/agents/:agentId/instruct', async (req) => {
      const { projectId, agentId } = req.params
      const { instruction, queue = true } = req.body
      if (!instruction) return { success: false, message: 'instruction required' }
      if (queue) {
        await orchestrator.runInstruction(projectId, agentId, instruction)
        return { success: true, message: 'Instruction queued' }
      }
      await orchestrator.runInstructionDirect(projectId, agentId, instruction)
      return { success: true, message: 'Instruction completed' }
    }
  )

  const PORT = Number(process.env.PORT ?? 3001)
  await server.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`\n🔨 LocalForge agent server running on port ${PORT}`)
  console.log(`   Mode: ${mode} | Model: ${loadConfig().selectedModel}\n`)
}

process.on('SIGINT', async () => {
  await server.close()
  closeDb()
  process.exit(0)
})

bootstrap().catch(err => {
  console.error('[Server] Fatal startup error:', err)
  process.exit(1)
})
