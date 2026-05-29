import { X } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export default function TabStrip() {
  const { getRecentTabs, activeSessionId, setActiveSession, closeSession } = useAppStore()
  const tabs = getRecentTabs()

  if (tabs.length < 2) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      background: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      overflowX: 'auto',
    }}>
      {tabs.map(tab => {
        const isActive = tab.id === activeSessionId
        return (
          <div
            key={tab.id}
            onClick={() => setActiveSession(tab.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minWidth: 110,
              maxWidth: 160,
              padding: '6px 10px 6px 12px',
              borderRadius: 8,
              border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
              background: isActive ? 'var(--accent-dim)' : 'var(--bg-secondary)',
              cursor: 'pointer',
              flexShrink: 0,
              position: 'relative',
              transition: 'border-color 0.15s, background 0.15s',
              boxShadow: isActive ? '0 0 0 1px var(--accent)20' : 'none',
            }}
            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)' }}
            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
          >
            {/* Title */}
            <span style={{
              fontSize: 12, fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--accent)' : 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              paddingRight: 14, lineHeight: 1.4,
            }}>
              {tab.title}
            </span>
            {/* Type */}
            <span style={{
              fontSize: 10, marginTop: 2,
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              textTransform: 'capitalize',
            }}>
              {tab.type}
            </span>
            {/* Close */}
            <button
              onClick={e => { e.stopPropagation(); closeSession(tab.id) }}
              style={{
                position: 'absolute', top: 6, right: 5,
                background: 'none', border: 'none', cursor: 'pointer',
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                display: 'flex', padding: 2, borderRadius: 3,
                opacity: 0.7,
              }}
            >
              <X size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
