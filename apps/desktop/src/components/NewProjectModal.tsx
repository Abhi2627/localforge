import { useState } from 'react'
import { X, FolderOpen, Loader } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { api } from '../hooks/useApi'
import { nanoid } from '../hooks/nanoid'

interface Props { onClose: () => void }

async function pickFolder(): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({ directory: true, multiple: false, title: 'Select project root folder' })
    return typeof result === 'string' ? result : null
  } catch {
    const path = window.prompt('Enter project root path (Tauri not available in browser):')
    return path || null
  }
}

export default function NewProjectModal({ onClose }: Props) {
  const { models, selectedModel, addSession, setActiveSession, setAllFiles, sessions } = useAppStore()
  const [rootPath, setRootPath] = useState('')
  const [model, setModel]       = useState(selectedModel || models[0]?.name || '')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const title = rootPath
    ? rootPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'project'
    : ''

  async function handlePickFolder() {
    const selected = await pickFolder()
    if (selected) { setRootPath(selected); setError('') }
  }

  async function handleOpen() {
    if (!rootPath.trim()) { setError('Please select a project folder'); return }
    setLoading(true)
    setError('')

    try {
      // Reuse an existing project session for the SAME folder instead of creating
      // a new empty one — otherwise reopening a project loses its chat history.
      const norm = (p?: string) => (p ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
      const target = norm(rootPath.trim())
      const existing = sessions.find(s => s.type === 'project' && norm(s.rootPath) === target)
      if (existing) {
        setActiveSession(existing.id)
        // Re-scan files + reconnect MCP/orchestrator for the restored session
        api.openProject(existing.id, rootPath.trim())
          .then(result => { if (result.fileList?.length) setAllFiles(existing.id, result.fileList) })
          .catch(console.error)
        onClose()
        return
      }

      const id = nanoid()

      // Register with backend orchestrator first (needed for agent creation)
      await api.createProject(title, rootPath.trim()).catch(() => {})

      // Persist session to DB
      await api.createSession(id, 'project', title, rootPath.trim(), model)

      // Add to UI store
      addSession({
        id, type: 'project', title,
        rootPath: rootPath.trim(),
        agents: [], messages: [], allFiles: [], writtenFiles: [],
        lastAccessedAt: Date.now(), isActive: true,
      })
      setActiveSession(id)

      // Scan existing files + generate summary in background
      api.openProject(id, rootPath.trim()).then(result => {
        if (result.fileList?.length) setAllFiles(id, result.fileList)
      }).catch(console.error)

      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 380, display: 'flex', flexDirection: 'column', gap: 18 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Open project</span>
          <button onClick={onClose} className="icon-btn" style={{ width: 24, height: 24 }}><X size={14} /></button>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
            Create a folder on your machine first, then select it here.
          </div>
          <button onClick={handlePickFolder} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px',
            background: 'var(--bg-primary)', border: `1px solid ${rootPath ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 8, cursor: 'pointer', color: rootPath ? 'var(--text-primary)' : 'var(--text-muted)',
          }}>
            <FolderOpen size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left', fontFamily: rootPath ? 'monospace' : 'inherit' }}>
              {rootPath || 'Select project folder…'}
            </span>
          </button>
          {rootPath && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, paddingLeft: 2 }}>
              Project name: <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{title}</span>
            </div>
          )}
        </div>

        {models.length > 1 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>Model</div>
            <select value={model} onChange={e => setModel(e.target.value)} style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px', color: 'var(--text-primary)', fontSize: 12, outline: 'none', cursor: 'pointer' }}>
              {models.map(m => <option key={m.name} value={m.name}>{m.name} ({m.sizeGb})</option>)}
            </select>
          </div>
        )}

        {error && (
          <div style={{ fontSize: 12, color: 'var(--red)', padding: '6px 10px', background: 'var(--red-dim)', borderRadius: 6 }}>{error}</div>
        )}

        <button onClick={handleOpen} disabled={!rootPath || loading} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '10px 0',
          color: 'white', fontSize: 13, fontWeight: 600,
          cursor: rootPath && !loading ? 'pointer' : 'not-allowed',
          width: '100%', opacity: rootPath && !loading ? 1 : 0.5,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          {loading && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
          {loading ? 'Opening…' : 'Open project'}
        </button>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
