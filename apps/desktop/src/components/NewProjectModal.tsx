import { useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { api } from '../hooks/useApi'
import { nanoid } from '../hooks/nanoid'

interface Props { onClose: () => void }

const ROLES = ['fullstack', 'frontend', 'backend', 'test'] as const

export default function NewProjectModal({ onClose }: Props) {
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [agentName, setAgentName] = useState('Dev')
  const [agentRole, setAgentRole] = useState<string>('fullstack')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { addProject, setActiveProject, addAgent } = useAppStore()

  async function handleCreate() {
    if (!name.trim() || !rootPath.trim()) {
      setError('Project name and path are required')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { project } = await api.createProject(name.trim(), rootPath.trim())
      addProject({
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        agents: [],
        messages: [],
        writtenFiles: [],
        isActive: true
      })
      setActiveProject(project.id)

      // Auto-create first agent
      const { agent } = await api.createAgent(project.id, agentName, agentRole)
      addAgent(project.id, {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: 'idle'
      })

      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
    }}>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 24, width: 420, display: 'flex', flexDirection: 'column', gap: 14
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>New Project</span>
          <button className="icon-btn" onClick={onClose}><X size={15} /></button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Project name</span>
          <input
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '7px 10px', color: 'var(--text-primary)',
              fontSize: 13, outline: 'none' }}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="my-app"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Project root path</span>
          <input
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '7px 10px', color: 'var(--text-primary)',
              fontSize: 13, outline: 'none', fontFamily: 'monospace' }}
            value={rootPath}
            onChange={e => setRootPath(e.target.value)}
            placeholder="/Users/you/Projects/my-app"
          />
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
            <span style={{ color: 'var(--text-secondary)' }}>First agent name</span>
            <input
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '7px 10px', color: 'var(--text-primary)',
                fontSize: 13, outline: 'none' }}
              value={agentName}
              onChange={e => setAgentName(e.target.value)}
              placeholder="Dev"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Role</span>
            <select
              className="model-select"
              style={{ padding: '7px 10px', fontSize: 13 }}
              value={agentRole}
              onChange={e => setAgentRole(e.target.value)}
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}

        <button
          onClick={handleCreate}
          disabled={loading}
          style={{
            background: 'var(--accent)', color: 'white', border: 'none',
            borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1
          }}
        >
          {loading ? 'Creating…' : 'Create Project'}
        </button>
      </div>
    </div>
  )
}
