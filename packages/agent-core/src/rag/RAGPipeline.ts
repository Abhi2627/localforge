/**
 * RAGPipeline.ts — Reliable web-augmented context injection
 *
 * Design principles:
 * - Only runs on EXPLICIT @web trigger (user typed @web) or auto-detect for live-data queries
 * - Hard-capped at MAX_RAG_MS total — never blocks the stream
 * - All errors caught — RAG failure never crashes the stream
 * - DuckDuckGo HTML scraper with AbortSignal propagation
 */

import { search, type SearchResult } from './WebSearch.js'

const MAX_RAG_MS = 5000  // 5s hard cap — generous but bounded

export interface RAGResult {
  didSearch:    boolean
  ragFailed:    boolean   // true = offline or timed out
  query:        string
  sources:      SearchResult[]
  contextBlock: string
}

// ── Live-data classifier (auto mode only) ─────────────────────────────────────

const LIVE_DATA_SIGNALS = [
  /\b(stock price|share price|closing price|current price|market cap|trading at)\b/i,
  /\b(nse|bse|nasdaq|nyse|sensex|nifty).{0,20}(price|today|current|open|close|high|low)\b/i,
  /\b(price|stock|shares).{0,20}(reliance|tcs|infosys|hdfc|wipro|aapl|googl|msft|tsla|amzn)\b/i,
  /\b(weather|forecast|temperature|will it rain|humidity).{0,30}(today|tomorrow|this week)\b/i,
  /\b(score|result|winner|won|lost).{0,20}(match|game|today|yesterday|last night)\b/i,
  /\b(latest news|breaking news|what happened|news today)\b/i,
  /\b(latest version|current version|stable version|release).{0,20}(of|for)\s+\w+/i,
]

const SKIP_PATTERNS = [
  /^(what is|explain|define|describe|tell me about|how does|what are)\s+/i,
  /\b(algorithm|data structure|design pattern|programming|coding|syntax)\b/i,
  /\b(history|invented|discovered|founded|created|developed)\b/i,
]

export function needsWebSearch(message: string): boolean {
  const msg = message.trim()
  if (msg.split(/\s+/).length < 4) return false
  if (SKIP_PATTERNS.some(r => r.test(msg))) return false
  return LIVE_DATA_SIGNALS.some(r => r.test(msg))
}

// Strip @web prefix if present
export function extractQuery(message: string): string {
  return message
    .replace(/^@web\s*/i, '')
    .replace(/^(can you|could you|please|tell me|show me|what is|what's)\s+/i, '')
    .replace(/\?+$/, '')
    .trim()
    .slice(0, 150)
}

export function hasWebTrigger(message: string): boolean {
  return /^@web\b/i.test(message.trim())
}

function buildContextBlock(results: SearchResult[], query: string): string {
  if (results.length === 0) return ''
  const lines = [`[WEB CONTEXT — searched: "${query}"]`, '']
  for (const r of results) {
    lines.push(`## ${r.title}`)
    lines.push(`Source: ${r.url}`)
    if (r.snippet) lines.push(`Summary: ${r.snippet}`)
    if (r.content)  lines.push(`Content:\n${r.content.slice(0, 1000)}`)
    lines.push('')
  }
  lines.push('[END WEB CONTEXT]')
  lines.push('Use the web context above to answer directly with specific facts and numbers.')
  lines.push('Always cite the source URL inline. Do NOT tell the user how to find the data themselves.')
  return lines.join('\n')
}

// ── Main RAG function ─────────────────────────────────────────────────────────

export async function runRAG(
  message:   string,
  forceWeb:  boolean = false,   // true when user typed @web
  onStatus:  (msg: string) => void = () => {}
): Promise<RAGResult> {
  const empty: RAGResult = { didSearch: false, ragFailed: false, query: '', sources: [], contextBlock: '' }

  try {
    // Decide whether to search
    const shouldSearch = forceWeb || needsWebSearch(message)
    if (!shouldSearch) return empty

    const query = extractQuery(message)
    if (!query) return empty

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MAX_RAG_MS)

    onStatus('Searching web…')

    try {
      const results = await search(query, 3, controller.signal)
      clearTimeout(timer)

      if (results.length === 0) {
        onStatus('No results found')
        return { ...empty, didSearch: true, ragFailed: true, query }
      }

      onStatus(`Found ${results.length} source${results.length > 1 ? 's' : ''}`)
      return {
        didSearch:    true,
        ragFailed:    false,
        query,
        sources:      results,
        contextBlock: buildContextBlock(results, query),
      }
    } catch (err: any) {
      clearTimeout(timer)
      const isTimeout = err?.name === 'AbortError'
      console.warn(`[RAG] ${isTimeout ? 'timed out' : 'failed'}: ${err?.message}`)
      return { ...empty, didSearch: true, ragFailed: true, query }
    }
  } catch {
    return empty
  }
}

// ── Inject RAG context into system prompt ─────────────────────────────────────

export function injectRAGContext(systemPrompt: string, rag: RAGResult): string {
  if (!rag.didSearch) return systemPrompt

  if (rag.ragFailed) {
    return systemPrompt + '\n\n[SYSTEM NOTE: A web search was attempted but failed — device may be offline or search timed out. Tell the user clearly you cannot access real-time data right now. Do NOT fabricate numbers.]'
  }

  if (!rag.contextBlock) return systemPrompt

  return systemPrompt + '\n\n' + rag.contextBlock
}
