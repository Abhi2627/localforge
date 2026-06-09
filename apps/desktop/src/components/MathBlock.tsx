import { useEffect, useRef, useState } from 'react'
import type KatexType from 'katex'
import { openUrl } from '@tauri-apps/plugin-opener'

// ── Link with confirmation dialog + copy icon ───────────────────────────────
export function LinkWithConfirm({ href, children }: { href: string; children?: React.ReactNode }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [copied, setCopied]           = useState(false)

  async function openLink() {
    try {
      await openUrl(href)
    } catch {
      // Fallback for browser dev mode
      window.open(href, '_blank', 'noopener,noreferrer')
    }
    setShowConfirm(false)
  }

  function copyLink() {
    navigator.clipboard.writeText(href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <>
      <span style={{ display:'inline-flex', alignItems:'center', gap:2, verticalAlign:'middle' }}>
        {/* Clickable link text */}
        <a onClick={e => { e.preventDefault(); setShowConfirm(true) }} href={href}
          style={{ color:'var(--accent)', textDecoration:'underline', cursor:'pointer' }}>
          {children ?? href}
        </a>
        {/* Copy icon */}
        <button onClick={copyLink} title={copied ? 'Copied!' : 'Copy link'}
          style={{ background:'none', border:'none', cursor:'pointer', color: copied ? '#3dd68c' : 'var(--text-muted)', padding:'0 2px', display:'inline-flex', alignItems:'center', lineHeight:1 }}
          onMouseEnter={e => { if (!copied) (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { if (!copied) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}>
          {copied
            ? <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>
            : <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
          }
        </button>
      </span>

      {/* Confirmation modal */}
      {showConfirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setShowConfirm(false)}>
          <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:10, padding:'22px 24px', maxWidth:440, width:'90%', boxShadow:'0 8px 32px rgba(0,0,0,0.6)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:14, fontWeight:600, color:'var(--text-primary)', marginBottom:6 }}>
              Open link in browser?
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:8 }}>LocalForge wants to open:</div>
            <div style={{ fontSize:11, color:'var(--accent)', fontFamily:'monospace', background:'var(--bg-primary)', padding:'7px 10px', borderRadius:5, marginBottom:18, wordBreak:'break-all', lineHeight:1.5 }}>
              {href}
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setShowConfirm(false)}
                style={{ padding:'7px 18px', borderRadius:6, border:'1px solid var(--border)', background:'transparent', color:'var(--text-secondary)', cursor:'pointer', fontSize:12 }}>
                Cancel
              </button>
              <button onClick={openLink}
                style={{ padding:'7px 18px', borderRadius:6, border:'none', background:'var(--accent)', color:'white', cursor:'pointer', fontSize:12, fontWeight:600 }}>
                Open
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── KaTeX singleton ───────────────────────────────────────────────────────────
let katexModule: typeof KatexType | null = null
let katexLoadPromise: Promise<typeof KatexType> | null = null

async function getKatex(): Promise<typeof KatexType> {
  if (katexModule) return katexModule
  if (!katexLoadPromise) {
    katexLoadPromise = import('katex').then(async mod => {
      try { await import('katex/dist/katex.min.css') } catch {
        if (!document.getElementById('katex-css')) {
          const link = document.createElement('link')
          link.id = 'katex-css'; link.rel = 'stylesheet'
          link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css'
          document.head.appendChild(link)
        }
      }
      katexModule = mod.default
      return mod.default
    })
  }
  return katexLoadPromise
}

interface Props {
  math:        string
  block:       boolean
  errorColor?: string
}

export default function MathBlock({ math, block, errorColor = '#f14c4c' }: Props) {
  const ref    = useRef<HTMLSpanElement>(null)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  function copySource() {
    const text = block ? `$$\n${math}\n$$` : `$${math}$`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  useEffect(() => {
    if (!ref.current) return
    setFailed(false)
    getKatex().then(katex => {
      if (!ref.current) return
      try {
        ref.current.innerHTML = ''
        katex.render(math.trim(), ref.current, {
          displayMode:  block,
          throwOnError: false,
          errorColor,
          output:       'html',
          trust:        false,
          strict:       false,
        })
      } catch { setFailed(true) }
    }).catch(() => setFailed(true))
  }, [math, block]) // eslint-disable-line

  if (block) {
    return (
      <div style={{ margin:'10px 0', background:'#252526', border:'1px solid #3c3c3c', borderRadius:6, overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 10px', borderBottom:'1px solid #3c3c3c', background:'#2d2d2d' }}>
          <span style={{ fontSize:10, color:'#858585', fontFamily:'monospace', userSelect:'none' }}>math</span>
          <button onClick={copySource}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#858585', fontSize:10, padding:'2px 4px', borderRadius:3 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#cccccc'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#858585'}>
            {copied ? <span style={{ color:'#3dd68c' }}>✓ Copied!</span> : 'Copy source'}
          </button>
        </div>
        <div style={{ padding:'12px 16px', overflowX:'auto', textAlign:'center', minHeight:40 }}>
          {failed
            ? <code style={{ fontSize:12, color:'#ce9178', fontFamily:'monospace', whiteSpace:'pre-wrap' }}>{math}</code>
            : <span ref={ref} style={{ color:'#d4d4d4' }}/>
          }
        </div>
      </div>
    )
  }

  return failed
    ? <code style={{ fontSize:12, color:'#ce9178', fontFamily:'monospace' }}>{math}</code>
    : <span ref={ref} style={{ color:'#d4d4d4', display:'inline' }}/>
}

// ── hasMath ───────────────────────────────────────────────────────────────────
export function hasMath(content: string): boolean {
  return /```math[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+?\$|\\\((?:[^\\]|\\[\s\S])+?\\\)/.test(content)
}

// ── Segment types ─────────────────────────────────────────────────────────────
export type Segment =
  | { type: 'text';         value: string }
  | { type: 'math-block';   value: string }
  | { type: 'math-inline';  value: string }
  | { type: 'fence';        lang: string; value: string }   // ```lang\n...\n```
  | { type: 'heading';      level: 1|2|3|4; value: string }
  | { type: 'bullet-list';  items: string[] }
  | { type: 'numbered-list';items: string[] }
  | { type: 'blockquote';   value: string }
  | { type: 'hr' }
  | { type: 'paragraph';    value: string }

// ── Full content parser ───────────────────────────────────────────────────────
// Parses a full response into block-level segments, then handles inline math
// within text segments. This replaces ReactMarkdown for math-containing responses.

export function parseContent(content: string): Segment[] {
  const segments: Segment[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block  ``` ... ```
    if (/^```/.test(line)) {
      const lang  = line.slice(3).trim()
      const start = i + 1
      let end = start
      while (end < lines.length && !lines[end].startsWith('```')) end++
      const body = lines.slice(start, end).join('\n')
      if (lang === 'math') {
        segments.push({ type: 'math-block', value: body.trim() })
      } else {
        segments.push({ type: 'fence', lang, value: body })
      }
      i = end + 1
      continue
    }

    // Block math \[...\] or $...$ on a SINGLE line  e.g.  \[ f(x) = x^2 \]
    const singleLineBlock = line.match(/^\s*\\\[(.+)\\\]\s*$/) || line.match(/^\s*\$\$(.+)\$\$\s*$/)
    if (singleLineBlock) {
      segments.push({ type: 'math-block', value: singleLineBlock[1].trim() })
      i++; continue
    }

    // Block math  \[...\]  or  $...$ spanning multiple lines
    const blockMathStart = line.match(/^\s*(\\\[|\$\$)\s*$/)
    if (blockMathStart) {
      const closer = blockMathStart[1] === '\\[' ? '\\]' : '$$'
      let end = i + 1
      while (end < lines.length && !lines[end].trim().startsWith(closer)) end++
      const body = lines.slice(i + 1, end).join('\n').trim()
      segments.push({ type: 'math-block', value: body })
      i = end + 1
      continue
    }

    // Heading  # ## ###
    const hm = line.match(/^(#{1,4})\s+(.+)$/)
    if (hm) {
      segments.push({ type: 'heading', level: hm[1].length as 1|2|3|4, value: hm[2] })
      i++; continue
    }

    // HR  ---
    if (/^[-*_]{3,}$/.test(line.trim())) {
      segments.push({ type: 'hr' })
      i++; continue
    }

    // Bullet list
    if (/^(\s*[-*+])\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      segments.push({ type: 'bullet-list', items })
      continue
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      segments.push({ type: 'numbered-list', items })
      continue
    }

    // Blockquote
    if (line.startsWith('>')) {
      const bqLines: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        bqLines.push(lines[i].slice(1).trim())
        i++
      }
      segments.push({ type: 'blockquote', value: bqLines.join('\n') })
      continue
    }

    // Empty line — paragraph break
    if (line.trim() === '') { i++; continue }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*[-*+]\s/.test(lines[i]) &&
      !/^\s*\d+\.\s/.test(lines[i]) &&
      !/^[-*_]{3,}$/.test(lines[i].trim()) &&
      !lines[i].startsWith('>')
    ) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length) {
      segments.push({ type: 'paragraph', value: paraLines.join(' ') })
    }
  }

  return segments
}

// ── Inline parser ─────────────────────────────────────────────────────────────
// Parses a single line/paragraph into inline elements with math, bold, italic, code

export type InlineToken =
  | { t: 'text';         v: string }
  | { t: 'math';         v: string }
  | { t: 'bold';         v: string }
  | { t: 'italic';       v: string }
  | { t: 'code';         v: string }
  | { t: 'bold-italic';  v: string }
  | { t: 'link';         v: string; href: string }

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  // Combined regex: inline math \(...\), $...$, bold-italic, bold, italic, inline code, markdown links
  const rx = /\\\(((?:[^\\]|\\[\s\S])+?)\\\)|\$([^$\n]+?)\$|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|_(.+?)_|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  let last = 0, m: RegExpExecArray | null
  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) tokens.push({ t: 'text', v: text.slice(last, m.index) })
    if (m[1] !== undefined) tokens.push({ t: 'math', v: m[1].trim() })       // \(...\)
    else if (m[2] !== undefined) tokens.push({ t: 'math', v: m[2].trim() })  // $...$
    else if (m[3] !== undefined) tokens.push({ t: 'bold-italic', v: m[3] })  // ***
    else if (m[4] !== undefined) tokens.push({ t: 'bold', v: m[4] })         // **
    else if (m[5] !== undefined) tokens.push({ t: 'bold', v: m[5] })         // __
    else if (m[6] !== undefined) tokens.push({ t: 'italic', v: m[6] })       // _
    else if (m[7] !== undefined) tokens.push({ t: 'italic', v: m[7] })       // *
    else if (m[8] !== undefined) tokens.push({ t: 'code', v: m[8] })         // `
    else if (m[9] !== undefined) tokens.push({ t: 'link', v: m[9], href: m[10] }) // [text](url)
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ t: 'text', v: text.slice(last) })
  return tokens
}

export function renderInline(text: string, key?: string | number): React.ReactNode {
  const tokens = parseInline(text)
  return (
    <span key={key}>
      {tokens.map((tok, i) => {
        if (tok.t === 'math')        return <MathBlock key={i} math={tok.v} block={false}/>
        if (tok.t === 'bold')        return <strong key={i} style={{ color:'var(--text-primary)', fontWeight:600 }}>{tok.v}</strong>
        if (tok.t === 'italic')      return <em key={i} style={{ color:'var(--text-secondary)' }}>{tok.v}</em>
        if (tok.t === 'bold-italic') return <strong key={i}><em>{tok.v}</em></strong>
        if (tok.t === 'code')        return <code key={i} style={{ background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:4, padding:'1px 5px', fontSize:12, fontFamily:'monospace', color:'var(--accent)' }}>{tok.v}</code>
        if (tok.t === 'link')        return <LinkWithConfirm key={i} href={tok.href ?? '#'}>{tok.v}</LinkWithConfirm>
        // Plain text — detect bare URLs and make them clickable
        const urlRx = /(https?:\/\/[^\s<>"']+)/g
        const parts = tok.v.split(urlRx)
        if (parts.length === 1) return <span key={i}>{tok.v}</span>
        return <span key={i}>{parts.map((p, j) => urlRx.test(p) ? <LinkWithConfirm key={j} href={p}>{p}</LinkWithConfirm> : p)}</span>
      })}
    </span>
  )
}
