import { useRef, useEffect, useState, KeyboardEvent } from 'react'
import { Send, Plus, Bot, Paperclip, Mic } from 'lucide-react'
import { useAppStore, type Message, type AgentRole } from '../store/appStore'
import { api } from '../hooks/useApi'
import NewProjectModal from './NewProjectModal'
import { nanoid } from '../hooks/nanoid'

function roleBadgeClass(role?: AgentRole) {
  if (!role) return 'badge-fullstack'
  return `badge-${role}`
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.type === 'user') {
    return <div className="msg-user">{msg.content}</div>
  }
  if (msg.type === 'system') {
    return (
      <div className="msg-system">
        <span>●</span>
        <span>{msg.content}</span>
      </div>
    )
  }
  if (msg.type === 'stream') {
    return (
      <div>
        {msg.agentName && (
          <div className="agent-label" style={{ color: 'var(--accent)', marginBottom: 3 }}>
            {msg.agentName}
          </div>
        )}
        <div className="msg-stream typing-cursor">{msg.content}</div>
      </div>
    )
  }
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
  const { projects, activeProjectId, addMessage, selectedModel } = useAppStore()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeProject = projects.find(p => p.id === activeProjectId)
  const messages = activeProject?.messages ?? []
  const firstAgent = activeProject?.agents[0]

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
    if (!input.trim() || !activeProject || !firstAgent || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)
    addMessage(activeProject.id, {
      id: nanoid(), type: 'user', content: text, timestamp: Date.now()
    })
    try {
      await api.instruct(activeProject.id, firstAgent.id, text)
    } catch (err: any) {
      addMessage(activeProject.id, {
        id: nanoid(), type: 'system', content: `Error: ${err.message}`, timestamp: Date.now()
      })
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const canSend = !!input.trim() && !!activeProject && !!firstAgent && !sending
  const modelShortName = selectedModel ? selectedModel.split(':')[0] : 'the AI'

  return (
    <div className="main-area">
      {/* Tab bar */}
      <div className="tab-bar">
        <div className="tab active">
          {activeProject ? activeProject.name : 'No project'}
        </div>
        <button
          className="icon-btn"
          style={{ marginLeft: 'auto', alignSelf: 'center', width: 26, height: 26 }}
          title="New project"
          onClick={() => setShowNewProject(true)}
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Bot size={36} style={{ marginBottom: 10, opacity: 0.3 }} />
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, color: 'var(--text-secondary)' }}>
              {!activeProject ? 'No project open' : !firstAgent ? 'No agent yet' : 'Ready to build'}
            </div>
            <div style={{ fontSize: 12 }}>
              {!activeProject
                ? 'Click + to create a project'
                : !firstAgent
                  ? 'Add an agent from the sidebar'
                  : `${firstAgent.name} (${firstAgent.role}) is ready`}
            </div>
          </div>
        )}
        {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
        <div ref={bottomRef} />
      </div>

      {/* Input area — centred, narrower */}
      <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          {/* Input box */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 6,
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '6px 8px 6px 12px',
          }}>
            <button className="icon-btn" title="Attach file"
              style={{ width: 28, height: 28, flexShrink: 0, marginBottom: 1 }}>
              <Paperclip size={14} />
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                !activeProject ? 'Create a project first…'
                : !firstAgent ? 'Add an agent to start…'
                : `Message ${firstAgent.name}…`
              }
              disabled={!activeProject || !firstAgent || sending}
              rows={1}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                color: 'var(--text-primary)',
                fontSize: 13,
                lineHeight: 1.6,
                fontFamily: 'inherit',
                padding: '2px 0',
                maxHeight: 140,
                overflowY: 'auto',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, marginBottom: 1 }}>
              <button className="icon-btn" title="Voice input" style={{ width: 28, height: 28 }}>
                <Mic size={14} />
              </button>
              <button
                onClick={send}
                disabled={!canSend}
                title="Send"
                style={{
                  width: 30, height: 30,
                  borderRadius: 8,
                  border: 'none',
                  background: canSend ? 'var(--accent)' : 'var(--bg-hover)',
                  color: canSend ? 'white' : 'var(--text-muted)',
                  cursor: canSend ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s, color 0.15s',
                  flexShrink: 0,
                }}
              >
                <Send size={13} />
              </button>
            </div>
          </div>

          {/* Disclaimer */}
          <div style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            textAlign: 'center',
            marginTop: 6,
          }}>
            {modelShortName} is AI and can make mistakes. Please double-check responses.
          </div>
        </div>
      </div>

      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </div>
  )
}
