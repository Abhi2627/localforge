/**
 * RAGPipeline.ts — Web-augmented context injection
 */

import { search, type SearchResult } from './WebSearch.js'

const MAX_RAG_MS = 5000

export interface RAGResult {
  didSearch:    boolean
  ragFailed:    boolean
  query:        string
  sources:      SearchResult[]
  contextBlock: string
}

// ── Live-data classifier ──────────────────────────────────────────────────────

const LIVE_DATA_SIGNALS = [
  /\b(stock price|share price|closing price|current price|market cap|trading at)\b/i,
  /\b(nse|bse|nasdaq|nyse|sensex|nifty).{0,20}(price|today|current|open|close|high|low)\b/i,
  /\b(price|stock|shares).{0,20}(reliance|tcs|infosys|hdfc|wipro|aapl|googl|msft|tsla|amzn)\b/i,
  /\b(weather|forecast|temperature|will it rain|humidity).{0,30}(today|tomorrow|this week)\b/i,
  /\b(score|result|winner|won|lost).{0,20}(match|game|today|yesterday|last night)\b/i,
  /\b(latest news|breaking news|what happened|news today)\b/i,
  /\b(latest version|current version|stable version|release).{0,20}(of|for)\s+\w+/i,
  /\b(current|who is|who's).{0,20}(cm|chief minister|pm|prime minister|president|governor|ceo)\b/i,
  /\b(cm|chief minister|pm|prime minister).{0,20}(of|for)\s+\w+/i,
]

const SKIP_PATTERNS = [
  /\b(algorithm|data structure|design pattern|syntax)\b/i,
  /\b(invented|discovered|founded|created|developed)\b/i,
]

export function needsWebSearch(message: string): boolean {
  const msg = message.trim()
  if (msg.split(/\s+/).length < 3) return false
  if (SKIP_PATTERNS.some(r => r.test(msg))) return false
  return LIVE_DATA_SIGNALS.some(r => r.test(msg))
}

export function extractQuery(message: string): string {
  return message
    .replace(/^@web\s*/i, '')
    .replace(/^(can you|could you|please|tell me|show me)\s+/i, '')
    .replace(/\?+$/, '')
    .trim()
    .slice(0, 150)
}

export function hasWebTrigger(message: string): boolean {
  return /^@web\b/i.test(message.trim())
}

function buildContextBlock(results: SearchResult[], query: string): string {
  if (results.length === 0) return ''
  const lines = [
    `[WEB SEARCH RESULTS for: "${query}"]`,
    `[Retrieved: ${new Date().toUTCString()}]`,
    '',
  ]
  for (const r of results) {
    lines.push(`### ${r.title}`)
    lines.push(`URL: ${r.url}`)
    if (r.snippet) lines.push(`Snippet: ${r.snippet}`)
    if (r.content) lines.push(`Page content:\n${r.content.slice(0, 1200)}`)
    lines.push('')
  }
  lines.push('[END WEB RESULTS]')
  return lines.join('\n')
}

export async function runRAG(
  message:  string,
  forceWeb: boolean = false,
  onStatus: (msg: string) => void = () => {}
): Promise<RAGResult> {
  const empty: RAGResult = { didSearch: false, ragFailed: false, query: '', sources: [], contextBlock: '' }
  try {
    if (!forceWeb && !needsWebSearch(message)) return empty
    const query = extractQuery(message)
    if (!query) return empty

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MAX_RAG_MS)
    onStatus('Searching web…')
    try {
      const results = await search(query, 3, controller.signal)
      clearTimeout(timer)
      if (results.length === 0) { onStatus('No results found'); return { ...empty, didSearch: true, ragFailed: true, query } }
      onStatus(`Found ${results.length} source${results.length > 1 ? 's' : ''}`)
      return { didSearch: true, ragFailed: false, query, sources: results, contextBlock: buildContextBlock(results, query) }
    } catch (err: any) {
      clearTimeout(timer)
      console.warn(`[RAG] ${err?.name === 'AbortError' ? 'timed out' : 'failed'}: ${err?.message}`)
      return { ...empty, didSearch: true, ragFailed: true, query }
    }
  } catch { return empty }
}

export function injectRAGContext(systemPrompt: string, rag: RAGResult): string {
  if (!rag.didSearch) return systemPrompt

  if (rag.ragFailed) {
    return systemPrompt + '\n\n[SYSTEM: Web search failed — tell the user you cannot fetch live data right now. Do NOT guess or invent any facts.]'
  }

  if (!rag.contextBlock) return systemPrompt

  // The instruction is placed AFTER the context so it's the last thing the model reads
  // before generating — highest influence position in the prompt
  return (
    systemPrompt +
    '\n\n' + rag.contextBlock +
    `\n\n
===STRICT INSTRUCTIONS FOR THIS RESPONSE===
You MUST follow these rules or your answer will be wrong:
1. Answer using ONLY the [WEB SEARCH RESULTS] above. Your training data is OUTDATED for this question.
2. Copy facts EXACTLY from the search results — do not paraphrase, infer, or combine with memory.
3. If the results state a party name, use that EXACT party name. Do not substitute it with another party.
4. If the results do not contain a specific fact, write "Not found in search results" for that fact.
5. Cite the source URL at the end of your answer.
6. Do NOT add information not present in the search results.
===END STRICT INSTRUCTIONS===`
  )
}
