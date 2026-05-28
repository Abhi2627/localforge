import { useRef, useEffect, KeyboardEvent } from 'react'
import { useState } from 'react'
import { Send, Bot, Paperclip, Mic } from 'lucide-react'
import { useAppStore, type Message, type AgentRole } from '../store/appStore'
import { api } from '../hooks/useApi'
import { nanoid } from '../hooks/nanoid'

function roleBadgeClass(role?: AgentRole) { return `badge-${role ?? 'fullstack'}` }

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.type === 'user') return <div className="msg-user">{msg.content}</div>
  if (msg.type === 'system') return (
    <div className="msg-system"><span>●</span><span>{msg.content}</span></div>
  )
  if (msg.type === 'stream') return (
    <div>
      {msg.agentName && <div className="agent-label" style={{ color: 'var(--accent)', marginBottom: 3 }}>{msg.agentName}</div>}
      <div className="msg-stream typing-cursor">{msg.content}</div>
    </div>
  )
  return (
    <div>
      {msg.agentName && (
        <div className={`agent-badge ${roleBadgeClass(msg.agentRole)}`}
          style={{ display: 'inline-block', marginBottom: 4, fontSize: 10 }}>
          {msg.agentName}
        </div>
      )}
      <div className="msg-agent">{msg.content}</div>
    </div>
  )
}

export default function ChatPanel() {
  const { sessions, activeSessionId, addMessage, selectedModel } = useAppStore()
  const [input, setInput]   = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const session    = sessions.find(s => s.id === activeSessionId)
  const messages   = session?.messages ?? []
  const firstAgent = session?.agents[0]
  const isProject  = session?.type === 'project'
  const isChat     = session?.type === 'chat'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [input])

  async function send() {
    if (!input.trim() || !session || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)

    const msgId = nanoid()
    addMessage(session.id, { id: msgId, type: 'user', content: text, timestamp: Date.now() })

    // Persist user message
    api.saveMessage(msgId, session.id, 'user', text).catch(() => {})

    try {
      if (isProject && firstAgent) {
        await api.instruct(session.id, firstAgent.id, text)
      } else if (isChat) {
        // Build history from current messages for context
        const history = messages
          .filter(m => m.type === 'user' || m.type === 'agent')
          .slice(-20)
          .map(m => ({ role: m.type === 'user' ? 'user' : 'assistant', content: m.content }))

        const data = await api.sendChat(text, session.id, history)
        const replyId = nanoid()
        addMessage(session.id, {
          id: replyId, type: 'agent',
          content: data.reply ?? 'No response',
          agentName: selectedModel?.split(':')[0] ?? 'LocalForge',
          timestamp: Date.now()
        })
      }
    } catch (err: any) {
      addMessage(session.id, {
        id: nanoid(), type: 'system',
        content: `Error: ${err.message}`, timestamp: Date.now()
      })
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const canSend        = !!input.trim() && !!session && !sending
  const modelShortName = selectedModel ? selectedModel.split(':')[0] : 'the AI'
  const placeholder    = !session         ? 'Open a chat or project…'
    : isChat             ? 'Ask anything…'
    : !firstAgent        ? 'Add an agent from the sidebar…'
    : `Instruct ${firstAgent.name}…`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-primary)' }}>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Show project summary as first system message if available */}
        {session?.summary && messages.length === 0 && (
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 14px', fontSize: 12,
            color: 'var(--text-secondary)', lineHeight: 1.6,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', marginBottom: 5 }}>
              Project summary
            </div>
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
              {isChat     ? 'I can explain concepts, review code, or answer questions'
               : isProject && !firstAgent ? 'Create agents from the workspace panel'
               : firstAgent ? `${firstAgent.name} (${firstAgent.role}) is ready` : ''}
            </div>
          </div>
        )}

        {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
        <div ref={bottomRef} />
      </div>

      {/* Input — pinned at bottom, no divider */}
      {session?.type !== 'terminal' && (
        <div style={{ flexShrink: 0, padding: '10px 16px 14px', background: 'var(--bg-primary)' }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 6,
              background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '6px 8px 6px 12px',
            }}>
              <button className="icon-btn" title="Upload file" style={{ width: 28, height: 28, flexShrink: 0, marginBottom: 1 }}>
                <Paperclip size={14} />
              </button>
              <textarea
                ref={textareaRef} value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown} placeholder={placeholder}
                disabled={!session || sending} rows={1}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', padding: '2px 0', maxHeight: 140, overflowY: 'auto' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, marginBottom: 1 }}>
                <button className="icon-btn" title="Voice" style={{ width: 28, height: 28 }}>
                  <Mic size={14} />
                </button>
                <button onClick={send} disabled={!canSend} style={{
                  width: 30, height: 30, borderRadius: 8, border: 'none',
                  background: canSend ? 'var(--accent)' : 'var(--bg-hover)',
                  color: canSend ? 'white' : 'var(--text-muted)',
                  cursor: canSend ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s, color 0.15s', flexShrink: 0,
                }}>
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
    </div>
  )
}
