/**
 * KnowledgeGraph.ts
 *
 * Per-project in-memory symbol store.
 * Tracks which files define which symbols, detects conflicts,
 * and provides context injection for agent prompts.
 */

import fs from 'fs'
import path from 'path'
import { extractSymbols, type ExtractedSymbol, type SymbolKind } from './SymbolExtractor.js'

export interface GraphNode extends ExtractedSymbol {
  sessionId: string
}

export interface Conflict {
  name:   string
  kind:   SymbolKind
  files:  string[]   // two or more files defining the same symbol
}

export interface GraphSummary {
  totalSymbols: number
  byKind:       Record<SymbolKind, number>
  byFile:       Array<{ file: string; count: number }>
  conflicts:    Conflict[]
  topSymbols:   GraphNode[]   // most recently added
}

// One graph per session
const graphs = new Map<string, GraphNode[]>()

// ── Build / scan ──────────────────────────────────────────────────────────────

const SCANNABLE = /\.(ts|tsx|js|jsx|py|rs)$/
const IGNORE    = ['node_modules', '.git', 'dist', 'build', '.next', 'target', '.tauri']

export function scanProject(sessionId: string, rootPath: string): number {
  const nodes: GraphNode[] = []

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        if (IGNORE.includes(e.name)) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { walk(full); continue }
        if (!SCANNABLE.test(e.name)) continue
        try {
          const src = fs.readFileSync(full, 'utf8')
          const syms = extractSymbols(full, src)
          syms.forEach(s => nodes.push({ ...s, sessionId }))
        } catch { }
      }
    } catch { }
  }

  walk(rootPath)
  graphs.set(sessionId, nodes)
  return nodes.length
}

// Update symbols for a single file (call after agent writes a file)
export function updateFile(sessionId: string, filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) {
      // File deleted — remove its symbols
      const existing = graphs.get(sessionId) ?? []
      graphs.set(sessionId, existing.filter(n => n.file !== filePath))
      return
    }
    const src  = fs.readFileSync(filePath, 'utf8')
    const syms = extractSymbols(filePath, src)
    const existing = graphs.get(sessionId) ?? []
    // Replace all symbols for this file
    const filtered = existing.filter(n => n.file !== filePath)
    syms.forEach(s => filtered.push({ ...s, sessionId }))
    graphs.set(sessionId, filtered)
  } catch { }
}

// ── Query ─────────────────────────────────────────────────────────────────────

export function getSymbols(sessionId: string): GraphNode[] {
  return graphs.get(sessionId) ?? []
}

export function getSymbolsForFile(sessionId: string, filePath: string): GraphNode[] {
  return (graphs.get(sessionId) ?? []).filter(n => n.file === filePath)
}

export function findSymbol(sessionId: string, name: string): GraphNode[] {
  return (graphs.get(sessionId) ?? []).filter(n => n.name.toLowerCase().includes(name.toLowerCase()))
}

export function getConflicts(sessionId: string): Conflict[] {
  const nodes   = graphs.get(sessionId) ?? []
  const byName  = new Map<string, GraphNode[]>()

  for (const n of nodes) {
    if (!n.exported) continue  // only check exported symbols for conflicts
    const key = `${n.name}:${n.kind}`
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key)!.push(n)
  }

  const conflicts: Conflict[] = []
  byName.forEach((nodes, key) => {
    const uniqueFiles = [...new Set(nodes.map(n => n.file))]
    if (uniqueFiles.length > 1) {
      conflicts.push({ name: nodes[0].name, kind: nodes[0].kind, files: uniqueFiles })
    }
  })
  return conflicts
}

export function getSummary(sessionId: string): GraphSummary {
  const nodes     = graphs.get(sessionId) ?? []
  const conflicts = getConflicts(sessionId)

  const byKind: Record<string, number> = {}
  const byFile: Record<string, number> = {}

  for (const n of nodes) {
    byKind[n.kind] = (byKind[n.kind] ?? 0) + 1
    const rel = n.file.split('/').slice(-2).join('/')
    byFile[rel]  = (byFile[rel]  ?? 0) + 1
  }

  return {
    totalSymbols: nodes.length,
    byKind:       byKind as Record<SymbolKind, number>,
    byFile:       Object.entries(byFile)
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    conflicts,
    topSymbols: nodes.slice(-20).reverse(),
  }
}

// ── Context injection for agent prompts ───────────────────────────────────────
// Returns a compact string the agent can use to avoid redefining existing symbols

export function buildAgentContext(sessionId: string, targetFile?: string): string {
  const nodes     = graphs.get(sessionId) ?? []
  const conflicts = getConflicts(sessionId)
  const lines: string[] = []

  if (nodes.length === 0) return ''

  lines.push('[KNOWLEDGE GRAPH — existing symbols in this project]')

  // Show conflicts first — most important
  if (conflicts.length > 0) {
    lines.push('\n⚠ CONFLICTS — same symbol defined in multiple files:')
    for (const c of conflicts.slice(0, 5)) {
      lines.push(`  ${c.kind} "${c.name}" in: ${c.files.map(f => f.split('/').pop()).join(', ')}`)
    }
  }

  // Show exported symbols grouped by file (exclude target file)
  const exported = nodes.filter(n => n.exported && n.file !== targetFile)
  if (exported.length > 0) {
    const byFile = new Map<string, GraphNode[]>()
    for (const n of exported) {
      if (!byFile.has(n.file)) byFile.set(n.file, [])
      byFile.get(n.file)!.push(n)
    }
    lines.push('\nExported symbols by file:')
    byFile.forEach((syms, file) => {
      const rel = file.split('/').slice(-3).join('/')
      lines.push(`  ${rel}: ${syms.slice(0, 8).map(s => `${s.name}(${s.kind[0]})`).join(', ')}${syms.length > 8 ? ` +${syms.length - 8}` : ''}`)
    })
  }

  lines.push('[END KNOWLEDGE GRAPH]')
  return lines.join('\n')
}

export function clearGraph(sessionId: string): void {
  graphs.delete(sessionId)
}
