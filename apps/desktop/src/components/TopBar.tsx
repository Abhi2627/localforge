import { useState, useEffect } from 'react'
import { Wifi, WifiOff, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ChevronDown, Activity, Smartphone, Zap } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import ModelAdvisor from './ModelAdvisor'
import QRPreview from './QRPreview'

// Provider colours — match SettingsModal
const PROVIDER_COLORS: Record<string, string> = {
  ollama:  '#3dd68c',
  openai:  '#10b981',
  gemini:  '#4285f4',
  claude:  '#d97706',
  groq:    '#8b5cf6',
  custom:  '#94a3b8',
}

const PROVIDER_LABELS: Record<string, string> = {
  ollama:  'Ollama',
  openai:  'OpenAI',
  gemini:  'Gemini',
  claude:  'Claude',
  groq:    'Groq',
  custom:  'Custom',
}

export default function TopBar() {
  const {
    isConnected, models, selectedModel,
    rightExpanded, setRightExpanded,
    leftExpanded,  setLeftExpanded,
    sessions, activeSessionId, screen,
  } = useAppStore()

  const [advisorOpen,   setAdvisorOpen]   = useState(false)
  const [qrOpen,        setQrOpen]        = useState(false)
  const [activeProvider,setActiveProvider]= useState('ollama')
  const [cloudModel,    setCloudModel]    = useState('')

  // Poll active provider from server every 3s so TopBar stays in sync with Settings
  useEffect(() => {
    async function loadProvider() {
      try {
        const res  = await fetch('http://localhost:3001/settings')
        const data = await res.json()
        setActiveProvider(data.activeProvider ?? 'ollama')
        if (data.activeProvider && data.activeProvider !== 'ollama') {
          setCloudModel(data.cloudModels?.[data.activeProvider] ?? '')
        }
      } catch { }
    }
    loadProvider()
    const t = setInterval(loadProvider, 3000)
    return () => clearInterval(t)
  }, [])

  const activeSession    = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = screen === 'session' && activeSession?.type === 'project'

  // Display label for the model chip
  const isCloud    = activeProvider !== 'ollama'
  const chipColor  = PROVIDER_COLORS[activeProvider] ?? 'var(--accent)'
  const provLabel  = PROVIDER_LABELS[activeProvider] ?? activeProvider
  const modelLabel = isCloud
    ? (cloudModel?.split(':')[0] ?? provLabel)
    : (selectedModel?.split(':')[0] ?? 'No model')

  const modelInfo  = models.find((m: any) => m.name === selectedModel)

  const btnBase: React.CSSProperties = {
    background:'none', border:'none', cursor:'pointer',
    color:'var(--text-muted)', display:'flex', alignItems:'center',
    padding:4, borderRadius:4, flexShrink:0,
  }

  return (
    <>
      <div className="topbar">
        <button style={btnBase} title={leftExpanded?'Collapse sidebar':'Expand sidebar'}
          onClick={()=>setLeftExpanded(!leftExpanded)}
          onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
          onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
        >
          {leftExpanded ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}
        </button>

        <span style={{ fontSize:15, fontWeight:700, color:'var(--accent)', letterSpacing:'-0.3px', flexShrink:0 }}>
          LocalForge
        </span>

        <span style={{ flex:1, minWidth:0 }}/>

        {/* QR Preview */}
        <button onClick={()=>setQrOpen(true)} title="Preview on device"
          style={{ ...btnBase, padding:'4px 6px' }}
          onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.color='var(--text-primary)';(e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}}
          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.color='var(--text-muted)';(e.currentTarget as HTMLElement).style.background='none'}}
        ><Smartphone size={15}/></button>

        {/* Model / Provider chip — opens Model Advisor for Ollama, shows provider for cloud */}
        <button
          onClick={() => { if (!isCloud) setAdvisorOpen(true) }}
          title={isCloud ? `${provLabel} — ${modelLabel}` : 'Open Model Advisor'}
          style={{
            display:'flex', alignItems:'center', gap:6,
            padding:'4px 10px 4px 8px',
            background:`${chipColor}12`,
            border:`1px solid ${chipColor}40`,
            borderRadius:8, cursor: isCloud ? 'default' : 'pointer',
            color:'var(--text-primary)', fontSize:12, fontWeight:500,
            flexShrink:0, maxWidth:280,
            transition:'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => { if (!isCloud) { (e.currentTarget as HTMLElement).style.borderColor = chipColor; (e.currentTarget as HTMLElement).style.background = `${chipColor}22` } }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = `${chipColor}40`; (e.currentTarget as HTMLElement).style.background = `${chipColor}12` }}
        >
          {isCloud
            ? <Zap size={12} style={{ color:chipColor, flexShrink:0 }}/>
            : <Activity size={12} style={{ color:chipColor, flexShrink:0 }}/>
          }
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:chipColor }}>
            {isCloud ? provLabel : modelLabel}
          </span>
          {isCloud && cloudModel && (
            <span style={{ fontSize:10, color:'var(--text-muted)', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:100 }}>
              {modelLabel}
            </span>
          )}
          {!isCloud && modelInfo?.sizeGb && (
            <span style={{ fontSize:10, color:'var(--text-muted)', flexShrink:0 }}>{modelInfo.sizeGb}</span>
          )}
          {!isCloud && <ChevronDown size={11} style={{ color:'var(--text-muted)', flexShrink:0 }}/>}
        </button>

        {/* Connection indicator */}
        <div title={isConnected?'Server connected':'Server disconnected'}
          style={{ display:'flex', alignItems:'center', flexShrink:0, color:isConnected?'var(--green)':'var(--red)' }}>
          {isConnected ? <Wifi size={15}/> : <WifiOff size={15}/>}
        </div>

        {/* Right sidebar toggle */}
        {isProjectSession && (
          <button style={btnBase} title={rightExpanded?'Collapse right bar':'Expand right bar'}
            onClick={()=>setRightExpanded(!rightExpanded)}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
          >
            {rightExpanded ? <PanelRightClose size={15}/> : <PanelRightOpen size={15}/>}
          </button>
        )}
      </div>

      {advisorOpen && <ModelAdvisor onClose={()=>setAdvisorOpen(false)}/>}
      {qrOpen      && <QRPreview   onClose={()=>setQrOpen(false)}/>}
    </>
  )
}
