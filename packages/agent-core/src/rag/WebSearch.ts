/**
 * WebSearch.ts — DuckDuckGo search + page fetch + text extraction
 * Accepts an AbortSignal so the caller can cancel the entire operation.
 */

export interface SearchResult {
  title:   string
  url:     string
  snippet: string
  content: string
}

export async function search(
  query:      string,
  maxResults = 3,
  signal?:    AbortSignal
): Promise<SearchResult[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal,
    })
    if (!res.ok) return []
    const html   = await res.text()
    const parsed = parseDDGHtml(html).slice(0, maxResults)
    if (parsed.length === 0) return []
    const withContent = await Promise.all(
      parsed.map(async r => ({ ...r, content: await fetchPageText(r.url, signal) }))
    )
    return withContent.filter(r => r.title || r.snippet)
  } catch (err: any) {
    if (err?.name === 'AbortError') return []
    console.warn('[WebSearch] failed:', err?.message ?? err)
    return []
  }
}

function parseDDGHtml(html: string): Omit<SearchResult, 'content'>[] {
  const results: Omit<SearchResult, 'content'>[] = []
  const linkRe    = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  const links:    [string, string][] = []
  const snippets: string[]           = []
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null) {
    let href = m[1]
    try { const uddg = href.match(/uddg=([^&]+)/); if (uddg) href = decodeURIComponent(uddg[1]) } catch { }
    const title = stripTags(m[2]).trim()
    if (href.startsWith('http') && title) links.push([href, title])
  }
  while ((m = snippetRe.exec(html)) !== null) { snippets.push(stripTags(m[1]).trim()) }
  for (let i = 0; i < Math.min(links.length, 5); i++) {
    results.push({ url: links[i][0], title: links[i][1], snippet: snippets[i] ?? '' })
  }
  return results
}

async function fetchPageText(url: string, signal?: AbortSignal, maxChars = 2000): Promise<string> {
  try {
    if (/\.(pdf|zip|png|jpg|jpeg|gif|svg|mp4|mp3|exe|dmg|woff|ttf)$/i.test(url)) return ''
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LocalForge/1.0)' }, signal })
    if (!res.ok) return ''
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return ''
    return extractReadableText(await res.text(), maxChars)
  } catch { return '' }
}

function extractReadableText(html: string, maxChars: number): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
  text = stripTags(text)
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 30)
    .filter(l => !/^[\s\W]{3,}$/.test(l)).join('\n').slice(0, maxChars)
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
}
