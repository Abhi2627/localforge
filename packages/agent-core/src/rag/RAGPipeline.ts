/**
 * RAGPipeline.ts — Web-augmented context injection
 */

import { search, activeSearchProvider, type SearchResult } from './WebSearch.js'

const MAX_RAG_MS = 12000   // headroom for the search API + any page fetches (5s was too tight)

export interface RAGResult {
  didSearch:    boolean
  ragFailed:    boolean
  query:        string
  sources:      SearchResult[]
  contextBlock: string
  // Pre-extracted facts to prepend before the model response
  // This bypasses model hallucination for simple factual lookups
  extractedFacts?: string
}

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

// ── Extract key facts directly from snippets ──────────────────────────────────
// This is the critical addition: we pull facts OUT of the search results
// and format them as a clean answer prefix, so the model just needs to elaborate.
// The model cannot hallucinate what it never generates — we generate the facts ourselves.

function extractFactsFromResults(results: SearchResult[], query: string): string | undefined {
  if (results.length === 0) return undefined

  const topSnippet = results[0]?.snippet
  const topContent = results[0]?.content?.split('\n').filter(l => l.length > 20)[0] ?? ''
  const source     = results[0]?.url ?? ''
  const title      = results[0]?.title ?? ''

  if (!topSnippet && !topContent) return undefined

  // Build a clean fact summary from the raw snippet — no model involved
  const factText = topSnippet || topContent
  return `> **From web search:** ${factText}\n> Source: ${source}\n`
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
      if (results.length === 0) {
        const hint = activeSearchProvider() === 'duckduckgo'
          ? 'No results — free DuckDuckGo search is often rate-limited. Add a free Tavily or Brave key in Settings → Cloud → Web Search for reliable results.'
          : 'No results found.'
        onStatus(hint)
        return { ...empty, didSearch: true, ragFailed: true, query }
      }
      onStatus(`Found ${results.length} source${results.length > 1 ? 's' : ''}`)
      const extractedFacts = extractFactsFromResults(results, query)
      return {
        didSearch:    true,
        ragFailed:    false,
        query,
        sources:      results,
        contextBlock: buildContextBlock(results, query),
        extractedFacts,
      }
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
    const keyHint = activeSearchProvider() === 'duckduckgo'
      ? ' Suggest the user add a free Tavily or Brave API key in Settings → Cloud → Web Search for reliable results.'
      : ''
    return systemPrompt + `\n\n[SYSTEM: Web search returned no results — tell the user you could not fetch live web data right now and do NOT guess or invent any facts.${keyHint}]`
  }

  if (!rag.contextBlock) return systemPrompt

  return (
    systemPrompt +
    '\n\n' + rag.contextBlock +
    `\n\n===ANSWER USING THE WEB RESULTS ABOVE===
Use ONLY the web results above — not your own training memory.
- Start with the direct answer in ONE sentence (e.g. "The current Chief Minister of X is Y, in office since <date>.").
- Copy names, parties, dates and numbers EXACTLY as they appear in the results.
- If sources disagree, prefer the most authoritative/most recent; if they don't clearly answer, say so plainly.
- Then add 1–2 concise sentences of supporting detail. Do not pad, speculate, or add unrelated info.
===END===`
  )
}
