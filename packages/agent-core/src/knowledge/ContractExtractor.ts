/**
 * ContractExtractor.ts
 *
 * Extracts API contracts from frontend and backend source files.
 *
 * Frontend: finds fetch(), axios, useSWR, useQuery, $fetch, ky, got calls
 * Backend:  finds Express/Fastify/Koa/Flask/FastAPI route registrations
 *
 * No AST — regex only, works offline.
 */

import fs   from 'fs'
import path from 'path'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ANY'

export interface ApiCall {
  method:  HttpMethod
  path:    string        // raw path string found in code e.g. '/api/users'
  file:    string
  line:    number
  source:  'frontend'
  raw:     string        // original matched text for display
}

export interface ApiRoute {
  method:  HttpMethod
  path:    string        // route pattern e.g. '/api/users/:id'
  file:    string
  line:    number
  source:  'backend'
  raw:     string
}

// ── Frontend call patterns ────────────────────────────────────────────────────

// fetch('/api/...') or fetch("...") — captures method from options object if present
const FETCH_RE = /\bfetch\s*\(\s*['"`]([^'"`\s]+)['"`](?:\s*,\s*\{[^}]*method\s*:\s*['"`](\w+)['"`])?/g

// axios.get/post/... ('/api/...')
const AXIOS_RE = /\baxios\s*\.\s*(get|post|put|delete|patch|head)\s*\(\s*['"`]([^'"`\s]+)['"`]/gi

// axios({ method: 'get', url: '/api/...' })
const AXIOS_OBJ_RE = /\baxios\s*\(\s*\{[^}]*(?:method\s*:\s*['"`](\w+)['"`])[^}]*url\s*:\s*['"`]([^'"`\s]+)['"`]/gi

// useSWR('/api/...') — always GET
const SWR_RE = /\buseSWR\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`\s]+)['"`]/g

// useQuery(key, () => fetch(...)) — too variable, capture the URL string after useQuery(
const USEQUERY_RE = /\buseQuery\s*\([^,)]*['"`]([/][^'"`\s]+)['"`]/g

// $fetch('/api/...') — Nuxt
const DOLLAR_FETCH_RE = /\$fetch\s*\(\s*['"`]([^'"`\s]+)['"`](?:\s*,\s*\{[^}]*method\s*:\s*['"`](\w+)['"`])?/g

// ky.get/post... (url)
const KY_RE = /\bky\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`\s]+)['"`]/gi

// ── Backend route patterns ────────────────────────────────────────────────────

// Express/Fastify/Koa: app.get('/path') router.post('/path') server.delete('/path')
const EXPRESS_RE = /(?:app|router|server|fastify)\s*\.\s*(get|post|put|delete|patch|all)\s*\(\s*['"`]([^'"`\s]+)['"`]/gi

// Fastify typed: server.get<...>('/path')
const FASTIFY_TYPED_RE = /(?:server|fastify)\s*\.\s*(get|post|put|delete|patch)\s*<[^>]*>\s*\(\s*['"`]([^'"`\s]+)['"`]/gi

// Python FastAPI / Flask: @app.get('/path') @router.post('/path')
const PYTHON_DECORATOR_RE = /@(?:app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`\s]+)['"`]/gi

// Rust Actix: #[get("/path")] #[post("/path")]
const ACTIX_RE = /#\[(get|post|put|delete|patch)\s*\(\s*"([^"]+)"\s*\)\]/gi

// ── Helpers ───────────────────────────────────────────────────────────────────

function lineOf(source: string, idx: number): number {
  return source.slice(0, idx).split('\n').length
}

function norm(method: string): HttpMethod {
  const m = method.toUpperCase()
  if (['GET','POST','PUT','DELETE','PATCH'].includes(m)) return m as HttpMethod
  return 'ANY'
}

function isApiPath(p: string): boolean {
  // Only interested in paths that look like API endpoints
  return p.startsWith('/') &&
    !p.endsWith('.js') &&
    !p.endsWith('.css') &&
    !p.endsWith('.png') &&
    !p.endsWith('.svg') &&
    p.length > 1 &&
    p.length < 200
}

// ── Extract frontend calls from a file ───────────────────────────────────────

export function extractFrontendCalls(filePath: string, source: string): ApiCall[] {
  const calls: ApiCall[] = []

  function add(method: HttpMethod, p: string, idx: number, raw: string) {
    if (!isApiPath(p)) return
    calls.push({ method, path: p, file: filePath, line: lineOf(source, idx), source: 'frontend', raw })
  }

  let m: RegExpExecArray | null

  const fetchRe = new RegExp(FETCH_RE.source, 'g')
  while ((m = fetchRe.exec(source)) !== null) {
    add(m[2] ? norm(m[2]) : 'GET', m[1], m.index, m[0])
  }

  const axiosRe = new RegExp(AXIOS_RE.source, 'gi')
  while ((m = axiosRe.exec(source)) !== null) {
    add(norm(m[1]), m[2], m.index, m[0])
  }

  const axiosObjRe = new RegExp(AXIOS_OBJ_RE.source, 'gi')
  while ((m = axiosObjRe.exec(source)) !== null) {
    add(norm(m[1]), m[2], m.index, m[0])
  }

  const swrRe = new RegExp(SWR_RE.source, 'g')
  while ((m = swrRe.exec(source)) !== null) {
    add('GET', m[1], m.index, m[0])
  }

  const useQueryRe = new RegExp(USEQUERY_RE.source, 'g')
  while ((m = useQueryRe.exec(source)) !== null) {
    add('GET', m[1], m.index, m[0])
  }

  const dfRe = new RegExp(DOLLAR_FETCH_RE.source, 'g')
  while ((m = dfRe.exec(source)) !== null) {
    add(m[2] ? norm(m[2]) : 'GET', m[1], m.index, m[0])
  }

  const kyRe = new RegExp(KY_RE.source, 'gi')
  while ((m = kyRe.exec(source)) !== null) {
    add(norm(m[1]), m[2], m.index, m[0])
  }

  // Deduplicate exact same path+method+line
  const seen = new Set<string>()
  return calls.filter(c => {
    const key = `${c.method}:${c.path}:${c.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Extract backend routes from a file ───────────────────────────────────────

export function extractBackendRoutes(filePath: string, source: string): ApiRoute[] {
  const routes: ApiRoute[] = []

  function add(method: HttpMethod, p: string, idx: number, raw: string) {
    if (!isApiPath(p)) return
    routes.push({ method: method === 'ANY' ? 'GET' : method, path: p, file: filePath, line: lineOf(source, idx), source: 'backend', raw })
  }

  let m: RegExpExecArray | null

  const expressRe = new RegExp(EXPRESS_RE.source, 'gi')
  while ((m = expressRe.exec(source)) !== null) {
    add(norm(m[1]), m[2], m.index, m[0])
  }

  const ftRe = new RegExp(FASTIFY_TYPED_RE.source, 'gi')
  while ((m = ftRe.exec(source)) !== null) {
    add(norm(m[1]), m[2], m.index, m[0])
  }

  const pyRe = new RegExp(PYTHON_DECORATOR_RE.source, 'gi')
  while ((m = pyRe.exec(source)) !== null) {
    add(norm(m[1]), m[2], m.index, m[0])
  }

  const actixRe = new RegExp(ACTIX_RE.source, 'gi')
  while ((m = actixRe.exec(source)) !== null) {
    add(norm(m[1]), m[2], m.index, m[0])
  }

  const seen = new Set<string>()
  return routes.filter(r => {
    const key = `${r.method}:${r.path}:${r.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Classify file as frontend or backend ─────────────────────────────────────

export type FileRole = 'frontend' | 'backend' | 'unknown'

export function classifyFile(filePath: string): FileRole {
  const p = filePath.replace(/\\/g, '/')

  // Backend indicators
  if (p.includes('/api/') || p.includes('/routes/') || p.includes('/server') ||
      p.includes('/backend') || p.includes('/handlers/') || p.includes('index.ts') ||
      p.includes('router.') || p.endsWith('.py') || p.endsWith('.rs')) {
    // But exclude if also in src/app (Next.js API routes are both)
    if (!p.includes('/src/app/') && !p.includes('/pages/api/')) return 'backend'
  }

  // Frontend indicators
  if (p.includes('/components/') || p.includes('/pages/') || p.includes('/views/') ||
      p.includes('/hooks/') || p.includes('/store/') || p.endsWith('.tsx') ||
      p.endsWith('.jsx') || p.includes('/src/app/')) {
    return 'frontend'
  }

  // Default: if it's TS/JS check extension
  if (p.endsWith('.ts') || p.endsWith('.js')) return 'unknown'
  return 'unknown'
}

// ── Scan entire project ───────────────────────────────────────────────────────

const IGNORE = ['node_modules', '.git', 'dist', 'build', '.next', 'target', '.tauri', '__pycache__']
const SCANNABLE = /\.(ts|tsx|js|jsx|py|rs)$/

export function scanContracts(rootPath: string): { calls: ApiCall[]; routes: ApiRoute[] } {
  const calls:  ApiCall[]  = []
  const routes: ApiRoute[] = []

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        if (IGNORE.includes(e.name)) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { walk(full); continue }
        if (!SCANNABLE.test(e.name)) continue
        try {
          const src  = fs.readFileSync(full, 'utf8')
          const role = classifyFile(full)

          // Extract frontend calls from frontend + unknown files
          if (role !== 'backend') {
            extractFrontendCalls(full, src).forEach(c => calls.push(c))
          }
          // Extract backend routes from backend + unknown files
          if (role !== 'frontend') {
            extractBackendRoutes(full, src).forEach(r => routes.push(r))
          }
        } catch { }
      }
    } catch { }
  }

  walk(rootPath)
  return { calls, routes }
}
