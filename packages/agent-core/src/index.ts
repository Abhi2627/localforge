import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import pty from 'node-pty'
import os from 'os'
import path from 'path'
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
import { getStatus, getLog, getBranches, getDiff, getCombinedDiff, getDiffAll, getCommitDiff } from './git/GitReader.js'
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

function buildSystemPrompt(modelName: string, summary?: string | null, knowledgeCtx?: string, contractCtx?: string, extra?: string, fileContents?: Record<string, string>): string {
  // Build a block of actual file contents so the model reads real data, not hallucinations
  const fileBlock = fileContents && Object.keys(fileContents).length > 0
    ? '\n\nProject files (read these carefully before answering):\n' +
      Object.entries(fileContents)
        .map(([name, content]) => `\n--- ${name} ---\n${content}`)
        .join('\n')
    : ''

  return (
    `You are a helpful AI coding assistant inside LocalForge, powered by ${modelName}. ` +
    `Format rules: use plain readable text. Do NOT use LaTeX syntax. ` +
    `Use Markdown only for code blocks, headers, and lists. Do not use ** for bold in prose. ` +
    `Do not add filler phrases. When uncertain, say so rather than guessing.\n\n` +
    `CRITICAL RULE — WRITING FILES: When the user asks you to write, create, edit, update, or fix ANY file, ` +
    `you MUST use this EXACT format and NO OTHER format:\n\n` +
    `\`\`\`write:path/to/filename.ext\n` +
    `<complete file content here>\n` +
    `\`\`\`\n\n` +
    `IMPORTANT: The backtick fence MUST start with write: followed immediately by the file path. ` +
    `DO NOT use \`\`\`typescript or \`\`\`javascript or any language tag when writing a file. ` +
    `ALWAYS write the COMPLETE file content, never partial snippets. ` +
    `Use the relative path from the project root. ` +
    `After the write block, briefly explain what you wrote and why.\n\n` +
    `Example of CORRECT format:\n` +
    `\`\`\`write:src/utils/hello.ts\n` +
    `export function hello(): string {\n` +
    `  return 'Hello, world!'\n` +
    `}\n` +
    `\`\`\`\n\n` +
    `Example of WRONG format (never do this):\n` +
    `\`\`\`typescript\n` +
    `export function hello() { ... }\n` +
    `\`\`\`` +
    (extra        ? `\n\n${extra}`                    : '') +
    (summary      ? `\n\nProject summary:\n${summary}` : '') +
    fileBlock +
    (knowledgeCtx ? `\n\n${knowledgeCtx}`              : '') +
    (contractCtx  ? `\n\n${contractCtx}`               : '')
  )
}

// Classify API errors into user-friendly actionable messages
function classifyApiError(err: Error, provider: string, model: string): string {
  const msg = err.message.toLowerCase()
  const isGroq    = provider === 'groq'
  const isGemini  = provider === 'gemini'
  const isClaude  = provider === 'claude'
  const isOpenAI  = provider === 'openai'

  // Rate limit (429)
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('too many requests')) {
    if (isGroq) return [
      '⚠️ **Groq rate limit reached**',
      '',
      'Groq\'s free tier limits: **30 requests/min** and **6,000 tokens/min**.',
      '',
      '**Immediate options:**',
      '- Wait 60 seconds and retry',
      '- Switch to a smaller model: `llama-3.1-8b-instant` uses fewer tokens',
      '- Switch to Gemini Flash (also free, higher limits) in **Settings → Cloud**',
      '- Pull a local Ollama model: `ollama pull qwen2.5-coder:1.5b` — no rate limits',
    ].join('\n')
    if (isGemini) return [
      '⚠️ **Gemini rate limit reached**',
      '',
      'Gemini free tier: **15 requests/min**, **1M tokens/day**.',
      '',
      '**Immediate options:**',
      '- Wait 60 seconds and retry',
      '- Switch to `gemini-2.0-flash-lite` (lighter model, same free tier)',
      '- Switch to Groq in **Settings → Cloud** (also free)',
      '- Pull a local model: `ollama pull qwen2.5-coder:1.5b`',
    ].join('\n')
    if (isOpenAI) return [
      '⚠️ **OpenAI rate limit reached**',
      '',
      'Your OpenAI account has hit its rate or spending limit.',
      '',
      '**Immediate options:**',
      '- Check your limits at [platform.openai.com/limits](https://platform.openai.com/limits)',
      '- Switch to `gpt-4o-mini` (cheaper, higher rate limits)',
      '- Switch to Gemini or Groq (free) in **Settings → Cloud**',
      '- Pull a local model to avoid API costs entirely',
    ].join('\n')
    if (isClaude) return [
      '⚠️ **Anthropic rate limit reached**',
      '',
      'Your Claude API key has hit its rate limit.',
      '',
      '**Immediate options:**',
      '- Switch to `claude-haiku-4-5` (fastest, cheapest, higher rate limits)',
      '- Check usage at [console.anthropic.com](https://console.anthropic.com)',
      '- Switch to Gemini or Groq (free) in **Settings → Cloud**',
    ].join('\n')
    return `⚠️ **Rate limit reached for ${provider}**\n\nWait 60 seconds then retry, or switch providers in **Settings → Cloud**.`
  }

  // Token / context limit
  if (msg.includes('context') && (msg.includes('length') || msg.includes('limit') || msg.includes('exceed') || msg.includes('too long'))) {
    return [
      '⚠️ **Context length exceeded**',
      '',
      `The conversation is too long for **${model}** to process in one request.`,
      '',
      '**Immediate options:**',
      '- Start a new chat (this one has too much history)',
      '- Reduce **Max tokens** in **Settings → LLM**',
      ...(provider === 'ollama' ? ['- Increase **Ollama context length (num_ctx)** in **Settings → LLM**'] : []),
      '- Use a model with a larger context window',
    ].join('\n')
  }

  // Quota / billing exceeded
  if (msg.includes('quota') || msg.includes('billing') || msg.includes('insufficient_quota') || msg.includes('exceeded your') || msg.includes('payment')) {
    return [
      '⚠️ **API quota or billing limit reached**',
      '',
      `Your **${provider}** account has run out of credits or hit its monthly quota.`,
      '',
      '**Immediate options:**',
      '- Add billing/credits at your provider dashboard',
      '- Switch to a free provider (Gemini or Groq) in **Settings → Cloud**',
      '- Pull a local Ollama model — completely free, no quotas',
    ].join('\n')
  }

  // Invalid API key
  if (msg.includes('401') || msg.includes('invalid api key') || msg.includes('unauthorized') || msg.includes('invalid_api_key') || msg.includes('authentication')) {
    return [
      '⚠️ **Invalid API key**',
      '',
      `The API key for **${provider}** is invalid or has been revoked.`,
      '',
      '**Fix:** Go to **Settings → Cloud** → ${provider} → enter a new API key.',
    ].join('\n')
  }

  // Model not found
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist') || msg.includes('invalid'))) {
    return [
      `⚠️ **Model not found: ${model}**`,
      '',
      `The model **${model}** is not available on **${provider}**.`,
      '',
      '**Fix:** Go to **Settings → Cloud** → ${provider} → select a different model.',
    ].join('\n')
  }

  // Ollama-specific
  if (msg.includes('out of memory') || msg.includes('cannot allocate') || msg.includes('ggml_') || msg.includes('metal')) {
    return [
      '⚠️ **Not enough RAM for this model**',
      '',
      '**Immediate options:**',
      '- Close other apps to free memory',
      '- Use a smaller model: `ollama pull qwen2.5-coder:1.5b` (1.1 GB)',
      '- Switch to a cloud provider (Gemini/Groq are free) in **Settings → Cloud**',
    ].join('\n')
  }

  if (msg.includes('fetch') || msg.includes('timeout') || msg.includes('abort') || msg.includes('econnrefused')) {
    return provider === 'ollama'
      ? '⚠️ **Cannot reach Ollama**\n\nMake sure Ollama is running:\n```\nollama serve\n```'
      : `⚠️ **Connection failed for ${provider}**\n\nCheck your internet connection and retry.`
  }

  return `⚠️ **Error from ${provider}:** ${err.message}`
}

function mapHistory(h: Array<{ role: string; content: string }>) {
  return h.slice(-20).map(x => ({ role: x.role as ChatRole, content: x.content }))
}

// Read key project files (README, package.json etc) to inject as real content into context
// Capped so we don't blow the context window. README gets up to 8000 chars, others 1500 each.
const KEY_FILES_FOR_CONTEXT = [
  'README.md', 'readme.md', 'README.txt',
  'package.json', 'tsconfig.json', 'vite.config.ts',
  'pyproject.toml', 'Cargo.toml', 'go.mod',
]

function readProjectFilesForContext(rootPath: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!rootPath || !fs.existsSync(rootPath)) return result
  for (const name of KEY_FILES_FOR_CONTEXT) {
    const full = path.join(rootPath, name)
    if (!fs.existsSync(full)) continue
    try {
      const raw   = fs.readFileSync(full, 'utf8')
      const limit = name.toLowerCase().startsWith('readme') ? 8000 : 1500
      result[name] = raw.length > limit ? raw.slice(0, limit) + '\n[... truncated ...]' : raw
    } catch { }
  }
  return result
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

// ── Unified chat — routes to Ollama or cloud provider ────────────────────────

async function routedChat(
  messages:  Array<{ role: ChatRole; content: string }>,
  onChunk?:  (chunk: string) => void,
  settings?: ReturnType<typeof loadSettings>
): Promise<{ content: string; modelUsed: string; provider: string }> {
  const s        = settings ?? loadSettings()
  const provider = s.activeProvider

  if (provider === 'ollama') {
    const { selectedModel } = loadConfig()
    if (!selectedModel) throw new Error('No Ollama model selected. Go to the Model Advisor to select one.')
    const content = await ollamaChat(selectedModel, messages, onChunk ? (c) => onChunk(c.content) : undefined)
    return { content, modelUsed: selectedModel, provider: 'ollama' }
  }

  const model  = s.cloudModels[provider as CloudProvider] ?? ''
  const keys   = s.apiKeys
  let apiKey   = ''
  let baseUrl: string | undefined

  if (provider === 'openai') apiKey = keys.openai  ?? ''
  if (provider === 'gemini') apiKey = keys.gemini  ?? ''
  if (provider === 'claude') apiKey = keys.claude  ?? ''
  if (provider === 'groq')   apiKey = keys.groq    ?? ''
  if (provider === 'custom') { apiKey = keys.customKey ?? ''; baseUrl = keys.customUrl }

  if (!apiKey) throw new Error(`No API key for ${provider}. Go to Settings → Cloud Providers.`)

  const config: CloudProviderConfig = { provider: provider as CloudProvider, apiKey, model, baseUrl }
  const content = await cloudChat(config, messages, onChunk ? (c) => onChunk(c.content) : undefined, {
    temperature: s.llmDefaults.temperature,
    maxTokens:   s.llmDefaults.maxTokens,
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

  // ── MCP status ────────────────────────────────────────────────────────────
  // Track which project paths have an active MCP connection
  const mcpConnected = new Set<string>()

  server.get<{ Querystring: { path?: string } }>('/mcp/status', async (req) => {
    const projectPath = req.query.path
    if (!projectPath) return { connected: false, error: 'No path provided' }
    return { connected: mcpConnected.has(projectPath), path: projectPath }
  })

  server.post<{ Body: { path: string } }>('/mcp/connect', async (req) => {
    const { path: projectPath } = req.body
    if (!projectPath) return { success: false, error: 'No path provided' }
    try {
      await connectMCP(projectPath)
      mcpConnected.add(projectPath)
      return { success: true, connected: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Health ─────────────────────────────────────────────────────────────────
  server.get('/health', async () => ({ status: 'ok', mode: taskQueue.currentMode, shell: DEFAULT_SHELL }))

  // ── Git direct (rootPath-based, bypasses DB lookup) ─────────────────────────
  // Used when session may not yet be persisted in SQLite (race condition on first open)
  server.get<{ Querystring: { rootPath: string } }>('/git/direct/status', async (req) => {
    const p = req.query.rootPath; if (!p) return { isRepo: false }
    return { isRepo: true, status: getStatus(p) }
  })
  server.get<{ Querystring: { rootPath: string; limit?: string; branch?: string } }>('/git/direct/log', async (req) => {
    const p = req.query.rootPath; if (!p) return { commits: [] }
    return { commits: getLog(p, Math.min(parseInt(req.query.limit ?? '100'), 500), req.query.branch ?? '') }
  })
  server.get<{ Querystring: { rootPath: string } }>('/git/direct/branches', async (req) => {
    const p = req.query.rootPath; if (!p) return { branches: [] }
    return { branches: getBranches(p) }
  })
  server.get<{ Querystring: { rootPath: string; file?: string; staged?: string } }>('/git/direct/diff', async (req) => {
    const p = req.query.rootPath; if (!p) return { diffs: [] }
    if (req.query.staged === 'all') return { diffs: getDiffAll(p, req.query.file) }
    return { diffs: getDiff(p, req.query.file, req.query.staged === 'true') }
  })

  // Commit diff — all files changed in a commit
  server.get<{ Params: { hash: string }; Querystring: { rootPath: string } }>('/git/direct/commit/:hash', async (req) => {
    const { rootPath: p } = req.query; const { hash } = req.params
    if (!p || !hash) return { diffs: [] }
    return { diffs: getCommitDiff(p, hash) }
  })

  // File content at a specific commit (or its parent)
  server.get<{ Querystring: { rootPath: string; file: string; hash: string; parent?: string } }>('/git/direct/file-at-commit', async (req) => {
    const { rootPath: p, file, hash, parent } = req.query
    if (!p || !file || !hash) return { content: '' }
    try {
      const { execFileSync } = await import('child_process')
      const ref     = parent === 'true' ? `${hash}^:${file}` : `${hash}:${file}`
      const content = execFileSync('git', ['show', ref], {
        cwd: p, encoding: 'utf8', timeout: 10000,
        maxBuffer: 1024 * 1024 * 20,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      return { content }
    } catch {
      return { content: '' }
    }
  })

  // Returns the committed (HEAD) or staged version of a file — used for full-file diff view
  server.get<{ Querystring: { rootPath: string; file: string; staged?: string } }>('/git/direct/file-at-head', async (req) => {
    const { rootPath: p, file, staged } = req.query
    if (!p || !file) return { content: '' }
    try {
      // Use execFileSync with array args to avoid ALL shell quoting issues
      // staged=true  → :0:filepath  (index/staging area, stage 0)
      // staged=false → HEAD:filepath (last commit)
      const { execFileSync } = await import('child_process')
      const ref     = staged === 'true' ? `:0:${file}` : `HEAD:${file}`
      const content = execFileSync('git', ['show', ref], {
        cwd: p, encoding: 'utf8', timeout: 10000,
        maxBuffer: 1024 * 1024 * 20,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      return { content }
    } catch {
      return { content: '' }  // new file — no HEAD/index version
    }
  })
  server.get('/system', async () => profileSystem())
  server.get('/system/info', async () => {
    const os_ = await import('os')
    const cpus = os_.default.cpus()
    return {
      totalRam: os_.default.totalmem(),
      freeRam:  os_.default.freemem(),
      platform: os_.default.platform(),
      arch:     os_.default.arch(),
      cpuModel: cpus[0]?.model ?? 'Unknown',
      cpuCount: cpus.length,
    }
  })
  server.post<{ Body: { mode: 'sequential'|'parallel'; maxParallel?: number } }>('/system/mode', async (req) => { taskQueue.setMode(req.body.mode, req.body.maxParallel); saveConfig({ executionMode: req.body.mode, maxParallel: req.body.maxParallel ?? 1 }); return { success: true } })
  server.get('/network/info', async () => ({ lanIp: LAN_IP, hostname: os.hostname(), platform: os.platform() }))

  // ── Settings ───────────────────────────────────────────────────────────────
  server.get('/settings', async () => getPublicSettings())
  server.post<{ Body: Record<string, any> }>('/settings', async (req) => {
    // Generic settings update — handles autoApply, fontSize, and other top-level fields
    const allowed = ['autoApply', 'fontSize']
    const update: Record<string, any> = {}
    for (const key of allowed) { if (key in req.body) update[key] = req.body[key] }
    if (Object.keys(update).length > 0) saveSettings(update as any)
    return { success: true, settings: getPublicSettings() }
  })
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
    const cur  = loadSettings(); const keys = { ...cur.apiKeys }
    if (provider === 'openai') delete keys.openai
    else if (provider === 'gemini') delete keys.gemini
    else if (provider === 'claude') delete keys.claude
    else if (provider === 'groq')   delete keys.groq
    else if (provider === 'custom') { delete keys.customKey; delete keys.customUrl }
    saveSettings({ apiKeys: keys }); return { success: true }
  })
  server.post<{ Body: { provider: CloudProvider; apiKey: string; model: string; baseUrl?: string } }>('/settings/apikey/validate', async (req) => {
    return validateApiKey({ provider: req.body.provider, apiKey: req.body.apiKey, model: req.body.model, baseUrl: req.body.baseUrl })
  })
  server.post<{ Body: { activeProvider: string; cloudModel?: string } }>('/settings/provider', async (req) => {
    const { activeProvider, cloudModel } = req.body
    const update: any = { activeProvider }
    if (cloudModel) { const cur = loadSettings(); update.cloudModels = { ...cur.cloudModels, [activeProvider]: cloudModel } }
    saveSettings(update); return { success: true, settings: getPublicSettings() }
  })
  server.post<{ Body: Partial<ReturnType<typeof loadSettings>['llmDefaults']> }>('/settings/llm', async (req) => {
    saveSettings({ llmDefaults: req.body as any }); return { success: true }
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
  server.post<{ Body: { id: string; type: string; title: string; rootPath?: string; modelName?: string } }>('/sessions', async (req) => {
    const { id, type, title, rootPath, modelName } = req.body
    return { success: true, session: upsertSession({ id, type: type as any, title, rootPath, modelName }) }
  })
  server.delete<{ Params: { id: string } }>('/sessions/:id', async (req) => {
    deleteSession(req.params.id); clearGraph(req.params.id); clearReport(req.params.id)
    return { success: true }
  })
  server.post<{ Body: { id: string; sessionId: string; role: string; content: string; agentName?: string } }>('/sessions/message', async (req) => {
    const { id, sessionId, role, content, agentName } = req.body
    if (!getSession(sessionId)) upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: loadConfig().selectedModel })
    saveMessage({ id, sessionId, role: role as any, content, agentName }); return { success: true }
  })

  // ── Project ────────────────────────────────────────────────────────────────
  server.post<{ Body: { sessionId: string; rootPath: string } }>('/project/open', async (req) => {
    const { sessionId, rootPath } = req.body; if (!rootPath) return { success: false, message: 'rootPath required' }
    await connectMCP(rootPath)
    mcpConnected.add(rootPath)   // mark as connected so /mcp/status reflects it
    const scan = scanProjectFiles(rootPath)
    setImmediate(() => { scanProject(sessionId, rootPath); try { runEnforcer(sessionId, rootPath) } catch { } broadcast({ type: 'knowledge_ready', sessionId }) })
    generateProjectSummary(sessionId, rootPath, scan).then(summary => broadcast({ type: 'project_summary', sessionId, summary }))
    return { success: true, isEmpty: scan.isEmpty, fileList: scan.fileList, fileTree: scan.fileTree, fileCount: scan.fileList.length }
  })
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/summary', async (req) => ({ summary: getSession(req.params.sessionId)?.summary ?? null }))
  server.get<{ Querystring: { path: string } }>('/project/file', async (req, reply) => {
    const p = req.query.path; if (!p) { reply.status(400).send({ error: 'path required' }); return }
    if (!fs.existsSync(p)) { reply.status(404).send({ error: 'not found' }); return }
    try { return { content: fs.readFileSync(p, 'utf8') } } catch (e: any) { reply.status(500).send({ error: e.message }) }
  })
  server.post<{ Body: { path: string; content: string } }>('/project/file', async (req, reply) => {
    const { path: p, content } = req.body; if (!p) { reply.status(400).send({ error: 'path required' }); return }
    try { fs.writeFileSync(p, content ?? '', 'utf8'); return { success: true } } catch (e: any) { reply.status(500).send({ error: e.message }) }
  })

  // ── Knowledge Graph ────────────────────────────────────────────────────────
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/symbols', async (req) => ({ symbols: getSymbols(req.params.sessionId) }))
  server.get<{ Params: { sessionId: string }; Querystring: { q?: string } }>('/project/:sessionId/symbols/search', async (req) => { const q = req.query.q ?? ''; return { symbols: q ? findSymbol(req.params.sessionId, q) : getSymbols(req.params.sessionId) } })
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/symbols/summary', async (req) => getSummary(req.params.sessionId))
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/symbols/conflicts', async (req) => ({ conflicts: getConflicts(req.params.sessionId) }))
  server.post<{ Params: { sessionId: string } }>('/project/:sessionId/symbols/rescan', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { success: false }; return { success: true, symbolCount: scanProject(req.params.sessionId, s.rootPath) } })

  // ── API Contracts ──────────────────────────────────────────────────────────
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/contracts', async (req) => { const c = getCachedReport(req.params.sessionId); if (c) return c; const s = getSession(req.params.sessionId); if (!s?.rootPath) return { error: 'No rootPath', violations: [], orphans: [], summary: null }; return runEnforcer(req.params.sessionId, s.rootPath) })
  server.post<{ Params: { sessionId: string } }>('/project/:sessionId/contracts/rescan', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { success: false }; return { success: true, summary: runEnforcer(req.params.sessionId, s.rootPath).summary } })

  // ── File management (VSCode-style operations) ──────────────────────────────
  server.delete<{ Querystring: { path: string } }>('/project/file', async (req, reply) => {
    const { path: filePath } = req.query
    if (!filePath) { reply.status(400).send('No path'); return }
    try {
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) fs.rmSync(filePath, { recursive: true, force: true })
      else fs.unlinkSync(filePath)
      return { success: true }
    } catch (err: any) { reply.status(500).send(err.message) }
  })

  server.post<{ Body: { source: string; destination: string } }>('/project/file/move', async (req, reply) => {
    const { source, destination } = req.body
    if (!source || !destination) { reply.status(400).send('Missing source/destination'); return }
    try { fs.renameSync(source, destination); return { success: true } }
    catch (err: any) { reply.status(500).send(err.message) }
  })

  server.post<{ Body: { source: string; destination: string } }>('/project/file/copy', async (req, reply) => {
    const { source, destination } = req.body
    if (!source || !destination) { reply.status(400).send('Missing source/destination'); return }
    try {
      function copyRecursive(src: string, dst: string) {
        const stat = fs.statSync(src)
        if (stat.isDirectory()) {
          fs.mkdirSync(dst, { recursive: true })
          fs.readdirSync(src).forEach(f => copyRecursive(path.join(src,f), path.join(dst,f)))
        } else {
          fs.mkdirSync(path.dirname(dst), { recursive: true })
          fs.copyFileSync(src, dst)
        }
      }
      copyRecursive(source, destination)
      return { success: true }
    } catch (err: any) { reply.status(500).send(err.message) }
  })

  server.post<{ Body: { path: string } }>('/project/folder', async (req, reply) => {
    const { path: folderPath } = req.body
    if (!folderPath) { reply.status(400).send('No path'); return }
    try { fs.mkdirSync(folderPath, { recursive: true }); return { success: true } }
    catch (err: any) { reply.status(500).send(err.message) }
  })

  // ── File extraction (PDF, DOCX, plain text) ─────────────────────────────
  server.post<{ Body: { path: string } }>('/project/file/extract', async (req, reply) => {
    const { path: filePath } = req.body
    if (!filePath) { reply.status(400).send({ error: 'path required' }); return }
    if (!fs.existsSync(filePath)) { reply.status(404).send({ error: 'file not found' }); return }

    const ext  = path.extname(filePath).toLowerCase()
    const name = path.basename(filePath)
    const MAX  = 1024 * 1024 * 10  // 10 MB raw size cap

    try {
      const stat = fs.statSync(filePath)
      if (stat.size > MAX) {
        reply.status(413).send({ error: `File too large (${(stat.size/1024/1024).toFixed(1)} MB). Max 10 MB.` })
        return
      }

      if (ext === '.pdf') {
        // pdf-parse doesn't have a proper ESM default export — use createRequire
        const { createRequire } = await import('module')
        const require   = createRequire(import.meta.url)
        const pdfParse  = require('pdf-parse')
        const buf       = fs.readFileSync(filePath)
        const data      = await pdfParse(buf)
        return {
          name, ext, type: 'pdf',
          content:  data.text,
          pages:    data.numpages,
          size:     stat.size,
          truncated: false,
        }
      }

      if (ext === '.docx' || ext === '.doc') {
        const mammoth = await import('mammoth')
        const result  = await mammoth.extractRawText({ path: filePath })
        return {
          name, ext, type: 'docx',
          content:  result.value,
          size:     stat.size,
          truncated: false,
        }
      }

      // Plain text / code files
      const TEXT_EXTS = new Set(['.ts','.tsx','.js','.jsx','.py','.go','.rs','.java','.kt','.swift','.c','.cpp','.h','.cs','.php','.html','.css','.scss','.json','.yaml','.yml','.toml','.xml','.env','.md','.mdx','.txt','.csv','.sh','.bash','.sql','.graphql','.proto'])
      if (TEXT_EXTS.has(ext) || ext === '') {
        const raw      = fs.readFileSync(filePath, 'utf8')
        const CHAR_CAP = 200_000
        return {
          name, ext, type: 'text',
          content:   raw.length > CHAR_CAP ? raw.slice(0, CHAR_CAP) + '\n\n[... truncated ...]' : raw,
          size:      stat.size,
          truncated: raw.length > CHAR_CAP,
        }
      }

      // Image files — return base64 for vision-capable models
      const IMG_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg','.bmp'])
      if (IMG_EXTS.has(ext)) {
        const buf     = fs.readFileSync(filePath)
        const base64  = buf.toString('base64')
        const mimeMap: Record<string,string> = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml', '.bmp':'image/bmp' }
        return {
          name, ext, type: 'image',
          base64,
          mimeType: mimeMap[ext] ?? 'image/png',
          size:     stat.size,
        }
      }

      reply.status(415).send({ error: `Unsupported file type: ${ext}` })
    } catch (err: any) {
      reply.status(500).send({ error: err.message })
    }
  })

  server.get<{ Querystring: { path: string } }>('/project/file/exists', async (req) => {
    const { path: filePath } = req.query
    if (!filePath) return { exists: false }
    return { exists: fs.existsSync(filePath), isDir: fs.existsSync(filePath) && fs.statSync(filePath).isDirectory() }
  })

  server.get('/project/search/files', async (req: any) => {
    const { rootPath: root, query, caseSensitive, wholeWord, includeGlob, excludeGlob } = req.query as Record<string, string>
    if (!root || !query || !fs.existsSync(root)) return { results: [], total: 0 }

    const MAX = 500
    const MAXSZ = 512 * 1024
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache', 'coverage', '.turbo'])
    const results: any[] = []
    let total = 0

    function esc(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
    let rx: RegExp
    try {
      const flags = caseSensitive === 'true' ? 'g' : 'gi'
      rx = new RegExp(wholeWord === 'true' ? `\\b${esc(query)}\\b` : esc(query), flags)
    } catch {
      return { results: [], total: 0 }
    }

    function glob(rel: string, pat: string): boolean {
      return pat.split(',').map(p => p.trim()).filter(Boolean).some(p => {
        const r = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*\*/g, '__D__').replace(/\*/g, '[^/]*').replace(/__D__/g, '.*').replace(/\?/g, '[^/]') + '$')
        return r.test(rel) || r.test(path.basename(rel))
      })
    }

    function walk(dir: string) {
      if (total >= MAX) return
      let ents: string[]
      try { ents = fs.readdirSync(dir) } catch { return }

      for (const e of ents) {
        if (total >= MAX) return
        const full = path.join(dir, e)
        const rel = path.relative(root, full).replace(/\\/g, '/')
        let st: fs.Stats
        try { st = fs.statSync(full) } catch { continue }

        if (st.isDirectory()) {
          if (!SKIP.has(e) && !e.startsWith('.')) walk(full)
          continue
        }
        if (!st.isFile() || st.size > MAXSZ) continue
        if (excludeGlob && glob(rel, excludeGlob)) continue
        if (includeGlob && !glob(rel, includeGlob)) continue

        let txt: string
        try { txt = fs.readFileSync(full, 'utf8') } catch { continue }
        if (txt.includes('\0')) continue

        const hits: any[] = []
        txt.split('\n').forEach((ln, i) => {
          rx.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = rx.exec(ln)) !== null) {
            const s = Math.min(m.index, 30)
            hits.push({
              line: i + 1,
              col: m.index,
              text: ln.slice(Math.max(0, m.index - 30), m.index + m[0].length + 60).trimEnd(),
              matchStart: s,
              matchEnd: s + m[0].length,
            })
            total++
            if (total >= MAX) break
          }
        })

        if (hits.length > 0) results.push({ file: full, relPath: rel, matches: hits })
      }
    }

    walk(root)
    return { results, total, capped: total >= MAX }
  })

  // ── Git ────────────────────────────────────────────────────────────────────
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/git/status', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { isRepo: false }; return { isRepo: true, status: getStatus(s.rootPath) } })
  server.get<{ Params: { sessionId: string }; Querystring: { limit?: string; branch?: string } }>('/project/:sessionId/git/log', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { commits: [] }; return { commits: getLog(s.rootPath, Math.min(parseInt(req.query.limit ?? '50'), 200), req.query.branch ?? '') } })
  server.get<{ Params: { sessionId: string } }>('/project/:sessionId/git/branches', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { branches: [] }; return { branches: getBranches(s.rootPath) } })
  server.get<{ Params: { sessionId: string }; Querystring: { file?: string; staged?: string } }>('/project/:sessionId/git/diff', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { diffs: [] }; return { diffs: getDiff(s.rootPath, req.query.file, req.query.staged === 'true') } })
  server.get<{ Params: { sessionId: string; hash: string } }>('/project/:sessionId/git/commit/:hash', async (req) => { const s = getSession(req.params.sessionId); if (!s?.rootPath) return { diffs: [] }; return { diffs: getCommitDiff(s.rootPath, req.params.hash) } })

  // ── Chat: title generation (no session required, no history) ───────────────
  // Dedicated lightweight endpoint — avoids the 400 from session-less /chat calls
  server.post<{ Body: { message: string } }>('/chat/title', async (req) => {
    const { message } = req.body
    if (!message) return { success: false, title: '' }
    try {
      const s = loadSettings()
      const msgs: Array<{ role: ChatRole; content: string }> = [
        { role: 'system', content: 'Generate a 3-5 word plain text chat title. Reply with ONLY the title — no markdown, no quotes, no punctuation.' },
        { role: 'user',   content: `Chat starts with: "${message.slice(0, 150)}"` },
      ]
      const { content } = await routedChat(msgs, undefined, s)
      return { success: true, title: content.trim() }
    } catch { return { success: false, title: '' } }
  })

  // ── Chat streaming (no RAG) ────────────────────────────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }> } }>(
    '/chat/stream', async (req, reply) => {
      const { message, sessionId, history = [] } = req.body
      if (!message) { reply.status(400).send('No message'); return }
      const send = setupSSE(reply)
      try {
        const s         = loadSettings()
        const isProject = getSession(sessionId)?.type === 'project'
        if (!getSession(sessionId)) upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: loadConfig().selectedModel })
        const session = getSession(sessionId)
        const modelName = s.activeProvider === 'ollama' ? loadConfig().selectedModel : (s.cloudModels[s.activeProvider as CloudProvider] ?? '')
        // Inject real file contents for project sessions — prevents hallucination
        const fileContents = isProject && session?.rootPath ? readProjectFilesForContext(session.rootPath) : undefined
        const sysPrompt = buildSystemPrompt(modelName, session?.summary, isProject ? buildAgentContext(sessionId) : undefined, isProject ? buildContractContext(sessionId) : undefined, s.llmDefaults.systemPrompt || undefined, fileContents)
        const msgs = [{ role: 'system' as ChatRole, content: sysPrompt }, ...mapHistory(history), { role: 'user' as ChatRole, content: message }]
        send({ type: 'provider', provider: s.activeProvider, model: modelName })
        let full = ''
        await routedChat(msgs, (chunk) => { full += chunk; send({ chunk }) }, s)
        reply.raw.write('data: [DONE]\n\n'); reply.raw.end()
        try { saveMessage({ id: randomUUID(), sessionId, role: 'assistant', content: full }) } catch { }
      } catch (err: any) {
        const s2 = loadSettings()
        const errMsg = classifyApiError(err, s2.activeProvider, s2.cloudModels[s2.activeProvider as CloudProvider] ?? '')
        try { send({ chunk: `\n\n${errMsg}` }); reply.raw.write('data: [DONE]\n\n'); reply.raw.end() } catch { }
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
        const s         = loadSettings()
        const isProject = getSession(sessionId)?.type === 'project'
        if (!getSession(sessionId)) upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: loadConfig().selectedModel })
        const session   = getSession(sessionId)
        const modelName = s.activeProvider === 'ollama' ? loadConfig().selectedModel : (s.cloudModels[s.activeProvider as CloudProvider] ?? '')
        // Inject real file contents for project sessions — prevents hallucination
        const fileContents = isProject && session?.rootPath ? readProjectFilesForContext(session.rootPath) : undefined
        let sysPrompt   = buildSystemPrompt(modelName, session?.summary, isProject ? buildAgentContext(sessionId) : undefined, isProject ? buildContractContext(sessionId) : undefined, s.llmDefaults.systemPrompt || undefined, fileContents)
        const rag = await runRAG(message, forceWeb, (status) => send({ type: 'rag_status', status }))
        if (rag.didSearch) {
          sysPrompt = injectRAGContext(sysPrompt, rag)
          if (rag.sources.length > 0) send({ type: 'rag_sources', sources: rag.sources.map(r => ({ title: r.title, url: r.url })) })
          if (rag.extractedFacts && !rag.ragFailed) send({ chunk: rag.extractedFacts + '\n' })
        }
        send({ type: 'provider', provider: s.activeProvider, model: modelName })
        const cleanMsg = message.replace(/^@web\s*/i, '').trim()
        const msgs = [{ role: 'system' as ChatRole, content: sysPrompt }, ...mapHistory(history), { role: 'user' as ChatRole, content: cleanMsg }]
        let full = rag.extractedFacts ?? ''
        await routedChat(msgs, (chunk) => { full += chunk; send({ chunk }) }, s)
        reply.raw.write('data: [DONE]\n\n'); reply.raw.end()
        try { saveMessage({ id: randomUUID(), sessionId, role: 'assistant', content: full }) } catch { }
      } catch (err: any) {
        const s2 = loadSettings()
        const errMsg = classifyApiError(err, s2.activeProvider, s2.cloudModels[s2.activeProvider as CloudProvider] ?? '')
        try { send({ chunk: `\n\n${errMsg}` }); reply.raw.write('data: [DONE]\n\n'); reply.raw.end() } catch { }
      }
    }
  )

  // ── Chat non-streaming (generic, not for title gen) ────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }> } }>('/chat', async (req) => {
    const { message, sessionId, history = [] } = req.body; if (!message) return { success: false, reply: 'No message' }
    const s = loadSettings(); const session = getSession(sessionId)
    const modelName = s.activeProvider === 'ollama' ? loadConfig().selectedModel : (s.cloudModels[s.activeProvider as CloudProvider] ?? '')
    const msgs = [{ role: 'system' as ChatRole, content: buildSystemPrompt(modelName, session?.summary) }, ...mapHistory(history), { role: 'user' as ChatRole, content: message }]
    const { content } = await routedChat(msgs, undefined, s)
    return { success: true, reply: content }
  })

  // ── Projects / Agents ──────────────────────────────────────────────────────
  server.get('/projects', async () => ({ projects: orchestrator.listProjects() }))
  server.post<{ Body: { name: string; rootPath: string } }>('/projects', async (req) => { const { name, rootPath } = req.body; if (!name || !rootPath) return { success: false }; const p = await orchestrator.createProject({ name, rootPath }); return { success: true, project: { id: p.id, name: p.name, rootPath: p.rootPath } } })
  server.get<{ Params: { projectId: string } }>('/projects/:projectId/agents', async (req) => ({ agents: orchestrator.listAgents(req.params.projectId) }))
  server.post<{ Params: { projectId: string }; Body: { name: string; role: string; allowedPaths?: string[] } }>('/projects/:projectId/agents', async (req) => {
    const { name, role, allowedPaths } = req.body; if (!name || !role) return { success: false }
    const agent = orchestrator.addAgent(req.params.projectId, { name, role: role as any, allowedPaths: allowedPaths ?? [], projectPath: orchestrator.getProject(req.params.projectId).rootPath })
    return { success: true, agent: { id: agent.id, name: agent.config.name, role: agent.config.role } }
  })
  server.post<{ Params: { projectId: string; agentId: string }; Body: { instruction: string; queue?: boolean } }>('/projects/:projectId/agents/:agentId/instruct', async (req) => {
    const { instruction, queue = true } = req.body; if (!instruction) return { success: false }
    if (queue) { await orchestrator.runInstruction(req.params.projectId, req.params.agentId, instruction); return { success: true } }
    await orchestrator.runInstructionDirect(req.params.projectId, req.params.agentId, instruction); return { success: true }
  })

  const PORT = Number(process.env.PORT ?? 3001)
  await server.listen({ port: PORT, host: '0.0.0.0' })
  const s = loadSettings()
  console.log(`\n🔨 LocalForge  :${PORT}  |  Provider: ${s.activeProvider}  |  LAN: ${LAN_IP}\n`)
}

process.on('SIGINT', async () => { await server.close(); closeDb(); process.exit(0) })
bootstrap().catch(err => { console.error('[Server] Fatal:', err); process.exit(1) })
