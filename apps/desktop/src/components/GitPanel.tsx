import { useState, useEffect, useCallback, useRef } from 'react'
import { GitBranch, RefreshCw, User, GitCommit, ArrowUp, ArrowDown, Plus, Minus, Circle, Clock } from 'lucide-react'
import { useAppStore } from '../store/appStore'

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
  name:      string
  isCurrent: boolean
  isRemote:  boolean
  upstream?: string
}

// GitPanel accepts either sessionId (for server lookup) or rootPath (direct, more reliable)
interface Props {
  sessionId: string
  rootPath?: string   // preferred — bypasses DB lookup, works even before session is persisted
}
type Tab = 'status' | 'history' | 'branches'

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
  return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' })
}

function formatAbsTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month:'short', day:'numeric', year:'numeric',
    hour:'2-digit', minute:'2-digit',
  })
}

function RefBadge({ label }: { label: string }) {
  const isHead   = label.includes('HEAD')
  const isRemote = label.includes('origin/')
  const isTag    = label.startsWith('tag: ')
  const bg = isHead ? 'var(--accent)' : isRemote ? '#f59e0b' : isTag ? '#10b981' : '#3dd68c'
  const display = label.replace('HEAD -> ','').replace('tag: ','')
  return (
    <span style={{ fontSize:9, padding:'1px 5px', borderRadius:4, background:`${bg}22`, color:bg, border:`1px solid ${bg}44`, fontWeight:600, flexShrink:0, maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
      {display.length > 18 ? display.slice(0,16)+'…' : display}
    </span>
  )
}

export default function GitPanel({ sessionId, rootPath }: Props) {
  const [tab,      setTab]      = useState<Tab>('status')
  const [status,   setStatus]   = useState<GitStatus | null>(null)
  const [commits,  setCommits]  = useState<Commit[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading,  setLoading]  = useState(false)
  const [isRepo,   setIsRepo]   = useState(true)
  const [limit,    setLimit]    = useState(100)
  const [hasMore,  setHasMore]  = useState(false)
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const activeSessionId = useAppStore(s => s.activeSessionId)
  const openFileFn      = useAppStore(s => s.openFile)

  // Build endpoint URL helper — uses rootPath directly when available
  function url(endpoint: string, params?: Record<string, string>) {
    const base = rootPath
      ? `http://localhost:3001/git/direct/${endpoint}?rootPath=${encodeURIComponent(rootPath)}`
      : `http://localhost:3001/project/${sessionId}/git/${endpoint}`
    if (!params) return base
    const sep = base.includes('?') ? '&' : '?'
    return base + sep + Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  }

  const loadStatus = useCallback(async () => {
    try {
      const res  = await fetch(url('status'))
      const data = await res.json()
      setIsRepo(data.isRepo !== false)
      setStatus(data.status ?? null)
    } catch { }
  }, [sessionId, rootPath]) // eslint-disable-line

  const loadHistory = useCallback(async (lim: number) => {
    try {
      const res  = await fetch(url('log', { limit: String(lim + 1) }))
      if (!res.ok) return
      const data = await res.json()
      const all  = data.commits ?? []
      if (all.length === 0 && lim === 100) {
        retryRef.current = setTimeout(() => loadHistory(lim), 800)
        return
      }
      setHasMore(all.length > lim)
      setCommits(all.slice(0, lim))
    } catch { }
  }, [sessionId, rootPath]) // eslint-disable-line

  const loadBranches = useCallback(async () => {
    try {
      const res  = await fetch(url('branches'))
      const data = await res.json()
      setBranches(data.branches ?? [])
    } catch { }
  }, [sessionId, rootPath]) // eslint-disable-line

  useEffect(() => {
    setCommits([]); setStatus(null)
    setLoading(true)
    clearTimeout(retryRef.current)
    Promise.all([loadStatus(), loadHistory(limit), loadBranches()])
      .finally(() => setLoading(false))
    return () => clearTimeout(retryRef.current)
  }, [sessionId, rootPath]) // eslint-disable-line

  useEffect(() => {
    const interval = setInterval(() => {
      loadStatus()
      if (tab === 'history')  loadHistory(limit)
      if (tab === 'branches') loadBranches()
    }, 3000)
    return () => clearInterval(interval)
  }, [tab, limit, loadStatus, loadHistory, loadBranches])

  function openFileDiff(file: string, staged: boolean) {
    if (activeSessionId) {
      openFileFn(activeSessionId, `git-diff::${sessionId}::${file}::${staged}`)
    }
  }

  if (!isRepo) return (
    <div style={{ padding:'12px', fontSize:11, color:'var(--text-muted)', lineHeight:1.8 }}>
      <GitBranch size={16} style={{ marginBottom:6, opacity:0.3, display:'block' }}/>
      Not a git repository.<br/>
      Run <code style={{ fontFamily:'monospace', color:'var(--accent)' }}>git init</code> in the terminal.
    </div>
  )

  const localBranches  = branches.filter(b => !b.isRemote)
  const remoteBranches = branches.filter(b => b.isRemote)
  const currentBranch  = status?.branch ?? ''

  const grouped: Array<{ date: string; items: Commit[] }> = []
  for (const c of commits) {
    const day = new Date(c.date).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' })
    const last = grouped[grouped.length - 1]
    if (last && last.date === day) last.items.push(c)
    else grouped.push({ date: day, items: [c] })
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden', minHeight:0 }}>

      <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--bg-tertiary)' }}>
        <GitBranch size={11} style={{ color:'var(--accent)', flexShrink:0 }}/>
        <span style={{ fontSize:11, fontWeight:600, color:'var(--accent)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{currentBranch}</span>
        {status && status.ahead  > 0 && <span style={{ fontSize:10, color:'var(--green)', display:'flex', alignItems:'center', gap:2 }}><ArrowUp size={9}/>{status.ahead}</span>}
        {status && status.behind > 0 && <span style={{ fontSize:10, color:'#f59e0b', display:'flex', alignItems:'center', gap:2 }}><ArrowDown size={9}/>{status.behind}</span>}
        {loading && <RefreshCw size={10} style={{ animation:'spin 1s linear infinite', color:'var(--text-muted)', flexShrink:0 }}/>}
      </div>

      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
        {(['status', 'history', 'branches'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding:'4px 0', border:'none', background:'transparent', cursor:'pointer', fontSize:10, fontWeight:tab===t?700:400, color:tab===t?'var(--accent)':'var(--text-muted)', borderBottom:tab===t?'2px solid var(--accent)':'2px solid transparent', textTransform:'capitalize', flex:1 }}>
            {t}
            {t==='status' && status && !status.isClean && (
              <span style={{ marginLeft:3, fontSize:9, background:'var(--accent)', color:'white', borderRadius:8, padding:'0 4px' }}>
                {status.staged.length + status.unstaged.length + status.untracked.length}
              </span>
            )}
            {t==='history' && commits.length > 0 && (
              <span style={{ marginLeft:3, fontSize:9, color:'var(--text-muted)' }}>{commits.length}{hasMore?'+':''}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>

        {tab === 'status' && (
          !status
            ? <div style={{ padding:'10px 12px', fontSize:11, color:'var(--text-muted)' }}>Loading…</div>
            : status.isClean
              ? <div style={{ padding:'14px 12px', fontSize:12, color:'var(--green)', display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:16 }}>✓</span> Working tree clean
                </div>
              : <>
                  {status.staged.length > 0 && (
                    <div>
                      <div style={{ padding:'5px 10px', fontSize:10, fontWeight:700, color:'var(--green)', textTransform:'uppercase', letterSpacing:'0.07em', background:'rgba(61,214,140,0.06)', display:'flex', alignItems:'center', gap:4, borderBottom:'1px solid var(--border)' }}>
                        <Plus size={9}/> Staged changes ({status.staged.length})
                      </div>
                      {status.staged.map((f, i) => (
                        <div key={i} onClick={() => openFileDiff(f.file, true)}
                          style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', cursor:'pointer', borderBottom:'1px solid rgba(255,255,255,0.03)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='transparent'}>
                          <span style={{ width:14, height:14, borderRadius:3, background:`${STATUS_COLOR[f.status]??'#888'}22`, color:STATUS_COLOR[f.status]??'#888', fontSize:9, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{STATUS_LETTER[f.status]??'M'}</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:11, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'monospace' }}>{f.file.split('/').pop()}</div>
                            <div style={{ fontSize:9, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'monospace' }}>{f.file}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {status.unstaged.length > 0 && (
                    <div style={{ marginTop:status.staged.length?4:0 }}>
                      <div style={{ padding:'5px 10px', fontSize:10, fontWeight:700, color:'#f59e0b', textTransform:'uppercase', letterSpacing:'0.07em', background:'rgba(245,158,11,0.06)', display:'flex', alignItems:'center', gap:4, borderBottom:'1px solid var(--border)' }}>
                        <Minus size={9}/> Unstaged changes ({status.unstaged.length})
                      </div>
                      {status.unstaged.map((f, i) => (
                        <div key={i} onClick={() => openFileDiff(f.file, false)}
                          style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', cursor:'pointer', borderBottom:'1px solid rgba(255,255,255,0.03)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='transparent'}>
                          <span style={{ width:14, height:14, borderRadius:3, background:`${STATUS_COLOR[f.status]??'#888'}22`, color:STATUS_COLOR[f.status]??'#888', fontSize:9, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{STATUS_LETTER[f.status]??'M'}</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:11, color:'var(--text-secondary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'monospace' }}>{f.file.split('/').pop()}</div>
                            <div style={{ fontSize:9, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'monospace' }}>{f.file}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {status.untracked.length > 0 && (
                    <div style={{ marginTop:4 }}>
                      <div style={{ padding:'5px 10px', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', background:'var(--bg-tertiary)', display:'flex', alignItems:'center', gap:4, borderBottom:'1px solid var(--border)' }}>
                        <Circle size={9}/> Untracked ({status.untracked.length})
                      </div>
                      {status.untracked.map((f, i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                          <span style={{ width:14, height:14, borderRadius:3, background:'#94a3b822', color:'#94a3b8', fontSize:9, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>?</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'monospace' }}>{f.split('/').pop()}</div>
                            <div style={{ fontSize:9, color:'var(--text-muted)', opacity:0.6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'monospace' }}>{f}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
        )}

        {tab === 'history' && (
          loading && commits.length === 0
            ? <div style={{ padding:'14px 12px', fontSize:11, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:6 }}>
                <RefreshCw size={12} style={{ animation:'spin 1s linear infinite' }}/> Loading history…
              </div>
            : commits.length === 0
              ? <div style={{ padding:'14px 12px', fontSize:11, color:'var(--text-muted)' }}>No commits yet</div>
              : <>
                  {grouped.map((group, gi) => (
                    <div key={gi}>
                      <div style={{ padding:'5px 10px 4px', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', background:'var(--bg-tertiary)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:5, position:'sticky', top:0, zIndex:1 }}>
                        <Clock size={9}/>{group.date}
                      </div>
                      {group.items.map((c, i) => (
                        <div key={i}
                          style={{ padding:'6px 10px', borderBottom:'1px solid rgba(255,255,255,0.04)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='transparent'}>
                          <div style={{ fontSize:12, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4, fontWeight:500 }}>
                            {c.message}
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                            <GitCommit size={9} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
                            <code style={{ fontSize:10, color:'var(--accent)', fontFamily:'monospace', flexShrink:0 }}>{c.hash}</code>
                            {c.refs.map((r,ri) => <RefBadge key={ri} label={r}/>)}
                            <span style={{ fontSize:10, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:3, marginLeft:'auto', flexShrink:0 }}>
                              <User size={9}/>{c.author}
                            </span>
                            <span title={formatAbsTime(c.date)} style={{ fontSize:10, color:'var(--text-muted)', flexShrink:0 }}>
                              {formatRelTime(c.date)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  {hasMore && (
                    <button
                      onClick={() => { const next = limit + 100; setLimit(next); loadHistory(next) }}
                      style={{ width:'100%', padding:'8px', border:'none', background:'var(--bg-tertiary)', color:'var(--text-secondary)', cursor:'pointer', fontSize:11, borderTop:'1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='var(--bg-tertiary)'}>
                      Load more commits…
                    </button>
                  )}
                </>
        )}

        {tab === 'branches' && (
          branches.length === 0
            ? <div style={{ padding:'14px 12px', fontSize:11, color:'var(--text-muted)' }}>No branches</div>
            : <>
                {localBranches.length > 0 && (
                  <div>
                    <div style={{ padding:'5px 10px', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', background:'var(--bg-tertiary)', borderBottom:'1px solid var(--border)' }}>
                      Local ({localBranches.length})
                    </div>
                    {localBranches.map((b, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 10px', background:b.isCurrent?'var(--accent-dim)':'transparent', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                        <GitBranch size={11} style={{ color:b.isCurrent?'var(--accent)':'var(--text-muted)', flexShrink:0 }}/>
                        <span style={{ flex:1, fontSize:12, fontWeight:b.isCurrent?600:400, color:b.isCurrent?'var(--accent)':'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.name}</span>
                        {b.isCurrent && <span style={{ fontSize:9, color:'var(--accent)', flexShrink:0, fontWeight:700, padding:'1px 5px', borderRadius:4, border:'1px solid var(--accent)', background:'var(--accent-dim)' }}>current</span>}
                      </div>
                    ))}
                  </div>
                )}
                {remoteBranches.length > 0 && (
                  <div style={{ marginTop:4 }}>
                    <div style={{ padding:'5px 10px', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', background:'var(--bg-tertiary)', borderBottom:'1px solid var(--border)' }}>
                      Remote ({remoteBranches.length})
                    </div>
                    {remoteBranches.map((b, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
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
