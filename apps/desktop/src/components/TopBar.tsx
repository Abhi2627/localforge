import { Wifi, WifiOff, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { api } from '../hooks/useApi'

export default function TopBar() {
  const {
    isConnected, models, selectedModel, setSelectedModel,
    rightExpanded, setRightExpanded,
    leftExpanded,  setLeftExpanded,
    sessions, activeSessionId, screen,
  } = useAppStore()

  const activeSession    = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = screen === 'session' && activeSession?.type === 'project'

  async function handleModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const model = e.target.value
    await api.selectModel(model)
    setSelectedModel(model)
  }

  return (
    <div className="topbar">
      <button
        className="icon-btn"
        title={leftExpanded ? 'Collapse left bar' : 'Expand left bar'}
        onClick={() => setLeftExpanded(!leftExpanded)}
      >
        {leftExpanded ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
      </button>

      <span style={{
        fontSize: 15, fontWeight: 700, color: 'var(--accent)',
        letterSpacing: '-0.3px', flexShrink: 0,
      }}>
        LocalForge
      </span>

      <span style={{ flex: 1, minWidth: 0 }} />

      <select
        className="model-select"
        value={selectedModel}
        onChange={handleModelChange}
        title={selectedModel}
      >
        {models.length === 0 && (
          <option value="">No models — ollama pull qwen2.5-coder</option>
        )}
        {models.map(m => (
          <option key={m.name} value={m.name}>{m.name} ({m.sizeGb})</option>
        ))}
      </select>

      <div
        title={isConnected ? 'Agent server connected' : 'Agent server disconnected'}
        style={{
          display: 'flex', alignItems: 'center', flexShrink: 0,
          color: isConnected ? 'var(--green)' : 'var(--red)',
        }}
      >
        {isConnected ? <Wifi size={15} /> : <WifiOff size={15} />}
      </div>

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
  )
}
