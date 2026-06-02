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
import { chat as ollamaChat } from './ollama/OllamaClient.js'
import { cloudChat, type CloudProviderConfig, type CloudProvider, validateApiKey } from './cloud/CloudClient.js'
import { getInstalledModels, getModelStats, selectModel, selectRagModel, setFallbackModels, loadConfig, saveConfig, getBestRagModel } from './ollama/ModelManager.js'
import { loadSettings, saveSettings, getPublicSettings } from './settings/SettingsStore.js'
import { scanProjectFiles, generateProjectSummary } from './mcp/ProjectScanner.js'
import { connectMCP } from './mcp/MCPClient.js'
import { scanProject, updateFile, getSymbols, findSymbol, getSummary, getConflicts, buildAgentContext, clearGraph } from './knowledge/KnowledgeGraph.js'
import { runEnforcer, getCachedReport, clearReport, buildContractContext } from './knowledge/ContractEnforcer.js'
import { getStatus, getLog, getBranches, getDiff, getCommitDiff } from './git/GitReader.js'
import { runRAG, injectRAGContext, hasWebTrigger } from './rag/RAGPipeline.js'

type ChatRole = 'system' | 'user' | 'assistant'

const server = Fastify({ logger: false, connectionTimeout: 0, keepAliveTimeout: 0 })
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

function getLanIp(): string {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    if (/lo|utun|vmnet|veth/i.test(name)) continue
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}

const DEFAULT_SHELL = detectShell()
const LAN_IP        = getLanIp()

function broadcast(data: object) {
  const msg = JSON.stringify(data)
  wsClients.forEach(ws => { try { ws.send(msg) } catch { wsClients.delete(ws) } })
}

function buildSystemPrompt(modelName: string, summary?: string | null, knowledgeCtx?: string, contractCtx?: string, extraSystemPrompt?: string): string {
  return (
    `You are a helpful AI coding assistant inside LocalForge, powered by ${modelName}. ` +
    `Always use clean Markdown. Do not add filler phrases. When uncertain, say so explicitly rather than guessing.` +
    (extraSystemPrompt ? `\n\n${extraSystemPrompt}` : '') +
    (summary           ? `\n\nProject context:\n${summary}` : '') +
    (knowledgeCtx      ? `\n\n${knowledgeCtx}` : '') +
    (contractCtx       ? `\n\n${contractCtx}`  : '')
  )
}

function mapHistory(h: Array<{ role: string; content: string }>) {
  return h.slice(-20).map(x => ({ role: x.role as ChatRole, content: x.content }))
}

function setupSSE(reply: any) {
  reply.raw.setTimeout(0)
  reply.raw.setHeader('Access-Control-Allow-Origin', '*')
  reply.raw.setHeader('Content-Type', 'text/event-stream')
  reply.raw.setHeader('Cache-Control', 'no-cache')
  reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.setHeader('X-Accel-Buffering', 'no')
  reply.raw.flushHeaders()
  return (data: object) => { try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`) } catch { } }
}

// ── Unified chat function — routes to Ollama or cloud ────────────────────────

async function routedChat(
  messages: Array<{ role: ChatRole; content: string }>,
  onChunk?: (chunk: string) => void
): Promise<{ content: string; modelUsed: string; provider: string }> {
  const settings = loadSettings()
  const provider = settings.activeProvider

  if (provider === 'ollama') {
    const { selectedModel } = loadConfig()
    const content = await ollamaChat(selectedModel, messages, onChunk ? (c) => onChunk(c.content) : undefined)
    return { content, modelUsed: selectedModel, provider: 'ollama' }
  }

  // Cloud provider
  const apiKeys  = settings.apiKeys
  const model    = settings.cloudModels[provider as CloudProvider] ?? ''
  const defaults = settings.llmDefaults

  let apiKey = ''
  let baseUrl: string | undefined
  if (provider === 'openai')  apiKey = apiKeys.openai  ?? ''
  if (provider === 'gemini')  apiKey = apiKeys.gemini  ?? ''
  if (provider === 'claude')  apiKey = apiKeys.claude  ?? ''
  if (provider === 'groq')    apiKey = apiKeys.groq    ?? ''
  if (provider === 'custom') { apiKey = apiKeys.customKey ?? ''; baseUrl = apiKeys.customUrl }

  if (!apiKey) throw new Error(`No API key configured for ${provider}. Go to Settings → Cloud Providers.`)

  const config: CloudProviderConfig = { provider: provider as CloudProvider, apiKey, model, baseUrl }
  const content = await cloudChat(config, messages, onChunk ? (c) => onChunk(c.content) : undefined, {
    temperature: defaults.temperature,
    maxTokens:   defaults.maxTokens,
  })

  return { content, modelUsed: model, provider }
}

async function bootstrap() {
  await server.register(cors, { origin: (_: any, cb: any) => cb(null, true), methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','Accept'], credentials: true, preflight: true, strictPreflight: false })
  await server.register(websocket)

  const profile = await profileSystem()
  const config  = loadConfig()
  taskQueue = new TaskQueue(config.executionMode ?? profile.recommendedMode, config.maxParallel ?? profile.recommendedMaxParallel)
  getDb(); initSessionTables()

  orchestrator.onEvent((projectId, event) => {
    broadcast({ type: 'agent_event', projectId, event })
    if (event.type === 'file_written' && event.filePath) {
      const s = getSession(projectId); if (s?.rootPath) updateFile(projectId, event.filePath)
    }
  })

  // ── WebSocket ──────────────────────────────────────────────────────────────
  server.get('/ws', { websocket: true }, (socket) => {
    wsClients.add(socket); socket.send(JSON.stringify({ type: 'connected' }))
    socket.on('close', () => wsClients.delete(socket))
  })

  server.get<{ Querystring: { cwd?: string } }>('/terminal', { websocket: true }, (socket, req) => {
    const cwd = fs.existsSync(req.query.cwd ?? '') ? req.query.cwd! : os.homedir()
    let ptyProc: ReturnType<typeof pty.spawn> | null = null
    try {
      ptyProc = pty.spawn(DEFAULT_SHELL, [], {
        name: 'xterm-256color', cols: 120, rows: 30, cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'LocalForge', HOME: process.env.HOME ?? os.homedir(), USER: process.env.USER ?? os.userInfo().username, SHELL: DEFAULT_SHELL, PATH: process.env.PATH ?? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: process.env.LANG ?? 'en_US.UTF-8' } as any,
      })
      ptyProc.onData((d: string) => { try { socket.send(d) } catch { } })
      ptyProc.onExit(({ exitCode }) => { try { socket.send(`\r\n\x1b[90m[shell exited ${exitCode}]\x1b[0m\r\n`) } catch { } try { socket.close() } catch { } })
      socket.on('message', (raw: Buffer | string) => {
        if (!ptyProc) return
        const str = typeof raw === 'string' ? raw : raw.toString('utf8')
        try { const m = JSON.parse(str); if (m.type==='input') ptyProc.write(m.data); if (m.type==='resize') ptyProc.resize(Math.max(1,Math.floor(Number(m.cols))),Math.max(1,Math.floor(Number(m.rows)))) } catch { ptyProc.write(str) }
      })
      socket.on('close', () => { if (ptyProc) { try { ptyProc.kill() } catch { } ptyProc = null } })
    } catch (err: any) { try { socket.send(`\r\n\x1b[31m[Failed: ${err.message}]\x1b[0m\r\n`) } catch { } try { socket.close() } catch { } }
  })

  // ── Health ─────────────────────────────────────────────────────────────────
  server.get('/health', async () => ({ status: 'ok', mode: taskQueue.currentMode, shell: DEFAULT_SHELL }))
  server.get('/system', async () => profileSystem())
  server.post<{ Body: { mode: 'sequential'|'parallel'; maxParallel?: number } }>('/system/mode', async (req) => { taskQueue.setMode(req.body.mode, req.body.maxParallel); saveConfig({ executionMode: req.body.mode, maxParallel: req.body.maxParallel ?? 1 }); return { success: true } })
  server.get('/network/info', async () => ({ lanIp: LAN_IP, hostname: os.hostname(), platform: os.platform() }))

  // ── Settings endpoints ─────────────────────────────────────────────────────
  server.get('/settings', async () => getPublicSettings())
  server.post<{ Body: Partial<import('./settings/SettingsStore.js').AppSettings> }>('/settings', async (req) => {
    // Never accept raw API keys from the body if they look masked
    const body = { ...req.body }
    if (body.apiKeys) {
      const cleaned: Record<string, string> = {}
      for (const [k, v] of Object.entries(body.apiKeys)) {
        // Only save if it doesn't look like a masked value (doesn't start with •)
        if (v && !String(v).startsWith('•')) cleaned[k] = String(v)
      }
      body.apiKeys = cleaned as any
    }
    return { success: true, settings: getPublicSettings() }
  })
  // Separate endpoint for updating API keys (avoids accidental masking)
  server.post<{ Body: { provider: string; apiKey: string; baseUrl?: string } }>('/settings/apikey', async (req) => {
    const { provider, apiKey, baseUrl } = req.body
    if (!provider || !apiKey) return { success: false, error: 'provider and apiKey required' }
    const update: Record<string, string> = {}
    if (provider === 'openai') update.openai = apiKey
    else if (provider === 'gemini') update.gemini = apiKey
    else if (provider === 'claude') update.claude = apiKey
    else if (provider === 'groq')   update.groq   = apiKey
    else if (provider === 'custom') { update.customKey = apiKey; if (baseUrl) update.customUrl = baseUrl }
    saveSettings({ apiKeys: update as any })
    return { success: true }
  })
  server.post<{ Body: { provider: string } }>('/settings/apikey/delete', async (req) => {
    const { provider } = req.body
    const cur = loadSettings()
    const keys = { ...cur.apiKeys }
    if (provider === 'openai') delete keys.openai
    else if (provider === 'gemini') delete keys.gemini
    else if (provider === 'claude') delete keys.claude
    else if (provider === 'groq')   delete keys.groq
    else if (provider === 'custom') { delete keys.customKey; delete keys.customUrl }
    saveSettings({ apiKeys: keys })
    return { success: true }
  })
  // Validate an API key
  server.post<{ Body: { provider: CloudProvider; apiKey: string; model: string; baseUrl?: string } }>('/settings/apikey/validate', async (req) => {
    const { provider, apiKey, model, baseUrl } = req.body
    const result = await validateApiKey({ provider, apiKey, model, baseUrl })
    return result
  })
  // Update active provider + cloud model
  server.post<{ Body: { activeProvider: string; cloudModel?: string } }>('/settings/provider', async (req) => {
    const { activeProvider, cloudModel } = req.body
    const update: any = { activeProvider }
    if (cloudModel) {
      const cur = loadSettings()
      update.cloudModels = { ...cur.cloudModels, [activeProvider]: cloudModel }
    }
    saveSettings(update)
    return { success: true, settings: getPublicSettings() }
  })
  // Update LLM defaults
  server.post<{ Body: Partial<import('./settings/SettingsStore.js').AppSettings['llmDefaults']> }>('/settings/llm', async (req) => {
    saveSettings({ llmDefaults: req.body as any })
    return { success: true }
  })

  // ── Models (Ollama) ────────────────────────────────────────────────────────
  server.get('/models', async () => { try { return { models: await getInstalledModels() } } catch { return { error: 'Ollama not reachable', models: [] } } })
  server.get('/models/stats', async () => { try { return await getModelStats() } catch (e: any) { return { error: e.message } } })
  server.get('/models/config', async () => loadConfig())
  server.post<{ Body: { model: string } }>('/models/select', async (req) => { if (!req.body.model) return { success: false }; return selectModel(req.body.model) })
  server.post<{ Body: { model: string | null } }>('/models/rag', async (req) => selectRagModel(req.body.model))
  server.post<{ Body: { models: string[] } }>('/models/fallback', async (req) => ({ success: true, config: await setFallbackModels(req.body.models) }))

  // ── Sessions ───────────────────────────────────────────────────────────────
  server.get('/sessions', async () => ({ sessions: getAllSessions() }))
  server.get<{ Params: { id: string } }>('/sessions/:id', async (req) => { const s = getSession(req.params.id); return s ? { session: s, messages: getSessionMessages(req.params.id) } : { error: 'Not found' } })
  server.post<{ Body: { id: string; type: string; title: string; rootPath?: string; modelName?: string } }>('/sessions', async (req) => { const { id, type, title, rootPath, modelName } = req.body; return { success: true, session: upsertSession({ id, type: type as any, title, rootPath, modelName }) } })
  server.delete<{ Params: { id: string } }>('/sessions/:id', async (req) => { deleteSession(req.params.id); clearGraph(req.params.id); clearReport(req.params.id); return { success: true } })
  server.post<{ Body: { id: string; sessionId: string; role: string; content: string; agentName?: string } }>('/sessions/message', async (req) => {
    const { id, sessionId, role, content, agentName } = req.body
    if (!getSession(sessionId)) upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: loadConfig().selectedModel })
    saveMessage({ id, sessionId, role: role as any, content, agentName }); return { success: true }
  })

  // ── Project ────────────────────────────────────────────────────────────────
  server.post<{ Body: { sessionId: string; rootPath: string } }>('/project/open', async (req) => {
    const { sessionId, rootPath } = req.body; if (!rootPath) return { success: false, message: 'rootPath required' }
    await connectMCP(rootPath); const scan = scanProjectFiles(rootPath)
    setImmediate(() => { scanProject(sessionId, rootPath); try { runEnforcer(sessionId, rootPath) } catch { } broadcast({ type: 'knowledge_ready', sessionId }) })
    generateProjectSummary(sessionId, rootPath, scan).then(summary => broadcast({ type: 'project_summary', sessionId, summary }))
    return { success: true, isEmpty: scan.isEmpty, fileList: scan.fileList, fileTree: scan.fileTree, fileCount: scan.fileList.length }
  })
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/summary', async (req) => ({ summary: getSession(req.params.sessionId)?.summary ?? null }))
  server.get<{ Querystring: { path: string } }>('/project/file', async (req, reply) => { const p = req.query.path; if (!p) { reply.status(400).send({ error: 'path required' }); return } if (!fs.existsSync(p)) { reply.status(404).send({ error: 'not found' }); return } try { return { content: fs.readFileSync(p, 'utf8') } } catch (e: any) { reply.status(500).send({ error: e.message }) } })
  server.post<{ Body: { path: string; content: string } }>('/project/file', async (req, reply) => { const { path: p, content } = req.body; if (!p) { reply.status(400).send({ error: 'path required' }); return } try { fs.writeFileSync(p, content ?? '', 'utf8'); return { success: true } } catch (e: any) { reply.status(500).send({ error: e.message }) } })

  // ── Knowledge Graph ────────────────────────────────────────────────────────
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/symbols', async (req) => ({ symbols: getSymbols(req.params.sessionId) }))
  server.get<{ Params: { sessionId: string }; Querystring: { q?: string } }>('/project/:sessionId/symbols/search', async (req) => { const q = req.query.q ?? ''; return { symbols: q ? findSymbol(req.params.sessionId, q) : getSymbols(req.params.sessionId) } })
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/symbols/summary', async (req) => getSummary(req.params.sessionId))
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/symbols/conflicts', async (req) => ({ conflicts: getConflicts(req.params.sessionId) }))
  server.post<{ Params: { sessionId: string } }>('/project/:sessionId/symbols/rescan', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { success: false }; return { success: true, symbolCount: scanProject(req.params.sessionId, s.rootPath) } })

  // ── API Contracts ──────────────────────────────────────────────────────────
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/contracts', async (req) => { const c = getCachedReport(req.params.sessionId); if (c) return c; const s = getSession(req.params.sessionId); if (!s?.rootPath) return { error: 'No rootPath', violations: [], orphans: [], summary: null }; return runEnforcer(req.params.sessionId, s.rootPath) })
  server.post<{ Params: { sessionId: string } }>('/project/:sessionId/contracts/rescan', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { success: false }; return { success: true, summary: runEnforcer(req.params.sessionId, s.rootPath).summary } })

  // ── Git ────────────────────────────────────────────────────────────────────
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/git/status', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { isRepo: false }; return { isRepo: true, status: getStatus(s.rootPath) } })
  server.get<{ Params: { sessionId: string }; Querystring: { limit?: string; branch?: string } }>('/project/:sessionId/git/log', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { commits: [] }; return { commits: getLog(s.rootPath, Math.min(parseInt(req.query.limit ?? '50'), 200), req.query.branch ?? '') } })
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/git/branches', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { branches: [] }; return { branches: getBranches(s.rootPath) } })
  server.get<{ Params: { sessionId: string }; Querystring: { file?: string; staged?: string } }>('/project/:sessionId/git/diff', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { diffs: [] }; return { diffs: getDiff(s.rootPath, req.query.file, req.query.staged === 'true') } })
  server.get<{ Params: { sessionId: string; hash: string } }>('/project/:sessionId/git/commit/:hash', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { diffs: [] }; return { diffs: getCommitDiff(s.rootPath, req.params.hash) } })

  // ── Chat streaming (no RAG) ────────────────────────────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }> } }>(
    '/chat/stream', async (req, reply) => {
      const { message, sessionId, history = [] } = req.body
      if (!message) { reply.status(400).send('No message'); return }
      const send = setupSSE(reply)
      try {
        const settings  = loadSettings()
        const isProject = getSession(sessionId)?.type === 'project'
        if (!getSession(sessionId)) upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: loadConfig().selectedModel })
        const session = getSession(sessionId)

        const activeModelName = settings.activeProvider === 'ollama'
          ? loadConfig().selectedModel
          : (settings.cloudModels[settings.activeProvider as CloudProvider] ?? settings.activeProvider)

        const systemPrompt = buildSystemPrompt(activeModelName, session?.summary, isProject ? buildAgentContext(sessionId) : undefined, isProject ? buildContractContext(sessionId) : undefined, settings.llmDefaults.systemPrompt || undefined)
        const msgs = [
          { role: 'system' as ChatRole, content: systemPrompt },
          ...mapHistory(history),
          { role: 'user' as ChatRole, content: message },
        ]

        // Send provider info to client
        send({ type: 'provider', provider: settings.activeProvider, model: activeModelName })

        let full = ''
        const { modelUsed, provider } = await routedChat(msgs, (chunk) => { full += chunk; send({ chunk }) })
        reply.raw.write('data: [DONE]\n\n'); reply.raw.end()
        try { saveMessage({ id: randomUUID(), sessionId, role: 'assistant', content: full }) } catch { }
        console.log(`[Chat] ${provider}/${modelUsed} → ${full.length} chars`)
      } catch (err: any) {
        try { send({ chunk: `\n\n⚠️ **Error:** ${err.message}` }); reply.raw.write('data: [DONE]\n\n'); reply.raw.end() } catch { }
      }
    }
  )

  // ── Chat streaming WITH RAG ────────────────────────────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }> } }>(
    '/chat/stream/web', async (req, reply) => {
      const { message, sessionId, history = [] } = req.body
      if (!message) { reply.status(400).send('No message'); return }
      const send = setupSSE(reply); const forceWeb = hasWebTrigger(message)
      try {
        const settings  = loadSettings()
        const isProject = getSession(sessionId)?.type === 'project'
        if (!getSession(sessionId)) upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: loadConfig().selectedModel })
        const session = getSession(sessionId)

        const activeModelName = settings.activeProvider === 'ollama'
          ? loadConfig().selectedModel
          : (settings.cloudModels[settings.activeProvider as CloudProvider] ?? settings.activeProvider)

        let systemPrompt = buildSystemPrompt(activeModelName, session?.summary, isProject ? buildAgentContext(sessionId) : undefined, isProject ? buildContractContext(sessionId) : undefined, settings.llmDefaults.systemPrompt || undefined)
        const rag = await runRAG(message, forceWeb, (status) => send({ type: 'rag_status', status }))

        if (rag.didSearch) {
          systemPrompt = injectRAGContext(systemPrompt, rag)
          if (rag.sources.length > 0) send({ type: 'rag_sources', sources: rag.sources.map(s => ({ title: s.title, url: s.url })) })
          if (rag.extractedFacts && !rag.ragFailed) send({ chunk: rag.extractedFacts + '\n' })
        }

        send({ type: 'provider', provider: settings.activeProvider, model: activeModelName })

        const cleanMessage = message.replace(/^@web\s*/i, '').trim()
        const msgs = [
          { role: 'system' as ChatRole, content: systemPrompt },
          ...mapHistory(history),
          { role: 'user' as ChatRole, content: cleanMessage },
        ]

        let full = rag.extractedFacts ?? ''
        await routedChat(msgs, (chunk) => { full += chunk; send({ chunk }) })
        reply.raw.write('data: [DONE]\n\n'); reply.raw.end()
        try { saveMessage({ id: randomUUID(), sessionId, role: 'assistant', content: full }) } catch { }
      } catch (err: any) {
        try { send({ chunk: `\n\n⚠️ **Error:** ${err.message}` }); reply.raw.write('data: [DONE]\n\n'); reply.raw.end() } catch { }
      }
    }
  )

  // ── Chat non-streaming ─────────────────────────────────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }> } }>('/chat', async (req) => {
    const { message, sessionId, history = [] } = req.body; if (!message) return { success: false, reply: 'No message' }
    const settings = loadSettings(); const session = getSession(sessionId)
    const modelName = settings.activeProvider === 'ollama' ? loadConfig().selectedModel : (settings.cloudModels[settings.activeProvider as CloudProvider] ?? '')
    const msgs = [{ role: 'system' as ChatRole, content: buildSystemPrompt(modelName, session?.summary) }, ...mapHistory(history), { role: 'user' as ChatRole, content: message }]
    const { content } = await routedChat(msgs)
    return { success: true, reply: content }
  })

  // ── Projects / Agents ──────────────────────────────────────────────────────
  server.get('/projects', async () => ({ projects: orchestrator.listProjects() }))
  server.post<{ Body: { name: string; rootPath: string } }>('/projects', async (req) => { const { name, rootPath } = req.body; if (!name || !rootPath) return { success: false }; const p = await orchestrator.createProject({ name, rootPath }); return { success: true, project: { id: p.id, name: p.name, rootPath: p.rootPath } } })
  server.get<{ Params: { projectId: string } }>('/projects/:projectId/agents', async (req) => ({ agents: orchestrator.listAgents(req.params.projectId) }))
  server.post<{ Params: { projectId: string }; Body: { name: string; role: string; allowedPaths?: string[] } }>('/projects/:projectId/agents', async (req) => { const { name, role, allowedPaths } = req.body; if (!name || !role) return { success: false }; const agent = orchestrator.addAgent(req.params.projectId, { name, role: role as any, allowedPaths: allowedPaths ?? [], projectPath: orchestrator.getProject(req.params.projectId).rootPath }); return { success: true, agent: { id: agent.id, name: agent.config.name, role: agent.config.role } } })
  server.post<{ Params: { projectId: string; agentId: string }; Body: { instruction: string; queue?: boolean } }>('/projects/:projectId/agents/:agentId/instruct', async (req) => { const { instruction, queue = true } = req.body; if (!instruction) return { success: false }; if (queue) { await orchestrator.runInstruction(req.params.projectId, req.params.agentId, instruction); return { success: true } }; await orchestrator.runInstructionDirect(req.params.projectId, req.params.agentId, instruction); return { success: true } })

  const PORT = Number(process.env.PORT ?? 3001)
  await server.listen({ port: PORT, host: '0.0.0.0' })
  const settings = loadSettings()
  console.log(`\n🔨 LocalForge  :${PORT}  |  Provider: ${settings.activeProvider}`)
  console.log(`   Shell: ${DEFAULT_SHELL}  |  LAN: ${LAN_IP}\n`)
}

process.on('SIGINT', async () => { await server.close(); closeDb(); process.exit(0) })
bootstrap().catch(err => { console.error('[Server] Fatal:', err); process.exit(1) })
