/**
 * WebSearch.ts — DuckDuckGo search + page fetch + text extraction
 *
 * Uses DuckDuckGo's HTML endpoint (no API key required).
 * Falls back gracefully if search or fetch fails.
 */

export interface SearchResult {
  title:   string
  url:     string
  snippet: string
  content: string   // extracted page text (may be empty if fetch failed)
}

// ── DuckDuckGo search ─────────────────────────────────────────────────────────

export async function search(query: string, maxResults = 3): Promise<SearchResult[]> {
  try {
    // DuckDuckGo HTML search — no API key needed
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res  = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LocalForge/1.0)',
        'Accept':     'text/html',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) throw new Error(`DDG returned ${res.status}`)

    const html    = await res.text()
    const results = parseDDGHtml(html).slice(0, maxResults)

    // Fetch page content for each result in parallel
    const withContent = await Promise.all(
      results.map(async r => ({
        ...r,
        content: await fetchPageText(r.url),
      }))
    )

    return withContent
  } catch (err) {
    console.warn('[WebSearch] Search failed:', (err as Error).message)
    return []
  }
}

// ── Parse DDG HTML results ────────────────────────────────────────────────────

function parseDDGHtml(html: string): Omit<SearchResult, 'content'>[] {
  const results: Omit<SearchResult, 'content'>[] = []

  // DuckDuckGo HTML result links are in <a class="result__a"> tags
  // Snippets are in <a class="result__snippet">
  const linkRe    = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  const links:    Array<[string, string]> = []
  const snippets: string[]                = []

  let m: RegExpExecArray | null

  while ((m = linkRe.exec(html)) !== null) {
    const href  = decodeURIComponent(m[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0])
    const title = stripTags(m[2]).trim()
    if (href.startsWith('http') && title) links.push([href, title])
  }

  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(stripTags(m[1]).trim())
  }

  for (let i = 0; i < Math.min(links.length, 5); i++) {
    results.push({
      url:     links[i][0],
      title:   links[i][1],
      snippet: snippets[i] ?? '',
    })
  }

  return results
}

// ── Fetch and extract readable text from a page ───────────────────────────────

export async function fetchPageText(url: string, maxChars = 3000): Promise<string> {
  try {
    // Skip non-HTML resources
    if (/\.(pdf|zip|png|jpg|gif|mp4|mp3|exe|dmg)$/i.test(url)) return ''

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LocalForge/1.0)' },
      signal:  AbortSignal.timeout(6000),
    })

    if (!res.ok) return ''

    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return ''

    const html = await res.text()
    return extractReadableText(html, maxChars)
  } catch {
    return ''
  }
}

// ── Text extraction from HTML ─────────────────────────────────────────────────

function extractReadableText(html: string, maxChars: number): string {
  // Remove scripts, styles, nav, footer, header
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')

  // Convert common block elements to newlines
  text = text
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')

  // Strip all remaining tags
  text = stripTags(text)

  // Clean up whitespace
  text = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 20)           // skip empty / very short lines
    .filter(l => !/^[\s\W]+$/.test(l))    // skip lines that are just symbols
    .join('\n')

  return text.slice(0, maxChars)
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
}
