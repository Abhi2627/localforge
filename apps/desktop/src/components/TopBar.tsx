import { useState } from 'react'
import { Wifi, WifiOff, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Smartphone } from 'lucide-react'
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

  // Show red if either server is disconnected OR internet is offline
  // Green only when both are fine
  const serverOk  = isConnected
  const netOk     = isOnline

  const btnBase: React.CSSProperties = {
    background:'none', border:'none', cursor:'pointer',
    color:'var(--text-muted)', display:'flex', alignItems:'center',
    padding:4, borderRadius:4, flexShrink:0,
  }

  return (
    <>
      <div className="topbar">
        {/* Left sidebar toggle */}
        <button style={btnBase} title={leftExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={() => setLeftExpanded(!leftExpanded)}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
        >
          {leftExpanded ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}
        </button>

        {/* App name */}
        <span style={{ fontSize:15, fontWeight:700, color:'var(--accent)', letterSpacing:'-0.3px', flexShrink:0 }}>
          LocalForge
        </span>

        <span style={{ flex:1, minWidth:0 }}/>

        {/* QR Preview — only useful when online */}
        <button
          onClick={() => netOk && setQrOpen(true)}
          title={netOk ? 'Preview on device' : 'No internet connection'}
          style={{
            ...btnBase, padding:'4px 6px',
            opacity: netOk ? 1 : 0.35,
            cursor:  netOk ? 'pointer' : 'not-allowed',
          }}
          onMouseEnter={e => { if (netOk) (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
        >
          <Smartphone size={15}/>
        </button>

        {/* Connectivity indicator — two-state: server + internet */}
        <div style={{ display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
          {/* Internet */}
          <div
            title={netOk ? 'Internet connected' : 'No internet — cloud providers unavailable'}
            style={{ display:'flex', alignItems:'center', color: netOk ? 'var(--green)' : 'var(--red)' }}
          >
            {netOk ? <Wifi size={15}/> : <WifiOff size={15}/>}
          </div>
          {/* Server — small dot beside the wifi icon */}
          <div
            title={serverOk ? 'Agent server connected' : 'Agent server disconnected'}
            style={{ width:6, height:6, borderRadius:'50%', background: serverOk ? 'var(--green)' : 'var(--red)', flexShrink:0,
              boxShadow: serverOk ? '0 0 4px var(--green)' : 'none' }}
          />
        </div>

        {/* Right sidebar toggle */}
        {isProjectSession && (
          <button style={btnBase} title={rightExpanded ? 'Collapse right bar' : 'Expand right bar'}
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
