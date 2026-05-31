/**
 * ContractEnforcer.ts
 *
 * Compares frontend API calls against backend route definitions.
 * Produces violations (unmatched calls) and orphans (unused routes).
 *
 * Path matching handles:
 *   Express params:   /users/:id
 *   OpenAPI params:   /users/{id}
 *   Next.js params:   /users/[id]
 *   Wildcards:        /users/* or /users/**
 *   Query strings:    /users?page=1 → strips to /users
 *   Template literals: /api/users/${id} → treated as /api/users/:param
 */

import fs   from 'fs'
import path from 'path'
import { scanContracts, type ApiCall, type ApiRoute, type HttpMethod } from './ContractExtractor.js'

export interface Violation {
  kind:    'missing_route'    // frontend calls an endpoint with no backend route
         | 'method_mismatch' // endpoint exists but wrong HTTP method
  call:    ApiCall
  similar: ApiRoute[]   // routes with same path but different method
}

export interface Orphan {
  route:   ApiRoute
  // route exists in backend but never called from frontend
}

export interface ContractReport {
  scannedAt:   number
  rootPath:    string
  calls:       ApiCall[]
  routes:      ApiRoute[]
  violations:  Violation[]
  orphans:     Orphan[]
  summary: {
    totalCalls:    number
    totalRoutes:   number
    matched:       number
    violations:    number
    orphans:       number
    health:        'good' | 'warn' | 'bad'
  }
}

// Per-session cache
const cache = new Map<string, ContractReport>()

// ── Path normalisation ────────────────────────────────────────────────────────

function normalisePath(p: string): string {
  return p
    .split('?')[0]              // strip query string
    .replace(/\$\{[^}]+\}/g, ':param')   // template literals → :param
    .replace(/\[([^\]]+)\]/g, ':$1')     // [id] → :id
    .replace(/\{([^}]+)\}/g, ':$1')      // {id} → :id
    .replace(/\/\*+/g, '/*')            // /** → /*
    .replace(/\/+$/, '')                // trailing slash
    .toLowerCase()
    || '/'
}

// Convert a route pattern to a regex for matching
function routeToRegex(pattern: string): RegExp {
  const norm = normalisePath(pattern)
  const escaped = norm
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')  // escape regex chars
    .replace(/:\\w+/g, '/:[^/]+')              // unescape param placeholders
    .replace(/:\\[^/]+/g, '[^/]+')             // :param → any segment
    .replace(/\/\\\*/g, '.*')                  // /* → anything
  return new RegExp(`^${escaped}$`)
}

// Does a frontend call path match a backend route pattern?
function pathMatches(callPath: string, routePath: string): boolean {
  const normCall  = normalisePath(callPath)
  const normRoute = normalisePath(routePath)

  // Exact match after normalisation
  if (normCall === normRoute) return true

  // Pattern match — route may have params
  try {
    return routeToRegex(normRoute).test(normCall)
  } catch {
    return false
  }
}

function methodMatches(callMethod: HttpMethod, routeMethod: HttpMethod): boolean {
  if (callMethod === 'ANY' || routeMethod === 'ANY') return true
  return callMethod === routeMethod
}

// ── Main enforcer ─────────────────────────────────────────────────────────────

export function enforce(rootPath: string): { calls: ApiCall[]; routes: ApiRoute[]; violations: Violation[]; orphans: Orphan[] } {
  const { calls, routes } = scanContracts(rootPath)

  const violations: Violation[] = []
  const matchedRouteIndices     = new Set<number>()

  for (const call of calls) {
    // Find all routes where the path matches
    const pathMatchingRoutes = routes
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => pathMatches(call.path, r.path))

    if (pathMatchingRoutes.length === 0) {
      // No route at all — definite missing route
      violations.push({ kind: 'missing_route', call, similar: [] })
      continue
    }

    // Check if any path-matching route also matches the method
    const fullMatch = pathMatchingRoutes.find(({ r }) => methodMatches(call.method, r.method))

    if (fullMatch) {
      matchedRouteIndices.add(fullMatch.i)
    } else {
      // Path exists but method is wrong
      violations.push({
        kind:    'method_mismatch',
        call,
        similar: pathMatchingRoutes.map(({ r }) => r),
      })
    }
  }

  // Routes never called from frontend
  const orphans: Orphan[] = routes
    .filter((_, i) => !matchedRouteIndices.has(i))
    .filter(r => {
      // Exclude obvious infrastructure routes
      const p = r.path.toLowerCase()
      return !p.includes('/health') &&
             !p.includes('/metrics') &&
             !p.includes('/ws') &&
             !p.includes('/terminal') &&
             !p.includes('*') &&
             !p.startsWith('/static') &&
             !p.startsWith('/assets')
    })
    .map(r => ({ route: r }))

  return { calls, routes, violations, orphans }
}

export function runEnforcer(sessionId: string, rootPath: string): ContractReport {
  const { calls, routes, violations, orphans } = enforce(rootPath)

  const matched = calls.length - violations.length
  const health: 'good' | 'warn' | 'bad' =
    violations.length === 0 ? 'good'
    : violations.length <= 3 ? 'warn'
    : 'bad'

  const report: ContractReport = {
    scannedAt: Date.now(),
    rootPath,
    calls,
    routes,
    violations,
    orphans,
    summary: {
      totalCalls:  calls.length,
      totalRoutes: routes.length,
      matched,
      violations:  violations.length,
      orphans:     orphans.length,
      health,
    },
  }

  cache.set(sessionId, report)
  return report
}

export function getCachedReport(sessionId: string): ContractReport | null {
  return cache.get(sessionId) ?? null
}

export function clearReport(sessionId: string): void {
  cache.delete(sessionId)
}

// ── Agent context injection ───────────────────────────────────────────────────

export function buildContractContext(sessionId: string): string {
  const report = cache.get(sessionId)
  if (!report || report.violations.length === 0) return ''

  const lines = ['[API CONTRACT VIOLATIONS]']
  for (const v of report.violations.slice(0, 5)) {
    if (v.kind === 'missing_route') {
      lines.push(`  ✗ ${v.call.method} ${v.call.path} — called in frontend but NO backend route exists (${v.call.file.split('/').pop()}:${v.call.line})`)
    } else {
      const methods = v.similar.map(r => r.method).join(', ')
      lines.push(`  ✗ ${v.call.method} ${v.call.path} — route exists but as ${methods} (${v.call.file.split('/').pop()}:${v.call.line})`)
    }
  }
  if (report.violations.length > 5) {
    lines.push(`  ... and ${report.violations.length - 5} more violations`)
  }
  lines.push('[END CONTRACT VIOLATIONS]')
  return lines.join('\n')
}
