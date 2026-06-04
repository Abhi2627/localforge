import { useState, useEffect, useRef, useCallback } from 'react'
import { GitBranch, Loader, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '../store/appStore'

interface DiffLine  { type: 'context' | 'added' | 'removed'; content: string }
interface DiffHunk  { header: string; lines: DiffLine[] }
interface FileDiff  { file: string; status: string; hunks: DiffHunk[]; isBinary: boolean }

interface Props {
  sessionId: string
  filePath:  string
  staged:    boolean
}

// Per-line decoration derived from diff hunks
type LineDecor = 'added' | 'removed' | 'normal'

interface FullLine {
  lineNo:  number
  content: string
  decor:   LineDecor
}

// Build a Set of changed line numbers from diff hunks.
// Returns { removedLines: Set<number>, addedLines: Set<number> } for each side.
function buildChangesets(hunks: DiffHunk[]): {
  removedLines: Set<number>  // old-file line numbers that were removed
  addedLines:   Set<number>  // new-file line numbers that were added
} {
  const removedLines = new Set<number>()
  const addedLines   = new Set<number>()

  for (const hunk of hunks) {
    const m = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    let ol = m ? parseInt(m[1]) : 1
    let nl = m ? parseInt(m[2]) : 1

    for (const line of hunk.lines) {
      if      (line.type === 'removed') { removedLines.add(ol++); }
      else if (line.type === 'added')   { addedLines.add(nl++);   }
      else                              { ol++; nl++ }
    }
  }
  return { removedLines, addedLines }
}

const MONO: React.CSSProperties = {
  fontFamily: "'SF Mono','Fira Code','Cascadia Code',Menlo,monospace",
  fontSize: 12,
  lineHeight: '20px',
  whiteSpace: 'pre',
  overflowWrap: 'normal',
}

const MINIMAP_W      = 60
const MINIMAP_LINE_H = 2
const MINIMAP_CHAR_W = 0.5

function DiffMinimap({ lines, visibleStart, visibleCount, onClickLine, label }: {
  lines: FullLine[]; visibleStart: number; visibleCount: number
  onClickLine: (i: number) => void; label: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const FULL_H = lines.length * MINIMAP_LINE_H

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.width = MINIMAP_W; canvas.height = Math.max(FULL_H, 1)
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, MINIMAP_W, Math.max(FULL_H, 1))
    lines.forEach(({ content, decor }, i) => {
      const y = i * MINIMAP_LINE_H
      if      (decor === 'removed') { ctx.fillStyle = 'rgba(220,50,47,0.35)';    ctx.fillRect(0, y, MINIMAP_W, MINIMAP_LINE_H) }
      else if (decor === 'added')   { ctx.fillStyle = 'rgba(42,180,102,0.35)';   ctx.fillRect(0, y, MINIMAP_W, MINIMAP_LINE_H) }
      const trimmed = content.trimStart()
      const indent  = content.length - trimmed.length
      const x = indent * MINIMAP_CHAR_W
      const w = Math.min(trimmed.length * MINIMAP_CHAR_W, MINIMAP_W - x)
      if (w > 0) {
        ctx.fillStyle = decor === 'removed' ? '#f88' : decor === 'added' ? '#7ec' : '#555770'
        ctx.fillRect(x, y + 0.3, w, 1)
      }
    })
  }, [lines]) // eslint-disable-line

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    onClickLine(Math.floor((e.clientY - rect.top) / MINIMAP_LINE_H))
  }

  return (
    <div onClick={handleClick} style={{ width:MINIMAP_W, flexShrink:0, background:'#1e1e1e', borderLeft:'1px solid #2a2a2a', overflow:'hidden', position:'relative', cursor:'pointer' }}>
      <div style={{ fontSize:8, color:'#444', padding:'2px 4px', position:'sticky', top:0, background:'#1e1e1e', zIndex:1 }}>{label}</div>
      <div style={{ width:MINIMAP_W, height:FULL_H, position:'relative' }}>
        <canvas ref={canvasRef} width={MINIMAP_W} height={Math.max(FULL_H,1)} style={{ display:'block', imageRendering:'pixelated' }}/>
        <div style={{ position:'absolute', left:0, top: visibleStart * MINIMAP_LINE_H, width:MINIMAP_W, height: Math.max(visibleCount * MINIMAP_LINE_H, 20), background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.12)', pointerEvents:'none', boxSizing:'border-box' }}/>
      </div>
    </div>
  )
}

function FullFileColumn({
  lines, label, isRight, onScroll,
}: {
  lines: FullLine[]
  label: string
  isRight: boolean
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      data-scroll-col={isRight ? 'right' : 'left'}
      onScroll={onScroll}
      style={{ flex:1, display:'flex', flexDirection:'column', overflow:'auto', minWidth:0, borderRight: isRight ? 'none' : '2px solid #333' }}
    >
      {/* Sticky header */}
      <div style={{ padding:'3px 12px 3px 62px', background:'#2d2d2d', borderBottom:'1px solid #3a3a3a', fontSize:10, color:'#6a6a6a', flexShrink:0, fontFamily:'monospace', position:'sticky', top:0, zIndex:2 }}>
        {label}
      </div>

      {lines.map((line, i) => {
        const bg =
          line.decor === 'removed' ? 'rgba(220,50,47,0.18)'  :
          line.decor === 'added'   ? 'rgba(42,180,102,0.14)' :
          'transparent'

        const lineNumColor =
          line.decor === 'removed' ? '#c55' :
          line.decor === 'added'   ? '#3a9' :
          '#858585'   // brighter than before (#3d3d3d was too faint)

        const textColor =
          line.decor === 'removed' ? '#ff9999' :
          line.decor === 'added'   ? '#99e8b4' :
          '#d4d4d4'

        const prefix =
          line.decor === 'removed' ? '-' :
          line.decor === 'added'   ? '+' :
          ' '

        return (
          <div key={i} style={{ display:'flex', background:bg, minHeight:20 }}>
            {/* Line number */}
            <div style={{ width:44, flexShrink:0, textAlign:'right', paddingRight:8, color:lineNumColor, userSelect:'none', ...MONO, borderRight:'1px solid #2e2e2e' }}>
              {line.lineNo}
            </div>
            {/* +/- marker */}
            <div style={{ width:16, flexShrink:0, textAlign:'center', color:textColor, userSelect:'none', ...MONO, opacity:0.85 }}>
              {prefix}
            </div>
            {/* Content */}
            <div style={{ flex:1, color:textColor, ...MONO, paddingLeft:4, paddingRight:16 }}>
              {line.content}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function DiffEditorPanel({ sessionId, filePath, staged }: Props) {
  const [diffs,       setDiffs]      = useState<FileDiff[]>([])
  const [oldContent,  setOldContent] = useState<string>('')
  const [newContent,  setNewContent] = useState<string>('')
  const [loading,     setLoading]    = useState(true)
  const [error,       setError]      = useState('')
  const [fileIdx,     setFileIdx]    = useState(0)
  const [leftVisible,  setLeftVisible]  = useState({ start: 0, count: 40 })
  const [rightVisible, setRightVisible] = useState({ start: 0, count: 40 })
  const containerRef = useRef<HTMLDivElement>(null)

  const sessions  = useAppStore(s => s.sessions)
  const activeId  = useAppStore(s => s.activeSessionId)
  const session   = sessions.find(s => s.id === (sessionId || activeId))
  const rootPath  = session?.rootPath

  const filename = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath

  useEffect(() => {
    if (!rootPath) return
    setLoading(true); setError(''); setFileIdx(0)

    const enc = encodeURIComponent
    const diffUrl = `http://localhost:3001/git/direct/diff?rootPath=${enc(rootPath)}&file=${enc(filePath)}&staged=${staged}`
    // old = committed/staged version, new = working tree
    const oldUrl  = `http://localhost:3001/git/direct/file-at-head?rootPath=${enc(rootPath)}&file=${enc(filePath)}&staged=${staged}`
    const newUrl  = `http://localhost:3001/project/file?path=${enc(`${rootPath}/${filePath}`)}`

    Promise.all([
      fetch(diffUrl).then(r => r.json()),
      fetch(oldUrl).then(r => r.json()).catch(() => ({ content: '' })),
      fetch(newUrl).then(r => r.json()).catch(() => ({ content: '' })),
    ])
      .then(([diffData, oldData, newData]) => {
        setDiffs(diffData.diffs ?? [])
        setOldContent(oldData.content ?? '')
        setNewContent(newData.content ?? '')
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [sessionId, filePath, staged, rootPath])

  const DIFF_LINE_H = 20

  function syncScroll(e: React.UIEvent<HTMLDivElement>) {
    const src = e.currentTarget
    const container = containerRef.current
    if (!container) return
    container.querySelectorAll<HTMLElement>('[data-scroll-col]').forEach(el => {
      if (el !== src) el.scrollTop = src.scrollTop
    })
    const isLeft = src.dataset.scrollCol === 'left'
    const start  = Math.floor(src.scrollTop / DIFF_LINE_H)
    const count  = Math.ceil(src.clientHeight / DIFF_LINE_H)
    if (isLeft) setLeftVisible({ start, count })
    else        setRightVisible({ start, count })
  }

  const scrollToLine = useCallback((colSide: 'left'|'right', lineIdx: number) => {
    const container = containerRef.current; if (!container) return
    const col = container.querySelector<HTMLElement>(`[data-scroll-col="${colSide}"]`)
    if (!col) return
    const targetTop = lineIdx * DIFF_LINE_H - col.clientHeight / 2
    col.scrollTop = Math.max(0, targetTop)
    // sync other col
    const other = container.querySelector<HTMLElement>(`[data-scroll-col="${colSide === 'left' ? 'right' : 'left'}"]`)
    if (other) other.scrollTop = col.scrollTop
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

  const currentDiff = diffs[Math.min(fileIdx, diffs.length - 1)]

  if (currentDiff.isBinary) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#858585', fontSize:13, background:'#1e1e1e' }}>
      Binary file — no diff available
    </div>
  )

  // Build decoration maps from diff hunks
  const { removedLines, addedLines } = buildChangesets(currentDiff.hunks)

  const addedCount   = addedLines.size
  const removedCount = removedLines.size

  // Build full left (old) and right (new) line arrays
  const leftLines:  FullLine[] = oldContent.split('\n').map((content, i) => ({
    lineNo:  i + 1,
    content,
    decor:   removedLines.has(i + 1) ? 'removed' : 'normal',
  }))

  const rightLines: FullLine[] = newContent.split('\n').map((content, i) => ({
    lineNo:  i + 1,
    content,
    decor:   addedLines.has(i + 1) ? 'added' : 'normal',
  }))

  // Remove trailing empty line added by split('\n') on files ending with \n
  if (leftLines.length  > 0 && leftLines[leftLines.length - 1].content  === '') leftLines.pop()
  if (rightLines.length > 0 && rightLines[rightLines.length - 1].content === '') rightLines.pop()

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#1e1e1e', overflow:'hidden', minHeight:0 }}>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px', borderBottom:'1px solid #333', background:'#252526', flexShrink:0, flexWrap:'wrap' }}>
        <GitBranch size={13} style={{ color:'var(--accent)', flexShrink:0 }}/>
        <span style={{ fontSize:12, fontWeight:600, color:'#d4d4d4', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
          {currentDiff.file}
        </span>
        <span style={{ fontSize:10, padding:'1px 7px', borderRadius:4, fontWeight:600, flexShrink:0,
          background: staged ? 'rgba(61,214,140,0.15)' : 'rgba(245,158,11,0.15)',
          color:      staged ? '#3dd68c' : '#f59e0b',
        }}>
          {staged ? 'staged' : 'unstaged'}
        </span>
        {addedCount   > 0 && <span style={{ fontSize:11, color:'#3dd68c', fontWeight:700, flexShrink:0 }}>+{addedCount}</span>}
        {removedCount > 0 && <span style={{ fontSize:11, color:'#f97575', fontWeight:700, flexShrink:0 }}>-{removedCount}</span>}
        <span style={{ fontSize:10, color:'#4a4a4a', flexShrink:0 }}>
          {leftLines.length} lines (before) · {rightLines.length} lines (after)
        </span>

        {diffs.length > 1 && (
          <div style={{ display:'flex', alignItems:'center', gap:4, marginLeft:'auto' }}>
            <span style={{ fontSize:11, color:'#858585' }}>{fileIdx + 1} / {diffs.length}</span>
            <button onClick={() => setFileIdx(i => Math.max(0, i - 1))} disabled={fileIdx === 0}
              style={{ background:'none', border:'none', cursor: fileIdx===0?'default':'pointer', color: fileIdx===0?'#333':'#858585', display:'flex', padding:2 }}>
              <ChevronLeft size={13}/>
            </button>
            <button onClick={() => setFileIdx(i => Math.min(diffs.length-1, i+1))} disabled={fileIdx===diffs.length-1}
              style={{ background:'none', border:'none', cursor: fileIdx===diffs.length-1?'default':'pointer', color: fileIdx===diffs.length-1?'#333':'#858585', display:'flex', padding:2 }}>
              <ChevronRight size={13}/>
            </button>
          </div>
        )}
      </div>

      {/* Side-by-side full file diff — each column has its own minimap */}
      <div ref={containerRef} style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
        {/* Left: old file + minimap */}
        <div style={{ flex:1, display:'flex', overflow:'hidden', minWidth:0, borderRight:'2px solid #333' }}>
          <FullFileColumn
            lines={leftLines}
            label={`${currentDiff.file}  (before — ${leftLines.length} lines)`}
            isRight={false}
            onScroll={syncScroll}
          />
          <DiffMinimap
            lines={leftLines}
            visibleStart={leftVisible.start}
            visibleCount={leftVisible.count}
            onClickLine={i => scrollToLine('left', i)}
            label="before"
          />
        </div>
        {/* Right: new file + minimap */}
        <div style={{ flex:1, display:'flex', overflow:'hidden', minWidth:0 }}>
          <FullFileColumn
            lines={rightLines}
            label={`${currentDiff.file}  (after — ${rightLines.length} lines)`}
            isRight={true}
            onScroll={syncScroll}
          />
          <DiffMinimap
            lines={rightLines}
            visibleStart={rightVisible.start}
            visibleCount={rightVisible.count}
            onClickLine={i => scrollToLine('right', i)}
            label="after"
          />
        </div>
      </div>
    </div>
  )
}
