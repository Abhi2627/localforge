/**
 * RAGPipeline.ts — Automatic web context injection
 *
 * Flow:
 *   1. needsWebSearch(message) — fast heuristic classifier (no model call)
 *   2. If yes → search DuckDuckGo → fetch pages → buildContext()
 *   3. Return enriched system prompt with [WEB CONTEXT] block injected
 *
 * Design decisions:
 *   - Classifier is pure heuristic (keyword + pattern based), not a model call.
 *     This keeps latency low and avoids a round-trip just to decide whether to search.
 *   - Context is capped at ~4000 chars total to avoid overflowing model context window.
 *   - Sources are included so the model can cite them.
 */

import { search, type SearchResult } from './WebSearch.js'

export interface RAGResult {
  didSearch:    boolean
  query:        string          // the query we actually searched
  sources:      SearchResult[]
  contextBlock: string          // ready to inject into system prompt
}

// ── Heuristic classifier — no model call needed ───────────────────────────────

// Signals that strongly suggest live web data would help
const WEB_SIGNALS = [
  // News / current events
  /\b(latest|recent|current|today|this week|this year|2024|2025|2026)\b/i,
  // Library / framework questions
  /\b(how to|how do I|how does|tutorial|example|docs|documentation)\b/i,
  // Version / release questions
  /\b(version|release|changelog|update|upgrade|install|npm|pip|brew)\b/i,
  // Error lookup
  /\b(error|exception|bug|issue|fix|workaround|stackoverflow)\b/i,
  // API / service questions
  /\b(api|endpoint|sdk|library|package|module|framework)\b/i,
  // Direct web intent
  /\b(search|look up|find|google|what is|who is|when was|where is)\b/i,
]

// Signals that suggest the question is purely local / conversational — skip search
const LOCAL_SIGNALS = [
  /\b(refactor|rewrite|this code|my code|this file|this project|the function|above)\b/i,
  /\b(explain|what does this|what do you think|review|check|analyse)\b/i,
]

export function needsWebSearch(message: string): boolean {
  // Short conversational messages — skip
  if (message.trim().split(' ').length < 4) return false

  // If it looks clearly local — skip
  if (LOCAL_SIGNALS.some(r => r.test(message))) return false

  // If it matches any web signal — search
  return WEB_SIGNALS.some(r => r.test(message))
}

// ── Extract a clean search query from the user's message ─────────────────────

export function extractSearchQuery(message: string): string {
  // Remove common conversational prefixes
  return message
    .replace(/^(can you|could you|please|hey|hi|tell me|show me|explain|what is|how to|how do I)\s+/i, '')
    .replace(/\?+$/, '')
    .trim()
    .slice(0, 120)  // max 120 chars for search
}

// ── Build context block from search results ───────────────────────────────────

function buildContextBlock(results: SearchResult[], query: string): string {
  if (results.length === 0) return ''

  const lines: string[] = [
    `[WEB CONTEXT — searched for: "${query}"]`,
    '',
  ]

  for (const r of results) {
    lines.push(`## ${r.title}`)
    lines.push(`Source: ${r.url}`)
    if (r.snippet) lines.push(`Summary: ${r.snippet}`)
    if (r.content) {
      // Trim content to avoid blowing context budget
      const content = r.content.slice(0, 800)
      lines.push(`Content:\n${content}`)
    }
    lines.push('')
  }

  lines.push('[END WEB CONTEXT]')
  return lines.join('\n')
}

// ── Main RAG function ─────────────────────────────────────────────────────────

export async function runRAG(
  message:  string,
  onStatus: (msg: string) => void = () => {}
): Promise<RAGResult> {
  const empty: RAGResult = { didSearch: false, query: '', sources: [], contextBlock: '' }

  if (!needsWebSearch(message)) return empty

  const query = extractSearchQuery(message)
  if (!query) return empty

  onStatus('Searching web…')

  try {
    const results = await search(query, 3)
    if (results.length === 0) return empty

    onStatus(`Found ${results.length} sources`)

    const contextBlock = buildContextBlock(results, query)
    return { didSearch: true, query, sources: results, contextBlock }
  } catch (err) {
    console.warn('[RAG] Search failed:', (err as Error).message)
    return empty
  }
}

// ── Inject RAG context into a system prompt ───────────────────────────────────

export function injectRAGContext(systemPrompt: string, ragResult: RAGResult): string {
  if (!ragResult.didSearch || !ragResult.contextBlock) return systemPrompt

  return systemPrompt + '\n\n' + ragResult.contextBlock + '\n\nWhen relevant, cite sources from the web context above using the format [source: URL].'
}
