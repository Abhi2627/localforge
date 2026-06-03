import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Trash2, Download, RefreshCw, Loader, CheckCircle, AlertCircle, HardDrive, Cpu } from 'lucide-react'

interface OllamaModel {
  name:         string
  size:         number
  parameterSize: string
  quantization:  string
  family:        string
  modifiedAt:   string
}

interface PullProgress {
  status:    string
  completed: number
  total:     number
  percent:   number
}

interface Props { onClose: () => void }

export default function OllamaModelsModal({ onClose }: Props) {
  const [models,      setModels]      = useState<OllamaModel[]>([])
  const [loading,     setLoading]     = useState(true)
  const [pullModel,   setPullModel]   = useState('')
  const [pulling,     setPulling]     = useState(false)
  const [pullStatus,  setPullStatus]  = useState<{ model: string; progress: PullProgress | null; done: boolean; error: string | null } | null>(null)
  const [deleting,    setDeleting]    = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const pullRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [modelsRes, configRes] = await Promise.all([
        fetch('http://localhost:3001/models'),
        fetch('http://localhost:3001/models/config'),
      ])
      const modelsData = await modelsRes.json()
      const configData = await configRes.json()
      setSelectedModel(configData.selectedModel ?? '')

      const raw = modelsData.models ?? []
      setModels(raw.map((m: any) => ({
        name:          m.name,
        size:          m.size ?? 0,
        parameterSize: m.details?.parameter_size ?? m.parameterSize ?? '',
        quantization:  m.details?.quantization_level ?? m.quantization ?? '',
        family:        m.details?.family ?? '',
        modifiedAt:    m.modified_at ?? m.modifiedAt ?? '',
      })))
    } catch { }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function selectModel(name: string) {
    await fetch('http://localhost:3001/models/select', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    })
    setSelectedModel(name)
    window.dispatchEvent(new CustomEvent('model-changed'))
  }

  async function deleteModel(name: string) {
    setDeleting(name)
    try {
      // Call Ollama directly to delete
      await fetch('http://localhost:11434/api/delete', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      await load()
    } catch { }
    setDeleting(null)
  }

  async function startPull() {
    const modelName = pullModel.trim()
    if (!modelName || pulling) return
    setPulling(true)
    setPullStatus({ model: modelName, progress: null, done: false, error: null })

    pullRef.current = new AbortController()
    try {
      const res = await fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
        signal: pullRef.current.signal,
      })
      if (!res.ok) throw new Error(`Pull failed: ${res.statusText}`)

      const reader  = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No response body')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            const progress: PullProgress = {
              status:    data.status ?? '',
              completed: data.completed ?? 0,
              total:     data.total ?? 0,
              percent:   data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
            }
            setPullStatus(s => s ? { ...s, progress } : null)
          } catch { }
        }
      }

      setPullStatus(s => s ? { ...s, done: true } : null)
      setPullModel('')
      await load()

    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setPullStatus(s => s ? { ...s, error: err.message, done: false } : null)
      }
    }
    setPulling(false)
  }

  function cancelPull() {
    pullRef.current?.abort()
    setPulling(false)
    setPullStatus(null)
  }

  function formatSize(bytes: number) {
    if (bytes === 0) return '?'
    if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`
    return `${(bytes / 1e9).toFixed(1)} GB`
  }

  function formatDate(iso: string) {
    if (!iso) return ''
    try { return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) } catch { return '' }
  }

  const POPULAR = [
    { name:'qwen2.5-coder:1.5b', desc:'1.1 GB · Fastest, works on 8 GB RAM' },
    { name:'qwen2.5-coder:7b',   desc:'4.7 GB · Best quality, needs 12 GB RAM' },
    { name:'llama3.2:3b',        desc:'2.0 GB · Good general purpose' },
    { name:'codellama:7b',       desc:'3.8 GB · Specialised for code' },
    { name:'mistral:7b',         desc:'4.1 GB · Fast and capable' },
  ]

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:14, width:580, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,0.7)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
          <Cpu size={16} style={{ color:'var(--accent)' }}/>
          <span style={{ fontSize:15, fontWeight:700, color:'var(--text-primary)', flex:1 }}>Ollama Models</span>
          <button onClick={load} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:4 }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}/>
          </button>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:4 }}>
            <X size={16}/>
          </button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px 20px', display:'flex', flexDirection:'column', gap:20 }}>

          {/* Installed models */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:10 }}>
              Installed ({models.length})
            </div>

            {loading ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--text-muted)', fontSize:13 }}>
                <Loader size={14} style={{ animation:'spin 1s linear infinite' }}/> Loading…
              </div>
            ) : models.length === 0 ? (
              <div style={{ fontSize:13, color:'var(--text-muted)' }}>No models installed. Pull one below.</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {models.map(m => {
                  const isActive  = m.name === selectedModel
                  const isDeleting = deleting === m.name
                  return (
                    <div key={m.name} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, background: isActive ? 'var(--accent-dim)' : 'var(--bg-tertiary)', border:`1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`, transition:'all 0.15s' }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.name}</span>
                          {isActive && <span style={{ fontSize:9, padding:'1px 6px', borderRadius:8, background:'var(--accent)', color:'white', fontWeight:600, flexShrink:0 }}>ACTIVE</span>}
                        </div>
                        <div style={{ display:'flex', gap:8, marginTop:2 }}>
                          {m.parameterSize && <span style={{ fontSize:10, color:'var(--text-muted)' }}>{m.parameterSize}</span>}
                          {m.quantization  && <span style={{ fontSize:10, color:'var(--text-muted)' }}>{m.quantization}</span>}
                          <span style={{ fontSize:10, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:3 }}><HardDrive size={9}/>{formatSize(m.size)}</span>
                          {m.modifiedAt && <span style={{ fontSize:10, color:'var(--text-muted)' }}>{formatDate(m.modifiedAt)}</span>}
                        </div>
                      </div>
                      {!isActive && (
                        <button onClick={() => selectModel(m.name)}
                          style={{ padding:'4px 10px', background:'var(--accent)', border:'none', borderRadius:6, color:'white', fontSize:11, fontWeight:500, cursor:'pointer', flexShrink:0 }}>
                          Use
                        </button>
                      )}
                      <button onClick={() => deleteModel(m.name)} disabled={isDeleting || isActive}
                        title={isActive ? 'Cannot delete active model' : 'Delete model'}
                        style={{ background:'none', border:'none', cursor: isDeleting||isActive ? 'not-allowed' : 'pointer', color: isDeleting||isActive ? 'var(--text-muted)' : 'var(--red)', display:'flex', padding:4, opacity: isActive ? 0.3 : 1, flexShrink:0 }}>
                        {isDeleting ? <Loader size={14} style={{ animation:'spin 1s linear infinite' }}/> : <Trash2 size={14}/>}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Pull new model */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:10 }}>
              Pull new model
            </div>

            {/* Popular suggestions */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
              {POPULAR.filter(p => !models.find(m => m.name === p.name)).map(p => (
                <button key={p.name} onClick={() => setPullModel(p.name)}
                  style={{ padding:'4px 10px', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-secondary)', fontSize:11, cursor:'pointer', textAlign:'left' }}
                  title={p.desc}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor='var(--accent)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor='var(--border)'}
                >
                  {p.name.split(':')[0]} <span style={{ opacity:0.6 }}>:{p.name.split(':')[1]}</span>
                </button>
              ))}
            </div>

            <div style={{ display:'flex', gap:8 }}>
              <input
                value={pullModel}
                onChange={e => setPullModel(e.target.value)}
                onKeyDown={e => { if (e.key==='Enter') startPull() }}
                placeholder="e.g. llama3.2:3b or qwen2.5-coder:1.5b"
                disabled={pulling}
                style={{ flex:1, background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:6, padding:'7px 10px', color:'var(--text-primary)', fontSize:12, outline:'none', fontFamily:'monospace' }}
              />
              {pulling
                ? <button onClick={cancelPull}
                    style={{ padding:'0 12px', background:'var(--red)', border:'none', borderRadius:6, color:'white', fontSize:12, fontWeight:500, cursor:'pointer', flexShrink:0 }}>
                    Cancel
                  </button>
                : <button onClick={startPull} disabled={!pullModel.trim()}
                    style={{ padding:'0 12px', background:'var(--accent)', border:'none', borderRadius:6, color:'white', fontSize:12, fontWeight:500, cursor:pullModel.trim()?'pointer':'not-allowed', flexShrink:0, opacity:pullModel.trim()?1:0.5, display:'flex', alignItems:'center', gap:5 }}>
                    <Download size={13}/> Pull
                  </button>
              }
            </div>

            {/* Pull progress */}
            {pullStatus && (
              <div style={{ marginTop:10, padding:'10px 12px', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  {pullStatus.done
                    ? <CheckCircle size={14} style={{ color:'var(--green)', flexShrink:0 }}/>
                    : pullStatus.error
                    ? <AlertCircle size={14} style={{ color:'var(--red)', flexShrink:0 }}/>
                    : <Loader size={14} style={{ color:'var(--accent)', animation:'spin 1s linear infinite', flexShrink:0 }}/>
                  }
                  <span style={{ fontSize:12, color:'var(--text-primary)', fontWeight:500 }}>{pullStatus.model}</span>
                  {(pullStatus.progress?.percent ?? 0) > 0 && !pullStatus.done && (
                    <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:'auto' }}>{pullStatus.progress?.percent ?? 0}%</span>
                  )}
                </div>

                {/* Progress bar */}
                {!pullStatus.done && !pullStatus.error && pullStatus.progress && (
                  <div style={{ height:3, background:'var(--border)', borderRadius:2, overflow:'hidden', marginBottom:6 }}>
                    <div style={{ height:'100%', background:'var(--accent)', borderRadius:2, width:`${pullStatus.progress.percent}%`, transition:'width 0.3s' }}/>
                  </div>
                )}

                <div style={{ fontSize:11, color: pullStatus.error ? 'var(--red)' : pullStatus.done ? 'var(--green)' : 'var(--text-muted)' }}>
                  {pullStatus.error ? pullStatus.error
                    : pullStatus.done ? '✓ Pull complete — model is ready'
                    : pullStatus.progress?.status ?? 'Starting…'
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
