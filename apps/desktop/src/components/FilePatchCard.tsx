import { useState, useEffect } from 'react'
import { Check, X, FileText, ChevronDown, ChevronUp } from 'lucide-react'

export interface FilePatch {
  id:       string
  path:     string   // relative or absolute path
  content:  string   // full new file content
  rootPath?: string  // project root for resolving relative paths
}

interface Props {
  patch:         FilePatch
  alreadyApplied?: boolean   // parent tells us this was already applied (survives re-render)
  onApply:       (patch: FilePatch) => Promise<void>
  onReject:      (id: string) => void
}

export function FilePatchCard({ patch, alreadyApplied = false, onApply, onReject }: Props) {
  const [expanded,  setExpanded]  = useState(false)
  const [applying,  setApplying]  = useState(false)
  const [applied,   setApplied]   = useState(alreadyApplied)
  const [rejected,  setRejected]  = useState(false)
  const [existing,  setExisting]  = useState<string | null>(null)
  const [loadingEx, setLoadingEx] = useState(false)

  // Sync applied state from parent (handles re-renders after apply)
  useEffect(() => { if (alreadyApplied) setApplied(true) }, [alreadyApplied])

  const fileName = patch.path.replace(/\\/g, '/').split('/').pop() ?? patch.path
  const lines    = patch.content.split('\n')

  // Load existing file content for diff preview
  useEffect(() => {
    if (!expanded || existing !== null) return
    setLoadingEx(true)
    const fullPath = patch.path.startsWith('/') ? patch.path
      : patch.rootPath ? `${patch.rootPath}/${patch.path}` : patch.path
    fetch(`http://localhost:3001/project/file?path=${encodeURIComponent(fullPath)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setExisting(d?.content ?? ''))
      .catch(() => setExisting(''))
      .finally(() => setLoadingEx(false))
  }, [expanded])

  async function handleApply() {
    setApplying(true)
    try {
      await onApply(patch)
      setApplied(true)
      // Notify the file tree to show the new/updated file immediately
      window.dispatchEvent(new CustomEvent('localforge:file-applied', { detail: patch.path }))
    } finally {
      setApplying(false)
    }
  }

  function handleReject() {
    setRejected(true)
    setTimeout(() => onReject(patch.id), 300)
  }

  if (rejected) return null

  const isNew = existing === ''
  const lineCount = lines.length

  return (
    <div style={{
      border: applied ? '1px solid rgba(61,214,140,0.4)' : '1px solid var(--border)',
      borderRadius: 8,
      background: applied ? 'rgba(61,214,140,0.06)' : 'var(--bg-tertiary)',
      overflow: 'hidden',
      margin: '6px 0',
      transition: 'all 0.2s',
    }}>
      {/* Header row */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 12px', borderBottom: expanded ? '1px solid var(--border)' : 'none' }}>
        <FileText size={13} style={{ color: applied ? 'var(--green)' : 'var(--accent)', flexShrink:0 }}/>
        <span style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {patch.path}
        </span>
        <span style={{ fontSize:10, color:'var(--text-muted)', flexShrink:0 }}>
          {isNew ? 'new file' : 'modified'} · {lineCount} lines
        </span>

        {!applied && (
          <>
            <button onClick={() => setExpanded(v => !v)}
              style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:'2px 4px', borderRadius:4 }}
              title={expanded ? 'Collapse' : 'Preview changes'}
            >{expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}</button>

            <button onClick={handleApply} disabled={applying}
              style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 10px', background:'var(--accent)', border:'none', borderRadius:5, color:'white', fontSize:11, fontWeight:600, cursor:applying?'wait':'pointer', flexShrink:0 }}>
              {applying ? '...' : <><Check size={11}/>Apply</>}
            </button>
            <button onClick={handleReject}
              style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', background:'transparent', border:'1px solid var(--border)', borderRadius:5, color:'var(--text-secondary)', fontSize:11, cursor:'pointer', flexShrink:0 }}>
              <X size={11}/>Reject
            </button>
          </>
        )}

        {applied && (
          <span style={{ fontSize:11, color:'var(--green)', fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
            <Check size={12}/>Applied
          </span>
        )}
      </div>

      {/* Diff preview */}
      {expanded && !applied && (
        <div style={{ maxHeight: 320, overflowY:'auto' }}>
          {loadingEx ? (
            <div style={{ padding:'10px 14px', fontSize:11, color:'var(--text-muted)' }}>Loading current file...</div>
          ) : (
            <DiffView oldContent={existing ?? ''} newContent={patch.content} fileName={fileName}/>
          )}
        </div>
      )}
    </div>
  )
}

// Simple line-by-line diff view
function DiffView({ oldContent, newContent, fileName }: { oldContent: string; newContent: string; fileName: string }) {
  const oldLines = oldContent ? oldContent.split('\n') : []
  const newLines = newContent.split('\n')

  if (!oldContent) {
    // New file — show all lines as added
    return (
      <div style={{ fontFamily:'monospace', fontSize:11, lineHeight:1.6 }}>
        <div style={{ padding:'4px 12px', background:'rgba(61,214,140,0.08)', borderBottom:'1px solid var(--border)', fontSize:10, color:'var(--text-muted)' }}>
          + New file: {fileName}
        </div>
        {newLines.map((line, i) => (
          <div key={i} style={{ display:'flex', background:'rgba(61,214,140,0.06)' }}>
            <span style={{ width:36, flexShrink:0, color:'rgba(61,214,140,0.6)', textAlign:'right', paddingRight:8, userSelect:'none', fontSize:10 }}>{i+1}</span>
            <span style={{ color:'#3dd68c', paddingLeft:4, whiteSpace:'pre-wrap', wordBreak:'break-all' }}>+{line}</span>
          </div>
        ))}
      </div>
    )
  }

  // Existing file — compute simple diff (added / removed / unchanged)
  const diff = computeDiff(oldLines, newLines)
  const added   = diff.filter(l => l.type === 'add').length
  const removed = diff.filter(l => l.type === 'remove').length

  return (
    <div style={{ fontFamily:'monospace', fontSize:11, lineHeight:1.6 }}>
      <div style={{ padding:'4px 12px', background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)', fontSize:10, color:'var(--text-muted)', display:'flex', gap:12 }}>
        <span>Modified: {fileName}</span>
        {added   > 0 && <span style={{ color:'#3dd68c' }}>+{added}</span>}
        {removed > 0 && <span style={{ color:'var(--red)' }}>-{removed}</span>}
      </div>
      {diff.map((line, i) => {
        const bg    = line.type==='add' ? 'rgba(61,214,140,0.08)' : line.type==='remove' ? 'rgba(239,68,68,0.08)' : 'transparent'
        const color = line.type==='add' ? '#3dd68c'               : line.type==='remove' ? 'var(--red)'            : 'var(--text-secondary)'
        const prefix = line.type==='add' ? '+' : line.type==='remove' ? '-' : ' '
        return (
          <div key={i} style={{ display:'flex', background:bg }}>
            <span style={{ width:36, flexShrink:0, color:'var(--text-muted)', textAlign:'right', paddingRight:8, userSelect:'none', fontSize:10 }}>
              {line.type !== 'remove' ? line.newNum : ''}
            </span>
            <span style={{ color, paddingLeft:4, whiteSpace:'pre-wrap', wordBreak:'break-all' }}>{prefix}{line.text}</span>
          </div>
        )
      })}
    </div>
  )
}

// Minimal LCS-based line diff
type DiffLine = { type: 'add'|'remove'|'same'; text: string; newNum?: number }

function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  // For large files just show new content with change markers
  if (oldLines.length + newLines.length > 400) {
    return newLines.map((text, i) => ({ type: 'same', text, newNum: i+1 }))
  }

  // Build LCS table
  const m = oldLines.length, n = newLines.length
  const dp: number[][] = Array.from({ length: m+1 }, () => new Array(n+1).fill(0))
  for (let i = m-1; i >= 0; i--)
    for (let j = n-1; j >= 0; j--)
      dp[i][j] = oldLines[i] === newLines[j] ? 1 + dp[i+1][j+1] : Math.max(dp[i+1][j], dp[i][j+1])

  const result: DiffLine[] = []
  let i = 0, j = 0, newNum = 1
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      result.push({ type:'same', text: oldLines[i], newNum: newNum++ }); i++; j++
    } else if (j < n && (i >= m || dp[i][j+1] >= dp[i+1][j])) {
      result.push({ type:'add', text: newLines[j], newNum: newNum++ }); j++
    } else {
      result.push({ type:'remove', text: oldLines[i] }); i++
    }
  }
  return result
}
