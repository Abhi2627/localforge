import { useRef, useEffect, KeyboardEvent, useState, useCallback } from 'react'
import { Send, Bot, Paperclip, Mic, Loader, Copy, Pencil, RefreshCw, Check, X, Terminal, ChevronDown, ArrowDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore, type Message, type AgentRole } from '../store/appStore'
import { api } from '../hooks/useApi'
import { nanoid } from '../hooks/nanoid'
import FileEditorPanel from './FileEditorPanel'
import SettingsModal from './SettingsModal'

interface ChatPanelProps { onOpenTerminal?: (cwd: string) => void }

function roleBadgeClass(role?: AgentRole) { return `badge-${role ?? 'fullstack'}` }
function formatTime(ts: number) { return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) }
function cleanTitle(raw: string) {
  return raw.replace(/\*\*/g,'').replace(/\*/g,'').replace(/`/g,'')
    .replace(/#{1,6}\s?/g,'').replace(/[_~]/g,'')
    .replace(/^["'`[\]()]+|["'`[\]()]+$/g,'')
    .replace(/[^\w\s\-]/g,' ').replace(/\s+/g,' ').trim()
}

function classifyError(message: string): 'ram' | 'timeout' | 'generic' {
  const m = message.toLowerCase()
  if (m.includes('out of memory') || m.includes('cannot allocate') ||
      m.includes('ggml_') || m.includes('metal') || m.includes('allocation') ||
      m.includes('enomem') || m.includes('memory') || m.includes('resource')) return 'ram'
  if (m.includes('fetch') || m.includes('timeout') || m.includes('abort') ||
      m.includes('network') || m.includes('connect')) return 'timeout'
  return 'generic'
}

// ── Markdown renderer ──────────────────────────────────────────────────
function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p:    ({ children }) => <p style={{ margin:'0 0 8px', lineHeight:1.7 }}>{children}</p>,
        h1:   ({ children }) => <h1 style={{ fontSize:16, fontWeight:700, margin:'12px 0 6px' }}>{children}</h1>,
        h2:   ({ children }) => <h2 style={{ fontSize:14, fontWeight:700, margin:'10px 0 5px' }}>{children}</h2>,
        h3:   ({ children }) => <h3 style={{ fontSize:13, fontWeight:600, margin:'8px 0 4px' }}>{children}</h3>,
        ul:   ({ children }) => <ul style={{ margin:'4px 0 8px', paddingLeft:20 }}>{children}</ul>,
        ol:   ({ children }) => <ol style={{ margin:'4px 0 8px', paddingLeft:20 }}>{children}</ol>,
        li:   ({ children }) => <li style={{ margin:'3px 0', lineHeight:1.6 }}>{children}</li>,
        strong: ({ children }) => <strong style={{ color:'var(--text-primary)', fontWeight:600 }}>{children}</strong>,
        em:     ({ children }) => <em style={{ color:'var(--text-secondary)' }}>{children}</em>,
        blockquote: ({ children }) => <blockquote style={{ borderLeft:'3px solid var(--accent)', paddingLeft:12, margin:'6px 0', color:'var(--text-secondary)', fontStyle:'italic' }}>{children}</blockquote>,
        hr:   () => <hr style={{ border:'none', borderTop:'1px solid var(--border)', margin:'10px 0' }}/>,
        a:    ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" style={{ color:'var(--accent)', textDecoration:'underline' }}>{children}</a>,
        pre:  ({ children }) => <>{children}</>,
        code: ({ children, className }) => {
          const isBlock = !!className?.includes('language-')
          return isBlock
            ? <code style={{ display:'block', background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:6, padding:'10px 14px', fontSize:12, fontFamily:'monospace', overflowX:'auto', margin:'6px 0', lineHeight:1.6, color:'var(--text-primary)' }}>{children}</code>
            : <code style={{ background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:4, padding:'1px 5px', fontSize:12, fontFamily:'monospace', color:'var(--accent)' }}>{children}</code>
        },
        table: ({ children }) => <div style={{ overflowX:'auto', margin:'8px 0' }}><table style={{ borderCollapse:'collapse', fontSize:12, width:'100%' }}>{children}</table></div>,
        th:   ({ children }) => <th style={{ border:'1px solid var(--border)', padding:'5px 10px', background:'var(--bg-tertiary)', fontWeight:600, textAlign:'left' }}>{children}</th>,
        td:   ({ children }) => <td style={{ border:'1px solid var(--border)', padding:'5px 10px' }}>{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

// ── Message action buttons ────────────────────────────────────────────────────
function MsgActions({ content, onEdit, onReload, isUser, visible }: {
  content: string; onEdit?: () => void; onReload?: () => void; isUser: boolean; visible: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  const btn: React.CSSProperties = { background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:'3px 4px', borderRadius:4, display:'flex' }
  return (
    <div style={{ display:'flex', gap:2, opacity:visible?1:0, transition:'opacity 0.15s', alignItems:'center', pointerEvents:visible?'auto':'none' }}>
      <button onClick={copy} title="Copy" style={btn}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
      >{copied ? <Check size={12} style={{color:'var(--green)'}}/> : <Copy size={12}/>}</button>
      {isUser && onEdit && <button onClick={onEdit} title="Edit" style={btn}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
      ><Pencil size={12}/></button>}
      {!isUser && onReload && <button onClick={onReload} title="Regenerate" style={btn}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
      ><RefreshCw size={12}/></button>}
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, onEdit, onReload }: { msg: Message; onEdit?: (c: string) => void; onReload?: () => void }) {
  const [hovered, setHovered] = useState(false)
  if (msg.type === 'system') {
    const isError = msg.content.startsWith('⚠')
    return (
      <div style={{ display:'flex', justifyContent:'flex-start' }}>
        <div style={{ background: isError ? 'rgba(239,68,68,0.08)' : 'var(--bg-tertiary)', border:`1px solid ${isError ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`, borderRadius:8, padding:'10px 14px', fontSize:12, color: isError ? 'var(--red)' : 'var(--text-muted)', maxWidth:'80%', lineHeight:1.7 }}>
          <MarkdownContent content={msg.content}/>
        </div>
      </div>
    )
  }
  if (msg.type === 'stream') return (
    <div>
      {msg.agentName && <div style={{fontSize:10,color:'var(--accent)',marginBottom:3}}>{msg.agentName}</div>}
      <div className="msg-agent">
        <MarkdownContent content={msg.content}/>
        <span style={{display:'inline-block',width:7,height:13,background:'var(--accent)',marginLeft:2,animation:'blink 1s step-end infinite',verticalAlign:'text-bottom',borderRadius:1}}/>
      </div>
    </div>
  )
  const isUser = msg.type === 'user'
  const time   = formatTime(msg.timestamp)
  if (isUser) return (
    <div style={{ display:'flex', justifyContent:'flex-end', width:'100%' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3, maxWidth:'60%', minWidth:0 }}>
        <MsgActions content={msg.content} isUser visible={hovered} onEdit={() => onEdit?.(msg.content)}/>
        <div className="msg-user">{msg.content}</div>
        <span style={{fontSize:10,color:'var(--text-muted)',paddingRight:2}}>{time}</span>
      </div>
    </div>
  )
  return (
    <div style={{display:'flex',flexDirection:'column',gap:3}}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {msg.agentName && <div className={`agent-badge ${roleBadgeClass(msg.agentRole)}`} style={{display:'inline-block',fontSize:10,alignSelf:'flex-start'}}>{msg.agentName}</div>}
      <div className="msg-agent"><MarkdownContent content={msg.content}/></div>
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        <span style={{fontSize:10,color:'var(--text-muted)',paddingLeft:2}}>{time}</span>
        <MsgActions content={msg.content} isUser={false} visible={hovered} onReload={onReload}/>
      </div>
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div style={{display:'flex',alignItems:'center'}}>
      <div style={{background:'var(--bg-tertiary)',border:'1px solid var(--border)',borderRadius:'3px 12px 12px 12px',padding:'10px 14px',display:'flex',alignItems:'center',gap:8}}>
        <Loader size={13} style={{color:'var(--accent)',animation:'spin 1s linear infinite',flexShrink:0}}/>
        <span style={{fontSize:12,color:'var(--text-muted)'}}>Thinking…</span>
      </div>
    </div>
  )
}

// ── Model selector ────────────────────────────────────────────────────────────
function ModelSelector({ selectedModel, models, activeProvider, cloudModel, isOnline, apiKeyStatus, onOpenSettings, onChange }: {
  selectedModel: string; models: any[]; activeProvider: string; cloudModel: string
  isOnline: boolean; apiKeyStatus: Record<string, boolean>
  onOpenSettings: () => void; onChange: (model: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const isCloud     = activeProvider !== 'ollama'
  const displayName = isCloud
    ? `${activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1)} · ${(cloudModel || activeProvider).split(':')[0]}`
    : (selectedModel?.split(':')[0] ?? 'No model')
  const COLORS: Record<string, string> = { ollama:'#3dd68c', openai:'#10b981', gemini:'#4285f4', claude:'#d97706', groq:'#8b5cf6', custom:'#94a3b8' }
  const color = COLORS[activeProvider] ?? '#888'

  return (
    <div ref={ref} style={{ position:'relative', flexShrink:0 }}>
      <button onClick={() => setOpen(v => !v)} title="Switch model"
        style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:7, background:`${color}15`, border:`1px solid ${color}35`, color, fontSize:11, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap', maxWidth:160, overflow:'hidden' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:120 }}>{displayName}</span>
        <ChevronDown size={10} style={{ flexShrink:0 }}/>
      </button>

      {open && (
        <div style={{ position:'absolute', bottom:'calc(100% + 6px)', left:0, background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:10, padding:6, minWidth:220, maxHeight:300, overflowY:'auto', boxShadow:'0 8px 24px rgba(0,0,0,0.5)', zIndex:100 }}>

          {models.length > 0 && <>
            <div style={{ padding:'4px 8px 2px', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Local (Ollama)</div>
            {models.map((m: any) => (
              <button key={m.name} onClick={() => { onChange(m.name); setOpen(false) }}
                style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 10px', background:m.name===selectedModel&&!isCloud?'var(--accent-dim)':'transparent', border:'none', borderRadius:6, cursor:'pointer', textAlign:'left' }}
                onMouseEnter={e => { if (!(m.name===selectedModel&&!isCloud)) (e.currentTarget as HTMLElement).style.background='var(--bg-hover)' }}
                onMouseLeave={e => { if (!(m.name===selectedModel&&!isCloud)) (e.currentTarget as HTMLElement).style.background='transparent' }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:'#3dd68c', flexShrink:0 }}/>
                <span style={{ flex:1, fontSize:12, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.name.split(':')[0]}</span>
                {m.name===selectedModel && !isCloud && <span style={{ fontSize:9, color:'var(--accent)', fontWeight:600 }}>active</span>}
              </button>
            ))}
          </>}

          {isOnline && (() => {
            const CLOUD = [
              { id:'gemini', label:'Gemini Flash',    color:'#4285f4' },
              { id:'openai', label:'GPT-4o',          color:'#10b981' },
              { id:'claude', label:'Claude',          color:'#d97706' },
              { id:'groq',   label:'Groq (free tier)', color:'#8b5cf6' },
            ] as const
            const available = CLOUD.filter(p => apiKeyStatus[p.id])
            if (!available.length) return null
            return <>
              <div style={{ height:1, background:'var(--border)', margin:'6px 4px' }}/>
              <div style={{ padding:'4px 8px 2px', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Cloud</div>
              {available.map(p => (
                <button key={p.id}
                  onClick={async () => {
                    await fetch('http://localhost:3001/settings/provider', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ activeProvider: p.id }) })
                    setOpen(false); window.dispatchEvent(new CustomEvent('provider-changed'))
                  }}
                  style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 10px', background:isCloud&&activeProvider===p.id?`${p.color}18`:'transparent', border:'none', borderRadius:6, cursor:'pointer', textAlign:'left' }}
                  onMouseEnter={e => { if (!(isCloud&&activeProvider===p.id)) (e.currentTarget as HTMLElement).style.background='var(--bg-hover)' }}
                  onMouseLeave={e => { if (!(isCloud&&activeProvider===p.id)) (e.currentTarget as HTMLElement).style.background='transparent' }}>
                  <div style={{ width:7, height:7, borderRadius:'50%', background:p.color, flexShrink:0 }}/>
                  <span style={{ flex:1, fontSize:12, color:'var(--text-primary)' }}>{p.label}</span>
                  {isCloud && activeProvider===p.id && <span style={{ fontSize:9, color:p.color, fontWeight:600 }}>active</span>}
                </button>
              ))}
            </>
          })()}

          {!isOnline && <div style={{ padding:'7px 10px', fontSize:11, color:'var(--text-muted)', borderTop:'1px solid var(--border)', marginTop:4 }}>⚠ Offline — cloud providers unavailable</div>}

          <div style={{ height:1, background:'var(--border)', margin:'6px 4px' }}/>
          <button onClick={() => { setOpen(false); onOpenSettings() }}
            style={{ display:'flex', alignItems:'center', gap:6, width:'100%', padding:'7px 10px', background:'transparent', border:'none', borderRadius:6, cursor:'pointer', color:'var(--text-secondary)', fontSize:12, textAlign:'left' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='transparent'}>
            ⚙ Configure API keys in Settings
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ChatPanel({ onOpenTerminal }: ChatPanelProps) {
  const {
    sessions, activeSessionId,
    addMessage, appendStream, finalizeStream,
    selectedModel, models, updateSessionTitle,
    openFiles, activeFile, setActiveFile, closeFile,
    sendingSessionId, streamingSessionId,
    setSendingSession, setStreamingSession,
    isOnline,
  } = useAppStore()

  const [input,          setInput]         = useState('')
  const [activeProvider, setActiveProvider]= useState('ollama')
  const [cloudModel,     setCloudModel]    = useState('')
  const [apiKeyStatus,   setApiKeyStatus]  = useState<Record<string,boolean>>({})
  const [showSettings,   setShowSettings]  = useState(false)
  // Scroll state
  const [isAtBottom,     setIsAtBottom]    = useState(true)
  const scrollRef   = useRef<HTMLDivElement>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Track whether user manually scrolled — prevents auto-scroll fighting them
  const userScrolledRef = useRef(false)

  const session           = sessions.find(s => s.id === activeSessionId)
  const messages          = session?.messages ?? []
  const isProject         = session?.type === 'project'
  const isChat            = session?.type === 'chat'
  const currentActiveFile = session ? (activeFile[session.id] ?? null) : null
  const isSending         = sendingSessionId   === activeSessionId
  const isStreaming       = streamingSessionId === activeSessionId
  const isBusy            = isSending || isStreaming

  // ── Smart scroll logic ─────────────────────────────────────────────────────
  // Only auto-scroll if the user hasn't manually scrolled up
  const scrollToBottom = useCallback((force = false) => {
    const el = scrollRef.current
    if (!el) return
    if (force || !userScrolledRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  // Detect when user manually scrolls
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const threshold = 80 // px from bottom = "at bottom"
    const atBottom  = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    setIsAtBottom(atBottom)
    if (atBottom) {
      userScrolledRef.current = false // reset: user scrolled back to bottom
    } else {
      userScrolledRef.current = true  // user scrolled up
    }
  }, [])

  // Auto-scroll on new messages ONLY if already at bottom
  useEffect(() => {
    if (!userScrolledRef.current) scrollToBottom()
  }, [messages.length]) // new message added

  // Auto-scroll on streaming chunks ONLY if already at bottom
  const lastContent = messages[messages.length - 1]?.content
  useEffect(() => {
    if (!userScrolledRef.current) scrollToBottom()
  }, [lastContent])

  // When switching sessions, always scroll to bottom and reset state
  useEffect(() => {
    userScrolledRef.current = false
    setIsAtBottom(true)
    setTimeout(() => scrollToBottom(true), 50)
  }, [activeSessionId])

  useEffect(() => {
    const ta = textareaRef.current; if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [input])

  useEffect(() => {
    async function loadProvider() {
      try {
        const res  = await fetch('http://localhost:3001/settings')
        const data = await res.json()
        setActiveProvider(data.activeProvider ?? 'ollama')
        setApiKeyStatus(data.apiKeyStatus ?? {})
        if (data.activeProvider !== 'ollama') setCloudModel(data.cloudModels?.[data.activeProvider] ?? '')
      } catch { }
    }
    loadProvider()
    window.addEventListener('provider-changed', loadProvider)
    return () => window.removeEventListener('provider-changed', loadProvider)
  }, [])

  async function generateTitle(sessionId: string, sessionType: string, rootPath: string | undefined, firstMsg: string) {
    try {
      const res = await fetch('http://localhost:3001/chat/title', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message: firstMsg.slice(0, 150) }),
      })
      if (!res.ok) return
      const data  = await res.json()
      const title = cleanTitle(data.title?.trim() ?? '') || firstMsg.slice(0, 40)
      if (!title || title.toLowerCase() === 'new chat') return
      updateSessionTitle(sessionId, title)
      await api.createSession(sessionId, sessionType, title, rootPath, selectedModel)
    } catch { }
  }

  async function handleModelChange(modelName: string) {
    try {
      await fetch('http://localhost:3001/settings/provider', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ activeProvider: 'ollama' }) })
      await api.selectModel(modelName)
      setActiveProvider('ollama')
    } catch { }
  }

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || !session || isBusy) return
    if (!overrideText) setInput('')

    const sessionId   = session.id
    const sessionType = session.type
    const rootPath    = session.rootPath
    const isFirstMsg  = messages.filter(m => m.type === 'user').length === 0

    // When user sends, always scroll to bottom
    userScrolledRef.current = false
    scrollToBottom(true)

    const msgId = nanoid()
    addMessage(sessionId, { id:msgId, type:'user', content:text, timestamp:Date.now() })
    api.saveMessage(msgId, sessionId, 'user', text).catch(() => {})

    setSendingSession(sessionId); setStreamingSession(null)
    const streamTaskId = nanoid(); let firstChunk = true

    try {
      await api.streamChat(text, sessionId,
        messages.filter(m => m.type==='user'||m.type==='agent').map(m => ({ role:m.type==='user'?'user':'assistant', content:m.content })),
        streamTaskId,
        (chunk) => {
          if (firstChunk) { setSendingSession(null); setStreamingSession(sessionId); firstChunk=false }
          appendStream(sessionId, streamTaskId, chunk)
        }
      )
      finalizeStream(sessionId, streamTaskId)
      const live = useAppStore.getState().sessions.find(s => s.id === sessionId)
      if (isChat && isFirstMsg && live?.title === 'New chat') generateTitle(sessionId, sessionType, rootPath, text)

    } catch (err: any) {
      const errType = classifyError(err.message)
      const userMessage = errType === 'ram'
        ? '⚠ **Not enough memory to run this model.**\n\nYour system is out of RAM. Options:\n- Close other apps (WhatsApp, Brave tabs, VS Code)\n- Pull a smaller model: `ollama pull qwen2.5-coder:1.5b`\n- Add a free cloud API key in Settings (Gemini or Groq)'
        : errType === 'timeout'
        ? '⚠ **Connection failed or timed out.**\n\n- Check the agent server is running: `cd packages/agent-core && npm run dev`\n- Check Ollama is running: `ollama serve`'
        : `⚠ **Error:** ${err.message}`
      addMessage(sessionId, { id:nanoid(), type:'system', content:userMessage, timestamp:Date.now() })
    } finally {
      setSendingSession(null); setStreamingSession(null)
    }
  }

  function handleEdit(content: string) { setInput(content); textareaRef.current?.focus() }
  async function handleReload() {
    if (!session || isBusy) return
    const userMsgs = messages.filter(m => m.type==='user')
    if (!userMsgs.length) return
    await send(userMsgs[userMsgs.length-1].content)
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const canSend     = !!input.trim() && !!session && !isBusy
  const placeholder = !session ? 'Open a chat or project to start…' : isChat ? 'Ask anything…' : 'Ask about this project…'

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'var(--bg-primary)' }}>

      <style>{`
        @keyframes spin  { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
      `}</style>

      {/* Title bar */}
      {session && (
        <div style={{ flexShrink:0, padding:'0 16px', height:36, borderBottom:'1px solid var(--border)', background:'var(--bg-secondary)', display:'flex', alignItems:'center', gap:8, overflow:'hidden' }}>
          <span style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:1, minWidth:0 }}>{session.title}</span>
          {isProject && session.rootPath && <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:1, minWidth:0 }}>{session.rootPath}</span>}
          <div style={{ flex:1, minWidth:8 }}/>
          {isProject && session.rootPath && onOpenTerminal && (
            <button onClick={() => onOpenTerminal(session.rootPath!)}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 8px', background:'transparent', border:'1px solid var(--border)', borderRadius:5, color:'var(--text-secondary)', cursor:'pointer', fontSize:12, flexShrink:0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--accent)'; (e.currentTarget as HTMLElement).style.color='var(--accent)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--border)'; (e.currentTarget as HTMLElement).style.color='var(--text-secondary)' }}
            ><Terminal size={13}/><span>Terminal</span></button>
          )}
          <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:600, background:'var(--accent-dim)', color:'var(--accent)', flexShrink:0 }}>{session.type}</span>
        </div>
      )}

      {/* File tabs */}
      {session && isProject && (
        <div style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)', flexShrink:0, overflowX:'auto', scrollbarWidth:'none' }}>
          <div onClick={() => setActiveFile(session.id, null)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:4, background:!currentActiveFile?'var(--bg-primary)':'transparent', border:`1px solid ${!currentActiveFile?'var(--border)':'transparent'}`, color:!currentActiveFile?'var(--accent)':'var(--text-secondary)', cursor:'pointer', fontSize:12, fontWeight:500, userSelect:'none', flexShrink:0 }}>
            <Bot size={12}/><span>Chat</span>
          </div>
          {(openFiles[session.id]??[]).map(file => {
            const isActive = currentActiveFile===file
            const name = file.replace(/\\/g,'/').split('/').pop()??'file'
            return (
              <div key={file} onClick={() => setActiveFile(session.id, file)}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 8px 3px 10px', borderRadius:4, background:isActive?'var(--bg-primary)':'transparent', border:`1px solid ${isActive?'var(--border)':'transparent'}`, color:isActive?'var(--text-primary)':'var(--text-secondary)', cursor:'pointer', fontSize:12, userSelect:'none', flexShrink:0 }}>
                <span>{name}</span>
                <button onClick={e => { e.stopPropagation(); closeFile(session.id, file) }}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:1, borderRadius:3 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
                ><X size={11}/></button>
              </div>
            )
          })}
        </div>
      )}

      {/* Content */}
      {currentActiveFile ? <FileEditorPanel filePath={currentActiveFile}/> : (
        <>
          {/* Messages scroll container */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={{ flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:14, minHeight:0 }}
          >
            {messages.length===0 && !isBusy && (
              <div style={{ margin:'auto', textAlign:'center', color:'var(--text-muted)' }}>
                <Bot size={36} style={{ marginBottom:10, opacity:0.3 }}/>
                <div style={{ fontSize:15, fontWeight:500, marginBottom:6, color:'var(--text-secondary)' }}>
                  {isChat ? 'Ask me anything' : 'Project assistant'}
                </div>
                <div style={{ fontSize:13, lineHeight:1.8, color:'var(--text-muted)' }}>
                  {isChat ? 'Explain concepts, review code, write drafts, or answer questions.' : 'Ask about the codebase, request code changes, or instruct agents.'}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <MessageBubble key={msg.id} msg={msg} onEdit={handleEdit}
                onReload={i===messages.length-1 && msg.type==='agent' ? handleReload : undefined}
              />
            ))}

            {isSending && !isStreaming && <ThinkingBubble/>}
            <div ref={bottomRef} style={{ height:1 }}/>
          </div>

          {/* ── Scroll-to-bottom button — appears when user scrolls up ── */}
          {!isAtBottom && (
            <div style={{ position:'absolute', bottom:90, left:'50%', transform:'translateX(-50%)', zIndex:20 }}>
              <button
                onClick={() => { userScrolledRef.current = false; scrollToBottom(true) }}
                title="Scroll to bottom"
                style={{
                  display:'flex', alignItems:'center', gap:6,
                  padding:'7px 14px', borderRadius:20,
                  background:'var(--bg-secondary)',
                  border:'1px solid var(--border-light)',
                  color:'var(--text-primary)', fontSize:12, fontWeight:500,
                  cursor:'pointer', boxShadow:'0 4px 16px rgba(0,0,0,0.4)',
                  backdropFilter:'blur(8px)',
                  transition:'background 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--accent)'; (e.currentTarget as HTMLElement).style.background='var(--bg-hover)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--border-light)'; (e.currentTarget as HTMLElement).style.background='var(--bg-secondary)' }}
              >
                <ArrowDown size={13} style={{ color:'var(--accent)' }}/>
                Scroll to bottom
              </button>
            </div>
          )}

          {/* Input area */}
          <div style={{ flexShrink:0, padding:'10px 24px 14px', background:'var(--bg-primary)', position:'relative' }}>
            <div style={{
              display:'flex', alignItems:'flex-end', gap:6,
              background:'var(--bg-tertiary)',
              border:`1px solid ${isBusy ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius:12, padding:'8px 10px 8px 14px', transition:'border-color 0.2s',
            }}>
              <button className="icon-btn" title="Attach file (coming soon)" style={{ width:28, height:28, flexShrink:0, marginBottom:1 }}>
                <Paperclip size={14}/>
              </button>
              <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown} placeholder={placeholder} disabled={!session || isBusy} rows={1}
                style={{ flex:1, background:'transparent', border:'none', outline:'none', resize:'none', color:'var(--text-primary)', fontSize:13, lineHeight:1.6, fontFamily:'inherit', padding:'2px 0', maxHeight:140, overflowY:'auto' }}
              />
              <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0, marginBottom:1 }}>
                <ModelSelector
                  selectedModel={selectedModel} models={models}
                  activeProvider={activeProvider} cloudModel={cloudModel}
                  isOnline={isOnline} apiKeyStatus={apiKeyStatus}
                  onOpenSettings={() => setShowSettings(true)} onChange={handleModelChange}
                />
                <button className="icon-btn" title="Voice (coming soon)" style={{ width:28, height:28 }}>
                  <Mic size={14}/>
                </button>
                <button onClick={() => send()} disabled={!canSend}
                  style={{ width:32, height:32, borderRadius:8, border:'none', background:canSend?'var(--accent)':'var(--bg-hover)', color:canSend?'white':'var(--text-muted)', cursor:canSend?'pointer':'not-allowed', display:'flex', alignItems:'center', justifyContent:'center', transition:'background 0.15s', flexShrink:0 }}>
                  {isBusy ? <Loader size={13} style={{animation:'spin 1s linear infinite'}}/> : <Send size={13}/>}
                </button>
              </div>
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)', textAlign:'center', marginTop:5 }}>
              {isBusy ? 'Generating…' : 'AI can make mistakes. Double-check important responses.'}
            </div>
          </div>
        </>
      )}

      {showSettings && <SettingsModal onClose={() => { setShowSettings(false); window.dispatchEvent(new CustomEvent('provider-changed')) }}/>}
    </div>
  )
}
