import { useState, useEffect, useCallback } from 'react'
import { X, Zap, AlertCircle, CheckCircle, Clock, Activity, ChevronDown, RefreshCw, Lightbulb } from 'lucide-react'
import { api } from '../hooks/useApi'
import { useAppStore } from '../store/appStore'

interface ModelStat {
  name:          string
  sizeGb:        string
  isSelected:    boolean
  isFallback:    boolean
  totalCalls:    number
  avgLatencyMs:  number
  avgTps:        number
  lastLatencyMs: number
  lastTps:       number
  errorCount:    number
  lastUsed:      number
  paramSize?:    string
  quantization?: string
  family?:       string
  tags:          string[]
}

interface ModelError {
  model:   string
  ts:      number
  message: string
}

interface StatsResponse {
  models:      ModelStat[]
  selected:    string
  fallbacks:   string[]
  errors:      ModelError[]
  suggestions: { code: string | null; chat: string | null; reasoning: string | null }
}

interface Props {
  onClose: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms === 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTps(tps: number): string {
  return tps === 0 ? '—' : `${tps} tok/s`
}

function formatTime(ts: number): string {
  if (!ts) return 'Never'
  const diff = Date.now() - ts
  if (diff < 60000)   return `${Math.round(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function TagPill({ tag }: { tag: string }) {
  const colors: Record<string, string> = {
    code:      '#3b82f6', chat: '#8b5cf6', fast:   '#3dd68c',
    balanced:  '#f59e0b', large: '#ef4444', reasoning: '#06b6d4',
    instruct:  '#a78bfa', vision: '#f97316', embedding: '#94a3b8',
  }
  return (
    <span style={{
      fontSize: 9, padding: '1px 6px', borderRadius: 10,
      background: `${colors[tag] ?? '#888'}22`,
      color: colors[tag] ?? '#888',
      border: `1px solid ${colors[tag] ?? '#888'}44`,
      fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{tag}</span>
  )
}

// ── Latency bar ───────────────────────────────────────────────────────────────

function LatencyBar({ ms, maxMs }: { ms: number; maxMs: number }) {
  if (ms === 0) return <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>no data</div>
  const pct   = Math.min(100, (ms / maxMs) * 100)
  const color = ms < 2000 ? '#3dd68c' : ms < 5000 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 10, color, minWidth: 40, textAlign: 'right' }}>{formatMs(ms)}</span>
    </div>
  )
}

// ── Model card ────────────────────────────────────────────────────────────────

function ModelCard({ model, maxLatency, onSelect, onToggleFallback, isLoading }: {
  model:             ModelStat
  maxLatency:        number
  onSelect:          (name: string) => void
  onToggleFallback:  (name: string) => void
  isLoading:         boolean
}) {
  const health = model.errorCount === 0 ? 'good'
    : model.errorCount < 3              ? 'warn'
    : 'bad'
  const healthColor = health === 'good' ? 'var(--green)' : health === 'warn' ? '#f59e0b' : 'var(--red)'

  return (
    <div style={{
      background:   model.isSelected ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
      border:       `1px solid ${model.isSelected ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 10, padding: '12px 14px', marginBottom: 8,
      transition:   'border-color 0.15s, background 0.15s',
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        {/* Health dot */}
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: healthColor, marginTop: 4, flexShrink: 0,
          boxShadow: health === 'good' ? `0 0 6px ${healthColor}` : 'none' }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name + tags */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: model.isSelected ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {model.name}
            </span>
            {model.isSelected && (
              <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: 'var(--accent)', color: 'white', fontWeight: 700, flexShrink: 0 }}>
                ACTIVE
              </span>
            )}
            {model.isFallback && (
              <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44', fontWeight: 600, flexShrink: 0 }}>
                FALLBACK
              </span>
            )}
            {model.tags.map(t => <TagPill key={t} tag={t} />)}
          </div>
          {/* Meta */}
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-muted)' }}>
            <span>{model.sizeGb}</span>
            {model.paramSize    && <span>{model.paramSize}</span>}
            {model.quantization && <span>{model.quantization}</span>}
            {model.totalCalls > 0 && <span>{model.totalCalls} call{model.totalCalls !== 1 ? 's' : ''}</span>}
            {model.lastUsed > 0  && <span>used {formatTime(model.lastUsed)}</span>}
          </div>
        </div>
      </div>

      {/* Metrics */}
      {model.totalCalls > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 10 }}>
          {[
            { label: 'Avg latency',  value: formatMs(model.avgLatencyMs) },
            { label: 'Avg speed',    value: formatTps(model.avgTps) },
            { label: 'Last latency', value: formatMs(model.lastLatencyMs) },
            { label: 'Last speed',   value: formatTps(model.lastTps) },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>{label}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Latency bar */}
      {model.totalCalls > 0 && maxLatency > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Relative latency</div>
          <LatencyBar ms={model.avgLatencyMs} maxMs={maxLatency} />
        </div>
      )}

      {/* Error count */}
      {model.errorCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '4px 8px', background: '#ef444415', borderRadius: 6, border: '1px solid #ef444430' }}>
          <AlertCircle size={11} style={{ color: 'var(--red)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--red)' }}>{model.errorCount} error{model.errorCount !== 1 ? 's' : ''} recorded</span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6 }}>
        {!model.isSelected && (
          <button
            onClick={() => onSelect(model.name)}
            disabled={isLoading}
            style={{ flex: 1, padding: '5px 10px', background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', fontSize: 11, fontWeight: 500, cursor: isLoading ? 'not-allowed' : 'pointer', opacity: isLoading ? 0.6 : 1 }}
          >
            Use this model
          </button>
        )}
        <button
          onClick={() => onToggleFallback(model.name)}
          style={{ padding: '5px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: model.isFallback ? '#f59e0b' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}
        >
          {model.isFallback ? 'Remove fallback' : 'Add fallback'}
        </button>
      </div>
    </div>
  )
}

// ── Error log ─────────────────────────────────────────────────────────────────

function ErrorLog({ errors }: { errors: ModelError[] }) {
  if (errors.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px', color: 'var(--green)', fontSize: 12 }}>
      <CheckCircle size={14} /><span>No errors recorded this session</span>
    </div>
  )
  return (
    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
      {errors.map((e, i) => (
        <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10 }}>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: 'var(--red)', fontWeight: 600 }}>{e.model}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatTime(e.ts)}</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.message}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ModelAdvisor({ onClose }: Props) {
  const { setSelectedModel, setModels } = useAppStore()
  const [data,       setData]       = useState<StatsResponse | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [actionLoad, setActionLoad] = useState(false)
  const [tab,        setTab]        = useState<'models' | 'errors'>('models')
  const [filter,     setFilter]     = useState<'all' | 'code' | 'chat' | 'fast'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('http://localhost:3001/models/stats')
      const json = await res.json()
      setData(json)
    } catch { }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSelect(name: string) {
    setActionLoad(true)
    try {
      await api.selectModel(name)
      setSelectedModel(name)
      // Refresh models list in store
      const { models } = await api.getModels()
      setModels(models)
      await load()
    } finally {
      setActionLoad(false)
    }
  }

  async function handleToggleFallback(name: string) {
    if (!data) return
    const isFallback = data.fallbacks.includes(name)
    const next = isFallback
      ? data.fallbacks.filter(f => f !== name)
      : [...data.fallbacks, name]
    await fetch('http://localhost:3001/models/fallback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: next }),
    })
    await load()
  }

  const filteredModels = (data?.models ?? []).filter(m => {
    if (filter === 'all')  return true
    if (filter === 'code') return m.tags.includes('code')
    if (filter === 'chat') return m.tags.includes('chat')
    if (filter === 'fast') return m.tags.includes('fast')
    return true
  })

  const maxLatency = Math.max(...(data?.models ?? []).map(m => m.avgLatencyMs), 1)

  const suggestions = data?.suggestions
  const hasSuggestions = suggestions && Object.values(suggestions).some(Boolean)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 400, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 48 }}
      onClick={onClose}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 14, width: 540, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '14px 16px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Model Advisor</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={load} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4, borderRadius: 4 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
              ><RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /></button>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4, borderRadius: 4 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
              ><X size={15} /></button>
            </div>
          </div>

          {/* Suggestions banner */}
          {hasSuggestions && !loading && (
            <div style={{ background: 'rgba(124,106,247,0.08)', border: '1px solid rgba(124,106,247,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Lightbulb size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>Suggestions based on your installed models</span>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {([['code', 'Code tasks'], ['chat', 'Chat tasks'], ['reasoning', 'Reasoning']] as const).map(([key, label]) => {
                  const suggested = suggestions[key]
                  if (!suggested) return null
                  return (
                    <div key={key} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{label}: </span>
                      <button
                        onClick={() => handleSelect(suggested)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontWeight: 500, padding: 0, textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                      >
                        {suggested}
                      </button>
                      {suggested === data?.selected && <span style={{ fontSize: 9, marginLeft: 4, color: 'var(--green)' }}>✓ active</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
            {(['models', 'errors'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: '7px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? 'var(--accent)' : 'var(--text-muted)', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', textTransform: 'capitalize' }}
              >
                {t}{t === 'errors' && data && data.errors.length > 0 ? ` (${data.errors.length})` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
              <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Loading model stats…
            </div>
          ) : tab === 'models' ? (
            <>
              {/* Filter chips */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {(['all', 'code', 'chat', 'fast'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    style={{ padding: '3px 10px', borderRadius: 12, border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`, background: filter === f ? 'var(--accent-dim)' : 'transparent', color: filter === f ? 'var(--accent)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontWeight: filter === f ? 600 : 400, textTransform: 'capitalize' }}
                  >{f}</button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
                  {filteredModels.length} model{filteredModels.length !== 1 ? 's' : ''}
                </span>
              </div>

              {filteredModels.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 12 }}>
                  No models match this filter
                </div>
              ) : (
                filteredModels.map(m => (
                  <ModelCard
                    key={m.name}
                    model={m}
                    maxLatency={maxLatency}
                    onSelect={handleSelect}
                    onToggleFallback={handleToggleFallback}
                    isLoading={actionLoad}
                  />
                ))
              )}
            </>
          ) : (
            <ErrorLog errors={data?.errors ?? []} />
          )}
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )
}
