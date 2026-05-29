import { useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export default function TabStrip() {
  const { getRecentTabs, activeSessionId, setActiveSession } = useAppStore()
  // Local dismissed set — tabs removed from strip but NOT deleted from history
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const allTabs = getRecentTabs()
  const tabs    = allTabs.filter(t => !dismissed.has(t.id))

  if (tabs.length < 2) return null

  function dismiss(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setDismissed(prev => new Set([...prev, id]))
  }

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
            }}
            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)' }}
            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
          >
            <span style={{
              fontSize: 12, fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--accent)' : 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              paddingRight: 14, lineHeight: 1.4,
            }}>
              {tab.title}
            </span>
            <span style={{ fontSize: 10, marginTop: 2, color: isActive ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'capitalize' }}>
              {tab.type}
            </span>
            {/* X removes from tab strip only — does NOT delete from history */}
            <button
              onClick={e => dismiss(tab.id, e)}
              title="Remove from tab strip"
              style={{
                position: 'absolute', top: 6, right: 5,
                background: 'none', border: 'none', cursor: 'pointer',
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                display: 'flex', padding: 2, borderRadius: 3, opacity: 0.7,
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
