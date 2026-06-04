import { useState, useEffect, useCallback } from 'react'
import { GitBranch, RefreshCw, User, Plus, Minus, Circle, ArrowUp, ArrowDown } from 'lucide-react'

interface FileChange { status: string; file: string; oldFile?: string }
interface GitStatus {
  branch:    string
  upstream?: string
  ahead:     number
  behind:    number
  staged:    FileChange[]
  unstaged:  FileChange[]
  untracked: string[]
  isClean:   boolean
}
interface Commit {
  hash:    string
  author:  string
  email:   string
  date:    string
  message: string
  refs:    string[]
}
interface Branch {
  name:        string
  isCurrent:   boolean
  isRemote:    boolean
  upstream?:   string
  lastCommit?: string
}
interface DiffLine  { type: 'context' | 'added' | 'removed'; content: string }
interface DiffHunk  { header: string; lines: DiffLine[] }
interface FileDiff  { file: string; status: string; hunks: DiffHunk[]; isBinary: boolean }

const STATUS_COLOR: Record<string, string> = {
  added:'var(--green)', modified:'#f59e0b', deleted:'var(--red)',
  renamed:'#06b6d4', copied:'#a78bfa', unmerged:'#ef4444',
}
const STATUS_LETTER: Record<string, string> = {
  added:'A', modified:'M', deleted:'D', renamed:'R', copied:'C', unmerged:'U',
}

function formatRelTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000)      return `${Math.floor(diff/1000)}s ago`
  if (diff < 3600000)    return `${Math.floor(diff/60000)}m ago`
  if (diff < 86400000)   return `${Math.floor(diff/3600000)}h ago`
  if (diff < 2592000000) return `${Math.floor(diff/86400000)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric' })
}

function RefBadge({ ref }: { ref: string }) {
  const isHead   = ref.includes('HEAD')
  const isRemote = ref.includes('origin/')
  const bg = isHead ? 'var(--accent)' : isRemote ? '#f59e0b' : '#3dd68c'
  const label = ref.replace('HEAD -> ','').replace('tag: ','')
  return (
    <span style={{ fontSize:9, padding:'1px 5px', borderRadius:4, background:`${bg}22`, color:bg, border:`1px solid ${bg}44`, fontWeight:600, flexShrink:0 }}>
      {label.length > 20 ? label.slice(0,18)+'…' : label}
    </span>
  )
}

function DiffViewer({ diffs, onClose }: { diffs: FileDiff[]; onClose: () => void }) {
  return (
    <div style={{ position:'absolute', inset:0, background:'var(--bg-primary)', zIndex:20, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--bg-secondary)' }}>
        <span style={{ fontSize:11, fontWeight:600, color:'var(--text-primary)', flex:1 }}>Diff viewer</span>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:16, lineHeight:1 }}>✕</button>
      </div>
      <div style={{ flex:1, overflowY:'auto', fontFamily:'monospace', fontSize:11 }}>
        {diffs.length === 0
          ? <div style={{ padding:'12px', color:'var(--text-muted)' }}>No changes</div>
          : diffs.map((f, fi) => (
            <div key={fi}>
              <div style={{ padding:'6px 10px', background:'var(--bg-tertiary)', borderBottom:'1px solid var(--border)', fontSize:11, color:'var(--text-primary)', fontWeight:500, fontFamily:'monospace' }}>
                {f.file}
              </div>
              {f.isBinary
                ? <div style={{ padding:'8px 10px', color:'var(--text-muted)', fontSize:11 }}>Binary file</div>
                : f.hunks.map((hunk, hi) => (
                  <div key={hi}>
                    <div style={{ padding:'3px 10px', background:'rgba(124,106,247,0.08)', color:'var(--accent)', fontSize:10, borderBottom:'1px solid var(--border)' }}>
                      {hunk.header}
                    </div>
                    {hunk.lines.map((line, li) => {
                      const bg     = line.type==='added' ? 'rgba(61,214,140,0.08)' : line.type==='removed' ? 'rgba(245,101,101,0.08)' : 'transparent'
                      const color  = line.type==='added' ? '#3dd68c' : line.type==='removed' ? '#f56565' : 'var(--text-secondary)'
                      const prefix = line.type==='added' ? '+' : line.type==='removed' ? '-' : ' '
                      return (
                        <div key={li} style={{ display:'flex', background:bg, minHeight:18 }}>
                          <span style={{ color, width:14, flexShrink:0, textAlign:'center', userSelect:'none', opacity:0.8 }}>{prefix}</span>
                          <span style={{ color, flex:1, whiteSpace:'pre', overflow:'hidden', textOverflow:'ellipsis', paddingRight:8 }}>{line.content}</span>
                        </div>
                      )
                    })}
                  </div>
                ))
              }
            </div>
          ))
        }
      </div>
    </div>
  )
}

interface Props { sessionId: string }
type Tab = 'status' | 'log' | 'branches'

export default function GitPanel({ sessionId }: Props) {
  const [tab,      setTab]      = useState<Tab>('status')
  const [status,   setStatus]   = useState<GitStatus | null>(null)
  const [commits,  setCommits]  = useState<Commit[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading,  setLoading]  = useState(false)
  const [isRepo,   setIsRepo]   = useState(true)
  const [diffs,    setDiffs]    = useState<FileDiff[] | null>(null)

  const BASE = `http://localhost:3001/project/${sessionId}/git`

  const loadStatus = useCallback(async () => {
    try {
      const res  = await fetch(`${BASE}/status`)
      const data = await res.json()
      setIsRepo(data.isRepo)
      setStatus(data.status ?? null)
    } catch { }
  }, [BASE])

  const loadLog = useCallback(async () => {
    try {
      const res  = await fetch(`${BASE}/log?limit=50`)
      const data = await res.json()
      setCommits(data.commits ?? [])
    } catch { }
  }, [BASE])

  const loadBranches = useCallback(async () => {
    try {
      const res  = await fetch(`${BASE}/branches`)
      const data = await res.json()
      setBranches(data.branches ?? [])
    } catch { }
  }, [BASE])

  const reload = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadStatus(), loadLog(), loadBranches()])
    setLoading(false)
  }, [loadStatus, loadLog, loadBranches])

  useEffect(() => { reload() }, [reload])

  // Auto-reload every 3s — detects git changes (commits, staging, pushes) without manual refresh
  useEffect(() => {
    const interval = setInterval(() => {
      loadStatus()
      if (tab === 'log')      loadLog()
      if (tab === 'branches') loadBranches()
    }, 3000)
    return () => clearInterval(interval)
  }, [tab, loadStatus, loadLog, loadBranches])

  async function openFileDiff(file: string, staged: boolean) {
    const res  = await fetch(`${BASE}/diff?file=${encodeURIComponent(file)}&staged=${staged}`)
    const data = await res.json()
    setDiffs(data.diffs ?? [])
  }

  async function openCommitDiff(hash: string) {
    const res  = await fetch(`${BASE}/commit/${hash}`)
    const data = await res.json()
    setDiffs(data.diffs ?? [])
  }

  if (!isRepo) return (
    <div style={{ padding:'12px', fontSize:11, color:'var(--text-muted)', lineHeight:1.6 }}>
      <GitBranch size={16} style={{ marginBottom:6, opacity:0.3, display:'block' }}/>
      Not a git repository.<br/>
      Run <code style={{ fontFamily:'monospace', color:'var(--accent)' }}>git init</code> in the terminal to initialise one.
    </div>
  )

  const currentBranch  = status?.branch ?? ''
  const localBranches  = branches.filter(b => !b.isRemote)
  const remoteBranches = branches.filter(b => b.isRemote)

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden', minHeight:0, position:'relative' }}>
      {diffs && <DiffViewer diffs={diffs} onClose={() => setDiffs(null)}/>}

      {/* Branch bar */}
      <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--bg-tertiary)' }}>
        <GitBranch size={11} style={{ color:'var(--accent)', flexShrink:0 }}/>
        <span style={{ fontSize:11, fontWeight:500, color:'var(--accent)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{currentBranch}</span>
        {status && status.ahead  > 0 && <span style={{ fontSize:10, color:'var(--green)', display:'flex', alignItems:'center', gap:2 }}><ArrowUp size={9}/>{status.ahead}</span>}
        {status && status.behind > 0 && <span style={{ fontSize:10, color:'#f59e0b', display:'flex', alignItems:'center', gap:2 }}><ArrowDown size={9}/>{status.behind}</span>}
        {/* Loading indicator — shows during background refresh, no manual button needed */}
        {loading && <RefreshCw size={10} style={{ animation:'spin 1s linear infinite', color:'var(--text-muted)', flexShrink:0 }}/>}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
        {(['status','log','branches'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding:'4px 10px', border:'none', background:'transparent', cursor:'pointer', fontSize:10, fontWeight:tab===t?600:400, color:tab===t?'var(--accent)':'var(--text-muted)', borderBottom:tab===t?'2px solid var(--accent)':'2px solid transparent', textTransform:'capitalize', flex:1 }}>
            {t}
            {t==='status' && status && !status.isClean && (
              <span style={{ marginLeft:4, fontSize:9, background:'var(--accent)', color:'white', borderRadius:8, padding:'0 4px' }}>
                {status.staged.length + status.unstaged.length + status.untracked.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>

        {/* Status */}
        {tab === 'status' && (
          !status
            ? <div style={{ padding:'8px 12px', fontSize:11, color:'var(--text-muted)' }}>Loading…</div>
            : status.isClean
              ? <div style={{ padding:'12px', fontSize:11, color:'var(--green)' }}>✓ Working tree clean</div>
              : <>
                  {status.staged.length > 0 && (
                    <div>
                      <div style={{ padding:'5px 10px', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--bg-tertiary)', display:'flex', alignItems:'center', gap:4 }}>
                        <Plus size={9}/> Staged ({status.staged.length})
                      </div>
                      {status.staged.map((f, i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 10px', cursor:'pointer' }}
                          onClick={() => openFileDiff(f.file, true)}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                          <span style={{ width:12, height:12, borderRadius:3, background:`${STATUS_COLOR[f.status]??'#888'}22`, color:STATUS_COLOR[f.status]??'#888', fontSize:8, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{STATUS_LETTER[f.status]??'M'}</span>
                          <span style={{ flex:1, fontSize:11, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'monospace' }}>{f.file.split('/').pop()}</span>
                          <span style={{ fontSize:9, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:80, fontFamily:'monospace' }}>{f.file.split('/').slice(0,-1).join('/')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {status.unstaged.length > 0 && (
                    <div>
                      <div style={{ padding:'5px 10px', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--bg-tertiary)', display:'flex', alignItems:'center', gap:4, marginTop:4 }}>
                        <Minus size={9}/> Unstaged ({status.unstaged.length})
                      </div>
                      {status.unstaged.map((f, i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 10px', cursor:'pointer' }}
                          onClick={() => openFileDiff(f.file, false)}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                          <span style={{ width:12, height:12, borderRadius:3, background:`${STATUS_COLOR[f.status]??'#888'}22`, color:STATUS_COLOR[f.status]??'#888', fontSize:8, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{STATUS_LETTER[f.status]??'M'}</span>
                          <span style={{ flex:1, fontSize:11, color:'var(--text-secondary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'monospace' }}>{f.file.split('/').pop()}</span>
                          <span style={{ fontSize:9, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:80, fontFamily:'monospace' }}>{f.file.split('/').slice(0,-1).join('/')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {status.untracked.length > 0 && (
                    <div>
                      <div style={{ padding:'5px 10px', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--bg-tertiary)', display:'flex', alignItems:'center', gap:4, marginTop:4 }}>
                        <Circle size={9}/> Untracked ({status.untracked.length})
                      </div>
                      {status.untracked.map((f, i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 10px' }}>
                          <span style={{ width:12, height:12, borderRadius:3, background:'#94a3b822', color:'#94a3b8', fontSize:8, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>?</span>
                          <span style={{ flex:1, fontSize:11, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'monospace' }}>{f}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
        )}

        {/* Log */}
        {tab === 'log' && (
          commits.length === 0
            ? <div style={{ padding:'8px 12px', fontSize:11, color:'var(--text-muted)' }}>No commits yet</div>
            : commits.map((c, i) => (
              <div key={i} style={{ padding:'7px 10px', borderBottom:'1px solid var(--border)', cursor:'pointer' }}
                onClick={() => openCommitDiff(c.hash)}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3, flexWrap:'wrap' }}>
                  <code style={{ fontSize:10, color:'var(--accent)', fontFamily:'monospace', flexShrink:0 }}>{c.hash}</code>
                  {c.refs.slice(0,2).map((r,ri) => <RefBadge key={ri} ref={r}/>)}
                  <span style={{ marginLeft:'auto', fontSize:10, color:'var(--text-muted)', flexShrink:0 }}>{formatRelTime(c.date)}</span>
                </div>
                <div style={{ fontSize:12, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:2 }}>{c.message}</div>
                <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'var(--text-muted)' }}>
                  <User size={9}/>{c.author}
                </div>
              </div>
            ))
        )}

        {/* Branches */}
        {tab === 'branches' && (
          branches.length === 0
            ? <div style={{ padding:'8px 12px', fontSize:11, color:'var(--text-muted)' }}>No branches</div>
            : <>
                {localBranches.length > 0 && (
                  <div>
                    <div style={{ padding:'5px 10px', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--bg-tertiary)' }}>
                      Local ({localBranches.length})
                    </div>
                    {localBranches.map((b,i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', background:b.isCurrent?'var(--accent-dim)':'transparent' }}>
                        <GitBranch size={11} style={{ color:b.isCurrent?'var(--accent)':'var(--text-muted)', flexShrink:0 }}/>
                        <span style={{ flex:1, fontSize:11, fontWeight:b.isCurrent?600:400, color:b.isCurrent?'var(--accent)':'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.name}</span>
                        {b.isCurrent && <span style={{ fontSize:9, color:'var(--accent)', flexShrink:0, fontWeight:600 }}>current</span>}
                        {b.upstream && <span style={{ fontSize:9, color:'var(--text-muted)', flexShrink:0 }}>→ {b.upstream.replace('origin/','')}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {remoteBranches.length > 0 && (
                  <div style={{ marginTop:4 }}>
                    <div style={{ padding:'5px 10px', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--bg-tertiary)' }}>
                      Remote ({remoteBranches.length})
                    </div>
                    {remoteBranches.map((b,i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px' }}>
                        <GitBranch size={11} style={{ color:'#f59e0b', flexShrink:0 }}/>
                        <span style={{ flex:1, fontSize:11, color:'var(--text-secondary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
        )}
      </div>

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
