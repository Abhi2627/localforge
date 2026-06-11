import { useState } from 'react'
import { X, Plus, Sparkles, Loader } from 'lucide-react'
import { useAppStore, type AgentRole } from '../store/appStore'
import { api } from '../hooks/useApi'

interface Props {
  sessionId: string
  projectId: string
  onClose:   () => void
}

const ROLES: { value: AgentRole; label: string; desc: string; color: string }[] = [
  { value: 'fullstack', label: 'Fullstack', desc: 'Builds both frontend and backend',         color: 'var(--accent)' },
  { value: 'frontend',  label: 'Frontend',  desc: 'React, TypeScript, CSS — UI only',         color: 'var(--green)' },
  { value: 'backend',   label: 'Backend',   desc: 'API, database, server logic',               color: 'var(--amber)' },
  { value: 'test',      label: 'Test',      desc: 'Writes tests — Vitest, Jest, Playwright',   color: 'var(--red)' },
  { value: 'review',    label: 'Review',    desc: 'Reads code and gives structured feedback',  color: 'var(--text-secondary)' },
  { value: 'docs',      label: 'Docs',      desc: 'README, API docs, comments',               color: '#a78bfa' },
  { value: 'devops',    label: 'DevOps',    desc: 'Dockerfile, CI/CD, deployment config',     color: '#f97316' },
]

type Tab = 'manual' | 'auto'

export default function AgentModal({ sessionId, projectId, onClose }: Props) {
  const { addAgent } = useAppStore()
  const [tab,         setTab]         = useState<Tab>('auto')
  const [name,        setName]        = useState('')
  const [role,        setRole]        = useState<AgentRole>('fullstack')
  const [task,        setTask]        = useState('')
  const [loading,     setLoading]     = useState(false)
  const [autoLoading, setAutoLoading] = useState(false)
  const [error,       setError]       = useState('')
  const [autoResult,  setAutoResult]  = useState<any[] | null>(null)

  async function handleCreate() {
    if (!name.trim()) { setError('Agent name is required'); return }
    setLoading(true); setError('')
    try {
      const { agent } = await api.createAgent(projectId, name.trim(), role)
      addAgent(sessionId, { id: agent.id, name: agent.name, role: agent.role, status: 'idle' })
      onClose()
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function handleAutoOrchestrate() {
    if (!task.trim()) { setError('Describe the task first'); return }
    setAutoLoading(true); setError(''); setAutoResult(null)
    try {
      const res = await fetch(`http://localhost:3001/projects/${projectId}/orchestrate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      // Register agents in store
      for (const agent of data.agents ?? []) {
        addAgent(sessionId, { id: agent.id, name: agent.name, role: agent.role, status: 'running' })
      }
      setAutoResult(data.agents ?? [])
    } catch (err: any) { setError(err.message) }
    finally { setAutoLoading(false) }
  }

  const selectedRole = ROLES.find(r => r.value === role)!

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}>
      <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:12, padding:24, width:440, maxHeight:'85vh', overflowY:'auto', display:'flex', flexDirection:'column', gap:16 }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontWeight:600, fontSize:14, color:'var(--text-primary)' }}>Agents</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:4 }}><X size={14}/></button>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:4, background:'var(--bg-primary)', borderRadius:8, padding:3 }}>
          {(['auto', 'manual'] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setError('') }}
              style={{ flex:1, padding:'7px', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:500,
                background: tab===t ? 'var(--bg-secondary)' : 'transparent',
                color: tab===t ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: tab===t ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
              }}>
              {t === 'auto' ? '✨ Auto-Orchestrate' : '+ Manual'}
            </button>
          ))}
        </div>

        {/* Auto-Orchestrate tab */}
        {tab === 'auto' && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.6, background:'var(--bg-primary)', padding:'10px 12px', borderRadius:8, border:'1px solid var(--border)' }}>
              <strong style={{ color:'var(--text-secondary)' }}>Auto mode:</strong> Describe your project and LocalForge decides how many agents to deploy, what roles they need, and what each one should build. No manual setup required.
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:6 }}>Describe what you want to build</div>
              <textarea
                autoFocus value={task} onChange={e => setTask(e.target.value)}
                placeholder="e.g. Build a full-stack video meet app with React frontend, Node.js backend, WebRTC signaling, and PostgreSQL database. Production-ready with auth, tests, and Docker."
                rows={5}
                style={{ width:'100%', background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', color:'var(--text-primary)', fontSize:12, outline:'none', resize:'vertical', fontFamily:'inherit', lineHeight:1.6, boxSizing:'border-box' }}
                onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = 'var(--accent)'}
                onBlur={e  => (e.target as HTMLTextAreaElement).style.borderColor = 'var(--border)'}
              />
            </div>

            {autoResult && (
              <div style={{ background:'rgba(61,214,140,0.08)', border:'1px solid rgba(61,214,140,0.25)', borderRadius:8, padding:'10px 12px' }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#3dd68c', marginBottom:8 }}>
                  ✓ {autoResult.length} agent{autoResult.length !== 1 ? 's' : ''} deployed
                </div>
                {autoResult.map((a, i) => (
                  <div key={i} style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:4, display:'flex', gap:8 }}>
                    <span style={{ color:'var(--accent)', fontWeight:600, minWidth:80 }}>{a.name}</span>
                    <span style={{ color:'var(--text-muted)' }}>{a.role}</span>
                    <span style={{ color:'var(--text-muted)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.instruction}</span>
                  </div>
                ))}
                <div style={{ marginTop:8, fontSize:11, color:'var(--text-muted)' }}>
                  Agents are running in the background. Watch the Agents panel for progress.
                </div>
              </div>
            )}

            {error && <div style={{ fontSize:12, color:'var(--red)', padding:'6px 10px', background:'var(--red-dim)', borderRadius:6 }}>{error}</div>}

            <button onClick={handleAutoOrchestrate} disabled={!task.trim() || autoLoading}
              style={{ background:'var(--accent)', border:'none', borderRadius:8, padding:'11px 0', color:'white', fontSize:13, fontWeight:600, cursor:!task.trim()||autoLoading?'not-allowed':'pointer', opacity:!task.trim()||autoLoading?0.5:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              {autoLoading
                ? <><Loader size={14} style={{ animation:'spin 1s linear infinite' }}/> Planning agents…</>
                : <><Sparkles size={14}/> Auto-Orchestrate</>
              }
            </button>
            {autoResult && <button onClick={onClose} style={{ background:'transparent', border:'1px solid var(--border)', borderRadius:8, padding:'9px 0', color:'var(--text-secondary)', fontSize:13, cursor:'pointer' }}>Done</button>}
          </div>
        )}

        {/* Manual tab */}
        {tab === 'manual' && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:6 }}>Agent name</div>
              <input
                autoFocus value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="e.g. Dev, Frontend, Tester…"
                style={{ width:'100%', background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:7, padding:'8px 10px', color:'var(--text-primary)', fontSize:13, outline:'none', boxSizing:'border-box' }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
                onBlur={e  => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'}
              />
            </div>

            <div>
              <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:8 }}>Role</div>
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                {ROLES.map(r => (
                  <button key={r.value} onClick={() => setRole(r.value)} style={{
                    display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:8, cursor:'pointer', textAlign:'left',
                    border:`1px solid ${role===r.value?r.color:'var(--border)'}`,
                    background:role===r.value?`${r.color}15`:'var(--bg-primary)',
                  }}>
                    <span style={{ width:28, height:28, borderRadius:6, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background:`${r.color}20`, color:r.color, fontSize:10, fontWeight:700 }}>
                      {r.value.slice(0,2).toUpperCase()}
                    </span>
                    <div>
                      <div style={{ fontSize:12, fontWeight:500, color:role===r.value?r.color:'var(--text-primary)' }}>{r.label}</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)' }}>{r.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {error && <div style={{ fontSize:12, color:'var(--red)', padding:'6px 10px', background:'var(--red-dim)', borderRadius:6 }}>{error}</div>}

            <button onClick={handleCreate} disabled={!name.trim()||loading}
              style={{ background:'var(--accent)', border:'none', borderRadius:8, padding:'10px 0', color:'white', fontSize:13, fontWeight:600, cursor:name.trim()&&!loading?'pointer':'not-allowed', opacity:name.trim()&&!loading?1:0.5, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              <Plus size={14}/>
              {loading ? 'Creating…' : `Add ${selectedRole.label} agent`}
            </button>
          </div>
        )}

        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )
}
