/**
 * RAGPipeline.ts — Automatic web context injection
 *
 * Key behaviours:
 * - If internet is unreachable → returns ragFailed=true, caller injects a
 *   "not connected to internet" message into the prompt so the model says so
 * - If search returns 0 results → falls back silently, no context injected
 * - If search succeeds → injects [WEB CONTEXT] block into system prompt
 */

import { search, type SearchResult } from './WebSearch.js'

export interface RAGResult {
  didSearch:    boolean
  ragFailed:    boolean   // true = internet unreachable
  query:        string
  sources:      SearchResult[]
  contextBlock: string
}

// ── Heuristic classifier ──────────────────────────────────────────────────────

const WEB_SIGNALS = [
  /\b(latest|recent|current|today|this week|this year|2024|2025|2026)\b/i,
  /\b(how to|how do I|how does|tutorial|example|docs|documentation)\b/i,
  /\b(version|release|changelog|update|upgrade|install|npm|pip|brew)\b/i,
  /\b(error|exception|bug|issue|fix|workaround|stackoverflow)\b/i,
  /\b(api|endpoint|sdk|library|package|module|framework)\b/i,
  /\b(search|look up|find|google|what is|who is|when was|where is)\b/i,
  // Stock / financial data
  /\b(price|stock|share|market|nse|bse|nasdaq|nyse|closing|trading|sensex|nifty)\b/i,
  /\b(reliance|tcs|infosys|hdfc|infy|tatamotors|wipro|aapl|googl|msft|tsla)\b/i,
  // Weather
  /\b(weather|forecast|temperature|rain|humidity)\b/i,
  // Sports / news
  /\b(score|match|result|news|headline|won|lost|winner)\b/i,
]

const LOCAL_SIGNALS = [
  /\b(refactor|rewrite|this code|my code|this file|this project|the function|above|below)\b/i,
  /\b(explain this|what does this|review|check this|analyse this)\b/i,
]

export function needsWebSearch(message: string): boolean {
  if (message.trim().split(/\s+/).length < 3) return false
  if (LOCAL_SIGNALS.some(r => r.test(message))) return false
  return WEB_SIGNALS.some(r => r.test(message))
}

export function extractSearchQuery(message: string): string {
  return message
    .replace(/^(can you|could you|please|hey|hi|tell me|show me|explain|what is|how to|how do I)\s+/i, '')
    .replace(/\?+$/, '')
    .trim()
    .slice(0, 120)
}

function buildContextBlock(results: SearchResult[], query: string): string {
  if (results.length === 0) return ''
  const lines = [`[WEB CONTEXT — searched: "${query}"]`, '']
  for (const r of results) {
    lines.push(`## ${r.title}`)
    lines.push(`Source: ${r.url}`)
    if (r.snippet) lines.push(`Summary: ${r.snippet}`)
    if (r.content)  lines.push(`Content:\n${r.content.slice(0, 800)}`)
    lines.push('')
  }
  lines.push('[END WEB CONTEXT]')
  return lines.join('\n')
}

// ── Connectivity check ────────────────────────────────────────────────────────

async function isOnline(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch('https://www.google.com/generate_204', {
      method: 'HEAD', signal: controller.signal,
    }).finally(() => clearTimeout(timer))
    return res.status === 204 || res.ok
  } catch {
    return false
  }
}

// ── Main RAG function ─────────────────────────────────────────────────────────

export async function runRAG(
  message:  string,
  onStatus: (msg: string) => void = () => {}
): Promise<RAGResult> {
  const empty: RAGResult = { didSearch: false, ragFailed: false, query: '', sources: [], contextBlock: '' }

  if (!needsWebSearch(message)) return empty

  const query = extractSearchQuery(message)
  if (!query) return empty

  onStatus('Checking connection…')

  // Check internet before attempting search
  const online = await isOnline()
  if (!online) {
    return { ...empty, didSearch: true, ragFailed: true, query }
  }

  onStatus('Searching web…')

  try {
    const results = await search(query, 3)

    if (results.length === 0) {
      // Search ran but got no results — not a connectivity issue
      return { ...empty, didSearch: true, ragFailed: false, query }
    }

    onStatus(`Found ${results.length} source${results.length > 1 ? 's' : ''}`)

    const contextBlock = buildContextBlock(results, query)
    return { didSearch: true, ragFailed: false, query, sources: results, contextBlock }
  } catch {
    return { ...empty, didSearch: true, ragFailed: false, query }
  }
}

// ── Context injection ─────────────────────────────────────────────────────────

export function injectRAGContext(systemPrompt: string, ragResult: RAGResult): string {
  if (!ragResult.didSearch) return systemPrompt

  // No internet — tell the model explicitly so it gives a clear answer
  if (ragResult.ragFailed) {
    return systemPrompt + `\n\n[SYSTEM NOTE: Internet search was attempted for this query but the device is not connected to the internet. You MUST tell the user clearly that you are not connected to the internet and therefore cannot fetch live data like stock prices, weather, or current news. Do NOT make up data or give a generic "here's how to find it" answer — just say you are offline and cannot access real-time information.]`
  }

  // Search ran but no results — tell model to be honest about it
  if (ragResult.contextBlock === '') {
    return systemPrompt + `\n\n[SYSTEM NOTE: A web search was attempted for "${ragResult.query}" but returned no usable results. Be honest that you don't have current data for this query rather than making up information.]`
  }

  // We have web context — inject it and instruct the model to use it directly
  return systemPrompt +
    '\n\n' + ragResult.contextBlock +
    '\n\nIMPORTANT: Use the web context above to answer the question directly with specific data (prices, numbers, facts). Do NOT tell the user how to find the information themselves. If the context contains the answer, state it clearly. Cite the source URL at the end.'
}
