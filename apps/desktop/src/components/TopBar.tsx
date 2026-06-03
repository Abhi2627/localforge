import { useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Smartphone } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import QRPreview from './QRPreview'

export default function TopBar() {
  const {
    isConnected, isOnline,
    rightExpanded, setRightExpanded,
    leftExpanded,  setLeftExpanded,
    sessions, activeSessionId, screen,
  } = useAppStore()

  const [qrOpen, setQrOpen] = useState(false)

  const activeSession    = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = screen === 'session' && activeSession?.type === 'project'

  const btnBase: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
    padding: 4, borderRadius: 4, flexShrink: 0,
  }

  return (
    <>
      <div className="topbar">
        {/* Left sidebar toggle */}
        <button style={btnBase}
          title={leftExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={() => setLeftExpanded(!leftExpanded)}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
        >
          {leftExpanded ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}
        </button>

        {/* App name */}
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.3px', flexShrink: 0 }}>
          LocalForge
        </span>

        <span style={{ flex: 1, minWidth: 0 }}/>

        {/* QR preview — disabled when offline */}
        <button
          onClick={() => isOnline && setQrOpen(true)}
          title={isOnline ? 'Preview on device' : 'No internet connection'}
          style={{
            ...btnBase, padding: '4px 6px',
            opacity: isOnline ? 1 : 0.35,
            cursor:  isOnline ? 'pointer' : 'not-allowed',
          }}
          onMouseEnter={e => { if (isOnline) (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
        >
          <Smartphone size={15}/>
        </button>

        {/* ── Connectivity card ── */}
        {/* Internet status */}
        <div
          title={isOnline ? 'Internet connected' : 'No internet — cloud providers disabled'}
          style={{
            display: 'flex', alignItems: 'center',
            padding: '3px 9px', borderRadius: 6,
            background: isOnline ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${isOnline ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
            flexShrink: 0,
          }}
        >
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: isOnline ? 'var(--green)' : 'var(--red)',
            letterSpacing: '0.02em',
          }}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>

        {/* Server status — separate small pill */}
        <div
          title={isConnected ? 'Agent server running' : 'Agent server disconnected'}
          style={{
            display: 'flex', alignItems: 'center',
            padding: '3px 9px', borderRadius: 6,
            background: isConnected ? 'rgba(139,92,246,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${isConnected ? 'rgba(139,92,246,0.35)' : 'rgba(239,68,68,0.35)'}`,
            flexShrink: 0,
          }}
        >
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: isConnected ? 'var(--accent)' : 'var(--red)',
            letterSpacing: '0.02em',
          }}>
            {isConnected ? 'Server' : 'No server'}
          </span>
        </div>

        {/* Right sidebar toggle */}
        {isProjectSession && (
          <button style={btnBase}
            title={rightExpanded ? 'Collapse right bar' : 'Expand right bar'}
            onClick={() => setRightExpanded(!rightExpanded)}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
          >
            {rightExpanded ? <PanelRightClose size={15}/> : <PanelRightOpen size={15}/>}
          </button>
        )}
      </div>

      {qrOpen && <QRPreview onClose={() => setQrOpen(false)}/>}
    </>
  )
}
