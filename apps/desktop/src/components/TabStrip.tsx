import { useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../store/appStore'

const MAX_TABS = 4
const CARD_W   = 160  // fixed card width px

export default function TabStrip() {
  const { sessions, activeSessionId, setActiveSession } = useAppStore()

  // Manually dismissed tabs (removed from strip, session still exists)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // Always the N most recently accessed sessions, excluding dismissed and blank
  const tabs = [...sessions]
    .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
    .filter(s => s.title && s.title.trim() !== '' && !dismissed.has(s.id))
    .slice(0, MAX_TABS)

  // When a session is deleted it disappears from sessions array → auto-removed from strip
  // When user hits X → added to dismissed → removed from strip without deleting session

  if (tabs.length < 2) return null

  function dismiss(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    setDismissed(prev => new Set([...prev, id]))
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 10px',
      background: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      overflow: 'hidden',   // no scroll ever
    }}>
      {tabs.map(tab => {
        const isActive = tab.id === activeSessionId
        return (
          <div
            key={tab.id}
            onClick={() => setActiveSession(tab.id)}
            style={{
              width: CARD_W,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '6px 10px 6px 12px',
              borderRadius: 8,
              border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
              background: isActive ? 'var(--accent-dim)' : 'var(--bg-secondary)',
              cursor: 'pointer',
              position: 'relative',
              transition: 'border-color 0.15s, background 0.15s',
              userSelect: 'none',
            }}
            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)' }}
            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
          >
            {/* Title */}
            <span style={{
              fontSize: 12,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--accent)' : 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              paddingRight: 16,
              lineHeight: 1.4,
            }}>
              {tab.title}
            </span>
            {/* Type */}
            <span style={{
              fontSize: 10,
              marginTop: 2,
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              textTransform: 'capitalize',
            }}>
              {tab.type}
            </span>
            {/* X — dismiss from strip only, does NOT delete the session */}
            <button
              onClick={e => dismiss(e, tab.id)}
              title="Remove from tab strip"
              style={{
                position: 'absolute', top: 6, right: 5,
                background: 'none', border: 'none', cursor: 'pointer',
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                display: 'flex', padding: 2, borderRadius: 3,
                opacity: 0.5,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.5' }}
            >
              <X size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
