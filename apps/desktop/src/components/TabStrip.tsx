import { useRef } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export default function TabStrip() {
  const { sessions, activeSessionId, setActiveSession, getRecentTabs } = useAppStore()

  // Stable insertion-order list — only IDs that still exist in sessions
  const orderRef = useRef<string[]>([])

  const recentIds = new Set(getRecentTabs().map(t => t.id))
  const sessionIds = new Set(sessions.map(s => s.id))

  // Add new recent IDs in order — never reorder existing
  getRecentTabs().forEach(t => {
    if (!orderRef.current.includes(t.id)) orderRef.current.push(t.id)
  })
  // Remove IDs that no longer exist in the sessions array (deleted)
  orderRef.current = orderRef.current.filter(id => sessionIds.has(id))

  // Only show IDs that are recent AND still exist
  const tabIds = orderRef.current.filter(id => recentIds.has(id))
  const tabMap  = Object.fromEntries(sessions.map(s => [s.id, s]))
  const tabs    = tabIds.map(id => tabMap[id]).filter(Boolean)

  // Don't render if fewer than 2 tabs
  if (tabs.length < 2) return null

  function removeFromStrip(id: string) {
    orderRef.current = orderRef.current.filter(x => x !== id)
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      background: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      height: 52,
      // No overflow — tabs share the available width equally
      overflow: 'hidden',
    }}>
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeSessionId
        const isLast   = i === tabs.length - 1
        return (
          <div
            key={tab.id}
            onClick={() => setActiveSession(tab.id)}
            style={{
              flex: 1,                    // equal width sharing
              minWidth: 0,               // allow shrinking below content size
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '0 10px 0 12px',
              borderRight: isLast ? 'none' : '1px solid var(--border)',
              borderBottom: isActive ? `2px solid var(--accent)` : '2px solid transparent',
              background: isActive ? 'var(--accent-dim)' : 'transparent',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.15s',
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
              paddingRight: 16,
              lineHeight: 1.4,
            }}>
              {tab.title}
            </span>
            {/* Type badge */}
            <span style={{
              fontSize: 10,
              marginTop: 2,
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              textTransform: 'capitalize',
            }}>
              {tab.type}
            </span>
            {/* Remove from strip — does NOT delete the session */}
            <button
              onClick={e => { e.stopPropagation(); removeFromStrip(tab.id) }}
              title="Remove from tab strip"
              style={{
                position: 'absolute', top: 8, right: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                display: 'flex', padding: 2, borderRadius: 3, opacity: 0,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0' }}
            >
              <X size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
