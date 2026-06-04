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

// Build side-by-side aligned line pairs from unified diff
interface SideLine {
  lineNo?: number
  content: string
  type: 'context' | 'added' | 'removed' | 'empty'
}

interface SidePair { left: SideLine; right: SideLine }

function buildSideBySide(hunks: DiffHunk[]): SidePair[] {
  const pairs: SidePair[] = []

  for (const hunk of hunks) {
    // Hunk header separator
    pairs.push({
      left:  { content: hunk.header, type: 'context' },
      right: { content: hunk.header, type: 'context' },
    })

    // Collect removed and added lines in a block, then align them
    let leftNum  = 0
    let rightNum = 0

    // Parse the hunk header for starting line numbers
    const m = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (m) { leftNum = parseInt(m[1]); rightNum = parseInt(m[2]) }

    // Buffer removed and added lines to align them side by side
    let removedBuf: DiffLine[] = []
    let addedBuf:   DiffLine[] = []

    function flushBuffers() {
      const maxLen = Math.max(removedBuf.length, addedBuf.length)
      for (let i = 0; i < maxLen; i++) {
        const l = removedBuf[i]
        const r = addedBuf[i]
        pairs.push({
          left:  l ? { lineNo: leftNum++,  content: l.content, type: 'removed' } : { content: '', type: 'empty' },
          right: r ? { lineNo: rightNum++, content: r.content, type: 'added'   } : { content: '', type: 'empty' },
        })
      }
      removedBuf = []; addedBuf = []
    }

    for (const line of hunk.lines) {
      if (line.type === 'context') {
        flushBuffers()
        pairs.push({
          left:  { lineNo: leftNum++,  content: line.content, type: 'context' },
          right: { lineNo: rightNum++, content: line.content, type: 'context' },
        })
      } else if (line.type === 'removed') {
        removedBuf.push(line)
      } else if (line.type === 'added') {
        addedBuf.push(line)
      }
    }
    flushBuffers()
  }

  return pairs
}

const MONO: React.CSSProperties = {
  fontFamily: "'SF Mono','Fira Code','Cascadia Code',Menlo,monospace",
  fontSize: 12, lineHeight: '20px',
  whiteSpace: 'pre', overflowWrap: 'normal',
}

export default function DiffEditorPanel({ sessionId, filePath, staged }: Props) {
  const [diffs,   setDiffs]   = useState<FileDiff[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [fileIdx, setFileIdx] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const filename = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath

  useEffect(() => {
    setLoading(true); setError('')
    const url = staged
      ? `http://localhost:3001/project/${sessionId}/git/diff?file=${encodeURIComponent(filePath)}&staged=true`
      : `http://localhost:3001/project/${sessionId}/git/diff?file=${encodeURIComponent(filePath)}&staged=false`
    fetch(url)
      .then(r => r.json())
      .then(d => { setDiffs(d.diffs ?? []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [sessionId, filePath, staged])

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#1e1e1e', gap:10 }}>
      <Loader size={16} style={{ animation:'spin 1s linear infinite', color:'var(--accent)' }}/>
      <span style={{ fontSize:12, color:'#858585' }}>Loading diff…</span>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (error) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#1e1e1e', color:'var(--red)', fontSize:12 }}>
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

  const leftLines  = pairs.map(p => p.left)
  const rightLines = pairs.map(p => p.right)

  // Sync both columns' scroll together
  function syncScroll(e: React.UIEvent<HTMLDivElement>) {
    if (!scrollRef.current) return
    const children = scrollRef.current.querySelectorAll('[data-scroll-col]')
    children.forEach(el => { if (el !== e.currentTarget) (el as HTMLElement).scrollTop = (e.currentTarget as HTMLElement).scrollTop })
  }

  const addedLines   = currentDiff.hunks.flatMap(h => h.lines).filter(l => l.type === 'added').length
  const removedLines = currentDiff.hunks.flatMap(h => h.lines).filter(l => l.type === 'removed').length

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#1e1e1e', overflow:'hidden', minHeight:0 }}>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px', borderBottom:'1px solid #333', background:'#252526', flexShrink:0 }}>
        <GitBranch size={13} style={{ color:'var(--accent)', flexShrink:0 }}/>
        <span style={{ fontSize:12, fontWeight:600, color:'#d4d4d4' }}>{currentDiff.file}</span>
        <span style={{ fontSize:10, padding:'1px 6px', borderRadius:4, background:staged?'rgba(61,214,140,0.15)':'rgba(245,158,11,0.15)', color:staged?'#3dd68c':'#f59e0b', fontWeight:600 }}>
          {staged ? 'staged' : 'unstaged'}
        </span>
        {addedLines > 0   && <span style={{ fontSize:11, color:'#3dd68c', fontWeight:600 }}>+{addedLines}</span>}
        {removedLines > 0 && <span style={{ fontSize:11, color:'#f88',    fontWeight:600 }}>-{removedLines}</span>}
        {/* File navigator when multiple files changed */}
        {diffs.length > 1 && (
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ fontSize:11, color:'#858585' }}>{fileIdx+1} / {diffs.length}</span>
            <button onClick={() => setFileIdx(i => Math.max(0, i-1))} disabled={fileIdx===0}
              style={{ background:'none', border:'none', cursor:fileIdx===0?'not-allowed':'pointer', color:fileIdx===0?'#555':'#858585', display:'flex', padding:2 }}>
              <ChevronLeft size={13}/>
            </button>
            <button onClick={() => setFileIdx(i => Math.min(diffs.length-1, i+1))} disabled={fileIdx===diffs.length-1}
              style={{ background:'none', border:'none', cursor:fileIdx===diffs.length-1?'not-allowed':'pointer', color:fileIdx===diffs.length-1?'#555':'#858585', display:'flex', padding:2 }}>
              <ChevronRight size={13}/>
            </button>
          </div>
        )}
      </div>

      {currentDiff.isBinary ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#858585', fontSize:13 }}>
          Binary file — no diff available
        </div>
      ) : (
        // Side-by-side diff — two columns, scroll is synchronised
        <div ref={scrollRef} style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
          {/* Left column — OLD (before) */}
          <div data-scroll-col="left"
            onScroll={syncScroll}
            style={{ flex:1, display:'flex', flexDirection:'column', overflow:'auto', minWidth:0, borderRight:'2px solid #333' }}>
            {/* Column header */}
            <div style={{ padding:'3px 12px 3px 62px', background:'#252526', borderBottom:'1px solid #333', fontSize:10, color:'#858585', flexShrink:0, fontFamily:'monospace', position:'sticky', top:0, zIndex:1 }}>
              {currentDiff.file} (before)
            </div>
            {leftLines.map((line, i) => {
              const isHdr = line.content.startsWith('@@')
              const bg =
                isHdr                   ? 'rgba(124,106,247,0.1)'  :
                line.type === 'removed' ? 'rgba(255,80,80,0.12)'   :
                line.type === 'empty'   ? '#181818'                 :
                'transparent'
              const lineNumColor = line.type === 'removed' ? 'rgba(255,120,120,0.8)' : '#495162'
              const textColor    = isHdr ? 'var(--accent)' : line.type === 'removed' ? '#ff9999' : line.type === 'empty' ? '#252526' : '#d4d4d4'
              const prefix       = line.type === 'removed' ? '-' : line.type === 'empty' ? '' : ' '
              return (
                <div key={i} style={{ display:'flex', background:bg, minHeight:20 }}>
                  <div style={{ width:44, flexShrink:0, textAlign:'right', paddingRight:8, color:lineNumColor, userSelect:'none', ...MONO, borderRight:'1px solid #333' }}>{line.lineNo??''}</div>
                  <div style={{ width:16, flexShrink:0, textAlign:'center', color:textColor, userSelect:'none', ...MONO, opacity:0.9 }}>{prefix}</div>
                  <div style={{ flex:1, color:textColor, ...MONO, paddingLeft:4, paddingRight:16, overflow:'hidden' }}>{line.content}</div>
                </div>
              )
            })}
          </div>

          {/* Right column — NEW (after) */}
          <div data-scroll-col="right"
            onScroll={syncScroll}
            style={{ flex:1, display:'flex', flexDirection:'column', overflow:'auto', minWidth:0 }}>
            {/* Column header */}
            <div style={{ padding:'3px 12px 3px 62px', background:'#252526', borderBottom:'1px solid #333', fontSize:10, color:'#858585', flexShrink:0, fontFamily:'monospace', position:'sticky', top:0, zIndex:1 }}>
              {currentDiff.file} (after)
            </div>
            {rightLines.map((line, i) => {
              const isHdr = line.content.startsWith('@@')
              const bg =
                isHdr                 ? 'rgba(124,106,247,0.1)' :
                line.type === 'added' ? 'rgba(61,214,140,0.10)'  :
                line.type === 'empty' ? '#181818'                :
                'transparent'
              const lineNumColor = line.type === 'added' ? 'rgba(80,210,140,0.8)' : '#495162'
              const textColor    = isHdr ? 'var(--accent)' : line.type === 'added' ? '#90eac8' : line.type === 'empty' ? '#252526' : '#d4d4d4'
              const prefix       = line.type === 'added' ? '+' : line.type === 'empty' ? '' : ' '
              return (
                <div key={i} style={{ display:'flex', background:bg, minHeight:20 }}>
                  <div style={{ width:44, flexShrink:0, textAlign:'right', paddingRight:8, color:lineNumColor, userSelect:'none', ...MONO, borderRight:'1px solid #333' }}>{line.lineNo??''}</div>
                  <div style={{ width:16, flexShrink:0, textAlign:'center', color:textColor, userSelect:'none', ...MONO, opacity:0.9 }}>{prefix}</div>
                  <div style={{ flex:1, color:textColor, ...MONO, paddingLeft:4, paddingRight:16, overflow:'hidden' }}>{line.content}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
