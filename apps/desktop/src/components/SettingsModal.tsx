import { useState, useEffect, useCallback } from 'react'
import { X, Check, AlertCircle, Loader, Eye, EyeOff, ExternalLink, ChevronDown, Trash2, Download, HardDrive, Cpu, RefreshCw, Zap, Monitor, Activity, Server } from 'lucide-react'

type Tab = 'local' | 'providers' | 'defaults' | 'appearance'
type Provider = 'ollama' | 'openai' | 'gemini' | 'claude' | 'groq' | 'custom'

interface PublicSettings {
  activeProvider: Provider
  cloudModels:    Record<string, string>
  apiKeys:        Record<string, string>
  apiKeyStatus:   Record<string, boolean>
  llmDefaults:    { temperature: number; maxTokens: number; systemPrompt: string; contextLength: number }
  fontSize:       number
  autoApply:      boolean
  searchProvider?: string
}

interface ProviderInfo {
  id:             Provider
  label:          string
  color:          string
  models:         string[]
  docsUrl:        string
  keyLabel:       string
  keyPlaceholder: string
  free?:          boolean
  freeNote?:      string
  rateLimit?:     string
}

// Cloud providers only — Ollama is local and belongs in the Local tab
const CLOUD_PROVIDERS: ProviderInfo[] = [
  {
    id: 'gemini', label: 'Google Gemini', color: '#4285f4',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-lite'],
    docsUrl: 'https://aistudio.google.com/apikey',
    keyLabel: 'Gemini API Key', keyPlaceholder: 'AIza...',
    free: true, freeNote: 'Free tier available via AI Studio',
    rateLimit: '15 RPM / 1M TPD on free tier',
  },
  {
    id: 'openai', label: 'OpenAI', color: '#10b981',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    docsUrl: 'https://platform.openai.com/api-keys',
    keyLabel: 'OpenAI API Key', keyPlaceholder: 'sk-...',
    rateLimit: 'Tier-based — see platform.openai.com/limits',
  },
  {
    id: 'claude', label: 'Anthropic Claude', color: '#d97706',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-6'],
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyLabel: 'Anthropic API Key', keyPlaceholder: 'sk-ant-...',
    rateLimit: 'Tier-based — see console.anthropic.com/settings/limits',
  },
  {
    id: 'groq', label: 'Groq', color: '#8b5cf6',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    docsUrl: 'https://console.groq.com/keys',
    keyLabel: 'Groq API Key', keyPlaceholder: 'gsk_...',
    free: true, freeNote: 'Free tier available',
    rateLimit: '30 RPM / 6K TPM on free tier',
  },
  {
    id: 'custom', label: 'Custom (OpenAI-compatible)', color: '#94a3b8',
    models: [],
    docsUrl: '',
    keyLabel: 'API Key', keyPlaceholder: 'your-api-key',
  },
]

interface Props { onClose: () => void }

// ── Provider card ─────────────────────────────────────────────────────────────
function ProviderCard({
  info, isActive, hasKey, currentModel,
  onActivate, onSaveKey, onDeleteKey, onModelChange,
}: {
  info:          ProviderInfo
  isActive:      boolean
  hasKey:        boolean
  currentModel:  string
  onActivate:    () => void
  onSaveKey:     (key: string, baseUrl?: string) => Promise<void>
  onDeleteKey:   () => void
  onModelChange: (model: string) => void
}) {
  const [expanded,    setExpanded]    = useState(isActive)
  const [apiKey,      setApiKey]      = useState('')
  const [baseUrl,     setBaseUrl]     = useState('')
  const [showKey,     setShowKey]     = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [validating,  setValidating]  = useState(false)
  const [validResult, setValidResult] = useState<{ ok: boolean; error?: string } | null>(null)

  async function handleSave() {
    if (!apiKey.trim()) return
    setSaving(true)
    await onSaveKey(apiKey.trim(), baseUrl.trim() || undefined)
    setApiKey(''); setSaving(false)
  }

  async function handleValidate() {
    if (!apiKey.trim()) return
    setValidating(true); setValidResult(null)
    try {
      const res = await fetch('http://localhost:3001/settings/apikey/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: info.id, apiKey: apiKey.trim(), model: currentModel || info.models[0], baseUrl: baseUrl || undefined }),
      })
      setValidResult(await res.json())
    } catch (e: any) { setValidResult({ ok: false, error: e.message }) }
    setValidating(false)
  }

  return (
    <div style={{ border:`1px solid ${isActive ? info.color : 'var(--border)'}`, borderRadius:10, overflow:'hidden', marginBottom:8, background:isActive?`${info.color}08`:'var(--bg-tertiary)', transition:'border-color 0.2s' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer' }} onClick={() => setExpanded(v => !v)}>
        <div style={{ width:10, height:10, borderRadius:'50%', background:info.color, flexShrink:0, boxShadow:isActive?`0 0 8px ${info.color}`:'none' }}/>
        <span style={{ flex:1, fontSize:13, fontWeight:500, color:'var(--text-primary)' }}>{info.label}</span>
        {info.free && <span style={{ fontSize:9, padding:'1px 6px', borderRadius:8, background:`${info.color}22`, color:info.color, fontWeight:600 }}>FREE TIER</span>}
        {hasKey && <span style={{ fontSize:10, color:info.color, display:'flex', alignItems:'center', gap:3 }}><Check size={11}/>Key saved</span>}
        {isActive && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:8, background:info.color, color:'white', fontWeight:600 }}>ACTIVE</span>}
        <ChevronDown size={13} style={{ color:'var(--text-muted)', transform:expanded?'rotate(180deg)':'none', transition:'transform 0.2s' }}/>
      </div>

      {expanded && (
        <div style={{ borderTop:'1px solid var(--border)', padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>

          {/* Rate limit info */}
          {info.rateLimit && (
            <div style={{ display:'flex', alignItems:'flex-start', gap:6, padding:'7px 10px', borderRadius:6, background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)' }}>
              <Activity size={11} style={{ color:'#f59e0b', flexShrink:0, marginTop:1 }}/>
              <div>
                <div style={{ fontSize:10, fontWeight:600, color:'#f59e0b', marginBottom:1 }}>Rate limits</div>
                <div style={{ fontSize:10, color:'var(--text-secondary)' }}>{info.rateLimit}</div>
                {info.freeNote && <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>{info.freeNote}</div>}
              </div>
            </div>
          )}

          {/* Model selector */}
          {info.models.length > 0 && (
            <div>
              <label style={{ fontSize:11, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Model</label>
              <select value={currentModel} onChange={e => onModelChange(e.target.value)}
                style={{ width:'100%', background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', color:'var(--text-primary)', fontSize:12, outline:'none', cursor:'pointer' }}>
                {info.models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}

          {/* API key */}
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
                  placeholder={hasKey ? '••••••••  (enter new key to replace)' : info.keyPlaceholder}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
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
            {info.id === 'custom' && (
              <input placeholder="Base URL (e.g. http://localhost:11434/v1)" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                style={{ width:'100%', marginTop:6, background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', color:'var(--text-primary)', fontSize:12, outline:'none', boxSizing:'border-box' }}/>
            )}
            {validResult && (
              <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4, fontSize:11, color:validResult.ok?'var(--green)':'var(--red)' }}>
                {validResult.ok ? <Check size={12}/> : <AlertCircle size={12}/>}
                {validResult.ok ? 'API key is valid ✓' : validResult.error}
              </div>
            )}
            {hasKey && (
              <button onClick={onDeleteKey} style={{ marginTop:6, background:'none', border:'none', cursor:'pointer', color:'var(--red)', fontSize:11, padding:0, textAlign:'left' }}>
                Remove saved key
              </button>
            )}
          </div>

          {/* Activate */}
          {!isActive
            ? <button onClick={onActivate} style={{ padding:'8px', background:info.color, border:'none', borderRadius:7, color:'white', fontSize:12, fontWeight:500, cursor:'pointer' }}>
                Use {info.label}
              </button>
            : <div style={{ fontSize:11, color:info.color, display:'flex', alignItems:'center', gap:4 }}>
                <Check size={12}/> Active — all chats use {info.label}
              </div>
          }
        </div>
      )}
    </div>
  )
}

// ── Local system info ─────────────────────────────────────────────────────────
interface SystemInfo {
  totalRam:   number
  freeRam:    number
  platform:   string
  arch:       string
  cpuModel:   string
  ollamaOk:   boolean
  ollamaVer:  string
}

function SystemInfoPanel() {
  const [info,    setInfo]    = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [sysRes, olRes] = await Promise.all([
          fetch('http://localhost:3001/system/info'),
          fetch('http://localhost:11434/api/version').catch(() => null),
        ])
        const sys = await sysRes.json()
        const olVer = olRes?.ok ? (await olRes.json())?.version ?? 'unknown' : null
        setInfo({
          totalRam:  sys.totalRam  ?? 0,
          freeRam:   sys.freeRam   ?? 0,
          platform:  sys.platform  ?? 'unknown',
          arch:      sys.arch      ?? '',
          cpuModel:  sys.cpuModel  ?? '',
          ollamaOk:  !!olVer,
          ollamaVer: olVer ?? 'not running',
        })
      } catch { }
      setLoading(false)
    }
    load()
  }, [])

  function fmt(bytes: number) { return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` }

  if (loading) return <div style={{ fontSize:11, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:6 }}><Loader size={12} style={{animation:'spin 1s linear infinite'}}/>Loading system info…</div>
  if (!info) return null

  const ramPct  = info.totalRam > 0 ? ((info.totalRam - info.freeRam) / info.totalRam) * 100 : 0
  const ramColor = ramPct > 85 ? 'var(--red)' : ramPct > 65 ? '#f59e0b' : 'var(--green)'

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', display:'flex', alignItems:'center', gap:6 }}>
        <Monitor size={13} style={{ color:'var(--accent)' }}/> System
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        {[
          { label:'Platform', value:`${info.platform} ${info.arch}`, icon:<Monitor size={11}/> },
          { label:'CPU',      value:info.cpuModel.length > 30 ? info.cpuModel.slice(0,30)+'…' : info.cpuModel || 'Unknown', icon:<Cpu size={11}/> },
        ].map(({ label, value, icon }) => (
          <div key={label} style={{ padding:'8px 10px', background:'var(--bg-tertiary)', borderRadius:7, border:'1px solid var(--border)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'var(--text-muted)', marginBottom:3 }}>{icon}{label}</div>
            <div style={{ fontSize:11, color:'var(--text-primary)', fontWeight:500 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* RAM bar */}
      <div style={{ padding:'8px 10px', background:'var(--bg-tertiary)', borderRadius:7, border:'1px solid var(--border)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
          <span style={{ fontSize:10, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:4 }}><HardDrive size={11}/>RAM</span>
          <span style={{ fontSize:11, color:ramColor, fontWeight:500 }}>{fmt(info.totalRam - info.freeRam)} / {fmt(info.totalRam)}</span>
        </div>
        <div style={{ height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
          <div style={{ height:'100%', width:`${ramPct}%`, background:ramColor, borderRadius:2, transition:'width 0.3s' }}/>
        </div>
        {info.totalRam < 8 * 1024 * 1024 * 1024 && (
          <div style={{ marginTop:5, fontSize:10, color:'#f59e0b' }}>⚠ Low RAM — use qwen2.5-coder:1.5b for best performance</div>
        )}
      </div>

      {/* Ollama status */}
      <div style={{ padding:'8px 10px', background:'var(--bg-tertiary)', borderRadius:7, border:`1px solid ${info.ollamaOk?'rgba(61,214,140,0.3)':'rgba(239,68,68,0.3)'}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <Server size={11} style={{ color:info.ollamaOk?'var(--green)':'var(--red)', flexShrink:0 }}/>
          <span style={{ fontSize:11, fontWeight:500, color:'var(--text-primary)', flex:1 }}>Ollama</span>
          <div style={{ width:7, height:7, borderRadius:'50%', background:info.ollamaOk?'var(--green)':'var(--red)', boxShadow:info.ollamaOk?'0 0 5px var(--green)':'none' }}/>
          <span style={{ fontSize:10, color:info.ollamaOk?'var(--green)':'var(--red)', fontWeight:600 }}>
            {info.ollamaOk ? `v${info.ollamaVer}` : 'Not running'}
          </span>
        </div>
        {!info.ollamaOk && (
          <div style={{ marginTop:5, fontSize:10, color:'var(--text-secondary)' }}>
            Start with: <code style={{ fontFamily:'monospace', color:'var(--accent)' }}>ollama serve</code>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Local models tab ──────────────────────────────────────────────────────────
function LocalModelsTab({ selectedModel: _sel, onRefresh }: { selectedModel: string; onRefresh: () => void }) {
  const [models,     setModels]     = useState<any[]>([])
  const [loading,    setLoading]    = useState(true)
  const [pullInput,  setPullInput]  = useState('')
  const [pulling,    setPulling]    = useState(false)
  const [pullStatus, setPullStatus] = useState<{ status: string; percent: number; done: boolean; error: string | null } | null>(null)
  const [deleting,   setDeleting]   = useState<string | null>(null)
  const [activeModel,setActiveModel]= useState('')
  const pullRef = { current: null as AbortController | null }

  const POPULAR = [
    { name:'qwen2.5-coder:1.5b', desc:'1.1 GB · Best for 8 GB RAM' },
    { name:'llama3.2:3b',        desc:'2.0 GB · Good general' },
    { name:'codellama:7b',       desc:'3.8 GB · Code-focused' },
    { name:'mistral:7b',         desc:'4.1 GB · Fast & capable' },
  ]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [mRes, cRes] = await Promise.all([fetch('http://localhost:3001/models'), fetch('http://localhost:3001/models/config')])
      setActiveModel((await cRes.json()).selectedModel ?? '')
      setModels((await mRes.json()).models ?? [])
    } catch { }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function selectModel(name: string) {
    await fetch('http://localhost:3001/models/select', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model: name }) })
    setActiveModel(name); onRefresh()
  }

  async function deleteModel(name: string) {
    setDeleting(name)
    try { await fetch('http://localhost:11434/api/delete', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) }); await load() } catch { }
    setDeleting(null)
  }

  async function startPull() {
    const name = pullInput.trim(); if (!name || pulling) return
    setPulling(true); setPullStatus({ status:'Starting…', percent:0, done:false, error:null })
    pullRef.current = new AbortController()
    try {
      const res = await fetch('http://localhost:11434/api/pull', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, stream:true }), signal: pullRef.current.signal })
      if (!res.ok) throw new Error(`Pull failed: ${res.statusText}`)
      const reader = res.body?.getReader(); const dec = new TextDecoder(); if (!reader) throw new Error('No body')
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        for (const line of dec.decode(value, { stream:true }).split('\n').filter(Boolean)) {
          try { const d = JSON.parse(line); const pct = d.total > 0 ? Math.round((d.completed/d.total)*100) : 0; setPullStatus({ status:d.status??'', percent:pct, done:false, error:null }) } catch { }
        }
      }
      setPullStatus(s => s ? { ...s, done:true } : null)
      setPullInput(''); await load()
    } catch (err: any) { if (err?.name !== 'AbortError') setPullStatus(s => s ? { ...s, error: err.message } : null) }
    setPulling(false)
  }

  function formatSize(bytes: number) { return !bytes ? '?' : bytes < 1e9 ? `${(bytes/1e6).toFixed(0)} MB` : `${(bytes/1e9).toFixed(1)} GB` }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

      {/* System info panel */}
      <SystemInfoPanel/>

      <div style={{ height:1, background:'var(--border)' }}/>

      {/* Installed models */}
      <div>
        <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
          <span style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', flex:1 }}>Installed models ({models.length})</span>
          <button onClick={load} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}>
            <RefreshCw size={13} style={{ animation:loading?'spin 1s linear infinite':'none' }}/>
          </button>
        </div>
        {loading
          ? <div style={{ fontSize:12, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:6 }}><Loader size={13} style={{animation:'spin 1s linear infinite'}}/>Loading…</div>
          : models.length === 0
            ? <div style={{ fontSize:12, color:'var(--text-muted)' }}>No models installed. Pull one below.</div>
            : models.map((m: any) => {
                const isActive   = m.name === activeModel
                const isDeleting = deleting === m.name
                return (
                  <div key={m.name} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', marginBottom:6, borderRadius:8, background:isActive?'var(--accent-dim)':'var(--bg-tertiary)', border:`1px solid ${isActive?'var(--accent)':'var(--border)'}` }}>
                    <Cpu size={14} style={{ color:isActive?'var(--accent)':'var(--text-muted)', flexShrink:0 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.name}</span>
                        {isActive && <span style={{ fontSize:9, padding:'1px 6px', borderRadius:8, background:'var(--accent)', color:'white', fontWeight:600, flexShrink:0 }}>ACTIVE</span>}
                      </div>
                      <div style={{ display:'flex', gap:8, marginTop:2 }}>
                        {m.details?.parameter_size && <span style={{ fontSize:10, color:'var(--text-muted)' }}>{m.details.parameter_size}</span>}
                        {m.details?.quantization_level && <span style={{ fontSize:10, color:'var(--text-muted)' }}>{m.details.quantization_level}</span>}
                        {m.size > 0 && <span style={{ fontSize:10, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:2 }}><HardDrive size={9}/>{formatSize(m.size)}</span>}
                      </div>
                    </div>
                    {!isActive && <button onClick={() => selectModel(m.name)} style={{ padding:'4px 10px', background:'var(--accent)', border:'none', borderRadius:6, color:'white', fontSize:11, fontWeight:500, cursor:'pointer', flexShrink:0 }}>Use</button>}
                    <button onClick={() => deleteModel(m.name)} disabled={isDeleting || isActive} title={isActive?'Cannot delete active model':'Delete'}
                      style={{ background:'none', border:'none', cursor:isDeleting||isActive?'not-allowed':'pointer', color:isDeleting||isActive?'var(--text-muted)':'var(--red)', display:'flex', padding:4, opacity:isActive?0.3:1, flexShrink:0 }}>
                      {isDeleting ? <Loader size={13} style={{animation:'spin 1s linear infinite'}}/> : <Trash2 size={13}/>}
                    </button>
                  </div>
                )
              })
        }
      </div>

      {/* Pull new model */}
      <div>
        <div style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', marginBottom:8 }}>Pull a new model</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
          {POPULAR.filter(p => !models.find((m: any) => m.name === p.name)).map(p => (
            <button key={p.name} onClick={() => setPullInput(p.name)} title={p.desc}
              style={{ padding:'4px 10px', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-secondary)', fontSize:11, cursor:'pointer' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor='var(--accent)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor='var(--border)'}>
              {p.name}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <input value={pullInput} onChange={e => setPullInput(e.target.value)} onKeyDown={e => { if (e.key==='Enter') startPull() }}
            placeholder="e.g. qwen2.5-coder:7b" disabled={pulling}
            style={{ flex:1, background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:6, padding:'7px 10px', color:'var(--text-primary)', fontSize:12, outline:'none', fontFamily:'monospace' }}/>
          {pulling
            ? <button onClick={() => { pullRef.current?.abort(); setPulling(false); setPullStatus(null) }} style={{ padding:'0 12px', background:'var(--red)', border:'none', borderRadius:6, color:'white', fontSize:12, cursor:'pointer', flexShrink:0 }}>Cancel</button>
            : <button onClick={startPull} disabled={!pullInput.trim()} style={{ padding:'0 12px', background:'var(--accent)', border:'none', borderRadius:6, color:'white', fontSize:12, fontWeight:500, cursor:pullInput.trim()?'pointer':'not-allowed', flexShrink:0, opacity:pullInput.trim()?1:0.5, display:'flex', alignItems:'center', gap:5 }}>
                <Download size={13}/> Pull
              </button>
          }
        </div>
        {pullStatus && (
          <div style={{ marginTop:10, padding:'10px 12px', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:pullStatus.done||pullStatus.error?0:6 }}>
              {pullStatus.done ? <Check size={13} style={{color:'var(--green)',flexShrink:0}}/> : pullStatus.error ? <AlertCircle size={13} style={{color:'var(--red)',flexShrink:0}}/> : <Loader size={13} style={{color:'var(--accent)',animation:'spin 1s linear infinite',flexShrink:0}}/>}
              <span style={{ fontSize:12, color:'var(--text-primary)', fontWeight:500, flex:1 }}>{pullInput || 'Pulling…'}</span>
              {!pullStatus.done && !pullStatus.error && pullStatus.percent > 0 && <span style={{ fontSize:11, color:'var(--text-muted)' }}>{pullStatus.percent}%</span>}
            </div>
            {!pullStatus.done && !pullStatus.error && (
              <div style={{ height:3, background:'var(--border)', borderRadius:2, overflow:'hidden', marginBottom:6 }}>
                <div style={{ height:'100%', background:'var(--accent)', borderRadius:2, width:`${pullStatus.percent}%`, transition:'width 0.3s' }}/>
              </div>
            )}
            <div style={{ fontSize:11, color:pullStatus.error?'var(--red)':pullStatus.done?'var(--green)':'var(--text-muted)' }}>
              {pullStatus.error ? pullStatus.error : pullStatus.done ? 'Pull complete — model is ready' : pullStatus.status}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Web search API key row (Tavily / Brave) ───────────────────────────────────
function SearchKeyRow({ label, masked, hasKey, helpUrl, helpLabel, onSave, onDelete }: {
  label: string; masked?: string; hasKey: boolean; helpUrl: string; helpLabel: string
  onSave: (key: string) => Promise<void>; onDelete: () => Promise<void>
}) {
  const [key, setKey]         = useState('')
  const [saving, setSaving]   = useState(false)
  const [editing, setEditing] = useState(false)
  // Consider it connected if the status flag OR a masked key came back from the server.
  const connected = hasKey || (!!masked && masked.length > 2)

  async function doSave() {
    if (!key.trim()) return
    setSaving(true); await onSave(key.trim()); setKey(''); setEditing(false); setSaving(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, padding:'10px 12px', background:'var(--bg-tertiary)', border:`1px solid ${connected ? 'rgba(61,214,140,0.4)' : 'var(--border)'}`, borderRadius:8 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)' }}>{label}</span>
        {connected
          ? <span style={{ fontSize:11, color:'var(--green)', fontWeight:600 }}>✓ Connected {masked}</span>
          : <span style={{ fontSize:11, color:'var(--text-muted)' }}>Not connected</span>}
        <a href={helpUrl} target="_blank" rel="noreferrer" style={{ marginLeft:'auto', fontSize:10, color:'var(--accent)' }}>{helpLabel}</a>
      </div>

      {connected && !editing ? (
        // Connected: hide the input, offer Update / Remove
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={() => setEditing(true)}
            style={{ padding:'5px 12px', background:'transparent', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-secondary)', fontSize:11, cursor:'pointer' }}>
            Update key
          </button>
          <button onClick={() => onDelete()}
            style={{ padding:'5px 10px', background:'transparent', border:'1px solid var(--border)', borderRadius:6, color:'var(--red)', fontSize:11, cursor:'pointer' }}>
            Remove
          </button>
        </div>
      ) : (
        <div style={{ display:'flex', gap:6 }}>
          <input type="password" autoFocus={editing} value={key} placeholder="Paste API key…" onChange={e => setKey(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') doSave() }}
            style={{ flex:1, background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', color:'var(--text-primary)', fontSize:12, outline:'none' }}/>
          <button onClick={doSave} disabled={!key.trim() || saving}
            style={{ padding:'0 12px', background:'var(--accent)', border:'none', borderRadius:6, color:'white', fontSize:11, fontWeight:500, cursor:!key.trim()||saving?'not-allowed':'pointer' }}>
            {saving ? '…' : 'Save'}
          </button>
          {editing && (
            <button onClick={() => { setEditing(false); setKey('') }}
              style={{ padding:'0 10px', background:'transparent', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-muted)', fontSize:11, cursor:'pointer' }}>
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function SettingsModal({ onClose }: Props) {
  const [tab,      setTab]      = useState<Tab>('local')
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setSettings(await (await fetch('http://localhost:3001/settings')).json()) } catch { }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function setProvider(provider: Provider, model?: string) {
    try { await fetch('http://localhost:3001/settings/provider', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ activeProvider: provider, cloudModel: model }) }); await load() } catch { }
  }
  async function saveApiKey(provider: string, apiKey: string, baseUrl?: string) {
    await fetch('http://localhost:3001/settings/apikey', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ provider, apiKey, baseUrl }) }); await load()
  }
  async function deleteApiKey(provider: string) {
    await fetch('http://localhost:3001/settings/apikey/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ provider }) }); await load()
  }
  async function saveModelForProvider(provider: Provider, model: string) {
    await fetch('http://localhost:3001/settings/provider', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ activeProvider: settings?.activeProvider ?? provider, cloudModel: model }) })
    setSettings(s => s ? { ...s, cloudModels: { ...s.cloudModels, [provider]: model } } : s)
  }
  async function saveLLMDefaults(key: string, value: any) {
    await fetch('http://localhost:3001/settings/llm', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ [key]: value }) }); await load()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:14, width:620, maxHeight:'88vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,0.7)' }} onClick={e => e.stopPropagation()}>

        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'var(--text-primary)' }}>Settings</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:4 }}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color='var(--text-muted)'}><X size={16}/></button>
        </div>

        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'0 20px', flexShrink:0 }}>
          {([
            { id:'local',      label:'Local',    icon:<Cpu size={12}/> },
            { id:'providers',  label:'Cloud',    icon:<Zap size={12}/> },
            { id:'defaults',   label:'LLM',      icon:<Activity size={12}/> },
            { id:'appearance', label:'Display',  icon:<Monitor size={12}/> },
          ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'10px 14px', border:'none', background:'transparent', cursor:'pointer', fontSize:12, fontWeight:tab===t.id?600:400, color:tab===t.id?'var(--accent)':'var(--text-secondary)', borderBottom:tab===t.id?'2px solid var(--accent)':'2px solid transparent' }}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
          {loading
            ? <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, gap:10, color:'var(--text-muted)' }}><Loader size={16} style={{animation:'spin 1s linear infinite'}}/>Loading…</div>
            : tab === 'local' ? (
                <LocalModelsTab
                  selectedModel={settings?.cloudModels?.['ollama'] ?? ''}
                  onRefresh={load}
                />
              ) : tab === 'providers' ? (
                <>
                  <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14, lineHeight:1.7 }}>
                    Add API keys for cloud AI providers. LocalForge will switch to the selected provider automatically.
                    Rate limits and quotas vary by provider and plan — shown in each card.
                  </p>
                  {CLOUD_PROVIDERS.map(info => (
                    <ProviderCard
                      key={info.id}
                      info={info}
                      isActive={settings?.activeProvider === info.id}
                      hasKey={!!(settings?.apiKeyStatus?.[info.id])}
                      currentModel={settings?.cloudModels?.[info.id] ?? info.models[0] ?? ''}
                      onActivate={() => setProvider(info.id, settings?.cloudModels?.[info.id] ?? info.models[0])}
                      onSaveKey={(key, url) => saveApiKey(info.id, key, url)}
                      onDeleteKey={() => deleteApiKey(info.id)}
                      onModelChange={model => saveModelForProvider(info.id, model)}
                    />
                  ))}
                  <div style={{ marginTop:12, padding:'10px 14px', background:'var(--bg-tertiary)', borderRadius:8, fontSize:11, color:'var(--text-muted)', lineHeight:1.7 }}>
                    💡 <strong style={{color:'var(--text-secondary)'}}>No API key?</strong> Gemini and Groq have free tiers. Get a Gemini key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>aistudio.google.com</a> — no credit card needed.
                  </div>

                  {/* ── Web Search ── */}
                  <div style={{ marginTop:22, marginBottom:10, paddingTop:16, borderTop:'1px solid var(--border)' }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', marginBottom:4 }}>Web Search</div>
                    <p style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.7, marginBottom:12 }}>
                      Powers the <strong style={{color:'var(--text-secondary)'}}>🌐 Web</strong> toggle in chat. Add a key for better results, or leave blank to use the free DuckDuckGo fallback. Active: <strong style={{color:'var(--accent)'}}>{settings?.searchProvider ?? 'duckduckgo'}</strong>.
                    </p>
                    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                      <SearchKeyRow label="Tavily" masked={settings?.apiKeys?.tavily} hasKey={!!settings?.apiKeyStatus?.tavily}
                        helpUrl="https://tavily.com" helpLabel="Get key (free tier)"
                        onSave={k => saveApiKey('tavily', k)} onDelete={() => deleteApiKey('tavily')}/>
                      <SearchKeyRow label="Brave Search" masked={settings?.apiKeys?.brave} hasKey={!!settings?.apiKeyStatus?.brave}
                        helpUrl="https://brave.com/search/api/" helpLabel="Get key (free tier)"
                        onSave={k => saveApiKey('brave', k)} onDelete={() => deleteApiKey('brave')}/>
                    </div>
                  </div>
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
                      onChange={e => { const v=parseFloat(e.target.value); setSettings(s=>s?{...s,llmDefaults:{...s.llmDefaults,temperature:v}}:s) }}
                      onMouseUp={e => saveLLMDefaults('temperature', parseFloat((e.target as HTMLInputElement).value))}
                      style={{ width:'100%', accentColor:'var(--accent)' }}/>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-muted)', marginTop:3 }}>
                      <span>0 — Deterministic</span><span>1 — Balanced</span><span>2 — Creative</span>
                    </div>
                  </div>
                  {/* Max tokens */}
                  <div>
                    <label style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', display:'block', marginBottom:6 }}>
                      Max tokens — {settings?.llmDefaults.maxTokens ?? 4096}
                    </label>
                    <input type="range" min={256} max={32768} step={256}
                      value={settings?.llmDefaults.maxTokens ?? 4096}
                      onChange={e => { const v=parseInt(e.target.value); setSettings(s=>s?{...s,llmDefaults:{...s.llmDefaults,maxTokens:v}}:s) }}
                      onMouseUp={e => saveLLMDefaults('maxTokens', parseInt((e.target as HTMLInputElement).value))}
                      style={{ width:'100%', accentColor:'var(--accent)' }}/>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-muted)', marginTop:3 }}><span>256</span><span>32768</span></div>
                  </div>
                  {/* Context length */}
                  <div>
                    <label style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', display:'block', marginBottom:4 }}>Ollama context length (num_ctx)</label>
                    <p style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>Higher = more history kept in context. Requires more RAM.</p>
                    <select value={settings?.llmDefaults.contextLength ?? 4096}
                      onChange={async e => { await saveLLMDefaults('contextLength', parseInt(e.target.value)); await load() }}
                      style={{ width:'100%', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', color:'var(--text-primary)', fontSize:12, outline:'none' }}>
                      {[2048,4096,8192,16384,32768].map(n => <option key={n} value={n}>{n.toLocaleString()} tokens</option>)}
                    </select>
                  </div>
                  {/* System prompt */}
                  <div>
                    <label style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', display:'block', marginBottom:4 }}>
                      Custom system prompt <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:400 }}>(appended to all chats)</span>
                    </label>
                    <textarea
                      value={settings?.llmDefaults.systemPrompt ?? ''}
                      onChange={e => setSettings(s=>s?{...s,llmDefaults:{...s.llmDefaults,systemPrompt:e.target.value}}:s)}
                      onBlur={e => saveLLMDefaults('systemPrompt', e.target.value)}
                      placeholder="e.g. Always respond in Indian English. Prefer TypeScript over JavaScript."
                      rows={4}
                      style={{ width:'100%', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:6, padding:'8px 10px', color:'var(--text-primary)', fontSize:12, outline:'none', resize:'vertical', fontFamily:'inherit', lineHeight:1.6, boxSizing:'border-box' }}
                    />
                  </div>
                  {/* Auto-Apply toggle */}
                  <div style={{ display:'flex', alignItems:'flex-start', gap:14, padding:'12px 14px', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:8 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', marginBottom:3 }}>Agent Auto-Apply</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.6 }}>When enabled, file patches proposed by the agent are written to disk immediately — no Apply button required. Each applied file still shows an "Applied" badge in chat so you can track what changed.</div>
                    </div>
                    {/* Toggle pill */}
                    <div
                      onClick={async () => {
                        const next = !(settings?.autoApply ?? false)
                        setSettings(s => s ? { ...s, autoApply: next } : s)
                        await fetch('http://localhost:3001/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ autoApply: next }) })
                      }}
                      style={{ width:44, height:24, borderRadius:12, background:settings?.autoApply?'var(--accent)':'var(--bg-primary)', border:`1px solid ${settings?.autoApply?'var(--accent)':'var(--border)'}`, cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0, marginTop:2 }}>
                      <div style={{ position:'absolute', top:2, left:settings?.autoApply?20:2, width:18, height:18, borderRadius:'50%', background:'white', transition:'left 0.2s', boxShadow:'0 1px 4px rgba(0,0,0,0.35)' }}/>
                    </div>
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
                      onChange={e => setSettings(s=>s?{...s,fontSize:parseInt(e.target.value)}:s)}
                      onMouseUp={async e => {
                        const v = parseInt((e.target as HTMLInputElement).value)
                        await fetch('http://localhost:3001/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fontSize: v }) })
                        document.documentElement.style.setProperty('font-size', `${v}px`)
                      }}
                      style={{ width:'100%', accentColor:'var(--accent)' }}/>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-muted)', marginTop:3 }}>
                      <span>11px — Compact</span><span>16px — Large</span>
                    </div>
                  </div>
                  <div style={{ padding:12, background:'var(--bg-tertiary)', borderRadius:8, fontSize:12, color:'var(--text-secondary)', lineHeight:1.7 }}>
                    <strong style={{ color:'var(--text-primary)' }}>Theme:</strong> Dark only. Light theme planned for a future release.
                  </div>
                </div>
              )
          }
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
