/**
 * RAGPipeline.ts
 *
 * Hard rules:
 * 1. RAG only fires for queries that genuinely need LIVE data
 *    (prices, weather, scores, breaking news, package versions)
 * 2. Conceptual questions ("what is X", "explain X") never trigger RAG
 *    — the model already knows these from training data
 * 3. Total RAG phase is capped at MAX_RAG_MS; if it exceeds that,
 *    the search is aborted and the model answers from training data
 * 4. Any unhandled error in RAG is caught — never crashes the stream
 */

import { search, type SearchResult } from './WebSearch.js'

const MAX_RAG_MS = 3000

export interface RAGResult {
  didSearch:    boolean
  ragFailed:    boolean
  query:        string
  sources:      SearchResult[]
  contextBlock: string
}

// ── Signals that require LIVE data — narrow and specific ─────────────────────

// These patterns need real-time web data to answer correctly
const LIVE_DATA_SIGNALS = [
  // Stock prices, market data
  /\b(stock price|share price|closing price|current price|market cap|trading at)\b/i,
  /\b(nse|bse|nasdaq|nyse|sensex|nifty).{0,20}(price|today|current|open|close|high|low)\b/i,
  /\b(price|stock|shares).{0,20}(reliance|tcs|infosys|hdfc|wipro|aapl|googl|msft|tsla|amzn)\b/i,
  // Weather
  /\b(weather|forecast|temperature|will it rain|humidity).{0,30}(today|tomorrow|this week)\b/i,
  // Sports scores
  /\b(score|result|winner|won|lost).{0,20}(match|game|today|yesterday|last night)\b/i,
  // Breaking news  
  /\b(latest news|breaking news|what happened|news today)\b/i,
  // Package/library versions
  /\b(latest version|current version|stable version|release).{0,20}(of|for)\s+\w+/i,
]

// These patterns look like web queries but the model already knows the answer
const TRAINING_DATA_PATTERNS = [
  /^(what is|explain|define|describe|tell me about|how does|what are)\s+/i,
  /\b(rag|llm|gpt|bert|transformer|neural network|machine learning|deep learning)\b/i,
  /\b(algorithm|data structure|design pattern|programming|coding|syntax)\b/i,
  /\b(history|invented|discovered|founded|created|developed)\b/i,
]

export function needsWebSearch(message: string): boolean {
  const msg = message.trim()

  // Too short
  if (msg.split(/\s+/).length < 4) return false

  // Explicitly a conceptual/definitional question — model knows this
  if (TRAINING_DATA_PATTERNS.some(r => r.test(msg))) return false

  // Only trigger for queries that genuinely need live data
  return LIVE_DATA_SIGNALS.some(r => r.test(msg))
}

export function extractSearchQuery(message: string): string {
  return message
    .replace(/^(can you|could you|please|tell me|show me|what is|what's)\s+/i, '')
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
    if (r.content) lines.push(`Content:\n${r.content.slice(0, 800)}`)
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
  const empty: RAGResult = {
    didSearch: false, ragFailed: false,
    query: '', sources: [], contextBlock: '',
  }

  try {
    if (!needsWebSearch(message)) return empty

    const query = extractSearchQuery(message)
    if (!query) return empty

    // Shared abort controller — both timeout and early return use this
    const controller = new AbortController()
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, MAX_RAG_MS)

    onStatus('Searching web…')

    try {
      const results = await search(query, 3, controller.signal)
      clearTimeout(timer)

      if (timedOut || results.length === 0) {
        return { ...empty, didSearch: true, ragFailed: true, query }
      }

      onStatus(`Found ${results.length} source${results.length > 1 ? 's' : ''}`)
      return {
        didSearch: true, ragFailed: false, query,
        sources: results,
        contextBlock: buildContextBlock(results, query),
      }
    } catch {
      clearTimeout(timer)
      return { ...empty, didSearch: true, ragFailed: true, query }
    }
  } catch {
    // Outer catch — never let RAG crash the caller
    return empty
  }
}

// ── Inject RAG context into system prompt ─────────────────────────────────────

export function injectRAGContext(systemPrompt: string, rag: RAGResult): string {
  if (!rag.didSearch) return systemPrompt

  if (rag.ragFailed) {
    return systemPrompt + '\n\n[SYSTEM NOTE: A live web search was attempted for this query but failed — the device may be offline or the search timed out. Inform the user briefly that you cannot access real-time data for this query. Do NOT fabricate numbers or prices.]'
  }

  if (!rag.contextBlock) return systemPrompt

  return (
    systemPrompt +
    '\n\n' + rag.contextBlock +
    '\n\nUse the web context above to answer directly with specific facts. Cite the source URL.'
  )
}
