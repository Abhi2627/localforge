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

const server    = Fastify({ logger: false })
let taskQueue: TaskQueue
const wsClients = new Set<any>()

function broadcast(data: object) {
  const msg = JSON.stringify(data)
  wsClients.forEach(ws => { try { ws.send(msg) } catch { wsClients.delete(ws) } })
}

function buildSystemPrompt(selectedModel: string, summary?: string | null): string {
  return (
    `You are a helpful AI assistant running locally inside LocalForge. ` +
    `You are powered by ${selectedModel} running via Ollama on this machine — fully offline, no internet. ` +
    `You are NOT ChatGPT, Claude, GPT-4, or any cloud model. ` +
    `If asked what you are, say you are ${selectedModel} running locally via Ollama inside LocalForge. ` +
    `Always format your responses using clean Markdown: use **bold** for key terms, ## or ### headers for sections, ` +
    `- bullet lists for items, numbered lists for steps, and fenced code blocks with language tags for code. ` +
    `Keep responses well-structured and easy to read. Do not write walls of unformatted text. ` +
    `Do not add thinking steps, preamble, or filler phrases.` +
    (summary ? `\n\nProject context:\n${summary}` : '')
  )
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

  // ── Sessions ───────────────────────────────────────────────────────────────
  server.get('/sessions', async () => ({ sessions: getAllSessions() }))
  server.get<{ Params: { id: string } }>('/sessions/:id', async (req) => {
    const s = getSession(req.params.id)
    if (!s) return { error: 'Not found' }
    return { session: s, messages: getSessionMessages(req.params.id) }
  })
  server.post<{ Body: { id: string; type: string; title: string; rootPath?: string; modelName?: string } }>(
    '/sessions', async (req) => {
      const { id, type, title, rootPath, modelName } = req.body
      return { success: true, session: upsertSession({ id, type: type as any, title, rootPath, modelName }) }
    }
  )
  server.delete<{ Params: { id: string } }>('/sessions/:id', async (req) => {
    deleteSession(req.params.id); return { success: true }
  })
  server.post<{ Body: { id: string; sessionId: string; role: string; content: string; agentName?: string } }>(
    '/sessions/message', async (req) => {
      const { id, sessionId, role, content, agentName } = req.body
      if (!getSession(sessionId)) {
        upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: loadConfig().selectedModel })
      }
      saveMessage({ id, sessionId, role: role as any, content, agentName })
      return { success: true }
    }
  )

  // ── Project open ───────────────────────────────────────────────────────────
  server.post<{ Body: { sessionId: string; rootPath: string } }>('/project/open', async (req) => {
    const { sessionId, rootPath } = req.body
    if (!rootPath) return { success: false, message: 'rootPath required' }
    await connectMCP(rootPath)
    const scan = scanProjectFiles(rootPath)
    generateProjectSummary(sessionId, rootPath, scan).then(summary => {
      broadcast({ type: 'project_summary', sessionId, summary })
    })
    return { success: true, isEmpty: scan.isEmpty, fileList: scan.fileList, fileTree: scan.fileTree, fileCount: scan.fileList.length }
  })
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/summary', async (req) => {
    return { summary: getSession(req.params.sessionId)?.summary ?? null }
  })

  // ── Chat streaming — SSE, token by token ──────────────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }> } }>(
    '/chat/stream', async (req, reply) => {
      const { message, sessionId, history = [] } = req.body
      if (!message) { reply.status(400).send('No message'); return }

      const { selectedModel } = loadConfig()
      if (!getSession(sessionId)) {
        upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: selectedModel })
      }
      const session = getSession(sessionId)

      const messages = [
        { role: 'system' as const, content: buildSystemPrompt(selectedModel, session?.summary) },
        ...history.slice(-10).map((h: any) => ({ role: h.role as const, content: h.content })),
        { role: 'user' as const, content: message },
      ]

      reply.raw.setHeader('Content-Type',  'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection',    'keep-alive')
      reply.raw.flushHeaders()

      let fullReply = ''
      try {
        await chat(selectedModel, messages, (chunk) => {
          fullReply += chunk.content
          reply.raw.write(`data: ${JSON.stringify({ chunk: chunk.content })}\n\n`)
        })
      } catch (err: any) {
        reply.raw.write(`data: ${JSON.stringify({ chunk: `\n\nError: ${err.message}` })}\n\n`)
      }

      reply.raw.write('data: [DONE]\n\n')
      reply.raw.end()

      // Persist after stream
      const { randomUUID } = await import('crypto')
      saveMessage({ id: randomUUID(), sessionId, role: 'user',      content: message })
      saveMessage({ id: randomUUID(), sessionId, role: 'assistant', content: fullReply })
    }
  )

  // ── Chat non-streaming (title generation only) ────────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }> } }>(
    '/chat', async (req) => {
      const { message, sessionId, history = [] } = req.body
      if (!message) return { success: false, reply: 'No message' }

      const { selectedModel } = loadConfig()
      if (!getSession(sessionId)) {
        upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: selectedModel })
      }
      const session = getSession(sessionId)

      const messages = [
        { role: 'system' as const, content: buildSystemPrompt(selectedModel, session?.summary) },
        ...history.slice(-10).map((h: any) => ({ role: h.role as const, content: h.content })),
        { role: 'user' as const, content: message },
      ]

      const reply = await chat(selectedModel, messages)
      const { randomUUID } = await import('crypto')
      saveMessage({ id: randomUUID(), sessionId, role: 'user',      content: message })
      saveMessage({ id: randomUUID(), sessionId, role: 'assistant', content: reply })
      return { success: true, reply }
    }
  )

  // ── Projects / Agents / Instructions ──────────────────────────────────────
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
