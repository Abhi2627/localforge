import { useState, useEffect, useRef } from 'react'
import { GitBranch, Loader, ChevronLeft, ChevronRight } from 'lucide-react'

interface DiffLine  { type: 'context' | 'added' | 'removed'; content: string }
interface DiffHunk  { header: string; lines: DiffLine[] }
interface FileDiff  { file: string; status: string; hunks: DiffHunk[]; isBinary: boolean }

interface Props {
  sessionId: string
  filePath:  string
  staged:    boolean
}

interface RenderLine {
  lineNo?: number
  content: string
  type: 'added' | 'removed' | 'context' | 'empty' | 'hunk-header'
}

interface SidePair { left: RenderLine; right: RenderLine }

// Build full side-by-side line pairs from hunks.
// Each hunk only covers changed regions — we fill gaps with "no-content" empty lines
// so both columns always have the same number of rows and stay aligned.
function buildSideBySide(hunks: DiffHunk[]): SidePair[] {
  if (hunks.length === 0) return []

  const pairs: SidePair[] = []

  for (const hunk of hunks) {
    // Parse starting line numbers from hunk header: @@ -L,N +L,N @@
    const m = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    let leftNum  = m ? parseInt(m[1]) : 1
    let rightNum = m ? parseInt(m[2]) : 1

    // Hunk separator row
    pairs.push({
      left:  { content: hunk.header, type: 'hunk-header' },
      right: { content: hunk.header, type: 'hunk-header' },
    })

    // Collect removed/added lines within a change block and align them side by side
    const removedBuf: DiffLine[] = []
    const addedBuf:   DiffLine[] = []

    const flush = () => {
      const maxLen = Math.max(removedBuf.length, addedBuf.length)
      for (let i = 0; i < maxLen; i++) {
        const l = removedBuf[i]
        const r = addedBuf[i]
        pairs.push({
          left:  l
            ? { lineNo: leftNum++,  content: l.content, type: 'removed' }
            : { content: '',        type: 'empty' },
          right: r
            ? { lineNo: rightNum++, content: r.content, type: 'added'   }
            : { content: '',        type: 'empty' },
        })
      }
      removedBuf.length = 0
      addedBuf.length   = 0
    }

    for (const line of hunk.lines) {
      if (line.type === 'context') {
        flush()
        pairs.push({
          left:  { lineNo: leftNum++,  content: line.content, type: 'context' },
          right: { lineNo: rightNum++, content: line.content, type: 'context' },
        })
      } else if (line.type === 'removed') {
        removedBuf.push(line)
      } else {
        addedBuf.push(line)
      }
    }
    flush()
  }

  return pairs
}

const MONO: React.CSSProperties = {
  fontFamily: "'SF Mono','Fira Code','Cascadia Code',Menlo,monospace",
  fontSize: 12,
  lineHeight: '20px',
  whiteSpace: 'pre',
  overflowWrap: 'normal',
}

function DiffColumn({
  lines, label, isRight,
}: { lines: RenderLine[]; label: string; isRight: boolean }) {
  return (
    <div
      data-scroll-col={isRight ? 'right' : 'left'}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minWidth: 0, borderRight: isRight ? 'none' : '2px solid #333' }}
    >
      {/* Sticky column header */}
      <div style={{
        padding: '3px 12px 3px 62px', background: '#2d2d2d',
        borderBottom: '1px solid #3a3a3a', fontSize: 10, color: '#6a6a6a',
        flexShrink: 0, fontFamily: 'monospace',
        position: 'sticky', top: 0, zIndex: 2,
      }}>
        {label}
      </div>

      {lines.map((line, i) => {
        const isHdr = line.type === 'hunk-header'
        const bg =
          isHdr                   ? 'rgba(124,106,247,0.12)' :
          line.type === 'removed' ? 'rgba(220,50,47,0.15)'   :
          line.type === 'added'   ? 'rgba(42,180,102,0.12)'  :
          line.type === 'empty'   ? '#191919'                 :
          'transparent'

        const lineNumColor =
          line.type === 'removed' ? '#c44'  :
          line.type === 'added'   ? '#3a9'  :
          '#3d3d3d'

        const textColor =
          isHdr                   ? '#8b7cf8' :
          line.type === 'removed' ? '#ff9999' :
          line.type === 'added'   ? '#99e8b4' :
          line.type === 'empty'   ? '#191919' :
          '#d4d4d4'

        const prefix =
          isHdr                   ? ''  :
          line.type === 'removed' ? '-' :
          line.type === 'added'   ? '+' :
          line.type === 'empty'   ? ''  :
          ' '

        return (
          <div key={i} style={{ display: 'flex', background: bg, minHeight: 20 }}>
            {/* Line number gutter */}
            <div style={{
              width: 44, flexShrink: 0, textAlign: 'right', paddingRight: 8,
              color: lineNumColor, userSelect: 'none',
              ...MONO, borderRight: '1px solid #2e2e2e',
            }}>
              {isHdr ? '…' : (line.lineNo ?? '')}
            </div>
            {/* +/- gutter */}
            <div style={{
              width: 16, flexShrink: 0, textAlign: 'center',
              color: textColor, userSelect: 'none',
              ...MONO, opacity: 0.85,
            }}>
              {prefix}
            </div>
            {/* Content */}
            <div style={{
              flex: 1, color: textColor, ...MONO,
              paddingLeft: 4, paddingRight: 16,
              overflow: 'hidden',
              fontStyle: isHdr ? 'italic' : 'normal',
            }}>
              {line.content}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function DiffEditorPanel({ sessionId, filePath, staged }: Props) {
  const [diffs,   setDiffs]   = useState<FileDiff[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [fileIdx, setFileIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const filename = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath

  useEffect(() => {
    setLoading(true); setError(''); setFileIdx(0)
    const url = `http://localhost:3001/project/${sessionId}/git/diff?file=${encodeURIComponent(filePath)}&staged=${staged}`
    fetch(url)
      .then(r => r.json())
      .then(d => { setDiffs(d.diffs ?? []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [sessionId, filePath, staged])

  // Sync vertical scroll between left and right columns
  function syncScroll(e: React.UIEvent<HTMLDivElement>) {
    const src = e.currentTarget
    const container = containerRef.current
    if (!container) return
    container.querySelectorAll<HTMLElement>('[data-scroll-col]').forEach(el => {
      if (el !== src) el.scrollTop = src.scrollTop
    })
  }

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
  const pairs = currentDiff && !currentDiff.isBinary ? buildSideBySide(currentDiff.hunks) : []

  const addedCount   = currentDiff.hunks.flatMap(h => h.lines).filter(l => l.type === 'added').length
  const removedCount = currentDiff.hunks.flatMap(h => h.lines).filter(l => l.type === 'removed').length

  const leftLines  = pairs.map(p => p.left)
  const rightLines = pairs.map(p => p.right)

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#1e1e1e', overflow:'hidden', minHeight:0 }}>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {/* Header bar */}
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
        <span style={{ fontSize:10, color:'#555', flexShrink:0 }}>
          Note: only changed regions are shown (git unified diff)
        </span>

        {/* File navigator when diff spans multiple files */}
        {diffs.length > 1 && (
          <div style={{ display:'flex', alignItems:'center', gap:4, marginLeft:'auto' }}>
            <span style={{ fontSize:11, color:'#858585' }}>{fileIdx + 1} / {diffs.length}</span>
            <button onClick={() => setFileIdx(i => Math.max(0, i - 1))} disabled={fileIdx === 0}
              style={{ background:'none', border:'none', cursor: fileIdx === 0 ? 'default' : 'pointer', color: fileIdx === 0 ? '#333' : '#858585', display:'flex', padding:2 }}>
              <ChevronLeft size={13}/>
            </button>
            <button onClick={() => setFileIdx(i => Math.min(diffs.length - 1, i + 1))} disabled={fileIdx === diffs.length - 1}
              style={{ background:'none', border:'none', cursor: fileIdx === diffs.length - 1 ? 'default' : 'pointer', color: fileIdx === diffs.length - 1 ? '#333' : '#858585', display:'flex', padding:2 }}>
              <ChevronRight size={13}/>
            </button>
          </div>
        )}
      </div>

      {/* Diff body */}
      {currentDiff.isBinary ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#858585', fontSize:13 }}>
          Binary file — no diff available
        </div>
      ) : pairs.length === 0 ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#858585', fontSize:13 }}>
          No changed hunks found
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}
          onScroll={syncScroll}
        >
          <DiffColumn lines={leftLines}  label={`${currentDiff.file}  (before)`} isRight={false}/>
          <DiffColumn lines={rightLines} label={`${currentDiff.file}  (after)`}  isRight={true}/>
        </div>
      )}
    </div>
  )
}
