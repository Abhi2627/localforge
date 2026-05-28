import { X, MessageCircle, FolderOpen, Terminal } from 'lucide-react'
import { useAppStore } from '../store/appStore'

const TYPE_ICONS: Record<string, any> = { chat: MessageCircle, project: FolderOpen, terminal: Terminal }
const TYPE_COLORS: Record<string, string> = { chat: 'var(--accent)', project: 'var(--green)', terminal: 'var(--amber)' }

export default function TabStrip() {
  const { getRecentTabs, activeSessionId, setActiveSession, closeSession } = useAppStore()
  const tabs = getRecentTabs()

  // Occupy zero space when nothing to show
  if (tabs.length < 2) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 3,
      padding: '0 10px', background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)', overflowX: 'auto',
      flexShrink: 0, height: 36,
    }}>
      {tabs.map(tab => {
        const isActive = tab.id === activeSessionId
        const Icon     = TYPE_ICONS[tab.type]
        const color    = TYPE_COLORS[tab.type]
        return (
          <div key={tab.id} onClick={() => setActiveSession(tab.id)} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 8px 4px 10px', borderRadius: 6,
            background: isActive ? 'var(--bg-primary)' : 'transparent',
            border: isActive ? '1px solid var(--border)' : '1px solid transparent',
            cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s',
          }}>
            <Icon size={11} style={{ color, flexShrink: 0 }} />
            <span style={{
              fontSize: 12, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {tab.title}
            </span>
            <span style={{
              fontSize: 9, color, background: `${color}18`,
              borderRadius: 3, padding: '1px 4px',
              textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em',
            }}>
              {tab.type}
            </span>
            <button onClick={e => { e.stopPropagation(); closeSession(tab.id) }} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', display: 'flex', padding: 1, borderRadius: 3, marginLeft: 1,
            }}>
              <X size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
