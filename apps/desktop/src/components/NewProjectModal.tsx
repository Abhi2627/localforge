import { useState } from 'react'
import { X, FolderOpen } from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { useAppStore } from '../store/appStore'
import { nanoid } from '../hooks/nanoid'

interface Props { onClose: () => void }

export default function NewProjectModal({ onClose }: Props) {
  const { models, addSession, setActiveSession } = useAppStore()
  const [rootPath, setRootPath] = useState('')
  const [model, setModel]       = useState(models[0]?.name ?? '')
  const [error, setError]       = useState('')

  // Derive title from the last folder name in the path
  const title = rootPath ? rootPath.split('/').filter(Boolean).pop() ?? 'project' : ''

  async function pickFolder() {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Select project root folder' })
      if (typeof selected === 'string') setRootPath(selected)
    } catch {
      // Tauri not available in browser dev mode — fall back to manual input
    }
  }

  function handleCreate() {
    if (!rootPath.trim()) { setError('Please select a project folder'); return }
    const id = nanoid()
    addSession({
      id, type: 'project',
      title,
      rootPath: rootPath.trim(),
      agents: [], messages: [], writtenFiles: [],
      lastAccessedAt: Date.now(), isActive: true,
    })
    setActiveSession(id)
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24, width: 380,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>New project</span>
          <button onClick={onClose} className="icon-btn" style={{ width: 24, height: 24 }}>
            <X size={14} />
          </button>
        </div>

        {/* Folder picker */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Create a folder on your machine first, then select it here — just like opening a folder in VS Code.
          </div>
          <button onClick={pickFolder} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', padding: '10px 14px',
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
            borderRadius: 8, cursor: 'pointer', transition: 'border-color 0.15s',
            color: rootPath ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'}
          >
            <FolderOpen size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', flex: 1, fontFamily: rootPath ? 'monospace' : 'inherit' }}>
              {rootPath || 'Select project folder…'}
            </span>
          </button>
          {rootPath && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, paddingLeft: 2 }}>
              Project title: <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{title}</span>
            </div>
          )}
        </div>

        {/* Model selector — only when 2+ models */}
        {models.length > 1 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>Model</div>
            <select value={model} onChange={e => setModel(e.target.value)} style={{
              width: '100%', background: 'var(--bg-primary)',
              border: '1px solid var(--border)', borderRadius: 7,
              padding: '8px 10px', color: 'var(--text-primary)',
              fontSize: 12, outline: 'none', cursor: 'pointer',
            }}>
              {models.map(m => (
                <option key={m.name} value={m.name}>{m.name} ({m.sizeGb})</option>
              ))}
            </select>
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}

        <button onClick={handleCreate} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 8,
          padding: '10px 0', color: 'white', fontSize: 13,
          fontWeight: 600, cursor: 'pointer', width: '100%',
          opacity: rootPath ? 1 : 0.5,
        }}>
          Create project
        </button>
      </div>
    </div>
  )
}
