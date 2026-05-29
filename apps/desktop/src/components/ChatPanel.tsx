import { useRef, useEffect, KeyboardEvent, useState } from 'react'
import { Send, Bot, Paperclip, Mic, Loader, Copy, Pencil, RefreshCw, Check } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore, type Message, type AgentRole } from '../store/appStore'
import { api } from '../hooks/useApi'
import { nanoid } from '../hooks/nanoid'

// ── Helpers ───────────────────────────────────────────────────────────────────

function roleBadgeClass(role?: AgentRole) { return `badge-${role ?? 'fullstack'}` }

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Strips ALL markdown formatting — used at the title boundary
function cleanTitle(raw: string): string {
  return raw
    .replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '')
    .replace(/#{1,6}\s?/g, '').replace(/[_~]/g, '')
    .replace(/^["'`[\]()]+|["'`[\]()]+$/g, '')
    .replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── Markdown renderer ────────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      p:      ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
      h1:     ({ children }) => <h1 style={{ fontSize: 16, fontWeight: 700, margin: '12px 0 6px', color: 'var(--text-primary)' }}>{children}</h1>,
      h2:     ({ children }) => <h2 style={{ fontSize: 14, fontWeight: 700, margin: '10px 0 5px', color: 'var(--text-primary)' }}>{children}</h2>,
      h3:     ({ children }) => <h3 style={{ fontSize: 13, fontWeight: 600, margin: '8px 0 4px', color: 'var(--text-primary)' }}>{children}</h3>,
      ul:     ({ children }) => <ul style={{ margin: '4px 0 8px', paddingLeft: 20 }}>{children}</ul>,
      ol:     ({ children }) => <ol style={{ margin: '4px 0 8px', paddingLeft: 20 }}>{children}</ol>,
      li:     ({ children }) => <li style={{ margin: '3px 0', lineHeight: 1.6 }}>{children}</li>,
      strong: ({ children }) => <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{children}</strong>,
      em:     ({ children }) => <em style={{ color: 'var(--text-secondary)' }}>{children}</em>,
      code:   ({ children, className }) => {
        const isBlock = !!className?.includes('language-')
        return isBlock
          ? <code style={{ display: 'block', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', fontSize: 12, fontFamily: 'monospace', overflowX: 'auto', margin: '6px 0', lineHeight: 1.6, color: 'var(--text-primary)' }}>{children}</code>
          : <code style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', fontSize: 12, fontFamily: 'monospace', color: 'var(--accent)' }}>{children}</code>
      },
      pre:        ({ children }) => <>{children}</>,
      blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 12, margin: '6px 0', color: 'var(--text-secondary)', fontStyle: 'italic' }}>{children}</blockquote>,
      hr:    () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '10px 0' }} />,
      a:     ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{children}</a>,
      table: ({ children }) => <div style={{ overflowX: 'auto', margin: '8px 0' }}><table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>{children}</table></div>,
      th:    ({ children }) => <th style={{ border: '1px solid var(--border)', padding: '5px 10px', background: 'var(--bg-tertiary)', fontWeight: 600, textAlign: 'left' }}>{children}</th>,
      td:    ({ children }) => <td style={{ border: '1px solid var(--border)', padding: '5px 10px' }}>{children}</td>,
    }}>
      {content}
    </ReactMarkdown>
  )
}

// ── Message action buttons ────────────────────────────────────────────────────

function MsgActions({ content, onEdit, onReload, isUser, isStream }: {
  content: string
  onEdit?: () => void
  onReload?: () => void
  isUser: boolean
  isStream: boolean
}) {
  const [copied, setCopied] = useState(false)
  if (isStream) return null

  function copy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div style={{
      display: 'flex', gap: 2, opacity: 0,
      transition: 'opacity 0.15s',
      alignItems: 'center',
    }} className="msg-actions">
      <button onClick={copy} title="Copy" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '3px 4px', borderRadius: 4, display: 'flex' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      {isUser && onEdit && (
        <button onClick={onEdit} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '3px 4px', borderRadius: 4, display: 'flex' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
          <Pencil size={12} />
        </button>
      )}
      {!isUser && onReload && (
        <button onClick={onReload} title="Regenerate" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '3px 4px', borderRadius: 4, display: 'flex' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
          <RefreshCw size={12} />
        </button>
      )}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg, onEdit, onReload }: {
  msg: Message
  onEdit?: (content: string) => void
  onReload?: () => void
}) {
  if (msg.type === 'system') return (
    <div className="msg-system"><span>●</span><span>{msg.content}</span></div>
  )

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

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'flex-end' }}
        onMouseEnter={e => { const el = e.currentTarget.querySelector('.msg-actions') as HTMLElement; if (el) el.style.opacity = '1' }}
        onMouseLeave={e => { const el = e.currentTarget.querySelector('.msg-actions') as HTMLElement; if (el) el.style.opacity = '0' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <MsgActions content={msg.content} isUser onEdit={() => onEdit?.(msg.content)} isStream={false} />
          <div className="msg-user">{msg.content}</div>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', paddingRight: 2 }}>{time}</span>
        </div>
      </div>
    )
  }

  // Agent message
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
      onMouseEnter={e => { const el = e.currentTarget.querySelector('.msg-actions') as HTMLElement; if (el) el.style.opacity = '1' }}
      onMouseLeave={e => { const el = e.currentTarget.querySelector('.msg-actions') as HTMLElement; if (el) el.style.opacity = '0' }}
    >
      {msg.agentName && (
        <div className={`agent-badge ${roleBadgeClass(msg.agentRole)}`}
          style={{ display: 'inline-block', fontSize: 10, alignSelf: 'flex-start' }}>
          {msg.agentName}
        </div>
      )}
      <div className="msg-agent">
        <MarkdownContent content={msg.content} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 2 }}>{time}</span>
        <MsgActions content={msg.content} isUser={false} onReload={onReload} isStream={false} />
      </div>
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

// ── ChatPanel ─────────────────────────────────────────────────────────────────

export default function ChatPanel() {
  const { sessions, activeSessionId, addMessage, appendStream, finalizeStream, selectedModel, updateSessionTitle } = useAppStore()
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const [editingText, setEditingText] = useState('')
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const session    = sessions.find(s => s.id === activeSessionId)
  const messages   = session?.messages ?? []
  const firstAgent = session?.agents[0]
  const isProject  = session?.type === 'project'
  const isChat     = session?.type === 'chat'

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) },
    [messages.length, messages[messages.length - 1]?.content])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [input])

  // ── Title generation ────────────────────────────────────────────────────────
  async function generateTitle(sessionId: string, firstMessage: string) {
    try {
      const data = await api.sendChat(
        `Give a 3 to 5 word plain text title for: "${firstMessage.slice(0, 100)}". Only plain words separated by spaces. No asterisks, no bold, no markdown, no punctuation. Example: Java Interview Preparation`,
        sessionId + '-titlegentmp', []
      )
      const raw   = data.reply?.trim() ?? firstMessage
      const title = cleanTitle(raw) || firstMessage.slice(0, 40)
      updateSessionTitle(sessionId, title)
      await api.createSession(sessionId, session?.type ?? 'chat', title, session?.rootPath, selectedModel)
    } catch { }
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || !session || sending) return
    if (!overrideText) setInput('')
    setSending(true)

    const msgId      = nanoid()
    const isFirstMsg = messages.filter(m => m.type === 'user').length === 0

    addMessage(session.id, { id: msgId, type: 'user', content: text, timestamp: Date.now() })
    api.saveMessage(msgId, session.id, 'user', text).catch(() => {})

    try {
      if (isProject && firstAgent) {
        await api.instruct(session.id, firstAgent.id, text)
      } else if (isChat) {
        const history = messages
          .filter(m => m.type === 'user' || m.type === 'agent')
          .slice(-20)
          .map(m => ({ role: m.type === 'user' ? 'user' : 'assistant', content: m.content }))

        const streamTaskId = nanoid()
        setSending(false)

        await api.streamChat(text, session.id, history, streamTaskId, (chunk) => {
          appendStream(session.id, streamTaskId, chunk)
        })
        finalizeStream(session.id, streamTaskId)

        if (isFirstMsg && session.title === 'New chat') generateTitle(session.id, text)
      }
    } catch (err: any) {
      addMessage(session.id, { id: nanoid(), type: 'system', content: `Error: ${err.message}`, timestamp: Date.now() })
    } finally {
      setSending(false)
    }
  }

  // ── Edit user message ───────────────────────────────────────────────────────
  function handleEdit(content: string) {
    setInput(content)
    textareaRef.current?.focus()
  }

  // ── Reload last agent response ──────────────────────────────────────────────
  async function handleReload() {
    if (!session || sending) return
    // Find the last user message before this agent response
    const userMsgs = messages.filter(m => m.type === 'user')
    if (userMsgs.length === 0) return
    const lastUserMsg = userMsgs[userMsgs.length - 1]
    await send(lastUserMsg.content)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const canSend        = !!input.trim() && !!session && !sending
  const modelShortName = selectedModel ? selectedModel.split(':')[0] : 'the AI'
  const placeholder    = !session ? 'Open a chat or project…'
    : isChat ? 'Ask anything…'
    : !firstAgent ? 'Add an agent from the sidebar…'
    : `Instruct ${firstAgent.name}…`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-primary)' }}>

      {/* Session title bar */}
      {session && (
        <div style={{ flexShrink: 0, padding: '6px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{session.title}</span>
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600, background: 'var(--accent-dim)', color: 'var(--accent)' }}>{session.type}</span>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {session?.summary && messages.length === 0 && (
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', marginBottom: 5 }}>Project summary</div>
            {session.summary}
          </div>
        )}

        {messages.length === 0 && !session?.summary && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Bot size={36} style={{ marginBottom: 10, opacity: 0.3 }} />
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, color: 'var(--text-secondary)' }}>
              {isChat ? 'Ask me anything' : isProject && !firstAgent ? 'No agent yet' : 'Ready to build'}
            </div>
            <div style={{ fontSize: 12 }}>
              {isChat ? 'I can explain concepts, review code, or answer questions'
                : isProject && !firstAgent ? 'Create agents from the workspace panel'
                : firstAgent ? `${firstAgent.name} (${firstAgent.role}) is ready` : ''}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onEdit={handleEdit}
            onReload={i === messages.length - 1 && msg.type === 'agent' ? handleReload : undefined}
          />
        ))}
        {sending && <ThinkingBubble />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {session?.type !== 'terminal' && (
        <div style={{ flexShrink: 0, padding: '10px 16px 14px', background: 'var(--bg-primary)' }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 12, padding: '6px 8px 6px 12px' }}>
              <button className="icon-btn" title="Upload file" style={{ width: 28, height: 28, flexShrink: 0, marginBottom: 1 }}><Paperclip size={14} /></button>
              <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown} placeholder={placeholder}
                disabled={!session || sending} rows={1}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', padding: '2px 0', maxHeight: 140, overflowY: 'auto' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, marginBottom: 1 }}>
                <button className="icon-btn" title="Voice" style={{ width: 28, height: 28 }}><Mic size={14} /></button>
                <button onClick={() => send()} disabled={!canSend} style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: canSend ? 'var(--accent)' : 'var(--bg-hover)', color: canSend ? 'white' : 'var(--text-muted)', cursor: canSend ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s, color 0.15s', flexShrink: 0 }}>
                  <Send size={13} />
                </button>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
              {modelShortName} is AI and can make mistakes. Please double-check responses.
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin  { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
        .msg-actions { opacity: 0; transition: opacity 0.15s; }
      `}</style>
    </div>
  )
}
