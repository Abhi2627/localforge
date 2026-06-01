import { useState } from 'react'
import { Wifi, WifiOff, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ChevronDown, Activity, Smartphone } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import ModelAdvisor from './ModelAdvisor'
import QRPreview from './QRPreview'

export default function TopBar() {
  const {
    isConnected, models, selectedModel,
    rightExpanded, setRightExpanded,
    leftExpanded,  setLeftExpanded,
    sessions, activeSessionId, screen,
  } = useAppStore()

  const [advisorOpen, setAdvisorOpen] = useState(false)
  const [qrOpen,      setQrOpen]      = useState(false)

  const activeSession    = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = screen === 'session' && activeSession?.type === 'project'

  const modelInfo   = models.find((m: any) => m.name === selectedModel)
  const displayName = selectedModel ? selectedModel.split(':')[0] : 'No model'

  const btnBase: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
    padding: 4, borderRadius: 4, flexShrink: 0,
  }

  return (
    <>
      <div className="topbar">
        {/* Left — sidebar toggle */}
        <button style={btnBase} title={leftExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={() => setLeftExpanded(!leftExpanded)}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
        >
          {leftExpanded ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}
        </button>

        {/* Logo */}
        <span style={{ fontSize:15, fontWeight:700, color:'var(--accent)', letterSpacing:'-0.3px', flexShrink:0 }}>
          LocalForge
        </span>

        <span style={{ flex:1, minWidth:0 }} />

        {/* QR Preview button */}
        <button
          onClick={() => setQrOpen(true)}
          title="Preview on device (QR code)"
          style={{ ...btnBase, padding:'4px 6px' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'none' }}
        >
          <Smartphone size={15}/>
        </button>

        {/* Model chip → opens Model Advisor */}
        <button
          onClick={() => setAdvisorOpen(true)}
          title="Open Model Advisor"
          style={{
            display:'flex', alignItems:'center', gap:6,
            padding:'4px 10px 4px 8px',
            background:'var(--bg-tertiary)',
            border:'1px solid var(--border)',
            borderRadius:8, cursor:'pointer',
            color:'var(--text-primary)', fontSize:12, fontWeight:500,
            transition:'border-color 0.15s, background 0.15s',
            flexShrink:0, maxWidth:260,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.background = 'var(--accent-dim)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)' }}
        >
          <Activity size={12} style={{ color:'var(--accent)', flexShrink:0 }}/>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{displayName}</span>
          {modelInfo?.sizeGb && (
            <span style={{ fontSize:10, color:'var(--text-muted)', flexShrink:0 }}>{modelInfo.sizeGb}</span>
          )}
          <ChevronDown size={11} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
        </button>

        {/* Connection indicator */}
        <div title={isConnected ? 'Agent server connected' : 'Agent server disconnected'}
          style={{ display:'flex', alignItems:'center', flexShrink:0, color: isConnected ? 'var(--green)' : 'var(--red)' }}>
          {isConnected ? <Wifi size={15}/> : <WifiOff size={15}/>}
        </div>

        {/* Right sidebar toggle — project sessions only */}
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

      {advisorOpen && <ModelAdvisor onClose={() => setAdvisorOpen(false)} />}
      {qrOpen      && <QRPreview   onClose={() => setQrOpen(false)} />}
    </>
  )
}
