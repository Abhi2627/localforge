import { useRef, useEffect, KeyboardEvent, useState } from 'react'
import { Send, Bot, Paperclip, Mic, Loader, Copy, Pencil, RefreshCw, Check, X, Terminal, Globe } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore, type Message, type AgentRole } from '../store/appStore'
import { api, type RAGSource } from '../hooks/useApi'
import { nanoid } from '../hooks/nanoid'
import FileEditorPanel from './FileEditorPanel'

interface ChatPanelProps {
  onOpenTerminal?: (cwd: string) => void
}

function roleBadgeClass(role?: AgentRole) { return `badge-${role ?? 'fullstack'}` }
function formatTime(ts: number) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
function cleanTitle(raw: string) {
  return raw.replace(/\*\*/g,'').replace(/\*/g,'').replace(/`/g,'').replace(/#{1,6}\s?/g,'').replace(/[_~]/g,'')
    .replace(/^["'`[\]()]+|["'`[\]()]+$/g,'').replace(/[^\w\s-]/g,' ').replace(/\s+/g,' ').trim()
}

function isWebTrigger(text: string) { return /^@web\b/i.test(text.trim()) }

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      p:          ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
      h1:         ({ children }) => <h1 style={{ fontSize: 16, fontWeight: 700, margin: '12px 0 6px' }}>{children}</h1>,
      h2:         ({ children }) => <h2 style={{ fontSize: 14, fontWeight: 700, margin: '10px 0 5px' }}>{children}</h2>,
      h3:         ({ children }) => <h3 style={{ fontSize: 13, fontWeight: 600, margin: '8px 0 4px' }}>{children}</h3>,
      ul:         ({ children }) => <ul style={{ margin: '4px 0 8px', paddingLeft: 20 }}>{children}</ul>,
      ol:         ({ children }) => <ol style={{ margin: '4px 0 8px', paddingLeft: 20 }}>{children}</ol>,
      li:         ({ children }) => <li style={{ margin: '3px 0', lineHeight: 1.6 }}>{children}</li>,
      strong:     ({ children }) => <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{children}</strong>,
      em:         ({ children }) => <em style={{ color: 'var(--text-secondary)' }}>{children}</em>,
      blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 12, margin: '6px 0', color: 'var(--text-secondary)', fontStyle: 'italic' }}>{children}</blockquote>,
      hr:         () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '10px 0' }} />,
      a:          ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{children}</a>,
      pre:        ({ children }) => <>{children}</>,
      code:       ({ children, className }) => {
        const isBlock = !!className?.includes('language-')
        return isBlock
          ? <code style={{ display: 'block', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', fontSize: 12, fontFamily: 'monospace', overflowX: 'auto', margin: '6px 0', lineHeight: 1.6, color: 'var(--text-primary)' }}>{children}</code>
          : <code style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', fontSize: 12, fontFamily: 'monospace', color: 'var(--accent)' }}>{children}</code>
      },
      table: ({ children }) => <div style={{ overflowX: 'auto', margin: '8px 0' }}><table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>{children}</table></div>,
      th:    ({ children }) => <th style={{ border: '1px solid var(--border)', padding: '5px 10px', background: 'var(--bg-tertiary)', fontWeight: 600, textAlign: 'left' }}>{children}</th>,
      td:    ({ children }) => <td style={{ border: '1px solid var(--border)', padding: '5px 10px' }}>{children}</td>,
    }}>{content}</ReactMarkdown>
  )
}

function MsgActions({ content, onEdit, onReload, isUser, visible }: {
  content: string; onEdit?: () => void; onReload?: () => void; isUser: boolean; visible: boolean
}) {
  const [copied, setCopied] = useState(false)
  function copy() { navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }
  return (
    <div style={{ display: 'flex', gap: 2, opacity: visible ? 1 : 0, transition: 'opacity 0.15s', alignItems: 'center', pointerEvents: visible ? 'auto' : 'none' }}>
      <button onClick={copy} title="Copy" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '3px 4px', borderRadius: 4, display: 'flex' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
      >{copied ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}</button>
      {isUser && onEdit && (
        <button onClick={onEdit} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '3px 4px', borderRadius: 4, display: 'flex' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
        ><Pencil size={12} /></button>
      )}
      {!isUser && onReload && (
        <button onClick={onReload} title="Regenerate" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '3px 4px', borderRadius: 4, display: 'flex' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
        ><RefreshCw size={12} /></button>
      )}
    </div>
  )
}

function MessageBubble({ msg, onEdit, onReload }: { msg: Message; onEdit?: (c: string) => void; onReload?: () => void }) {
  const [hovered, setHovered] = useState(false)
  if (msg.type === 'system') return <div className="msg-system"><span>●</span><span>{msg.content}</span></div>
  if (msg.type === 'stream') return (
    <div>
      {msg.agentName && <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 3 }}>{msg.agentName}</div>}
      <div className="msg-agent">
        <MarkdownContent content={msg.content} />
        <span style={{ display: 'inline-block', width: 7, height: 13, background: 'var(--accent)', marginLeft: 2, animation: 'blink 1s step-end infinite', verticalAlign: 'text-bottom', borderRadius: 1 }} />
      </div>
    </div>
  )
  const isUser = msg.type === 'user'
  const time   = formatTime(msg.timestamp)

  if (isUser) return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'flex-end' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, maxWidth: '72%', minWidth: 0 }}>
        <MsgActions content={msg.content} isUser visible={hovered} onEdit={() => onEdit?.(msg.content)} />
        <div className="msg-user" style={{ width: '100%', boxSizing: 'border-box' }}>
          {isWebTrigger(msg.content)
            ? <><span style={{ color: '#06b6d4', fontWeight: 600 }}>@web</span>{msg.content.slice(4)}</>
            : msg.content
          }
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', paddingRight: 2 }}>{time}</span>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {msg.agentName && <div className={`agent-badge ${roleBadgeClass(msg.agentRole)}`} style={{ display: 'inline-block', fontSize: 10, alignSelf: 'flex-start' }}>{msg.agentName}</div>}
      <div className="msg-agent"><MarkdownContent content={msg.content} /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 2 }}>{time}</span>
        <MsgActions content={msg.content} isUser={false} visible={hovered} onReload={onReload} />
      </div>
    </div>
  )
}

// ── RAG status bubble ─────────────────────────────────────────────────────────

function RAGBubble({ status }: { status: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ background: 'var(--bg-tertiary)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: '3px 12px 12px 12px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Globe size={13} style={{ color: '#06b6d4', flexShrink: 0, animation: 'spin 2s linear infinite' }} />
        <span style={{ fontSize: 12, color: '#06b6d4' }}>{status}</span>
      </div>
    </div>
  )
}

// ── Source pills ──────────────────────────────────────────────────────────────

function RAGSources({ sources }: { sources: RAGSource[] }) {
  if (sources.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center', flexShrink: 0 }}>Sources:</span>
      {sources.map((s, i) => (
        <a key={i} href={s.url} target="_blank" rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#06b6d4', background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)', borderRadius: 12, padding: '2px 8px', textDecoration: 'none', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(6,182,212,0.18)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(6,182,212,0.08)'}
        >
          <Globe size={9} style={{ flexShrink: 0 }}/>
          {s.title.length > 28 ? s.title.slice(0, 26) + '…' : s.title}
        </a>
      ))}
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '3px 12px 12px 12px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Loader size={13} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Thinking…</span>
      </div>
    </div>
  )
}

export default function ChatPanel({ onOpenTerminal }: ChatPanelProps) {
  const { sessions, activeSessionId, addMessage, appendStream, finalizeStream, selectedModel, updateSessionTitle, openFiles, activeFile, setActiveFile, closeFile } = useAppStore()
  const [input,      setInput]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [streaming,  setStreaming]  = useState(false)
  const [ragStatus,  setRagStatus]  = useState<string | null>(null)
  const [ragSources, setRagSources] = useState<RAGSource[]>([])
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const session           = sessions.find(s => s.id === activeSessionId)
  const messages          = session?.messages ?? []
  const isProject         = session?.type === 'project'
  const isChat            = session?.type === 'chat'
  const currentActiveFile = session ? (activeFile[session.id] ?? null) : null

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) },
    [messages.length, messages[messages.length - 1]?.content])
  useEffect(() => {
    const ta = textareaRef.current; if (!ta) return
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [input])
  useEffect(() => { setRagStatus(null); setRagSources([]) }, [activeSessionId])

  async function generateTitle(sessionId: string, firstMessage: string) {
    try {
      const data = await api.sendChat(
        `Give a 3 to 5 word plain text title for: "${firstMessage.slice(0, 100)}". Only plain words. No markdown.`,
        sessionId + '-titlegentmp', []
      )
      const title = cleanTitle(data.reply?.trim() ?? firstMessage) || firstMessage.slice(0, 40)
      updateSessionTitle(sessionId, title)
      await api.createSession(sessionId, session?.type ?? 'chat', title, session?.rootPath, selectedModel)
    } catch { }
  }

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || !session || sending || streaming) return
    if (!overrideText) setInput('')

    const msgId      = nanoid()
    const isFirstMsg = messages.filter(m => m.type === 'user').length === 0
    addMessage(session.id, { id: msgId, type: 'user', content: text, timestamp: Date.now() })
    api.saveMessage(msgId, session.id, 'user', text).catch(() => {})

    setSending(true); setStreaming(false)
    setRagStatus(null); setRagSources([])

    try {
      const history = messages
        .filter(m => m.type === 'user' || m.type === 'agent')
        .map(m => ({ role: m.type === 'user' ? 'user' : 'assistant', content: m.content }))

      const streamTaskId = nanoid()
      let   firstChunk   = true
      const useWebSearch = isWebTrigger(text)

      if (useWebSearch) {
        // Web-augmented stream — RAG phase then model
        await api.streamChatWeb(
          text, session.id, history,
          (chunk) => {
            if (firstChunk) { setSending(false); setStreaming(true); setRagStatus(null); firstChunk = false }
            appendStream(session.id, streamTaskId, chunk)
          },
          (status) => { setSending(false); setRagStatus(status) },
          (sources) => setRagSources(sources),
        )
      } else {
        // Standard stream — no RAG, always fast
        await api.streamChat(text, session.id, history, streamTaskId, (chunk) => {
          if (firstChunk) { setSending(false); setStreaming(true); firstChunk = false }
          appendStream(session.id, streamTaskId, chunk)
        })
      }

      finalizeStream(session.id, streamTaskId)
      setStreaming(false)
      if (isChat && isFirstMsg && session.title === 'New chat') generateTitle(session.id, text)
    } catch (err: any) {
      addMessage(session.id, { id: nanoid(), type: 'system', content: `Error: ${err.message}`, timestamp: Date.now() })
    } finally {
      setSending(false); setStreaming(false); setRagStatus(null)
    }
  }

  function handleEdit(content: string) { setInput(content); textareaRef.current?.focus() }
  async function handleReload() {
    if (!session || sending || streaming) return
    const userMsgs = messages.filter(m => m.type === 'user')
    if (userMsgs.length === 0) return
    await send(userMsgs[userMsgs.length - 1].content)
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const isBusy    = sending || streaming
  const canSend   = !!input.trim() && !!session && !isBusy
  const isWebMode = isWebTrigger(input)
  const modelShortName = selectedModel ? selectedModel.split(':')[0] : 'AI'

  const placeholder = !session
    ? 'Open a chat or project…'
    : isWebMode
    ? 'Web search enabled — ask anything…'
    : isChat
    ? 'Ask anything… (type @web for live data)'
    : 'Ask about this project… (type @web for live data)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-primary)' }}>

      {/* Title bar */}
      {session && (
        <div style={{ flexShrink: 0, padding: '0 12px', height: 36, borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0 }}>{session.title}</span>
          {isProject && session.rootPath && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0 }}>{session.rootPath}</span>
          )}
          <div style={{ flex: 1, minWidth: 8 }} />
          {isProject && session.rootPath && onOpenTerminal && (
            <button onClick={() => onOpenTerminal(session.rootPath!)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
            >
              <Terminal size={12} /><span>Terminal</span>
            </button>
          )}
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600, background: 'var(--accent-dim)', color: 'var(--accent)', flexShrink: 0 }}>{session.type}</span>
        </div>
      )}

      {/* File tabs */}
      {session && isProject && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
          <div onClick={() => setActiveFile(session.id, null)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 4, background: !currentActiveFile ? 'var(--bg-primary)' : 'transparent', border: `1px solid ${!currentActiveFile ? 'var(--border)' : 'transparent'}`, color: !currentActiveFile ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, fontWeight: 500, userSelect: 'none', flexShrink: 0 }}>
            <Bot size={11} /><span>Chat</span>
          </div>
          {(openFiles[session.id] ?? []).map(file => {
            const isActive = currentActiveFile === file
            const name = file.replace(/\\/g, '/').split('/').pop() ?? 'file'
            return (
              <div key={file} onClick={() => setActiveFile(session.id, file)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 10px', borderRadius: 4, background: isActive ? 'var(--bg-primary)' : 'transparent', border: `1px solid ${isActive ? 'var(--border)' : 'transparent'}`, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, userSelect: 'none', flexShrink: 0 }}>
                <span>{name}</span>
                <button onClick={e => { e.stopPropagation(); closeFile(session.id, file) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 1, borderRadius: 3 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
                ><X size={10} /></button>
              </div>
            )
          })}
        </div>
      )}

      {/* Content */}
      {currentActiveFile ? (
        <FileEditorPanel filePath={currentActiveFile} />
      ) : (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 5%', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>

            {/* Empty state */}
            {messages.length === 0 && !isBusy && !ragStatus && (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Bot size={36} style={{ marginBottom: 10, opacity: 0.3 }} />
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6, color: 'var(--text-secondary)' }}>
                  {isChat ? 'Ask me anything' : 'Project assistant'}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  {isChat
                    ? <>Explain concepts, review code, or answer questions.<br/>
                       Type <code style={{ fontFamily:'monospace', color:'#06b6d4', background:'rgba(6,182,212,0.1)', padding:'1px 5px', borderRadius:4 }}>@web</code> before your message for live web data.</>
                    : <>Ask about the codebase, request changes, or instruct agents.<br/>
                       Type <code style={{ fontFamily:'monospace', color:'#06b6d4', background:'rgba(6,182,212,0.1)', padding:'1px 5px', borderRadius:4 }}>@web</code> before your message for live web data.</>
                  }
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <MessageBubble key={msg.id} msg={msg} onEdit={handleEdit}
                onReload={i === messages.length - 1 && msg.type === 'agent' ? handleReload : undefined}
              />
            ))}

            {/* Source pills — shown after last response */}
            {ragSources.length > 0 && !isBusy && <RAGSources sources={ragSources} />}

            {/* RAG status — "Searching web…" */}
            {ragStatus && <RAGBubble status={ragStatus} />}

            {/* Thinking bubble */}
            {sending && !streaming && !ragStatus && <ThinkingBubble />}

            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div style={{ flexShrink: 0, padding: '10px 5% 14px', background: 'var(--bg-primary)' }}>
            <div style={{ width: '100%', maxWidth: 860, margin: '0 auto' }}>
              <div style={{
                display: 'flex', alignItems: 'flex-end', gap: 6,
                background: 'var(--bg-tertiary)',
                border: `1px solid ${isBusy ? 'var(--accent)' : isWebMode ? '#06b6d4' : 'var(--border)'}`,
                borderRadius: 12, padding: '6px 8px 6px 12px', transition: 'border-color 0.2s',
              }}>
                <button className="icon-btn" title="Attach" style={{ width: 28, height: 28, flexShrink: 0, marginBottom: 1 }}><Paperclip size={14} /></button>
                <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={onKeyDown} placeholder={placeholder} disabled={!session || isBusy} rows={1}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', padding: '2px 0', maxHeight: 140, overflowY: 'auto' }}
                />
                {/* Web mode badge */}
                {isWebMode && (
                  <div style={{ display:'flex', alignItems:'center', gap:3, fontSize:10, color:'#06b6d4', flexShrink:0, marginBottom:2 }}>
                    <Globe size={11}/><span>web</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, marginBottom: 1 }}>
                  <button className="icon-btn" title="Voice" style={{ width: 28, height: 28 }}><Mic size={14} /></button>
                  <button onClick={() => send()} disabled={!canSend}
                    style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: canSend ? (isWebMode ? '#06b6d4' : 'var(--accent)') : 'var(--bg-hover)', color: canSend ? 'white' : 'var(--text-muted)', cursor: canSend ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s', flexShrink: 0 }}>
                    {isBusy ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : isWebMode ? <Globe size={13}/> : <Send size={13} />}
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                {modelShortName}
                {isWebMode && <span style={{ color:'#06b6d4' }}> · web search</span>}
                {' · '}{ragStatus ?? (isBusy ? 'Generating…' : 'Enter to send · @web for live data')}
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes spin  { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: 0 } }
      `}</style>
    </div>
  )
}
