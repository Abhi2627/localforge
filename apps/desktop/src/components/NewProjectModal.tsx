import { useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { nanoid } from '../hooks/nanoid'

interface Props { onClose: () => void }

export default function NewProjectModal({ onClose }: Props) {
  const { models, addSession, setActiveSession } = useAppStore()
  const [title, setTitle]       = useState('')
  const [rootPath, setRootPath] = useState('')
  const [model, setModel]       = useState(models[0]?.name ?? '')
  const [error, setError]       = useState('')

  function handleCreate() {
    if (!title.trim())    { setError('Project title is required'); return }
    if (!rootPath.trim()) { setError('Project path is required');  return }
    const id = nanoid()
    addSession({
      id, type: 'project',
      title: title.trim(),
      rootPath: rootPath.trim(),
      agents: [], messages: [], writtenFiles: [],
      lastAccessedAt: Date.now(), isActive: true,
    })
    setActiveSession(id)
    onClose()
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleCreate()
    if (e.key === 'Escape') onClose()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg-primary)',
    border: '1px solid var(--border)', borderRadius: 7,
    padding: '8px 10px', color: 'var(--text-primary)',
    fontSize: 13, outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--text-secondary)',
    marginBottom: 5, display: 'block',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24, width: 400,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>New project</span>
          <button onClick={onClose} className="icon-btn" style={{ width: 24, height: 24 }}><X size={14} /></button>
        </div>

        <div>
          <label style={labelStyle}>Project title</label>
          <input
            autoFocus style={inputStyle} placeholder="my-app"
            value={title} onChange={e => setTitle(e.target.value)} onKeyDown={onKey}
            onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
            onBlur={e  => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'}
          />
        </div>

        <div>
          <label style={labelStyle}>Project root path</label>
          <input
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
            placeholder="/Users/you/Projects/my-app"
            value={rootPath} onChange={e => setRootPath(e.target.value)} onKeyDown={onKey}
            onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
            onBlur={e  => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'}
          />
        </div>

        {/* Model selector — only shown when multiple models available */}
        {models.length > 1 && (
          <div>
            <label style={labelStyle}>Model</label>
            <select
              value={model} onChange={e => setModel(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {models.map(m => (
                <option key={m.name} value={m.name}>{m.name} ({m.sizeGb})</option>
              ))}
            </select>
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}

        <button onClick={handleCreate} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 8,
          padding: '9px 0', color: 'white', fontSize: 13,
          fontWeight: 600, cursor: 'pointer', width: '100%',
        }}>
          Create project
        </button>
      </div>
    </div>
  )
}
