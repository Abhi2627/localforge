import { X } from 'lucide-react'
import { useAppStore } from '../store/appStore'

// Max number of tabs to show — fits comfortably at any window width
const MAX_TABS = 4

export default function TabStrip() {
  const { sessions, activeSessionId, setActiveSession } = useAppStore()

  // Always derive tabs directly from sessions sorted by lastAccessedAt descending
  // No ref, no dismissed set — the strip purely reflects "most recently active"
  // Deleted sessions automatically disappear because they're removed from `sessions`
  const tabs = [...sessions]
    .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
    .slice(0, MAX_TABS)          // keep only the N most recent
    .filter(s => s.title && s.title.trim() !== '')

  // Don't render when there's only 0 or 1 session — no point showing a strip
  if (tabs.length < 2) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      height: 48,
      overflow: 'hidden',   // never scroll — cards fill available width equally
    }}>
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeSessionId
        const isLast   = i === tabs.length - 1

        return (
          <div
            key={tab.id}
            onClick={() => setActiveSession(tab.id)}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '0 12px',
              borderRight: isLast ? 'none' : '1px solid var(--border)',
              borderTop: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              background: isActive ? 'var(--accent-dim)' : 'transparent',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.12s',
              userSelect: 'none',
            }}
            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            {/* Title */}
            <span style={{
              fontSize: 12,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--accent)' : 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.4,
            }}>
              {tab.title}
            </span>
            {/* Type */}
            <span style={{
              fontSize: 10,
              marginTop: 1,
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              textTransform: 'capitalize',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {tab.type}
            </span>
          </div>
        )
      })}
    </div>
  )
}
