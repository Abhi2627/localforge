import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import pty from 'node-pty'
import os from 'os'
import fs from 'fs'
import { execSync } from 'child_process'
import { randomUUID } from 'crypto'
import { getDb, closeDb } from './persistence/Database.js'
import { initSessionTables, upsertSession, saveMessage, getAllSessions, getSession, getSessionMessages, deleteSession } from './persistence/SessionStore.js'
import { profileSystem } from './orchestrator/SystemProfiler.js'
import { TaskQueue } from './orchestrator/TaskQueue.js'
import { orchestrator } from './orchestrator/Orchestrator.js'
import { chat } from './ollama/OllamaClient.js'
import { getInstalledModels, selectModel, setFallbackModels, loadConfig, saveConfig } from './ollama/ModelManager.js'
import { scanProjectFiles, generateProjectSummary } from './mcp/ProjectScanner.js'
import { connectMCP } from './mcp/MCPClient.js'

type ChatRole = 'system' | 'user' | 'assistant'

const server    = Fastify({ logger: false })
let taskQueue: TaskQueue
const wsClients = new Set<any>()

function detectShell(): string {
  if (os.platform() === 'win32') return 'powershell.exe'
  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) return process.env.SHELL
  try {
    const username = os.userInfo().username
    const passwd   = fs.readFileSync('/etc/passwd', 'utf8')
    const line     = passwd.split('\n').find(l => l.startsWith(username + ':'))
    if (line) { const s = line.split(':').pop()?.trim(); if (s && fs.existsSync(s)) return s }
  } catch { }
  try {
    const s = execSync('dscl . -read /Users/$USER UserShell 2>/dev/null | awk \'{print $2}\'', { encoding: 'utf8' }).trim()
    if (s && fs.existsSync(s)) return s
  } catch { }
  for (const s of ['/bin/zsh', '/bin/bash', '/bin/sh']) { if (fs.existsSync(s)) return s }
  return '/bin/sh'
}

const DEFAULT_SHELL = detectShell()

function broadcast(data: object) {
  const msg = JSON.stringify(data)
  wsClients.forEach(ws => { try { ws.send(msg) } catch { wsClients.delete(ws) } })
}

function buildSystemPrompt(selectedModel: string, summary?: string | null): string {
  return (
    `You are a helpful AI assistant running locally inside LocalForge. ` +
    `You are powered by ${selectedModel} running via Ollama — fully offline. ` +
    `Always format responses using clean Markdown with headers, bullets, and code blocks. ` +
    `Do not add thinking steps or filler phrases.` +
    (summary ? `\n\nProject context:\n${summary}` : '')
  )
}

function mapHistory(h: Array<{ role: string; content: string }>) {
  return h.slice(-20).map(x => ({ role: x.role as ChatRole, content: x.content }))
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

  // ── Agent events WebSocket ─────────────────────────────────────────────────
  server.get('/ws', { websocket: true }, (socket) => {
    wsClients.add(socket)
    socket.send(JSON.stringify({ type: 'connected' }))
    socket.on('close', () => wsClients.delete(socket))
  })

  // ── PTY Terminal WebSocket ─────────────────────────────────────────────────
  server.get<{ Querystring: { cwd?: string } }>('/terminal', { websocket: true }, (socket, req) => {
    const rawCwd = req.query.cwd ?? os.homedir()
    const cwd    = fs.existsSync(rawCwd) ? rawCwd : os.homedir()

    let ptyProc: ReturnType<typeof pty.spawn> | null = null
    try {
      console.log(`[terminal] spawning ${DEFAULT_SHELL} in ${cwd}`)
      ptyProc = pty.spawn(DEFAULT_SHELL, [], {
        name: 'xterm-256color', cols: 120, rows: 30, cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'LocalForge',
          HOME:  process.env.HOME  ?? os.homedir(),
          USER:  process.env.USER  ?? os.userInfo().username,
          SHELL: DEFAULT_SHELL,
          PATH:  process.env.PATH  ?? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
          LANG:  process.env.LANG  ?? 'en_US.UTF-8',
        } as Record<string, string>,
      })

      ptyProc.onData((data: string) => { try { socket.send(data) } catch { } })
      ptyProc.onExit(({ exitCode }) => {
        try { socket.send(`\r\n\x1b[90m[shell exited ${exitCode}]\x1b[0m\r\n`) } catch { }
        try { socket.close() } catch { }
      })

      socket.on('message', (raw: Buffer | string) => {
        if (!ptyProc) return
        const str = typeof raw === 'string' ? raw : raw.toString('utf8')
        try {
          const msg = JSON.parse(str)
          if (msg.type === 'input')  ptyProc.write(msg.data as string)
          if (msg.type === 'resize') ptyProc.resize(Math.max(1, Math.floor(Number(msg.cols))), Math.max(1, Math.floor(Number(msg.rows))))
        } catch { ptyProc.write(str) }
      })

      socket.on('close', () => { if (ptyProc) { try { ptyProc.kill() } catch { } ptyProc = null } })

    } catch (err: any) {
      console.error('[terminal] spawn error:', err.message)
      try { socket.send(`\r\n\x1b[31m[Failed: ${err.message}]\x1b[0m\r\nShell: ${DEFAULT_SHELL}\r\n`) } catch { }
      try { socket.close() } catch { }
    }
  })

  // ── Health ─────────────────────────────────────────────────────────────────
  server.get('/health', async () => ({ status: 'ok', mode: taskQueue.currentMode, shell: DEFAULT_SHELL }))
  server.get('/system', async () => profileSystem())
  server.post<{ Body: { mode: 'sequential' | 'parallel'; maxParallel?: number } }>('/system/mode', async (req) => {
    taskQueue.setMode(req.body.mode, req.body.maxParallel)
    saveConfig({ executionMode: req.body.mode, maxParallel: req.body.maxParallel ?? 1 })
    return { success: true }
  })

  // ── Models ─────────────────────────────────────────────────────────────────
  server.get('/models', async () => { try { return { models: await getInstalledModels() } } catch { return { error: 'Ollama not reachable' } } })
  server.get('/models/config', async () => loadConfig())
  server.post<{ Body: { model: string } }>('/models/select', async (req) => {
    if (!req.body.model) return { success: false }
    return selectModel(req.body.model)
  })
  server.post<{ Body: { models: string[] } }>('/models/fallback', async (req) => {
    return { success: true, config: await setFallbackModels(req.body.models) }
  })

  // ── Sessions ───────────────────────────────────────────────────────────────
  server.get('/sessions', async () => ({ sessions: getAllSessions() }))
  server.get<{ Params: { id: string } }>('/sessions/:id', async (req) => {
    const s = getSession(req.params.id)
    return s ? { session: s, messages: getSessionMessages(req.params.id) } : { error: 'Not found' }
  })
  server.post<{ Body: { id: string; type: string; title: string; rootPath?: string; modelName?: string } }>('/sessions', async (req) => {
    const { id, type, title, rootPath, modelName } = req.body
    return { success: true, session: upsertSession({ id, type: type as any, title, rootPath, modelName }) }
  })
  server.delete<{ Params: { id: string } }>('/sessions/:id', async (req) => { deleteSession(req.params.id); return { success: true } })
  server.post<{ Body: { id: string; sessionId: string; role: string; content: string; agentName?: string } }>('/sessions/message', async (req) => {
    const { id, sessionId, role, content, agentName } = req.body
    if (!getSession(sessionId)) upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: loadConfig().selectedModel })
    saveMessage({ id, sessionId, role: role as any, content, agentName })
    return { success: true }
  })

  // ── Project ────────────────────────────────────────────────────────────────
  server.post<{ Body: { sessionId: string; rootPath: string } }>('/project/open', async (req) => {
    const { sessionId, rootPath } = req.body
    if (!rootPath) return { success: false, message: 'rootPath required' }
    await connectMCP(rootPath)
    const scan = scanProjectFiles(rootPath)
    generateProjectSummary(sessionId, rootPath, scan).then(summary => broadcast({ type: 'project_summary', sessionId, summary }))
    return { success: true, isEmpty: scan.isEmpty, fileList: scan.fileList, fileTree: scan.fileTree, fileCount: scan.fileList.length }
  })
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/summary', async (req) => {
    return { summary: getSession(req.params.sessionId)?.summary ?? null }
  })
  server.get<{ Querystring: { path: string } }>('/project/file', async (req, reply) => {
    const p = req.query.path
    if (!p) { reply.status(400).send({ error: 'path required' }); return }
    if (!fs.existsSync(p)) { reply.status(404).send({ error: 'not found' }); return }
    try { return { content: fs.readFileSync(p, 'utf8') } } catch (e: any) { reply.status(500).send({ error: e.message }) }
  })
  server.post<{ Body: { path: string; content: string } }>('/project/file', async (req, reply) => {
    const { path: p, content } = req.body
    if (!p) { reply.status(400).send({ error: 'path required' }); return }
    try { fs.writeFileSync(p, content ?? '', 'utf8'); return { success: true } } catch (e: any) { reply.status(500).send({ error: e.message }) }
  })

  // ── Chat streaming ─────────────────────────────────────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }> } }>('/chat/stream', async (req, reply) => {
    const { message, sessionId, history = [] } = req.body
    if (!message) { reply.status(400).send('No message'); return }
    const { selectedModel } = loadConfig()
    if (!getSession(sessionId)) upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: selectedModel })
    const session  = getSession(sessionId)
    const messages = [
      { role: 'system' as ChatRole, content: buildSystemPrompt(selectedModel, session?.summary) },
      ...mapHistory(history),
      { role: 'user' as ChatRole, content: message },
    ]
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders()
    let fullReply = ''
    try {
      await chat(selectedModel, messages, (chunk) => {
        fullReply += chunk.content
        reply.raw.write(`data: ${JSON.stringify({ chunk: chunk.content })}\n\n`)
      })
    } catch (err: any) { reply.raw.write(`data: ${JSON.stringify({ chunk: `\n\nError: ${err.message}` })}\n\n`) }
    reply.raw.write('data: [DONE]\n\n')
    reply.raw.end()
    saveMessage({ id: randomUUID(), sessionId, role: 'assistant', content: fullReply })
  })

  // ── Chat non-streaming (title gen) ────────────────────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }> } }>('/chat', async (req) => {
    const { message, sessionId, history = [] } = req.body
    if (!message) return { success: false, reply: 'No message' }
    const { selectedModel } = loadConfig()
    const session  = getSession(sessionId)
    const messages = [
      { role: 'system' as ChatRole, content: buildSystemPrompt(selectedModel, session?.summary) },
      ...mapHistory(history),
      { role: 'user' as ChatRole, content: message },
    ]
    return { success: true, reply: await chat(selectedModel, messages) }
  })

  // ── Projects / Agents ─────────────────────────────────────────────────────
  server.get('/projects', async () => ({ projects: orchestrator.listProjects() }))
  server.post<{ Body: { name: string; rootPath: string } }>('/projects', async (req) => {
    const { name, rootPath } = req.body
    if (!name || !rootPath) return { success: false }
    const p = await orchestrator.createProject({ name, rootPath })
    return { success: true, project: { id: p.id, name: p.name, rootPath: p.rootPath } }
  })
  server.get<{ Params: { projectId: string } }>('/projects/:projectId/agents', async (req) => {
    return { agents: orchestrator.listAgents(req.params.projectId) }
  })
  server.post<{ Params: { projectId: string }; Body: { name: string; role: string; allowedPaths?: string[] } }>('/projects/:projectId/agents', async (req) => {
    const { name, role, allowedPaths } = req.body
    if (!name || !role) return { success: false }
    const agent = orchestrator.addAgent(req.params.projectId, {
      name, role: role as any, allowedPaths: allowedPaths ?? [],
      projectPath: orchestrator.getProject(req.params.projectId).rootPath,
    })
    return { success: true, agent: { id: agent.id, name: agent.config.name, role: agent.config.role } }
  })
  server.post<{ Params: { projectId: string; agentId: string }; Body: { instruction: string; queue?: boolean } }>('/projects/:projectId/agents/:agentId/instruct', async (req) => {
    const { instruction, queue = true } = req.body
    if (!instruction) return { success: false }
    if (queue) { await orchestrator.runInstruction(req.params.projectId, req.params.agentId, instruction); return { success: true } }
    await orchestrator.runInstructionDirect(req.params.projectId, req.params.agentId, instruction)
    return { success: true }
  })

  const PORT = Number(process.env.PORT ?? 3001)
  await server.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`\n🔨 LocalForge  :${PORT}  |  Model: ${loadConfig().selectedModel}`)
  console.log(`   Shell: ${DEFAULT_SHELL}`)
  console.log(`   Terminal ws://localhost:${PORT}/terminal\n`)
}

process.on('SIGINT', async () => { await server.close(); closeDb(); process.exit(0) })
bootstrap().catch(err => { console.error('[Server] Fatal:', err); process.exit(1) })
