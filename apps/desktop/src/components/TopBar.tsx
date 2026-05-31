import { useState } from 'react'
import { Wifi, WifiOff, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ChevronDown, Activity } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import ModelAdvisor from './ModelAdvisor'

export default function TopBar() {
  const {
    isConnected, models, selectedModel,
    rightExpanded, setRightExpanded,
    leftExpanded,  setLeftExpanded,
    sessions, activeSessionId, screen,
  } = useAppStore()

  const [advisorOpen, setAdvisorOpen] = useState(false)

  const activeSession    = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = screen === 'session' && activeSession?.type === 'project'

  // Find full model info for display
  const modelInfo = models.find(m => m.name === selectedModel)
  const displayName = selectedModel
    ? selectedModel.split(':')[0]   // "qwen2.5-coder" from "qwen2.5-coder:latest"
    : 'No model'

  return (
    <>
      <div className="topbar">
        <button
          className="icon-btn"
          title={leftExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={() => setLeftExpanded(!leftExpanded)}
        >
          {leftExpanded ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>

        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.3px', flexShrink: 0 }}>
          LocalForge
        </span>

        <span style={{ flex: 1, minWidth: 0 }} />

        {/* Model chip — click to open advisor */}
        <button
          onClick={() => setAdvisorOpen(true)}
          title="Open Model Advisor"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px 4px 8px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            cursor: 'pointer',
            color: 'var(--text-primary)',
            fontSize: 12,
            fontWeight: 500,
            transition: 'border-color 0.15s, background 0.15s',
            flexShrink: 0,
            maxWidth: 260,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
            ;(e.currentTarget as HTMLElement).style.background = 'var(--accent-dim)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
            ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)'
          }}
        >
          <Activity size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
          </span>
          {modelInfo?.sizeGb && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
              {modelInfo.sizeGb}
            </span>
          )}
          <ChevronDown size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        </button>

        {/* Connection indicator */}
        <div
          title={isConnected ? 'Agent server connected' : 'Agent server disconnected'}
          style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: isConnected ? 'var(--green)' : 'var(--red)' }}
        >
          {isConnected ? <Wifi size={15} /> : <WifiOff size={15} />}
        </div>

        {/* Right sidebar toggle */}
        {isProjectSession && (
          <button
            className="icon-btn"
            title={rightExpanded ? 'Collapse right bar' : 'Expand right bar'}
            onClick={() => setRightExpanded(!rightExpanded)}
          >
            {rightExpanded ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        )}
      </div>

      {/* Model Advisor modal */}
      {advisorOpen && <ModelAdvisor onClose={() => setAdvisorOpen(false)} />}
    </>
  )
}
