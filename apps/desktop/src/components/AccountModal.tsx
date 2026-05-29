import { useState, useEffect } from 'react'
import { X, User } from 'lucide-react'
import { useAppStore } from '../store/appStore'

const STORAGE_KEY = 'localforge_username'

interface Props { onClose: () => void }

export default function AccountModal({ onClose }: Props) {
  const { userName, setUserName } = useAppStore()
  const [draft, setDraft] = useState(userName)

  // Load saved name from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && !userName) {
      setUserName(saved)
      setDraft(saved)
    }
  }, [])

  function handleSave() {
    const name = draft.trim()
    setUserName(name)
    localStorage.setItem(STORAGE_KEY, name)
    onClose()
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24, width: 360,
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Account</span>
          </div>
          <button onClick={onClose} className="icon-btn" style={{ width: 24, height: 24 }}>
            <X size={14} />
          </button>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
            What should LocalForge call you? The model will use this name when addressing you.
          </div>
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder="Enter your name…"
            style={{
              width: '100%', background: 'var(--bg-primary)',
              border: '1px solid var(--border)', borderRadius: 7,
              padding: '9px 12px', color: 'var(--text-primary)',
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
            onBlur={e  => (e.target as HTMLInputElement).style.borderColor = 'var(--border)'}
          />
          {draft.trim() && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, paddingLeft: 2 }}>
              Preview: <span style={{ color: 'var(--text-secondary)' }}>Welcome onboard, <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{draft.trim()}</span></span>
            </div>
          )}
        </div>

        <button onClick={handleSave} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 8,
          padding: '9px 0', color: 'white', fontSize: 13,
          fontWeight: 600, cursor: 'pointer', width: '100%',
        }}>
          Save
        </button>
      </div>
    </div>
  )
}
