/**
 * ModelMetrics.ts — Tracks latency, token speed, and errors per model
 * In-memory store (resets on server restart — intentional, this is live telemetry)
 */

export interface ModelStat {
  name:          string
  totalCalls:    number
  totalTokens:   number
  totalMs:       number
  errors:        ModelError[]
  lastUsed:      number    // timestamp
  lastLatencyMs: number
  lastTps:       number    // tokens per second
}

export interface ModelError {
  ts:      number
  message: string
}

const MAX_ERRORS = 20

const stats = new Map<string, ModelStat>()

function getOrCreate(name: string): ModelStat {
  if (!stats.has(name)) {
    stats.set(name, {
      name, totalCalls: 0, totalTokens: 0, totalMs: 0,
      errors: [], lastUsed: 0, lastLatencyMs: 0, lastTps: 0,
    })
  }
  return stats.get(name)!
}

export function recordSuccess(name: string, tokens: number, ms: number) {
  const s = getOrCreate(name)
  s.totalCalls++
  s.totalTokens += tokens
  s.totalMs     += ms
  s.lastUsed     = Date.now()
  s.lastLatencyMs = ms
  s.lastTps       = ms > 0 ? Math.round((tokens / ms) * 1000) : 0
}

export function recordError(name: string, message: string) {
  const s = getOrCreate(name)
  s.errors.push({ ts: Date.now(), message: message.slice(0, 200) })
  if (s.errors.length > MAX_ERRORS) s.errors.shift()
  s.lastUsed = Date.now()
}

export function getStats(): ModelStat[] {
  return Array.from(stats.values())
}

export function getModelStat(name: string): ModelStat | undefined {
  return stats.get(name)
}

// Avg latency in ms across all calls
export function avgLatency(s: ModelStat): number {
  return s.totalCalls > 0 ? Math.round(s.totalMs / s.totalCalls) : 0
}

// Avg tokens per second across all calls
export function avgTps(s: ModelStat): number {
  return s.totalMs > 0 ? Math.round((s.totalTokens / s.totalMs) * 1000) : 0
}
