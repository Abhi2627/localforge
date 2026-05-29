import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { useAppStore, type AgentRole } from '../store/appStore'
import { api } from '../hooks/useApi'

interface Props {
  sessionId: string
  projectId: string   // backend project id (may differ from session id)
  onClose: () => void
}

const ROLES: { value: AgentRole; label: string; desc: string; color: string }[] = [
  { value: 'fullstack',  label: 'Fullstack',  desc: 'Builds both frontend and backend code', color: 'var(--accent)' },
  { value: 'frontend',   label: 'Frontend',   desc: 'React, TypeScript, CSS — UI only',       color: 'var(--green)' },
  { value: 'backend',    label: 'Backend',    desc: 'API, database, server logic',             color: 'var(--amber)' },
  { value: 'test',       label: 'Test',       desc: 'Writes tests — Vitest, Jest, Playwright', color: 'var(--red)' },
  { value: 'review',     label: 'Review',     desc: 'Reads code and gives structured feedback', color: 'var(--text-secondary)' },
]

export default function AgentModal({ sessionId, projectId, onClose }: Props) {
  const { addAgent } = useAppStore()
  const [name, setName]   = useState('')
  const [role, setRole]   = useState<AgentRole>('fullstack')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!name.trim()) { setError('Agent name is required'); return }
    setLoading(true)
    setError('')
    try {
      const { agent } = await api.createAgent(projectId, name.trim(), role)
      addAgent(sessionId, {
        id:     agent.id,
        name:   agent.name,
        role:   agent.role,
        status: 'idle',
      })
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const selectedRole = ROLES.find(r => r.value === role)!

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24, width: 400,
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Add agent</span>
          <button onClick={onClose} className="icon-btn" style={{ width: 24, height: 24 }}><X size={14} /></button>
        </div>

        {/* Name */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>Agent name</div>
          <input
            autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="e.g. Dev, Frontend, Tester…"
            style={{
              width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 7, padding: '8px 10px', color: 'var(--text-primary)',
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
            onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
            onBlur={e  => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'}
          />
        </div>

        {/* Role selector */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>Role</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ROLES.map(r => (
              <button key={r.value} onClick={() => setRole(r.value)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${role === r.value ? r.color : 'var(--border)'}`,
                background: role === r.value ? `${r.color}15` : 'var(--bg-primary)',
                transition: 'all 0.15s', textAlign: 'left',
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `${r.color}20`, color: r.color,
                  fontSize: 10, fontWeight: 700,
                }}>
                  {r.value.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: role === r.value ? r.color : 'var(--text-primary)' }}>
                    {r.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--red)', padding: '6px 10px', background: 'var(--red-dim)', borderRadius: 6 }}>
            {error}
          </div>
        )}

        <button onClick={handleCreate} disabled={!name.trim() || loading} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 8,
          padding: '10px 0', color: 'white', fontSize: 13, fontWeight: 600,
          cursor: name.trim() && !loading ? 'pointer' : 'not-allowed',
          opacity: name.trim() && !loading ? 1 : 0.5, width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Plus size={14} />
          {loading ? 'Creating…' : `Add ${selectedRole.label} agent`}
        </button>
      </div>
    </div>
  )
}
