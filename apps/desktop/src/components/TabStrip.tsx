import { X } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export default function TabStrip() {
  const { getRecentTabs, activeSessionId, setActiveSession, closeSession } = useAppStore()
  const tabs = getRecentTabs()

  if (tabs.length < 2) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      height: 48,
      overflowX: 'auto',
      overflowY: 'hidden',
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
              minWidth: 120,
              maxWidth: 180,
              padding: '0 10px',
              cursor: 'pointer',
              flexShrink: 0,
              position: 'relative',
              background: isActive ? 'var(--bg-primary)' : 'transparent',
              borderRight: '1px solid var(--border)',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            {/* Title */}
            <span style={{
              fontSize: 12, fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              paddingRight: 16,
            }}>
              {tab.title}
            </span>

            {/* Type label below title */}
            <span style={{
              fontSize: 10,
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              textTransform: 'capitalize',
              marginTop: 1,
            }}>
              {tab.type}
            </span>

            {/* Close button — top right */}
            <button
              onClick={e => { e.stopPropagation(); closeSession(tab.id) }}
              style={{
                position: 'absolute', top: 6, right: 4,
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', display: 'flex', padding: 2, borderRadius: 3,
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
