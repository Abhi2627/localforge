import { Wifi, WifiOff } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { api } from '../hooks/useApi'

export default function TopBar() {
  const { isConnected, models, selectedModel, setSelectedModel } = useAppStore()

  async function handleModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const model = e.target.value
    await api.selectModel(model)
    setSelectedModel(model)
  }

  return (
    <div className="topbar">
      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.3px' }}>
        LocalForge
      </span>
      <span style={{ flex: 1 }} />

      <select className="model-select" value={selectedModel} onChange={handleModelChange}>
        {models.length === 0 && (
          <option value="">No models — run: ollama pull qwen2.5-coder</option>
        )}
        {models.map(m => (
          <option key={m.name} value={m.name}>
            {m.name} ({m.sizeGb})
          </option>
        ))}
      </select>

      {/* Connection indicator — icon only, color tells the story */}
      <div title={isConnected ? 'Server connected' : 'Server disconnected'}
        style={{ display: 'flex', alignItems: 'center', color: isConnected ? 'var(--green)' : 'var(--red)' }}>
        {isConnected ? <Wifi size={15} /> : <WifiOff size={15} />}
      </div>
    </div>
  )
}
