import { useState, useEffect, useCallback } from 'react'
import { X, Check, AlertCircle, Loader, Eye, EyeOff, ExternalLink, ChevronDown } from 'lucide-react'

type Tab = 'providers' | 'defaults' | 'appearance'

type Provider = 'ollama' | 'openai' | 'gemini' | 'claude' | 'groq' | 'custom'

interface PublicSettings {
  activeProvider: Provider
  cloudModels:    Record<string, string>
  apiKeys:        Record<string, string>
  apiKeyStatus:   Record<string, boolean>
  llmDefaults:    { temperature: number; maxTokens: number; systemPrompt: string; contextLength: number }
  fontSize:       number
}

interface ProviderInfo {
  id:       Provider
  label:    string
  color:    string
  models:   string[]
  docsUrl:  string
  keyLabel: string
  keyPlaceholder: string
  free?:    boolean
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'ollama', label: 'Ollama (Local)', color: '#3dd68c',
    models: [], docsUrl: 'https://ollama.com',
    keyLabel: 'No API key required', keyPlaceholder: '', free: true,
  },
  {
    id: 'gemini', label: 'Google Gemini', color: '#4285f4',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-lite'],
    docsUrl: 'https://aistudio.google.com/apikey',
    keyLabel: 'Gemini API Key', keyPlaceholder: 'AIza...',
    free: true,
  },
  {
    id: 'openai', label: 'OpenAI', color: '#10b981',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    docsUrl: 'https://platform.openai.com/api-keys',
    keyLabel: 'OpenAI API Key', keyPlaceholder: 'sk-...',
  },
  {
    id: 'claude', label: 'Anthropic Claude', color: '#d97706',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-6'],
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyLabel: 'Anthropic API Key', keyPlaceholder: 'sk-ant-...',
  },
  {
    id: 'groq', label: 'Groq', color: '#8b5cf6',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    docsUrl: 'https://console.groq.com/keys',
    keyLabel: 'Groq API Key', keyPlaceholder: 'gsk_...',
    free: true,
  },
  {
    id: 'custom', label: 'Custom (OpenAI-compatible)', color: '#94a3b8',
    models: [],
    docsUrl: '',
    keyLabel: 'API Key', keyPlaceholder: 'your-api-key',
  },
]

interface Props { onClose: () => void }

function ProviderCard({
  info, isActive, hasKey, currentModel, ollamaModels,
  onActivate, onSaveKey, onDeleteKey, onModelChange,
}: {
  info:         ProviderInfo
  isActive:     boolean
  hasKey:       boolean
  currentModel: string
  ollamaModels: string[]
  onActivate:   () => void
  onSaveKey:    (key: string, baseUrl?: string) => Promise<void>
  onDeleteKey:  () => void
  onModelChange:(model: string) => void
}) {
  const [expanded,   setExpanded]   = useState(isActive)
  const [apiKey,     setApiKey]     = useState('')
  const [baseUrl,    setBaseUrl]    = useState('')
  const [showKey,    setShowKey]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [validating, setValidating] = useState(false)
  const [validResult,setValidResult]= useState<{ ok: boolean; error?: string } | null>(null)

  const models = info.id === 'ollama' ? ollamaModels : info.models

  async function handleSave() {
    if (!apiKey.trim() && info.id !== 'ollama') return
    setSaving(true)
    await onSaveKey(apiKey.trim(), baseUrl.trim() || undefined)
    setApiKey(''); setSaving(false)
  }

  async function handleValidate() {
    if (!apiKey.trim()) return
    setValidating(true); setValidResult(null)
    try {
      const model = currentModel || models[0] || ''
      const res = await fetch('http://localhost:3001/settings/apikey/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: info.id, apiKey: apiKey.trim(), model, baseUrl: baseUrl || undefined }),
      })
      const data = await res.json()
      setValidResult(data)
    } catch (e: any) {
      setValidResult({ ok: false, error: e.message })
    }
    setValidating(false)
  }

  return (
    <div style={{
      border: `1px solid ${isActive ? info.color : 'var(--border)'}`,
      borderRadius: 10, overflow: 'hidden', marginBottom: 8,
      background: isActive ? `${info.color}08` : 'var(--bg-tertiary)',
      transition: 'border-color 0.2s',
    }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer' }}
        onClick={() => setExpanded(v => !v)}>
        <div style={{ width:10, height:10, borderRadius:'50%', background:info.color, flexShrink:0,
          boxShadow: isActive ? `0 0 8px ${info.color}` : 'none' }}/>
        <span style={{ flex:1, fontSize:13, fontWeight:500, color:'var(--text-primary)' }}>{info.label}</span>
        {info.free && <span style={{ fontSize:9, padding:'1px 6px', borderRadius:8, background:`${info.color}22`, color:info.color, fontWeight:600 }}>FREE TIER</span>}
        {hasKey && info.id !== 'ollama' && <span style={{ fontSize:10, color:info.color, display:'flex', alignItems:'center', gap:3 }}><Check size={11}/>Key saved</span>}
        {isActive && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:8, background:info.color, color:'white', fontWeight:600 }}>ACTIVE</span>}
        <ChevronDown size={13} style={{ color:'var(--text-muted)', transform: expanded?'rotate(180deg)':'none', transition:'transform 0.2s' }}/>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ borderTop:`1px solid var(--border)`, padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>

          {/* Model selector */}
          {models.length > 0 && (
            <div>
              <label style={{ fontSize:11, color:'var(--text-muted)', display:'block', marginBottom:4 }}>
                {info.id === 'ollama' ? 'Ollama model' : 'Model'}
              </label>
              <select value={currentModel} onChange={e => onModelChange(e.target.value)}
                style={{ width:'100%', background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', color:'var(--text-primary)', fontSize:12, outline:'none', cursor:'pointer' }}>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}

          {/* API Key input — skip for ollama */}
          {info.id !== 'ollama' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                <label style={{ fontSize:11, color:'var(--text-muted)' }}>{info.keyLabel}</label>
                {info.docsUrl && (
                  <a href={info.docsUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize:10, color:'var(--accent)', display:'flex', alignItems:'center', gap:3, textDecoration:'none' }}>
                    Get key <ExternalLink size={10}/>
                  </a>
                )}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <div style={{ flex:1, display:'flex', alignItems:'center', background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:6, padding:'0 10px', gap:6 }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    placeholder={hasKey ? '••••••••' + ' (enter new key to replace)' : info.keyPlaceholder}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    style={{ flex:1, background:'transparent', border:'none', outline:'none', color:'var(--text-primary)', fontSize:12, padding:'6px 0', fontFamily:'monospace' }}
                  />
                  <button onClick={() => setShowKey(v => !v)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}>
                    {showKey ? <EyeOff size={13}/> : <Eye size={13}/>}
                  </button>
                </div>
                <button onClick={handleValidate} disabled={!apiKey.trim() || validating}
                  style={{ padding:'0 10px', background:'transparent', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-muted)', fontSize:11, cursor:!apiKey.trim()||validating?'not-allowed':'pointer', flexShrink:0 }}>
                  {validating ? <Loader size={12} style={{animation:'spin 1s linear infinite'}}/> : 'Test'}
                </button>
                <button onClick={handleSave} disabled={!apiKey.trim() || saving}
                  style={{ padding:'0 12px', background:'var(--accent)', border:'none', borderRadius:6, color:'white', fontSize:11, fontWeight:500, cursor:!apiKey.trim()||saving?'not-allowed':'pointer', flexShrink:0 }}>
                  {saving ? <Loader size={12} style={{animation:'spin 1s linear infinite'}}/> : 'Save'}
                </button>
              </div>

              {/* Custom base URL */}
              {info.id === 'custom' && (
                <input placeholder="Base URL (e.g. http://localhost:11434)" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                  style={{ width:'100%', marginTop:6, background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', color:'var(--text-primary)', fontSize:12, outline:'none', boxSizing:'border-box' }}/>
              )}

              {/* Validation result */}
              {validResult && (
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4, fontSize:11, color: validResult.ok ? 'var(--green)' : 'var(--red)' }}>
                  {validResult.ok ? <Check size={12}/> : <AlertCircle size={12}/>}
                  {validResult.ok ? 'API key is valid ✓' : validResult.error}
                </div>
              )}

              {/* Delete key */}
              {hasKey && (
                <button onClick={onDeleteKey}
                  style={{ marginTop:6, background:'none', border:'none', cursor:'pointer', color:'var(--red)', fontSize:11, padding:0, textAlign:'left' }}>
                  Remove saved key
                </button>
              )}
            </div>
          )}

          {/* Activate button */}
          {!isActive && (
            <button onClick={onActivate}
              style={{ padding:'8px', background:info.color, border:'none', borderRadius:7, color:'white', fontSize:12, fontWeight:500, cursor:'pointer' }}>
              Use {info.label}
            </button>
          )}
          {isActive && (
            <div style={{ fontSize:11, color:info.color, display:'flex', alignItems:'center', gap:4 }}>
              <Check size={12}/> This provider is active — all chats will use {info.label}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SettingsModal({ onClose }: Props) {
  const [tab,      setTab]      = useState<Tab>('providers')
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sRes, mRes] = await Promise.all([
        fetch('http://localhost:3001/settings'),
        fetch('http://localhost:3001/models'),
      ])
      const sData = await sRes.json()
      const mData = await mRes.json()
      setSettings(sData)
      setOllamaModels((mData.models ?? []).map((m: any) => m.name))
    } catch { }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function setProvider(provider: Provider, model?: string) {
    setSaving(true)
    try {
      await fetch('http://localhost:3001/settings/provider', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeProvider: provider, cloudModel: model }),
      })
      await load()
    } finally { setSaving(false) }
  }

  async function saveApiKey(provider: string, apiKey: string, baseUrl?: string) {
    await fetch('http://localhost:3001/settings/apikey', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey, baseUrl }),
    })
    await load()
  }

  async function deleteApiKey(provider: string) {
    await fetch('http://localhost:3001/settings/apikey/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    })
    await load()
  }

  async function saveModelForProvider(provider: Provider, model: string) {
    await fetch('http://localhost:3001/settings/provider', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeProvider: settings?.activeProvider ?? provider, cloudModel: model }),
    })
    if (settings?.activeProvider === provider) await load()
    else setSettings(s => s ? { ...s, cloudModels: { ...s.cloudModels, [provider]: model } } : s)
  }

  async function saveLLMDefaults(key: string, value: any) {
    await fetch('http://localhost:3001/settings/llm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
    await load()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:14, width:600, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,0.7)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'var(--text-primary)' }}>Settings</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:4 }}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
          ><X size={16}/></button>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'0 20px', flexShrink:0 }}>
          {([
            { id:'providers', label:'Cloud Providers' },
            { id:'defaults',  label:'LLM Defaults' },
            { id:'appearance',label:'Appearance' },
          ] as { id: Tab; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:'10px 16px', border:'none', background:'transparent', cursor:'pointer', fontSize:13, fontWeight:tab===t.id?600:400, color:tab===t.id?'var(--accent)':'var(--text-secondary)', borderBottom:tab===t.id?'2px solid var(--accent)':'2px solid transparent', transition:'color 0.15s' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, gap:10, color:'var(--text-muted)' }}>
              <Loader size={16} style={{animation:'spin 1s linear infinite'}}/> Loading settings…
            </div>
          ) : tab === 'providers' ? (
            <>
              <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14, lineHeight:1.6 }}>
                Choose which AI provider powers LocalForge. Ollama runs locally — no internet needed.
                Cloud providers require an API key but give access to more capable models.
              </p>
              {PROVIDERS.map(info => {
                const isOllama = info.id === 'ollama'
                const currentModel = isOllama
                  ? (ollamaModels[0] ?? '')
                  : (settings?.cloudModels?.[info.id] ?? info.models[0] ?? '')
                return (
                  <ProviderCard
                    key={info.id}
                    info={info}
                    isActive={settings?.activeProvider === info.id}
                    hasKey={!!(settings?.apiKeyStatus?.[info.id])}
                    currentModel={currentModel}
                    ollamaModels={ollamaModels}
                    onActivate={() => setProvider(info.id, currentModel)}
                    onSaveKey={(key, url) => saveApiKey(info.id, key, url)}
                    onDeleteKey={() => deleteApiKey(info.id)}
                    onModelChange={(model) => saveModelForProvider(info.id, model)}
                  />
                )
              })}
            </>
          ) : tab === 'defaults' ? (
            <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
              {/* Temperature */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                  <label style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)' }}>Temperature</label>
                  <span style={{ fontSize:13, color:'var(--accent)', fontFamily:'monospace' }}>{settings?.llmDefaults.temperature ?? 0.7}</span>
                </div>
                <input type="range" min={0} max={2} step={0.1}
                  value={settings?.llmDefaults.temperature ?? 0.7}
                  onChange={e => { const v = parseFloat(e.target.value); setSettings(s => s ? { ...s, llmDefaults: { ...s.llmDefaults, temperature: v } } : s) }}
                  onMouseUp={e => saveLLMDefaults('temperature', parseFloat((e.target as HTMLInputElement).value))}
                  style={{ width:'100%', accentColor:'var(--accent)' }}
                />
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-muted)', marginTop:3 }}>
                  <span>0.0 — Deterministic</span><span>1.0 — Balanced</span><span>2.0 — Creative</span>
                </div>
              </div>

              {/* Max tokens */}
              <div>
                <label style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', display:'block', marginBottom:6 }}>
                  Max tokens — {settings?.llmDefaults.maxTokens ?? 4096}
                </label>
                <input type="range" min={256} max={32768} step={256}
                  value={settings?.llmDefaults.maxTokens ?? 4096}
                  onChange={e => { const v = parseInt(e.target.value); setSettings(s => s ? { ...s, llmDefaults: { ...s.llmDefaults, maxTokens: v } } : s) }}
                  onMouseUp={e => saveLLMDefaults('maxTokens', parseInt((e.target as HTMLInputElement).value))}
                  style={{ width:'100%', accentColor:'var(--accent)' }}
                />
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-muted)', marginTop:3 }}>
                  <span>256</span><span>32768</span>
                </div>
              </div>

              {/* Ollama context length */}
              <div>
                <label style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', display:'block', marginBottom:4 }}>
                  Ollama context length (num_ctx)
                </label>
                <p style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>Higher = more conversation history kept in context. Requires more RAM.</p>
                <select value={settings?.llmDefaults.contextLength ?? 4096}
                  onChange={async e => { const v = parseInt(e.target.value); await saveLLMDefaults('contextLength', v); await load() }}
                  style={{ width:'100%', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', color:'var(--text-primary)', fontSize:12, outline:'none' }}>
                  {[2048, 4096, 8192, 16384, 32768].map(n => <option key={n} value={n}>{n.toLocaleString()} tokens</option>)}
                </select>
              </div>

              {/* System prompt */}
              <div>
                <label style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', display:'block', marginBottom:4 }}>
                  Custom system prompt <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:400 }}>(appended to all chats)</span>
                </label>
                <textarea
                  value={settings?.llmDefaults.systemPrompt ?? ''}
                  onChange={e => setSettings(s => s ? { ...s, llmDefaults: { ...s.llmDefaults, systemPrompt: e.target.value } } : s)}
                  onBlur={e => saveLLMDefaults('systemPrompt', e.target.value)}
                  placeholder="e.g. Always respond in Indian English. Prefer TypeScript over JavaScript."
                  rows={4}
                  style={{ width:'100%', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:6, padding:'8px 10px', color:'var(--text-primary)', fontSize:12, outline:'none', resize:'vertical', fontFamily:'inherit', lineHeight:1.6, boxSizing:'border-box' }}
                />
              </div>
            </div>
          ) : (
            /* Appearance */
            <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                  <label style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)' }}>Font size</label>
                  <span style={{ fontSize:13, color:'var(--accent)', fontFamily:'monospace' }}>{settings?.fontSize ?? 13}px</span>
                </div>
                <input type="range" min={11} max={16} step={1}
                  value={settings?.fontSize ?? 13}
                  onChange={e => setSettings(s => s ? { ...s, fontSize: parseInt(e.target.value) } : s)}
                  onMouseUp={async e => {
                    const v = parseInt((e.target as HTMLInputElement).value)
                    await fetch('http://localhost:3001/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fontSize: v }) })
                    document.documentElement.style.setProperty('font-size', `${v}px`)
                  }}
                  style={{ width:'100%', accentColor:'var(--accent)' }}
                />
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-muted)', marginTop:3 }}>
                  <span>11px — Compact</span><span>16px — Large</span>
                </div>
              </div>
              <div style={{ padding:12, background:'var(--bg-tertiary)', borderRadius:8, fontSize:12, color:'var(--text-secondary)', lineHeight:1.7 }}>
                <strong style={{ color:'var(--text-primary)' }}>Theme:</strong> Dark only — LocalForge is designed for dark environments to reduce eye strain during long coding sessions. Light theme coming in a future update.
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
