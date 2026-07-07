import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import pty from 'node-pty'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { execSync, exec, spawn } from 'child_process'
import net from 'net'
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
import { getStatus, getLog, getBranches, getDiff, getCombinedDiff, getDiffAll, getCommitDiff, cleanGitEnv, isGitRepo } from './git/GitReader.js'
import { runRAG, injectRAGContext, hasWebTrigger } from './rag/RAGPipeline.js'
import { autoVisualize } from './visualization/AutoVisualizer.js'

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

// ── Audience mode prompts ────────────────────────────────────────────────────
const AUDIENCE_PROMPTS: Record<string, string> = {
  school: `
AUDIENCE LEVEL: School (beginner).
- Use simple everyday language. Zero jargon. If you must use a technical word, explain it in plain English immediately after.
- Give ONE real-world analogy per concept (e.g. "electricity is like water flowing through a pipe").
- Short responses: 3-5 paragraphs maximum.
- Use simple visuals: basic charts or diagrams only.
- Tone: friendly, encouraging, patient.
- Start explanations with "Think of it like..." or "Imagine..."
`,
  college: `
AUDIENCE LEVEL: College (intermediate).
- Use technical terms but define them on first use.
- Cover theory AND practical application.
- Include code examples or math equations where relevant.
- Use charts, graphs, and LaTeX math rendering.
- Length: as long as needed to explain the concept properly.
- Tone: neutral, informative, direct.
`,
  professor: `
AUDIENCE LEVEL: Professor / Expert (advanced).
- Use full academic/technical language. Assume deep domain knowledge.
- Give the COMPLETE picture: formal definition, historical context, derivations, proofs, edge cases, current research, open problems.
- Multiple examples: trivial case, standard case, pathological/edge case.
- Use LaTeX for ALL equations. Use interactive graphs with parameter sliders where applicable.
- Show step-by-step derivations. Cite theorems by name.
- Length: this is a LECTURE. Do not summarise — expand everything fully.
- Goal: the reader must be able to deliver this as a lecture to other people after reading.
- End with a "Further reading" section listing 3-5 foundational references (author, title, year).
- Tone: precise, rigorous, academic.
`,
}

function buildSystemPrompt(modelName: string, summary?: string | null, knowledgeCtx?: string, contractCtx?: string, extra?: string, fileContents?: Record<string, string>, audienceMode?: string): string {
  const fileBlock = fileContents && Object.keys(fileContents).length > 0
    ? '\n\nProject files (read these carefully before answering):\n' +
      Object.entries(fileContents)
        .map(([name, content]) => `\n--- ${name} ---\n${content}`)
        .join('\n')
    : ''

  return (
    `You are an expert software engineer inside LocalForge, powered by ${modelName}.\n\n` +

    // ── RENDERING CAPABILITIES ──────────────────────────────────────────────
    `RENDERING (use these for rich output):\n` +
    `- Math: \\[ block \\] or \\( inline \\) for LaTeX equations\n` +
    `  CRITICAL: EVERY math symbol in prose MUST be wrapped — \\(h_\\theta(x)\\) not hθ(x), \\(\\theta_0\\) not θ0\n` +
    `  NEVER write raw Greek letters or equations outside math delimiters\n` +
    `- Charts: \`\`\`chart {"type":"bar","data":[{"label":"A","value":10}]} \`\`\` for data visualisation\n` +
    `- Tables: use normal GitHub-flavoured markdown tables for tabular data\n` +
    `- Graphs: \`\`\`graph {"functions":[{"fn":"x^2 - 3*x"}]} \`\`\` for plotting math functions\n` +
    `  GRAPH RULES (follow exactly, or the plot will be wrong):\n` +
    `   • The "fn" string is PLAIN math, NOT LaTeX: use x^2, sqrt(x), sin(x), exp(x), abs(x), log(x), pi, e\n` +
    `   • Use * for multiplication (2*x, not 2x) and ^ for powers (x^2)\n` +
    `   • Do NOT put \\(, \\frac, or LaTeX inside "fn". Do NOT set yDomain — it auto-scales\n` +
    `   • You may add an interactive parameter: {"functions":[{"fn":"a*x^2"}],"params":[{"name":"a","min":-5,"max":5,"value":1}]}\n` +
    `- WHENEVER you discuss, derive, or are asked to plot/visualise a function, you MUST include a \`\`\`graph\`\`\` block so the user sees the actual curve\n` +
    `- If you also show Python/matplotlib (or MATLAB) code, ADD a \`\`\`graph\`\`\` block beside it — the code is illustrative, the graph block is the real rendered plot\n` +
    `- NEVER link to or suggest Desmos, Wolfram, GeoGebra, or external tools — always render inline with \`\`\`graph\`\`\`\n\n` +

    // ── VISUALIZATION DECISION RULES ────────────────────────────────────────
    `WHEN TO USE EACH FORMAT:\n` +
    `- Explaining code logic → use code blocks with language tag (\`\`\`typescript)\n` +
    `- Showing data/numbers → use \`\`\`chart if 3+ data points\n` +
    `- Mathematical function → use \`\`\`graph\n` +
    `- Formula/equation → use LaTeX \\[...\\]\n` +
    `- Writing a file → use write: format (see below)\n` +
    `- NEVER mix: explanation code blocks are different from file write blocks\n\n` +

    // ── FILE WRITING ─────────────────────────────────────────────────────────
    `WRITING FILES:\n` +
    `When asked to create or edit files, use EXACTLY this format:\n` +
    `\`\`\`write:path/to/file.ext\n` +
    `<complete file content>\n` +
    `\`\`\`\n\n` +
    `CRITICAL RULES for write: blocks:\n` +
    `1. NEVER use \`\`\`typescript or \`\`\`javascript for file writes — ONLY \`\`\`write:path\n` +
    `2. ALWAYS write the COMPLETE file — never partial snippets or placeholders\n` +
    `3. For explanation/illustration, use regular \`\`\`typescript blocks (no write:)\n` +
    `4. Write EVERY file the project needs — do not stop after 2-3 files\n` +
    `5. A production project needs ALL of: package.json, source files, config, tests, README\n\n` +

    // ── FIXING ERRORS ─────────────────────────────────────────────────────────
    `FIXING ERRORS / BUGS:\n` +
    `When the user reports an error, stack trace, failed command, or invalid file, DO NOT just explain the fix.\n` +
    `- The relevant file contents are provided below under "Project files". Read them, find the exact problem, and\n` +
    `  output the COMPLETE corrected file as a \`\`\`write:<path>\`\`\` block so it can be applied directly.\n` +
    `- Keep the path identical to the broken file. Fix only what's needed; preserve the rest of the file.\n` +
    `- Add a ONE-line note of what was wrong, then the write: block. Do not paste the file in a regular code block.\n\n` +

    // ── PRODUCTION PROJECT RULE ───────────────────────────────────────────────
    `WHEN BUILDING A FULL PROJECT:\n` +
    `- Write ALL files in one response — package.json, every source file, tests, config, README\n` +
    `- Every file must be production-ready: proper error handling, types, validation\n` +
    `- After writing all files, give a brief summary of what was created\n` +
    `- Do NOT ask for confirmation between files — write everything upfront\n\n` +

    `Keep explanations concise. No filler phrases. No apologies.\n` +
    (audienceMode && AUDIENCE_PROMPTS[audienceMode] ? `\n${AUDIENCE_PROMPTS[audienceMode]}` : '') +

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
      `**Fix:** Go to **Settings → Cloud** → ${provider} → enter a new API key.`,
    ].join('\n')
  }

  // Model not found
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist') || msg.includes('invalid'))) {
    return [
      `⚠️ **Model not found: ${model}**`,
      '',
      `The model **${model}** is not available on **${provider}**.`,
      '',
      `**Fix:** Go to **Settings → Cloud** → ${provider} → select a different model.`,
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

// Lenient JSON parse for model-generated plans. Small models emit trailing commas,
// stray backslashes (bad escapes) and control chars that break strict JSON.parse.
function parseModelJson(text: string): any {
  const firstObj = text.indexOf('{'), firstArr = text.indexOf('[')
  let start = -1
  if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) start = firstObj
  else if (firstArr >= 0) start = firstArr
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  const slice = (start >= 0 && end > start) ? text.slice(start, end + 1) : text
  try { return JSON.parse(slice) } catch { }
  const repaired = slice
    .replace(/,\s*([}\]])/g, '$1')                     // trailing commas
    .replace(/\\(?!["\\/bfnrtu])/g, '\\\\')            // escape invalid backslashes (e.g. Windows paths)
  return JSON.parse(repaired)
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

// Pull in the actual contents of any file the user mentions (a filename, a relative
// path, or an absolute path pasted inside an error/traceback) so the model can FIX
// it precisely instead of guessing. Resolves within the project root only.
function readReferencedFiles(message: string, rootPath: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!rootPath || !fs.existsSync(rootPath)) return result
  const candidates = new Set<string>()
  // absolute paths first (e.g. "/Users/.../backend/package.json" in an npm error)
  for (const m of message.matchAll(/(\/[\w./ @-]+\.[A-Za-z0-9]+)/g)) candidates.add(m[1].trim())
  // relative paths / bare filenames with an extension
  for (const m of message.matchAll(/(?:^|[\s"'`(])([\w][\w./@-]*\.[A-Za-z0-9]+)/g)) candidates.add(m[1])

  for (const cand of candidates) {
    if (Object.keys(result).length >= 8) break
    let full = path.isAbsolute(cand) ? cand : path.join(rootPath, cand)
    const resolved = path.resolve(full), root = path.resolve(rootPath)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue  // stay inside the project
    try {
      const st = fs.statSync(resolved)
      if (!st.isFile() || st.size > 120_000) continue
      const rel = path.relative(root, resolved)
      if (result[rel]) continue
      result[rel] = fs.readFileSync(resolved, 'utf8')
    } catch { }
  }
  return result
}

// ── Phase 2: verify-and-fix ───────────────────────────────────────────────────
// Run a shell command in the project and capture combined stdout+stderr + exit code.
function runCommand(command: string, cwd: string, timeoutMs = 120000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    exec(command, {
      cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 12,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0', npm_config_yes: 'true', ADBLOCK: '1' },
    }, (err: any, stdout, stderr) => {
      const output = `${stdout ?? ''}\n${stderr ?? ''}`.trim()
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, output })
    })
  })
}

interface VerifyCmd { label: string; command: string; timeoutMs: number }

// Build verify commands for a single package.json directory. `prefix` is a
// human/label + `cd` prefix so nested packages (backend/, frontend/) are run
// in their own folder.
function verifyCmdsForPackage(dir: string, label: string): VerifyCmd[] {
  const cmds: VerifyCmd[] = []
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const scripts = pkg.scripts ?? {}
    const inDir = (c: string) => dir === '.' ? c : `cd ${JSON.stringify(dir)} && ${c}`
    const tag   = label ? `${label} ` : ''
    cmds.push({ label: `${tag}install dependencies`, command: inDir('npm install --no-audit --no-fund'), timeoutMs: 300000 })
    if (scripts.build)          cmds.push({ label: `${tag}build`,     command: inDir('npm run build'),     timeoutMs: 300000 })
    else if (scripts.typecheck) cmds.push({ label: `${tag}typecheck`, command: inDir('npm run typecheck'), timeoutMs: 180000 })
    if (scripts.test)           cmds.push({ label: `${tag}tests`,     command: inDir('npm test'),          timeoutMs: 240000 })  // CI=true → jest/CRA run once, no watch
  } catch { }
  return cmds
}

function detectVerifyCommands(rootPath: string): VerifyCmd[] {
  try {
    // 1) Root package.json (monorepo root or single app).
    if (fs.existsSync(path.join(rootPath, 'package.json')))
      return verifyCmdsForPackage(rootPath, '')

    // 2) No root manifest — scan immediate subdirectories for package.json so
    //    scaffolds like backend/ + frontend/ (or server/, client/, app/) still
    //    get verified instead of being skipped.
    const nested: VerifyCmd[] = []
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const sub = path.join(rootPath, entry.name)
      if (fs.existsSync(path.join(sub, 'package.json')))
        nested.push(...verifyCmdsForPackage(entry.name, entry.name))  // relative dir → cd from rootPath
      if (nested.length >= 12) break
    }
    if (nested.length) return nested

    // 3) Python project.
    if (fs.existsSync(path.join(rootPath, 'requirements.txt'))) {
      const cmds: VerifyCmd[] = [{ label: 'install dependencies', command: 'pip install -r requirements.txt', timeoutMs: 300000 }]
      if (fs.existsSync(path.join(rootPath, 'tests')) || fs.existsSync(path.join(rootPath, 'pytest.ini')))
        cmds.push({ label: 'tests', command: 'python -m pytest -q', timeoutMs: 240000 })
      return cmds
    }
  } catch { }
  return []
}

// Run each verify command; on failure, deploy a fixer agent (with the error + the
// files it references) and retry, up to MAX_FIX times per command.
async function verifyAndFix(
  projectId: string, rootPath: string,
  onStatus: (m: string) => void,
): Promise<{ ok: boolean; skipped?: boolean; failed?: string; output?: string }> {
  const cmds = detectVerifyCommands(rootPath)
  if (cmds.length === 0) { onStatus('No verifiable build detected — skipping verify.'); return { ok: true, skipped: true } }
  const MAX_FIX = 2
  for (const cmd of cmds) {
    let attempt = 0
    while (true) {
      onStatus(`Running ${cmd.label}…`)
      const res = await runCommand(cmd.command, rootPath, cmd.timeoutMs)
      if (res.code === 0) { onStatus(`✓ ${cmd.label} passed`); break }
      if (attempt >= MAX_FIX) { onStatus(`✗ ${cmd.label} still failing after ${attempt} fix attempt(s)`); return { ok: false, failed: cmd.label, output: res.output.slice(-2000) } }
      attempt++
      onStatus(`✗ ${cmd.label} failed — deploying fixer (${attempt}/${MAX_FIX})`)
      try {
        const fixer = orchestrator.addAgent(projectId, { name: `Fixer-${attempt}`, role: 'fullstack' as any, allowedPaths: [], projectPath: rootPath })
        broadcast({ type: 'agent_deployed', projectId, agent: { id: fixer.id, name: `Fixer-${attempt}`, role: 'fullstack', phase: 'Verify & Fix' } })
        const referenced = readReferencedFiles(res.output, rootPath)
        const fileBlock = Object.entries(referenced).map(([n, c]) => `--- ${n} ---\n${c.slice(0, 4000)}`).join('\n\n')
        const instruction =
          `The command "${cmd.command}" failed in this project. Diagnose the cause and write the corrected file(s).\n\n` +
          `ERROR OUTPUT (tail):\n${res.output.slice(-3000)}\n\n` +
          (fileBlock ? `RELEVANT FILE CONTENTS:\n${fileBlock}\n\n` : '') +
          `Output each corrected file as its complete content followed on a new line by exactly "FILE_WRITTEN: <relative path>". Fix only what is needed; do not add prose or markdown fences.`
        await orchestrator.runInstructionDirect(projectId, fixer.id, instruction)
      } catch (e: any) { onStatus(`Fixer error: ${e?.message ?? e}`) }
    }
  }
  return { ok: true }
}

// ── Phase 3: project snapshot (for state-aware planning) ──────────────────────
// A compact view of what already exists, so the planner can recognise a feature
// that's already built instead of re-scaffolding it. Kept small (tree + a few
// key manifests) to stay within the small-model context budget.
function projectSnapshot(rootPath: string): string {
  const IGNORE = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'target', '.localforge', '.venv', '__pycache__', 'coverage'])
  const lines: string[] = []
  let fileCount = 0
  const walk = (dir: string, prefix: string, depth: number) => {
    if (depth > 2 || fileCount > 120) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    entries = entries.filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    for (const e of entries) {
      if (fileCount > 120) { lines.push(`${prefix}…`); break }
      fileCount++
      lines.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`)
      if (e.isDirectory()) walk(path.join(dir, e.name), prefix + '  ', depth + 1)
    }
  }
  walk(rootPath, '', 0)
  const tree = lines.length ? lines.join('\n') : '(empty project)'

  // Include excerpts of a few high-signal manifests if present.
  const manifests: string[] = []
  for (const rel of ['package.json', 'backend/package.json', 'frontend/package.json', 'requirements.txt', 'README.md']) {
    try {
      const p = path.join(rootPath, rel)
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        let body = fs.readFileSync(p, 'utf8')
        if (rel.endsWith('package.json')) {
          try { const j = JSON.parse(body); body = JSON.stringify({ name: j.name, scripts: j.scripts, dependencies: j.dependencies }, null, 0) } catch {}
        }
        manifests.push(`--- ${rel} ---\n${body.slice(0, 800)}`)
      }
    } catch {}
    if (manifests.length >= 4) break
  }
  return `FILE TREE:\n${tree}${manifests.length ? '\n\nKEY FILES:\n' + manifests.join('\n') : ''}`
}

// ── Phase 3: deploy / health-check ────────────────────────────────────────────
// Wait until a TCP port accepts a connection (server is up) or the deadline passes.
function waitForPort(port: number, host: string, deadlineMs: number): Promise<boolean> {
  const end = Date.now() + deadlineMs
  return new Promise((resolve) => {
    const tryOnce = () => {
      const sock = net.connect({ port, host })
      let settled = false
      const done = (ok: boolean) => { if (settled) return; settled = true; sock.destroy(); ok ? resolve(true) : (Date.now() >= end ? resolve(false) : setTimeout(tryOnce, 600)) }
      sock.once('connect', () => done(true))
      sock.once('error',   () => done(false))
      sock.setTimeout(1500, () => done(false))
    }
    tryOnce()
  })
}

// Find a start command + best-guess port for the project (or a nested app dir).
function detectStartCommand(rootPath: string): { command: string; cwd: string; port: number; label: string } | null {
  const scan = (dir: string, label: string) => {
    const pkgPath = path.join(dir, 'package.json')
    if (!fs.existsSync(pkgPath)) return null
    let pkg: any = {}
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch { return null }
    const scripts = pkg.scripts ?? {}
    const script = scripts.start ? 'start' : scripts.dev ? 'dev' : scripts.serve ? 'serve' : null
    if (!script) return null
    // Guess the port: PORT in the script, common source files, else 3000.
    let port = 3000
    const hay = [scripts[script], (() => { try { return fs.readFileSync(path.join(dir, 'server.js'), 'utf8') } catch { return '' } })(),
                 (() => { try { return fs.readFileSync(path.join(dir, 'index.js'), 'utf8') } catch { return '' } })()].join('\n')
    const m = hay.match(/(?:PORT\s*[=:]\s*|listen\(\s*)(\d{2,5})/)
    if (m) port = Number(m[1])
    return { command: `npm run ${script}`, cwd: dir, port, label }
  }
  const direct = scan(rootPath, '')
  if (direct) return direct
  for (const sub of ['backend', 'server', 'api', 'app']) {
    const hit = scan(path.join(rootPath, sub), sub)
    if (hit) return hit
  }
  return null
}

// Boot the app, check its port, then tear it down. Best-effort and non-fatal.
async function deployCheck(rootPath: string, onStatus: (m: string) => void):
  Promise<{ status: 'up' | 'down' | 'skipped'; port?: number; command?: string; detail?: string }> {
  const start = detectStartCommand(rootPath)
  if (!start) { onStatus('No start script found — skipping deploy check.'); return { status: 'skipped' } }
  onStatus(`Starting app: ${start.command}${start.label ? ` (${start.label})` : ''}…`)
  const child = spawn(start.command, {
    cwd: start.cwd, shell: true, detached: true,
    env: { ...process.env, PORT: String(start.port), FORCE_COLOR: '0', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logTail = ''
  const grab = (b: Buffer) => { logTail = (logTail + b.toString()).slice(-1500) }
  child.stdout?.on('data', grab); child.stderr?.on('data', grab)

  const kill = () => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} } }
  try {
    onStatus(`Waiting for port ${start.port}…`)
    const up = await waitForPort(start.port, '127.0.0.1', 25000)
    if (up) { onStatus(`✓ App is up on port ${start.port}`); return { status: 'up', port: start.port, command: start.command } }
    // The port guess can be wrong (Vite→5173, CRA→3000, etc. ignore PORT). Before
    // declaring failure, quickly probe a few common dev-server ports.
    for (const p of [5173, 3000, 8080, 8000, 5000, 4000].filter(p => p !== start.port)) {
      if (await waitForPort(p, '127.0.0.1', 2500)) {
        onStatus(`✓ App is up on port ${p}`); return { status: 'up', port: p, command: start.command }
      }
    }
    onStatus(`✗ App did not open a port in time`)
    return { status: 'down', port: start.port, command: start.command, detail: logTail.slice(-600) }
  } finally { kill() }
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

  const keys = s.apiKeys
  const keyFor = (p: CloudProvider): { apiKey: string; baseUrl?: string } => {
    if (p === 'openai') return { apiKey: keys.openai ?? '' }
    if (p === 'gemini') return { apiKey: keys.gemini ?? '' }
    if (p === 'claude') return { apiKey: keys.claude ?? '' }
    if (p === 'groq')   return { apiKey: keys.groq ?? '' }
    if (p === 'custom') return { apiKey: keys.customKey ?? '', baseUrl: keys.customUrl }
    return { apiKey: '' }
  }

  // Try the selected provider first, then any OTHER configured cloud provider as a
  // fallback when the primary is rate-limited / quota-exhausted. A 429 is returned
  // before streaming begins, so falling over never produces duplicated output.
  const primary = provider as CloudProvider
  const order: CloudProvider[] = [primary, ...(['groq', 'gemini', 'openai', 'claude', 'custom'] as CloudProvider[]).filter(p => p !== primary)]

  let lastErr: any = null
  let anyKey = false
  for (const p of order) {
    const { apiKey, baseUrl } = keyFor(p)
    if (!apiKey) continue
    anyKey = true
    const model = s.cloudModels[p] ?? ''
    try {
      const config: CloudProviderConfig = { provider: p, apiKey, model, baseUrl }
      const content = await cloudChat(config, messages, onChunk ? (c) => onChunk(c.content) : undefined, {
        temperature: s.llmDefaults.temperature,
        maxTokens:   s.llmDefaults.maxTokens,
      })
      return { content, modelUsed: model, provider: p }
    } catch (err: any) {
      lastErr = err
      const m = String(err?.message ?? '').toLowerCase()
      const rateLimited = m.includes('429') || m.includes('rate limit') || m.includes('rate_limit') || m.includes('quota') || m.includes('exhaust') || m.includes('too many requests')
      // Only fall over on rate-limit/quota; surface real errors (bad key, etc.) immediately.
      if (!rateLimited) throw err
      console.warn(`[routedChat] ${p} rate-limited — trying next configured provider`)
    }
  }
  if (!anyKey) throw new Error(`No API key for ${primary}. Go to Settings → Cloud Providers.`)
  throw lastErr
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

  // ── Web search DEBUG — open in browser to confirm the provider + results ─────
  // http://localhost:3001/search/debug?q=who is the cm of tamil nadu
  server.get<{ Querystring: { q?: string } }>('/search/debug', async (req) => {
    const q = (req.query.q ?? 'who is the prime minister of india').slice(0, 200)
    const { search, activeSearchProvider } = await import('./rag/WebSearch.js')
    const s = loadSettings()
    const provider = activeSearchProvider()
    const out: any = {
      provider,
      keysConfigured: { tavily: !!s.apiKeys.tavily, brave: !!s.apiKeys.brave },
      query: q,
    }
    try {
      const results = await search(q, 3)
      out.count = results.length
      out.results = results.map(r => ({ title: r.title, url: r.url, snippetLen: (r.snippet || '').length, contentLen: (r.content || '').length }))
    } catch (e: any) { out.error = e?.message ?? String(e) }
    return out
  })

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

  // ── Git diff DEBUG — reports exactly what the server sees for a file ─────────
  // Open in a browser:  http://localhost:3001/git/direct/debug?rootPath=<ROOT>&file=<relpath>
  server.get<{ Querystring: { rootPath: string; file: string } }>('/git/direct/debug', async (req) => {
    const { rootPath: p, file } = req.query
    const { execFileSync } = await import('child_process')
    const path_ = await import('path')
    const fs_   = await import('fs')
    const result: any = { rootPath: p, file, serverBuild: 'cleanGitEnv+-C present' }
    try { result.isGitRepo = isGitRepo(p) } catch (e: any) { result.isGitRepo = `err: ${e?.message}` }
    const abs = file && path_.isAbsolute(file) ? file : path_.join(p ?? '', file ?? '')
    result.resolvedAbsPath  = abs
    result.fileExistsOnDisk = (() => { try { return fs_.existsSync(abs) } catch { return false } })()
    try { result.projectFileBytes = fs_.readFileSync(abs, 'utf8').length } catch (e: any) { result.projectFileBytes = `err: ${e?.message}` }
    const rawGit = (args: string[]) => {
      try {
        const stdout = execFileSync('git', ['-C', p, ...args], { encoding: 'utf8', env: cleanGitEnv(), maxBuffer: 1024 * 1024 * 20 })
        return { ok: true, stdoutBytes: stdout.length, head: stdout.slice(0, 200) }
      } catch (e: any) {
        return { ok: false, exitCode: e?.status, stderr: (e?.stderr?.toString?.() ?? '').slice(0, 400), message: (e?.message ?? '').slice(0, 200) }
      }
    }
    result.gitDiffHEAD    = rawGit(['diff', 'HEAD', '--', file])
    result.gitShowHEAD    = rawGit(['show', `HEAD:${file}`])
    result.getDiffAllCount = (() => { try { return getDiffAll(p, file).length } catch (e: any) { return `err: ${e?.message}` } })()
    return result
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
      const content = execFileSync('git', ['-C', p, 'show', ref], {
        cwd: p, encoding: 'utf8', timeout: 10000,
        maxBuffer: 1024 * 1024 * 20,
        env: cleanGitEnv(),
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
      const content = execFileSync('git', ['-C', p, 'show', ref], {
        cwd: p, encoding: 'utf8', timeout: 10000,
        maxBuffer: 1024 * 1024 * 20,
        env: cleanGitEnv(),
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
    else if (provider === 'tavily') update.tavily = apiKey
    else if (provider === 'brave')  update.brave  = apiKey
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
    else if (provider === 'tavily') delete keys.tavily
    else if (provider === 'brave')  delete keys.brave
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

    // Scan files FIRST and return them. This must NOT depend on MCP or the
    // orchestrator — both can fail or hang, and previously a failed MCP connect
    // aborted the whole request, leaving the project stuck on "No files yet".
    const scan = scanProjectFiles(rootPath)

    // Orchestrator project + agent rehydration — best effort, never blocks files
    try {
      // Create or re-use an orchestrator project with the SAME id as the session
      // so AgentModal can pass session.id as projectId directly
      try { orchestrator.getProject(sessionId) }
      catch { await orchestrator.createProject({ id: sessionId, name: rootPath.split('/').pop() ?? sessionId, rootPath }) }
      try { orchestrator.rehydrateAgents(sessionId) } catch { }
    } catch (e: any) { console.error('[project/open] orchestrator init failed:', e?.message ?? e) }

    // MCP connect — background + best effort, can't block or hang the request
    connectMCP(rootPath)
      .then(() => { mcpConnected.add(rootPath); broadcast({ type: 'mcp_status', path: rootPath, connected: true }) })
      .catch(e => console.error('[project/open] MCP connect failed:', e?.message ?? e))

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
    try {
      // Ensure parent directory exists before writing
      const dir = path.dirname(p)
      if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(p, content ?? '', 'utf8'); return { success: true }
    } catch (e: any) { reply.status(500).send({ error: e.message }) }
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
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }>; audienceMode?: string; provider?: string } }>(
    '/chat/stream', async (req, reply) => {
      const { message, sessionId, history = [], audienceMode = 'college', provider } = req.body
      if (!message) { reply.status(400).send('No message'); return }
      const send = setupSSE(reply)
      try {
        // Per-request provider override (from the chat tab's model dropdown) —
        // makes the selected model authoritative instead of the single global one.
        const s0        = loadSettings()
        const s         = provider ? { ...s0, activeProvider: provider as any } : s0
        const isProject = getSession(sessionId)?.type === 'project'
        if (!getSession(sessionId)) upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: loadConfig().selectedModel })
        const session = getSession(sessionId)
        const modelName = s.activeProvider === 'ollama' ? loadConfig().selectedModel : (s.cloudModels[s.activeProvider as CloudProvider] ?? '')
        const fileContents = isProject && session?.rootPath
          ? { ...readProjectFilesForContext(session.rootPath), ...readReferencedFiles(message, session.rootPath) }
          : undefined
        const sysPrompt = buildSystemPrompt(modelName, session?.summary, isProject ? buildAgentContext(sessionId) : undefined, isProject ? buildContractContext(sessionId) : undefined, s.llmDefaults.systemPrompt || undefined, fileContents, audienceMode)
        const msgs = [{ role: 'system' as ChatRole, content: sysPrompt }, ...mapHistory(history), { role: 'user' as ChatRole, content: message }]
        send({ type: 'provider', provider: s.activeProvider, model: modelName })
        let full = ''
        await routedChat(msgs, (chunk) => { full += chunk; send({ chunk }) }, s)
        // Auto-visualize: upgrade tables → charts, detected functions → graphs.
        // Upgrades can be inserted mid-text, so replace the whole rendered message
        // rather than diffing by length (which streamed garbage + dropped the chart).
        const viz = autoVisualize(full)
        if (viz.upgraded) send({ type: 'replace', content: viz.content })
        reply.raw.write('data: [DONE]\n\n'); reply.raw.end()
        try { saveMessage({ id: randomUUID(), sessionId, role: 'assistant', content: viz.content }) } catch { }
      } catch (err: any) {
        const s2 = loadSettings()
        const errMsg = classifyApiError(err, s2.activeProvider, s2.cloudModels[s2.activeProvider as CloudProvider] ?? '')
        try { send({ chunk: `\n\n${errMsg}` }); reply.raw.write('data: [DONE]\n\n'); reply.raw.end() } catch { }
      }
    }
  )

  // ── Chat streaming WITH RAG ────────────────────────────────────────────────
  server.post<{ Body: { message: string; sessionId: string; history?: Array<{ role: string; content: string }>; forceWeb?: boolean; provider?: string } }>(
    '/chat/stream/web', async (req, reply) => {
      const { message, sessionId, history = [], forceWeb: forceWebBody = false, provider } = req.body
      if (!message) { reply.status(400).send('No message'); return }
      // forceWeb when the user toggled Web on OR typed an @web prefix.
      const send = setupSSE(reply); const forceWeb = forceWebBody || hasWebTrigger(message)
      try {
        // Per-request provider override from the chat tab's model dropdown.
        const s0        = loadSettings()
        const s         = provider ? { ...s0, activeProvider: provider as any } : s0
        const isProject = getSession(sessionId)?.type === 'project'
        if (!getSession(sessionId)) upsertSession({ id: sessionId, type: 'chat', title: 'Chat', modelName: loadConfig().selectedModel })
        const session   = getSession(sessionId)
        const modelName = s.activeProvider === 'ollama' ? loadConfig().selectedModel : (s.cloudModels[s.activeProvider as CloudProvider] ?? '')
        // Inject real file contents for project sessions — prevents hallucination
        const fileContents = isProject && session?.rootPath
          ? { ...readProjectFilesForContext(session.rootPath), ...readReferencedFiles(message, session.rootPath) }
          : undefined
        let sysPrompt   = buildSystemPrompt(modelName, session?.summary, isProject ? buildAgentContext(sessionId) : undefined, isProject ? buildContractContext(sessionId) : undefined, s.llmDefaults.systemPrompt || undefined, fileContents)
        const rag = await runRAG(message, forceWeb, (status) => send({ type: 'rag_status', status }))
        if (rag.didSearch) {
          // The web results are injected into the system prompt only. The model
          // reads them and formulates ONE unified answer — we do NOT stream the
          // raw snippet separately (that produced a "search dump + answer" split).
          sysPrompt = injectRAGContext(sysPrompt, rag)
          if (rag.sources.length > 0) send({ type: 'rag_sources', sources: rag.sources.map(r => ({ title: r.title, url: r.url })) })
        }
        send({ type: 'provider', provider: s.activeProvider, model: modelName })
        const cleanMsg = message.replace(/^@web\s*/i, '').trim()
        const msgs = [{ role: 'system' as ChatRole, content: sysPrompt }, ...mapHistory(history), { role: 'user' as ChatRole, content: cleanMsg }]
        let full = ''
        // Search ran but found nothing — surface a clear warning so the model's
        // (possibly hallucinated) answer isn't mistaken for web-verified fact.
        if (rag.didSearch && rag.ragFailed) {
          const warn = '> ⚠️ Live web search returned no results, so the answer below is **not** web-verified and may be outdated. Add a free Tavily or Brave key in **Settings → Cloud → Web Search** for reliable results.\n\n'
          full += warn
          send({ chunk: warn })
        }
        await routedChat(msgs, (chunk) => { full += chunk; send({ chunk }) }, s)
        const viz = autoVisualize(full)
        if (viz.upgraded) send({ type: 'replace', content: viz.content })
        reply.raw.write('data: [DONE]\n\n'); reply.raw.end()
        try { saveMessage({ id: randomUUID(), sessionId, role: 'assistant', content: viz.content }) } catch { }
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

  // ── Auto-orchestrate: LLM plans and deploys agents automatically ────────────
  server.post<{ Params: { projectId: string }; Body: { task: string } }>('/projects/:projectId/orchestrate', async (req, reply) => {
    const { task } = req.body
    const { projectId } = req.params
    if (!task) { reply.status(400).send({ error: 'task required' }); return }

    let project: any
    try { project = orchestrator.getProject(projectId) }
    catch { reply.status(404).send({ error: `Project ${projectId} not found` }); return }

    // Step 1: ask the model for an ORDERED, PHASED plan (dependencies go in earlier phases).
    // The planner is given a snapshot of what ALREADY exists so it can recognise a
    // feature that's already built and decline to rebuild it (state-aware planning).
    const snapshot = projectSnapshot(project.rootPath)
    const planPrompt = [
      { role: 'system' as ChatRole, content:
        'You are a software project planner. You are given the CURRENT state of a project and a task.\n' +
        'First decide whether the task is ALREADY DONE in the current project.\n' +
        '- If the requested thing already exists (the files/routes/features are already present), output EXACTLY:\n' +
        '  {"phases":[],"note":"<one sentence naming the existing files/features that already satisfy this>"}\n' +
        '- Otherwise, break the task into ORDERED phases that build on each other and output EXACTLY:\n' +
        '  {"phases":[{"name":"Scaffold","agents":[{"name":"Setup","role":"devops","instruction":"..."}]}]}\n' +
        'Output ONLY valid JSON — no markdown, no prose outside the JSON.\n' +
        'Rules:\n' +
        '- Phases run in ORDER; agents within a phase run in PARALLEL. Put anything others depend on in an earlier phase.\n' +
        '- Typical order: scaffold/config → backend → frontend → tests → docs. Skip phases that are not needed.\n' +
        '- If only PART of the task exists, plan ONLY the missing part (do not re-scaffold what is already there).\n' +
        '- role must be one of: frontend, backend, database, devops, test, docs, review, fullstack.\n' +
        '- 1-4 phases, 1-3 agents per phase. Instructions must be specific and actionable.'
      },
      { role: 'user' as ChatRole, content: `CURRENT PROJECT STATE:\n${snapshot}\n\nTask: ${task}\nProject path: ${project.rootPath}` },
    ]

    let planText: string
    try {
      const { content } = await routedChat(planPrompt)
      planText = content.trim().replace(/^```json\n?/i, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim()
    } catch (err: any) {
      reply.status(500).send({ error: `Planning failed: ${err.message}` }); return
    }

    // Step 2: parse — accept {phases:[...]} or a flat [{...}] (wrapped as a single phase).
    type PlanAgent = { name: string; role: string; instruction: string }
    type Phase     = { name: string; agents: PlanAgent[] }
    let phases: Phase[]
    let planNote: string | undefined
    try {
      const parsed = parseModelJson(planText)
      if (Array.isArray(parsed))                     phases = [{ name: 'Build', agents: parsed }]
      else if (parsed && Array.isArray(parsed.phases)) { phases = parsed.phases; planNote = typeof parsed.note === 'string' ? parsed.note : undefined }
      else throw new Error('Expected {phases:[...]} or [...]')
      phases = phases
        .filter(p => p && Array.isArray(p.agents) && p.agents.length > 0)
        .slice(0, 6)
        .map(p => ({ name: String(p.name ?? 'Phase'), agents: p.agents.slice(0, 4) }))
    } catch (err: any) {
      reply.status(500).send({ error: `Invalid plan JSON: ${err.message}`, raw: planText.slice(0, 500) }); return
    }

    // State-aware planner decided nothing needs building — the feature already
    // exists. Tell the user instead of re-scaffolding.
    if (phases.length === 0) {
      const note = planNote || 'This appears to already exist in the project — nothing to build.'
      broadcast({ type: 'orchestration_skipped', projectId, note, task })
      return { success: true, phases: [], note }
    }

    const planForClient = phases.map(p => ({ name: p.name, agents: p.agents.map(a => ({ name: a.name, role: a.role, instruction: a.instruction })) }))
    broadcast({ type: 'orchestration_started', projectId, phases: planForClient, task })

    // Step 3: run phases SEQUENTIALLY (each completes before the next starts);
    // agents within a phase run in PARALLEL. Files/knowledge-graph from one phase
    // are available to the next. Runs in the background; the response returns the plan.
    ;(async () => {
      for (const phase of phases) {
        broadcast({ type: 'phase_started', projectId, phase: phase.name })
        await Promise.all(phase.agents.map(async (a) => {
          try {
            const agent = orchestrator.addAgent(projectId, {
              name: a.name, role: (a.role as any) || 'fullstack', allowedPaths: [], projectPath: project.rootPath,
            })
            broadcast({ type: 'agent_deployed', projectId, agent: { id: agent.id, name: a.name, role: a.role, phase: phase.name } })
            await orchestrator.runInstructionDirect(projectId, agent.id, a.instruction)  // awaits completion
          } catch (e: any) {
            console.error(`[Orchestrate] Agent ${a.name} failed:`, e?.message ?? e)
          }
        }))
        broadcast({ type: 'phase_done', projectId, phase: phase.name })
      }
      // Phase 2: verify the build (install → build/typecheck → tests) and auto-fix failures.
      broadcast({ type: 'phase_started', projectId, phase: 'Verify & Fix' })
      let verify: any
      try { verify = await verifyAndFix(projectId, project.rootPath, (m) => broadcast({ type: 'verify_status', projectId, message: m })) }
      catch (e: any) { verify = { ok: false, output: String(e?.message ?? e) } }
      broadcast({ type: 'phase_done', projectId, phase: 'Verify & Fix' })

      // Phase 3: deploy check — boot the app and confirm it comes up on its port.
      // Only attempted when the build verified cleanly (or was skipped); a broken
      // build won't run anyway.
      let deploy: any = { status: 'skipped' }
      if (!verify || verify.ok !== false) {
        broadcast({ type: 'phase_started', projectId, phase: 'Deploy Check' })
        try { deploy = await deployCheck(project.rootPath, (m) => broadcast({ type: 'deploy_status', projectId, message: m })) }
        catch (e: any) { deploy = { status: 'down', detail: String(e?.message ?? e) } }
        broadcast({ type: 'phase_done', projectId, phase: 'Deploy Check' })
      }
      broadcast({ type: 'orchestration_done', projectId, verify, deploy })
    })().catch(e => console.error('[Orchestrate] pipeline error:', e?.message ?? e))

    return { success: true, phases: planForClient }
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
  // SECURITY: the agent server exposes unauthenticated filesystem + terminal
  // endpoints, so it is bound to loopback ONLY. It is never reachable from another
  // device. This does NOT affect the mobile/tablet preview feature: that scans a QR
  // pointing at the user's OWN dev server (Vite/Next/etc. on its own port), which is
  // a separate process — the LocalForge UI itself only ever runs on this machine.
  const HOST = '127.0.0.1'
  await server.listen({ port: PORT, host: HOST })
  const s = loadSettings()
  console.log(`\n🔨 LocalForge  :${PORT}  |  Host: ${HOST} (loopback only)  |  Provider: ${s.activeProvider}  |  Preview LAN IP: ${LAN_IP}\n`)
}

process.on('SIGINT', async () => { await server.close(); closeDb(); process.exit(0) })
bootstrap().catch(err => { console.error('[Server] Fatal:', err); process.exit(1) })
