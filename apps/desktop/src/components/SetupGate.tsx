import { useState, useEffect } from 'react'
import { Loader, CheckCircle, AlertCircle, Download, ChevronRight, RefreshCw } from 'lucide-react'

interface Props {
  onComplete: () => void  // called when user has at least one model or API key
}

interface SetupState {
  ollamaRunning:  boolean
  models:         string[]
  apiKeys:        Record<string, boolean>
  checking:       boolean
}

const CLOUD_PROVIDERS = [
  { id: 'gemini', name: 'Gemini',  color: '#4285f4', free: true,  note: 'Free tier: 15 RPM / 1M TPD' },
  { id: 'groq',   name: 'Groq',    color: '#8b5cf6', free: true,  note: 'Free tier: 30 RPM / 6K TPM' },
  { id: 'openai', name: 'OpenAI',  color: '#10b981', free: false, note: 'Pay-as-you-go' },
  { id: 'claude', name: 'Claude',  color: '#d97706', free: false, note: 'Pay-as-you-go' },
]

const RECOMMENDED_MODELS = [
  { name: 'qwen2.5-coder:7b',  size: '4.7 GB', note: 'Best for code — recommended' },
  { name: 'qwen2.5-coder:1.5b',size: '1.1 GB', note: 'Fast, low RAM (8 GB works)' },
  { name: 'llama3.2:3b',       size: '2.0 GB', note: 'Good general chat' },
  { name: 'mistral:7b',        size: '4.1 GB', note: 'Fast and capable' },
]

export default function SetupGate({ onComplete }: Props) {
  const [state,        setState]        = useState<SetupState>({ ollamaRunning: false, models: [], apiKeys: {}, checking: true })
  const [activeTab,    setActiveTab]    = useState<'local' | 'cloud'>('local')
  const [pulling,      setPulling]      = useState<string | null>(null)
  const [pullProgress, setPullProgress] = useState<string>('')
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({})
  const [savingKey,    setSavingKey]    = useState<string | null>(null)
  const [savedKey,     setSavedKey]     = useState<string | null>(null)

  async function checkStatus() {
    setState(s => ({ ...s, checking: true }))
    try {
      const [modelsRes, settingsRes] = await Promise.all([
        fetch('http://localhost:3001/ollama/models').catch(() => null),
        fetch('http://localhost:3001/settings').catch(() => null),
      ])
      const modelsData   = modelsRes?.ok   ? await modelsRes.json()   : {}
      const settingsData = settingsRes?.ok ? await settingsRes.json() : {}
      const models       = (modelsData.models ?? []).map((m: any) => m.name as string)
      const apiKeys      = settingsData.apiKeyStatus ?? {}
      const ollamaOk     = modelsRes?.ok ?? false
      setState({ ollamaRunning: ollamaOk, models, apiKeys, checking: false })

      // If user now has at least one model or API key, let them in
      if (models.length > 0 || Object.values(apiKeys).some(Boolean)) {
        onComplete()
      }
    } catch {
      setState(s => ({ ...s, checking: false }))
    }
  }

  useEffect(() => { checkStatus() }, []) // eslint-disable-line

  // Poll every 3s while checking
  useEffect(() => {
    const interval = setInterval(checkStatus, 3000)
    return () => clearInterval(interval)
  }, []) // eslint-disable-line

  async function pullModel(modelName: string) {
    setPulling(modelName); setPullProgress('Starting download…')
    try {
      const res = await fetch('http://localhost:3001/ollama/pull', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
      })
      if (!res.ok || !res.body) { setPullProgress('Failed to start pull'); return }
      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = dec.decode(value).split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const d = JSON.parse(line)
            if (d.total && d.completed) {
              const pct = Math.round((d.completed / d.total) * 100)
              setPullProgress(`${d.status ?? 'Downloading'} ${pct}%`)
            } else if (d.status) {
              setPullProgress(d.status)
            }
          } catch { }
        }
      }
      setPullProgress('Done!')
      setTimeout(() => { setPulling(null); setPullProgress(''); checkStatus() }, 800)
    } catch (e: any) {
      setPullProgress(`Error: ${e.message}`)
      setTimeout(() => { setPulling(null); setPullProgress('') }, 2000)
    }
  }

  async function saveApiKey(providerId: string) {
    const key = apiKeyInputs[providerId]?.trim()
    if (!key) return
    setSavingKey(providerId)
    try {
      await fetch('http://localhost:3001/settings/apikey', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey: key }),
      })
      setSavedKey(providerId)
      setTimeout(() => setSavedKey(null), 2000)
      await checkStatus()
    } catch { }
    setSavingKey(null)
  }

  const hasModel  = state.models.length > 0
  const hasApiKey = Object.values(state.apiKeys).some(Boolean)
  const canProceed = hasModel || hasApiKey

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)', padding: '24px',
      fontFamily: 'inherit',
    }}>
      {/* Logo + title */}
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.5px', marginBottom: 6 }}>
          LocalForge
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.6 }}>
          To get started, you need at least one AI model.<br/>
          Choose a local model (free, runs on your machine) or a cloud provider.
        </div>
      </div>

      {/* Main card */}
      <div style={{
        width: '100%', maxWidth: 520,
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {(['local', 'cloud'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '12px', border: 'none', cursor: 'pointer', fontSize: 13,
                fontWeight: activeTab === tab ? 600 : 400,
                background: activeTab === tab ? 'var(--bg-primary)' : 'transparent',
                color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
              {tab === 'local' ? '🖥  Local (Ollama)' : '☁️  Cloud API'}
            </button>
          ))}
        </div>

        {/* Local tab */}
        {activeTab === 'local' && (
          <div style={{ padding: '20px' }}>
            {/* Ollama status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', borderRadius: 8, background: state.ollamaRunning ? 'rgba(61,214,140,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${state.ollamaRunning ? 'rgba(61,214,140,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
              {state.checking
                ? <Loader size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)', flexShrink: 0 }}/>
                : state.ollamaRunning
                  ? <CheckCircle size={14} style={{ color: '#3dd68c', flexShrink: 0 }}/>
                  : <AlertCircle size={14} style={{ color: 'var(--red)', flexShrink: 0 }}/>
              }
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: state.ollamaRunning ? '#3dd68c' : 'var(--red)' }}>
                  {state.ollamaRunning ? 'Ollama is running' : 'Ollama not detected'}
                </div>
                {!state.ollamaRunning && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Install from <a href="https://ollama.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>ollama.com</a>, then run <code style={{ fontFamily: 'monospace', background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3 }}>ollama serve</code>
                  </div>
                )}
              </div>
            </div>

            {/* Existing models */}
            {state.models.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Installed models</div>
                {state.models.map(m => (
                  <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', marginBottom: 4, borderRadius: 7, background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
                    <CheckCircle size={13} style={{ color: '#3dd68c', flexShrink: 0 }}/>
                    <span style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{m}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Pull models */}
            {state.ollamaRunning && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  {state.models.length === 0 ? 'Pull a model to get started' : 'Pull another model'}
                </div>
                {RECOMMENDED_MODELS.map(m => {
                  const installed = state.models.some(installed => installed.startsWith(m.name.split(':')[0]))
                  const isPulling = pulling === m.name
                  return (
                    <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 6, borderRadius: 8, background: 'var(--bg-tertiary)', border: `1px solid ${isPulling ? 'var(--accent)' : 'var(--border)'}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <code style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{m.name}</code>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.size}</span>
                          {m.note.includes('recommend') && <span style={{ fontSize: 9, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 5px', borderRadius: 4, fontWeight: 600 }}>recommended</span>}
                        </div>
                        {isPulling
                          ? <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 3 }}>{pullProgress}</div>
                          : <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{m.note}</div>
                        }
                      </div>
                      {installed
                        ? <CheckCircle size={16} style={{ color: '#3dd68c', flexShrink: 0 }}/>
                        : isPulling
                          ? <Loader size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)', flexShrink: 0 }}/>
                          : (
                            <button onClick={() => pullModel(m.name)} disabled={!!pulling}
                              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 11, fontWeight: 600, cursor: pulling ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: pulling ? 0.5 : 1 }}>
                              <Download size={12}/> Pull
                            </button>
                          )
                      }
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}

        {/* Cloud tab */}
        {activeTab === 'cloud' && (
          <div style={{ padding: '20px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
              Add an API key for any cloud provider. Gemini and Groq have <strong style={{ color: 'var(--text-secondary)' }}>free tiers</strong> — no credit card needed.
            </div>
            {CLOUD_PROVIDERS.map(p => {
              const hasKey = state.apiKeys[p.id]
              return (
                <div key={p.id} style={{ marginBottom: 12, padding: '12px', borderRadius: 8, background: 'var(--bg-tertiary)', border: `1px solid ${hasKey ? `${p.color}40` : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: hasKey ? 0 : 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }}/>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{p.name}</span>
                    {p.free && <span style={{ fontSize: 9, color: '#3dd68c', background: 'rgba(61,214,140,0.12)', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>FREE TIER</span>}
                    {hasKey && <CheckCircle size={14} style={{ color: '#3dd68c', flexShrink: 0 }}/>}
                  </div>
                  {!hasKey && (
                    <>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{p.note}</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="password"
                          placeholder={`${p.name} API key`}
                          value={apiKeyInputs[p.id] ?? ''}
                          onChange={e => setApiKeyInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') saveApiKey(p.id) }}
                          style={{ flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 12, outline: 'none', fontFamily: 'monospace' }}
                        />
                        <button onClick={() => saveApiKey(p.id)}
                          disabled={!apiKeyInputs[p.id]?.trim() || savingKey === p.id}
                          style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: savedKey === p.id ? '#3dd68c' : 'var(--accent)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0, opacity: !apiKeyInputs[p.id]?.trim() ? 0.5 : 1, minWidth: 60 }}>
                          {savingKey === p.id ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }}/> : savedKey === p.id ? '✓' : 'Save'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={checkStatus}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
            <RefreshCw size={11}/> Refresh
          </button>
          <div style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)' }}>
            {canProceed
              ? <span style={{ color: '#3dd68c' }}>✓ Ready — {state.models.length} model{state.models.length !== 1 ? 's' : ''}{hasApiKey ? ' + cloud API' : ''} configured</span>
              : 'Pull a model or add an API key to continue'
            }
          </div>
          <button onClick={onComplete} disabled={!canProceed}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 8, border: 'none', background: canProceed ? 'var(--accent)' : 'var(--bg-tertiary)', color: canProceed ? 'white' : 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: canProceed ? 'pointer' : 'not-allowed', flexShrink: 0 }}>
            Continue <ChevronRight size={14}/>
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', opacity: 0.6 }}>
        You can add more models and API keys anytime in Settings
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
