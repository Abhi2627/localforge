import { useState, useEffect, useRef, useCallback } from 'react'
import { GitBranch, Loader, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '../store/appStore'

// ── Syntax highlighting (same as FileEditorPanel) ─────────────────────────────
function escHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
}

function highlightLine(content: string, ext: string): string {
  if (!['ts','tsx','js','jsx','py','json','css','scss','html','sh','rs','go'].includes(ext)) return escHtml(content)
  let s = escHtml(content)
  const keywords: Record<string, string[]> = {
    ts:  ['import','export','from','const','let','var','function','class','interface','type','enum','extends','implements','return','if','else','for','while','do','switch','case','break','continue','new','this','super','async','await','try','catch','finally','throw','typeof','instanceof','void','null','undefined','true','false','in','of','default','static','readonly','abstract','public','private','protected','declare','namespace','module','as','is'],
    tsx: ['import','export','from','const','let','var','function','class','interface','type','enum','extends','implements','return','if','else','for','while','do','switch','case','break','continue','new','this','super','async','await','try','catch','finally','throw','typeof','instanceof','void','null','undefined','true','false','in','of','default','static'],
    js:  ['import','export','from','const','let','var','function','class','return','if','else','for','while','do','switch','case','break','continue','new','this','super','async','await','try','catch','finally','throw','typeof','instanceof','void','null','undefined','true','false','in','of','default','static'],
    jsx: ['import','export','from','const','let','var','function','class','return','if','else','for','while','do','switch','case','break','continue','new','this','super','async','await','try','catch','finally','throw','typeof','instanceof','void','null','undefined','true','false','in','of','default','static'],
    py:  ['import','from','def','class','return','if','elif','else','for','while','break','continue','try','except','finally','raise','with','as','in','is','not','and','or','None','True','False','pass','lambda','yield'],
    rs:  ['fn','let','mut','const','static','struct','enum','impl','trait','use','mod','pub','crate','super','self','match','if','else','for','while','loop','return','break','continue','true','false'],
    go:  ['func','var','const','type','struct','interface','import','package','return','if','else','for','range','switch','case','break','continue','defer','go','nil','true','false'],
  }
  const kws = keywords[ext] ?? keywords['js']
  if (ext === 'py') s = s.replace(/(#[^\n]*)/g, '<span style="color:#6a9955">$1</span>')
  else { s = s.replace(/(\/\/[^\n]*)/g, '<span style="color:#6a9955">$1</span>') }
  s = s.replace(/(&quot;(?:[^&]|&(?!quot;))*&quot;|&#x27;(?:[^&]|&(?!#x27;))*&#x27;|`[^`]*`)/g, '<span style="color:#ce9178">$1</span>')
  s = s.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#b5cea8">$1</span>')
  s = s.replace(new RegExp(`\\b(${kws.join('|')})\\b`, 'g'), '<span style="color:#569cd6">$1</span>')
  s = s.replace(/\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, '<span style="color:#dcdcaa">$1</span>')
  s = s.replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g, '<span style="color:#4ec9b0">$1</span>')
  return s
}

interface DiffLine  { type: 'context' | 'added' | 'removed'; content: string }
interface DiffHunk  { header: string; lines: DiffLine[] }
interface FileDiff  { file: string; status: string; hunks: DiffHunk[]; isBinary: boolean }

interface Props {
  sessionId:   string
  filePath:    string
  commitHash?: string   // if set, shows this commit's diff instead of working-tree diff
}

type LineDecor = 'added' | 'removed' | 'normal' | 'placeholder'

interface FullLine {
  lineNo:  number
  content: string
  decor:   LineDecor
  // character-level ranges that changed within this line (for inline highlighting)
  inlineRanges?: Array<{ start: number; end: number }>
}

interface AlignedPair { left: FullLine; right: FullLine }

const PLACEHOLDER_LINE: FullLine = { lineNo: 0, content: '', decor: 'placeholder' }

// ── Character-level diff (LCS-based) ─────────────────────────────────────────
function charDiff(oldStr: string, newStr: string): { oldRanges: Array<{start:number;end:number}>; newRanges: Array<{start:number;end:number}> } {
  // Simple token-level diff — find longest common subsequence of characters
  const a = oldStr.split(''), b = newStr.split('')
  const m = a.length, n = b.length
  // For very long lines skip (performance)
  if (m + n > 800) return { oldRanges: [], newRanges: [] }
  const dp = Array.from({ length: m+1 }, () => new Array(n+1).fill(0))
  for (let i=m-1; i>=0; i--) for (let j=n-1; j>=0; j--)
    dp[i][j] = a[i]===b[j] ? 1+dp[i+1][j+1] : Math.max(dp[i+1][j], dp[i][j+1])
  // Trace back
  const oldChanged: boolean[] = new Array(m).fill(true)
  const newChanged: boolean[] = new Array(n).fill(true)
  let i=0, j=0
  while (i<m && j<n) {
    if (a[i]===b[j]) { oldChanged[i]=false; newChanged[j]=false; i++; j++ }
    else if (dp[i+1]?.[j] >= dp[i]?.[j+1]) i++
    else j++
  }
  function toRanges(changed: boolean[]): Array<{start:number;end:number}> {
    const ranges: Array<{start:number;end:number}> = []
    let start = -1
    for (let k=0; k<=changed.length; k++) {
      if (changed[k] && start===-1) start=k
      else if (!changed[k] && start!==-1) { ranges.push({start,end:k}); start=-1 }
    }
    return ranges
  }
  return { oldRanges: toRanges(oldChanged), newRanges: toRanges(newChanged) }
}

// ── Changeset builder ─────────────────────────────────────────────────────────
function buildChangesets(hunks: DiffHunk[]) {
  const removedLines = new Map<number, string>()  // lineNo → content
  const addedLines   = new Map<number, string>()
  for (const hunk of hunks) {
    const m = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    let ol = m ? parseInt(m[1]) : 1, nl = m ? parseInt(m[2]) : 1
    for (const line of hunk.lines) {
      if      (line.type==='removed') removedLines.set(ol++, line.content)
      else if (line.type==='added')   addedLines.set(nl++, line.content)
      else                            { ol++; nl++ }
    }
  }
  return { removedLines, addedLines }
}

// ── Aligned pairs builder ─────────────────────────────────────────────────────
function buildAlignedPairs(leftLines: FullLine[], rightLines: FullLine[], hunks: DiffHunk[]): AlignedPair[] {
  const pairs: AlignedPair[] = []
  let li = 0, ri = 0

  for (const hunk of hunks) {
    const m = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    const hunkOldStart = m ? parseInt(m[1])-1 : 0
    const hunkNewStart = m ? parseInt(m[2])-1 : 0

    // Context lines before this hunk
    while (li < hunkOldStart && ri < hunkNewStart && li < leftLines.length && ri < rightLines.length) {
      pairs.push({ left: leftLines[li++], right: rightLines[ri++] })
    }

    const removedBuf: FullLine[] = [], addedBuf: FullLine[] = []
    for (const line of hunk.lines) {
      if      (line.type==='removed') { if (leftLines[li])  removedBuf.push(leftLines[li]);  li++ }
      else if (line.type==='added')   { if (rightLines[ri]) addedBuf.push(rightLines[ri]);   ri++ }
      else {
        flushBuffers(pairs, removedBuf, addedBuf)
        pairs.push({ left: leftLines[li] ?? PLACEHOLDER_LINE, right: rightLines[ri] ?? PLACEHOLDER_LINE })
        li++; ri++
      }
    }
    flushBuffers(pairs, removedBuf, addedBuf)
  }

  // Remaining unchanged lines
  while (li < leftLines.length && ri < rightLines.length) pairs.push({ left: leftLines[li++], right: rightLines[ri++] })
  while (li < leftLines.length)  pairs.push({ left: leftLines[li++],  right: { ...PLACEHOLDER_LINE } })
  while (ri < rightLines.length) pairs.push({ left: { ...PLACEHOLDER_LINE }, right: rightLines[ri++] })
  return pairs
}

function flushBuffers(pairs: AlignedPair[], removed: FullLine[], added: FullLine[]) {
  const maxLen = Math.max(removed.length, added.length)

  // Compute inline diffs for paired remove/add lines
  const inlineDiffs: Array<ReturnType<typeof charDiff>> = []
  for (let k=0; k<Math.min(removed.length, added.length); k++) {
    inlineDiffs.push(charDiff(removed[k].content, added[k].content))
  }

  for (let k=0; k<maxLen; k++) {
    const l = removed[k]
    const r = added[k]
    const id = inlineDiffs[k]
    pairs.push({
      left:  l ? { ...l, inlineRanges: id?.oldRanges } : { ...PLACEHOLDER_LINE },
      right: r ? { ...r, inlineRanges: id?.newRanges } : { ...PLACEHOLDER_LINE },
    })
  }
  removed.length = 0; added.length = 0
}

// ── Styled line content with inline highlights ────────────────────────────────

// ── Combined minimap ──────────────────────────────────────────────────────────
const MM_W = 100, MM_LH = 2, MM_FONT = '1.7px monospace'

function mmLineColor(content: string): string {
  const t = content.trim()
  if (!t) return ''
  if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*'))  return '#6a9955'
  if (/^(import|export|from|const|let|var|function|class|interface|type|enum|return|if|else|for|while|async|await|def|fn)\b/.test(t)) return '#569cd6'
  if (/^[A-Z][a-zA-Z]/.test(t))                                       return '#4ec9b0'
  if (t.startsWith("'") || t.startsWith('"') || t.startsWith('`'))   return '#ce9178'
  if (t.startsWith('<') || t.startsWith('}') || t.startsWith('{'))   return '#ffd700'
  return '#9cdcfe'
}

function CombinedMinimap({ leftLines, rightLines, visibleStart, visibleCount, onClickLine }: {
  leftLines: FullLine[]; rightLines: FullLine[]
  visibleStart: number; visibleCount: number
  onClickLine: (i: number) => void
}) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const scrollRef    = useRef<HTMLDivElement>(null)
  const totalRows = Math.max(leftLines.length, rightLines.length)
  const FULL_H    = totalRows * MM_LH

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.width = MM_W; canvas.height = Math.max(FULL_H, 1)
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, MM_W, Math.max(FULL_H, 1))
    ctx.font = MM_FONT
    ctx.textBaseline = 'top'
    const half = MM_W / 2
    // Left column (before) — draws in left half
    leftLines.forEach(({ content, decor }, i) => {
      const y = i * MM_LH
      if (decor === 'removed') { ctx.fillStyle='rgba(220,50,47,0.3)'; ctx.fillRect(0, y, half, MM_LH) }
      if (!content.trim() || decor === 'placeholder') return
      const color = decor === 'removed' ? '#f99' : mmLineColor(content)
      if (!color) return
      ctx.fillStyle = color
      const indent = (content.length - content.trimStart().length) * 0.25
      ctx.fillText(content.trimStart(), Math.min(indent, half * 0.2), y + 0.1, half - Math.min(indent, half * 0.2))
    })
    // Right column (after) — draws in right half
    rightLines.forEach(({ content, decor }, i) => {
      const y = i * MM_LH
      if (decor === 'added') { ctx.fillStyle='rgba(42,180,102,0.25)'; ctx.fillRect(half, y, half, MM_LH) }
      if (!content.trim() || decor === 'placeholder') return
      const color = decor === 'added' ? '#7ec' : mmLineColor(content)
      if (!color) return
      ctx.fillStyle = color
      const indent = (content.length - content.trimStart().length) * 0.25
      ctx.fillText(content.trimStart(), half + Math.min(indent, half * 0.2), y + 0.1, half - Math.min(indent, half * 0.2))
    })
    // Centre divider
    ctx.fillStyle = '#444'; ctx.fillRect(half - 0.5, 0, 1, Math.max(FULL_H, 1))
  }, [leftLines, rightLines]) // eslint-disable-line

  // Auto-scroll minimap when viewport indicator goes out of view
  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    const viewportTop = visibleStart * MM_LH
    const viewportH   = visibleCount * MM_LH
    const elH = el.clientHeight
    // Keep viewport indicator centred in the minimap scroll area
    const targetScroll = viewportTop + viewportH / 2 - elH / 2
    el.scrollTop = Math.max(0, targetScroll)
  }, [visibleStart, visibleCount])

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const el   = scrollRef.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const y    = e.clientY - rect.top + el.scrollTop
    onClickLine(Math.floor(y / MM_LH))
  }

  const viewportTop = visibleStart * MM_LH
  const viewportH   = Math.max(visibleCount * MM_LH, 20)

  return (
    <div style={{ width:MM_W, flexShrink:0, background:'#1e1e1e', borderLeft:'1px solid #2a2a2a', display:'flex', flexDirection:'column' }}>
      {/* Fixed label */}
      <div style={{ fontSize:8, color:'#444', padding:'2px 4px 1px', display:'flex', justifyContent:'space-between', flexShrink:0, background:'#1e1e1e', zIndex:1, borderBottom:'1px solid #2a2a2a' }}>
        <span>before</span><span>after</span>
      </div>
      {/* Scrollable canvas area */}
      <div ref={scrollRef} onClick={handleClick}
        style={{ flex:1, overflow:'hidden', cursor:'pointer', position:'relative' }}>
        <div style={{ width:MM_W, height:FULL_H, position:'relative' }}>
          <canvas ref={canvasRef} width={MM_W} height={Math.max(FULL_H,1)}
            style={{ display:'block', imageRendering:'pixelated' }}/>
          <div style={{
            position:'absolute', left:0, top: viewportTop,
            width:MM_W, height: viewportH,
            background:'rgba(255,255,255,0.13)',
            border:'1px solid rgba(255,255,255,0.35)',
            pointerEvents:'none', boxSizing:'border-box', borderRadius:2,
          }}/>
        </div>
      </div>
    </div>
  )
}

// ── Column ────────────────────────────────────────────────────────────────────
const MONO: React.CSSProperties = {
  fontFamily: "'SF Mono','Fira Code','Cascadia Code',Menlo,monospace",
  fontSize: 12, lineHeight: '20px', whiteSpace: 'pre', overflowWrap: 'normal',
}

function DiffColumn({ lines, label, isRight, onScroll, ext }: {
  lines: FullLine[]; label: string; isRight: boolean; ext: string
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void
}) {
  return (
    <div data-scroll-col={isRight?'right':'left'} onScroll={onScroll}
      style={{ flex:1, display:'flex', flexDirection:'column', overflow:'auto', minWidth:0, borderRight: isRight?'none':'2px solid #333' }}>
      <div style={{ padding:'3px 12px 3px 62px', background:'#2d2d2d', borderBottom:'1px solid #3a3a3a', fontSize:10, color:'#6a6a6a', flexShrink:0, fontFamily:'monospace', position:'sticky', top:0, zIndex:2 }}>{label}</div>
      {lines.map((line, i) => {
        const isPlaceholder = line.decor === 'placeholder'
        const bg =
          line.decor==='removed'     ? 'rgba(220,50,47,0.14)'  :
          line.decor==='added'       ? 'rgba(42,180,102,0.12)' :
          isPlaceholder              ? '#252526'               :
          'transparent'
        const lineNumColor = line.decor==='removed' ? '#c55' : line.decor==='added' ? '#3a9' : '#858585'
        const prefix = line.decor==='removed' ? '-' : line.decor==='added' ? '+' : isPlaceholder ? '' : ' '
        // Syntax-highlight the content — apply coloured spans over the highlighted HTML
        // For changed lines, we additionally wrap inline-diff ranges with darker bg spans
        const getHtml = () => {
          if (isPlaceholder || !line.content) return ''
          const baseHtml = highlightLine(line.content, ext)
          if (!line.inlineRanges || line.inlineRanges.length === 0) return baseHtml
          // We can't easily apply inline ranges on top of HTML — show plain coloured text for changed chars
          // Simple approach: bold the changed chars in the raw content before highlighting
          const isAdded = line.decor === 'added'
          const hlBg    = isAdded ? 'rgba(42,180,102,0.5)' : 'rgba(220,50,47,0.5)'
          // Build plain text with marker chars, highlight, then replace markers with spans
          // Use non-printable sentinels that won't appear in code
          const OPEN = '\x02', CLOSE = '\x03'
          const chars = line.content.split('')
          let marked = ''
          let inRange = false
          for (let ci = 0; ci <= chars.length; ci++) {
            const inNext = line.inlineRanges.some(r => ci >= r.start && ci < r.end)
            if (inNext && !inRange) { marked += OPEN; inRange = true }
            if (!inNext && inRange) { marked += CLOSE; inRange = false }
            if (ci < chars.length) marked += chars[ci]
          }
          const markedHtml = highlightLine(marked, ext)
          return markedHtml
            .replace(/\x02/g, `<span style="background:${hlBg};border-radius:2px">`)
            .replace(/\x03/g, '</span>')
        }
        return (
          <div key={i} style={{ display:'flex', background:bg, minHeight:20 }}>
            <div style={{ width:44, flexShrink:0, textAlign:'right', paddingRight:8, color:lineNumColor, userSelect:'none', ...MONO, borderRight:'1px solid #2e2e2e' }}>
              {isPlaceholder ? '' : line.lineNo}
            </div>
            <div style={{ width:16, flexShrink:0, textAlign:'center', color: line.decor==='removed'?'#f97575': line.decor==='added'?'#3dd68c':'#858585', userSelect:'none', ...MONO, opacity:0.85 }}>{prefix}</div>
            <div style={{ flex:1, ...MONO, paddingLeft:4, paddingRight:16 }}
              dangerouslySetInnerHTML={{ __html: getHtml() }}/>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DiffEditorPanel({ sessionId, filePath, commitHash }: Props) {
  const [diffs,      setDiffs]      = useState<FileDiff[]>([])
  const [oldContent, setOldContent] = useState('')
  const [newContent, setNewContent] = useState('')
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [fileIdx,    setFileIdx]    = useState(0)
  const [visible,    setVisible]    = useState({ start:0, count:40 })
  const containerRef = useRef<HTMLDivElement>(null)

  const sessions = useAppStore(s => s.sessions)
  const activeId = useAppStore(s => s.activeSessionId)
  const session  = sessions.find(s => s.id === (sessionId || activeId))
  const rootPath = session?.rootPath
  const resolvedFilePath = (() => {
    if (!filePath) return ''
    const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)
    if (isAbsolute) return filePath
    return rootPath ? `${rootPath.replace(/\/+$/, '')}/${filePath.replace(/^\//, '')}` : filePath
  })()
  const filename = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  const loadDiff = useCallback(async (showLoading = false) => {
    if (!rootPath) return
    if (showLoading) { setLoading(true); setError(''); setFileIdx(0) }
    const enc = encodeURIComponent

    if (commitHash) {
      // Commit diff mode — show what changed in this specific commit
      const diffUrl = rootPath
        ? `http://localhost:3001/git/direct/commit/${commitHash}?rootPath=${enc(rootPath)}`
        : `http://localhost:3001/project/${sessionId}/git/commit/${commitHash}`
      const oldUrl  = `http://localhost:3001/git/direct/file-at-commit?rootPath=${enc(rootPath)}&file=${enc(filePath)}&hash=${enc(commitHash)}&parent=true`
      const newUrl  = `http://localhost:3001/git/direct/file-at-commit?rootPath=${enc(rootPath)}&file=${enc(filePath)}&hash=${enc(commitHash)}&parent=false`
      Promise.all([
        fetch(diffUrl).then(r => r.json()),
        fetch(oldUrl).then(r => r.json()).catch(() => ({ content: '' })),
        fetch(newUrl).then(r => r.json()).catch(() => ({ content: '' })),
      ]).then(([diffData, oldData, newData]) => {
        // Filter diffs to just this file
        const all = diffData.diffs ?? []
        const filtered = all.filter((d: FileDiff) => d.file === filePath || d.file.endsWith(`/${filePath}`) || filePath.endsWith(d.file))
        setDiffs(filtered.length > 0 ? filtered : all.length > 0 ? [all[0]] : [])
        setOldContent(oldData.content ?? '')
        setNewContent(newData.content ?? '')
        setLoading(false)
      }).catch(e => { setError(e.message); setLoading(false) })
    } else {
      // Working tree diff mode — one VS Code-style view against HEAD (combined staged + unstaged changes)
      const diffUrl = `http://localhost:3001/git/direct/diff?rootPath=${enc(rootPath)}&file=${enc(filePath)}&staged=all`
      const oldUrl  = `http://localhost:3001/git/direct/file-at-head?rootPath=${enc(rootPath)}&file=${enc(filePath)}&staged=false`
      const newUrl  = `http://localhost:3001/project/file?path=${enc(resolvedFilePath)}`

      Promise.all([
        fetch(diffUrl).then(r => r.json()).catch(() => ({ diffs: [] })),
        fetch(oldUrl).then(r => r.json()).catch(() => ({ content: '' })),
        fetch(newUrl).then(r => r.json()).catch(() => ({ content: '' })),
      ]).then(([diffData, oldData, newData]) => {
        setDiffs(diffData.diffs ?? [])
        setOldContent(oldData.content ?? '')
        setNewContent(newData.content ?? '')
        setLoading(false)
      }).catch(e => { setError(e.message); setLoading(false) })
    }
  }, [sessionId, filePath, rootPath, commitHash, resolvedFilePath]) // eslint-disable-line

  // Initial load
  useEffect(() => {
    loadDiff(true)
  }, [loadDiff])

  // Poll every 3s — auto-reload when diff changes (e.g. after git push, the diff should clear)
  useEffect(() => {
    if (commitHash) return  // commit diffs are immutable, no need to poll
    const interval = setInterval(() => {
      loadDiff()
    }, 3000)
    return () => clearInterval(interval)
  }, [loadDiff, commitHash])

  const DIFF_LINE_H = 20

  function syncScroll(e: React.UIEvent<HTMLDivElement>) {
    const src = e.currentTarget
    const container = containerRef.current; if (!container) return
    container.querySelectorAll<HTMLElement>('[data-scroll-col]').forEach(el => {
      if (el !== src) el.scrollTop = src.scrollTop
    })
    setVisible({ start: Math.floor(src.scrollTop/DIFF_LINE_H), count: Math.ceil(src.clientHeight/DIFF_LINE_H) })
  }

  const scrollToLine = useCallback((lineIdx: number) => {
    const container = containerRef.current; if (!container) return
    container.querySelectorAll<HTMLElement>('[data-scroll-col]').forEach(col => {
      col.scrollTop = Math.max(0, lineIdx * DIFF_LINE_H - col.clientHeight / 2)
    })
  }, [])

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#1e1e1e', gap:10 }}>
      <Loader size={16} style={{ animation:'spin 1s linear infinite', color:'var(--accent)' }}/>
      <span style={{ fontSize:12, color:'#858585' }}>Loading diff…</span>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
  if (error) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#1e1e1e', color:'var(--red)', fontSize:12, padding:20, textAlign:'center' }}>
      Failed to load diff: {error}
    </div>
  )
  if (diffs.length === 0) return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#1e1e1e', gap:8 }}>
      <GitBranch size={28} style={{ opacity:0.3, color:'#858585' }}/>
      <div style={{ fontSize:13, color:'#858585' }}>No changes in {filename}</div>
    </div>
  )

  const currentDiff = diffs[Math.min(fileIdx, diffs.length-1)]
  if (currentDiff.isBinary) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#858585', fontSize:13, background:'#1e1e1e' }}>
      Binary file — no diff available
    </div>
  )

  const { removedLines, addedLines } = buildChangesets(currentDiff.hunks)
  const addedCount   = addedLines.size
  const removedCount = removedLines.size

  const rawLeft: FullLine[] = oldContent.split('\n').map((content, i) => ({
    lineNo: i+1, content, decor: removedLines.has(i+1) ? 'removed' : 'normal',
  }))
  const rawRight: FullLine[] = newContent.split('\n').map((content, i) => ({
    lineNo: i+1, content, decor: addedLines.has(i+1) ? 'added' : 'normal',
  }))
  if (rawLeft.length  > 0 && rawLeft[rawLeft.length-1].content   === '') rawLeft.pop()
  if (rawRight.length > 0 && rawRight[rawRight.length-1].content === '') rawRight.pop()

  const pairs      = buildAlignedPairs(rawLeft, rawRight, currentDiff.hunks)
  const leftLines  = pairs.map(p => p.left)
  const rightLines = pairs.map(p => p.right)
  const fallbackLines = currentDiff.hunks.flatMap((hunk, hIdx) =>
    hunk.lines.map((line, lineIdx) => ({
      key: `${hIdx}-${lineIdx}`,
      kind: line.type,
      content: line.content,
    }))
  )
  const hasVisibleRows = leftLines.some(l => l.decor !== 'placeholder') || rightLines.some(l => l.decor !== 'placeholder')

  const modeLabel = commitHash ? `commit ${commitHash.slice(0,7)}` : 'working tree'
  const modeBg    = commitHash ? 'rgba(124,106,247,0.15)' : 'rgba(61,214,140,0.15)'
  const modeColor = commitHash ? '#8b7cf8' : '#3dd68c'

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#1e1e1e', overflow:'hidden', minHeight:0 }}>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px', borderBottom:'1px solid #333', background:'#252526', flexShrink:0, flexWrap:'wrap' }}>
        <GitBranch size={13} style={{ color:'var(--accent)', flexShrink:0 }}/>
        <span style={{ fontSize:12, fontWeight:600, color:'#d4d4d4', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{currentDiff.file}</span>
        <span style={{ fontSize:10, padding:'1px 7px', borderRadius:4, fontWeight:600, flexShrink:0, background:modeBg, color:modeColor }}>{modeLabel}</span>
        {addedCount   > 0 && <span style={{ fontSize:11, color:'#3dd68c', fontWeight:700, flexShrink:0 }}>+{addedCount}</span>}
        {removedCount > 0 && <span style={{ fontSize:11, color:'#f97575', fontWeight:700, flexShrink:0 }}>-{removedCount}</span>}
        <span style={{ fontSize:10, color:'#4a4a4a', flexShrink:0 }}>{leftLines.filter(l=>l.decor!=='placeholder').length}L · {rightLines.filter(l=>l.decor!=='placeholder').length}R</span>
        {diffs.length > 1 && (
          <div style={{ display:'flex', alignItems:'center', gap:4, marginLeft:'auto' }}>
            <span style={{ fontSize:11, color:'#858585' }}>{fileIdx+1}/{diffs.length}</span>
            <button onClick={() => setFileIdx(i=>Math.max(0,i-1))} disabled={fileIdx===0}
              style={{ background:'none', border:'none', cursor:fileIdx===0?'default':'pointer', color:fileIdx===0?'#333':'#858585', display:'flex', padding:2 }}><ChevronLeft size={13}/></button>
            <button onClick={() => setFileIdx(i=>Math.min(diffs.length-1,i+1))} disabled={fileIdx===diffs.length-1}
              style={{ background:'none', border:'none', cursor:fileIdx===diffs.length-1?'default':'pointer', color:fileIdx===diffs.length-1?'#333':'#858585', display:'flex', padding:2 }}><ChevronRight size={13}/></button>
          </div>
        )}
      </div>

      {/* Body: two columns + ONE combined minimap on right */}
      {hasVisibleRows ? (
        <div ref={containerRef} style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
          <DiffColumn lines={leftLines}  label={`${currentDiff.file}  (before)`} isRight={false} onScroll={syncScroll} ext={ext}/>
          <DiffColumn lines={rightLines} label={`${currentDiff.file}  (after)`}  isRight={true}  onScroll={syncScroll} ext={ext}/>
          {/* Single combined minimap on far right */}
          <CombinedMinimap
            leftLines={leftLines}
            rightLines={rightLines}
            visibleStart={visible.start}
            visibleCount={visible.count}
            onClickLine={scrollToLine}
          />
        </div>
      ) : (
        <div style={{ flex:1, overflow:'auto', minHeight:0, background:'#1e1e1e' }}>
          {fallbackLines.map(line => (
            <div key={line.key} style={{
              display:'flex', gap:8, padding:'2px 10px', fontFamily:'monospace', fontSize:12,
              color: line.kind === 'added' ? '#99e8b4' : line.kind === 'removed' ? '#ff9999' : '#d4d4d4',
              background: line.kind === 'added' ? 'rgba(42,180,102,0.08)' : line.kind === 'removed' ? 'rgba(220,50,47,0.10)' : 'transparent',
            }}>
              <span style={{ width:18, color: line.kind === 'added' ? '#3dd68c' : line.kind === 'removed' ? '#f97575' : '#858585', userSelect:'none' }}>
                {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
              </span>
              <span style={{ whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{line.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
