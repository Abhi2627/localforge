import { create } from 'zustand'

export type AgentRole    = 'frontend' | 'backend' | 'fullstack' | 'test' | 'review' | 'docs' | 'devops' | 'database'
export type MessageType  = 'user' | 'agent' | 'system' | 'stream'
export type SessionType  = 'chat' | 'project' | 'terminal'

function cleanTitleStr(raw: string): string {
  return raw
    .replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '')
    .replace(/#{1,6}\s/g, '').replace(/[_~]/g, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
    || raw.trim()
}

export interface Message {
  id: string; type: MessageType; content: string
  displayContent?: string    // what to show in the bubble (strips injected file context)
  filePaths?: string[]       // attached file paths shown as badges
  agentName?: string; agentRole?: AgentRole; taskId?: string; filePath?: string; timestamp: number
}
export interface Agent {
  id: string; name: string; role: AgentRole
  status: 'idle' | 'running' | 'done' | 'failed'; currentTask?: string
}
export interface Session {
  id: string; type: SessionType; title: string; rootPath?: string
  agents: Agent[]; messages: Message[]; allFiles: string[]; writtenFiles: string[]
  summary?: string; lastAccessedAt: number; isActive: boolean
  createdAt?: string; updatedAt?: string
  sessionProvider?: string
  sessionModel?: string
  sessionEffort?: 'low' | 'medium' | 'high' | 'max'  // maps to thinking budget / temperature
  sessionThinking?: boolean                            // extended thinking toggle (Claude only)
}
export interface OllamaModel {
  name: string; sizeGb: string; isSelected: boolean; isFallback: boolean
}
export type AppScreen = 'welcome' | 'session'

interface AppState {
  screen: AppScreen; sessions: Session[]; activeSessionId: string | null
  models: OllamaModel[]; selectedModel: string; leftExpanded: boolean
  rightExpanded: boolean; isConnected: boolean; isOnline: boolean; userName: string
  openFiles:  Record<string, string[]>
  activeFile: Record<string, string | null>

  // Per-session sending/streaming state — fixes "thinking bubble on all chats" bug
  sendingSessionId:   string | null
  streamingSessionId: string | null
  setSendingSession:   (id: string | null) => void
  setStreamingSession: (id: string | null) => void

  openFile:           (sessionId: string, filePath: string) => void
  closeFile:          (sessionId: string, filePath: string) => void
  setActiveFile:      (sessionId: string, filePath: string | null) => void
  getRecentTabs:      () => Session[]
  setScreen:          (s: AppScreen) => void
  loadSession:        (session: Session) => void
  addSession:         (session: Session) => void
  setActiveSession:   (id: string) => void
  updateSessionTitle: (id: string, title: string) => void
  closeSession:       (id: string) => void
  addMessage:         (sessionId: string, msg: Message) => void
  appendStream:       (sessionId: string, taskId: string, chunk: string) => void
  finalizeStream:     (sessionId: string, taskId: string) => void
  addAgent:           (sessionId: string, agent: Agent) => void
  updateAgent:        (sessionId: string, agentId: string, update: Partial<Agent>) => void
  addWrittenFile:     (sessionId: string, filePath: string) => void
  setAllFiles:        (sessionId: string, files: string[]) => void
  setSessionSummary:  (sessionId: string, summary: string) => void
  setSessionProvider:  (sessionId: string, provider: string, model?: string) => void
  setSessionEffort:    (sessionId: string, effort: 'low'|'medium'|'high'|'max', thinking?: boolean) => void
  setModels:          (models: OllamaModel[]) => void
  setSelectedModel:   (model: string) => void
  setLeftExpanded:    (v: boolean) => void
  setRightExpanded:   (v: boolean) => void
  setConnected:       (v: boolean) => void
  setOnline:          (v: boolean) => void
  setUserName:        (name: string) => void
}

const isWide = typeof window !== 'undefined' ? window.innerWidth >= 700 : true
const isRightWide = typeof window !== 'undefined' ? window.innerWidth >= 900 : true

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'welcome', sessions: [], activeSessionId: null,
  models: [], selectedModel: '', leftExpanded: isWide,
  rightExpanded: isRightWide, isConnected: false, isOnline: navigator.onLine, userName: '',
  openFiles: {}, activeFile: {},
  sendingSessionId: null,
  streamingSessionId: null,

  setSendingSession:   (id) => set({ sendingSessionId: id }),
  setStreamingSession: (id) => set({ streamingSessionId: id }),

  openFile: (sessionId, filePath) => set(s => {
    const cur     = s.openFiles[sessionId] ?? []
    const updated = cur.includes(filePath) ? cur : [...cur, filePath]
    return { openFiles: { ...s.openFiles, [sessionId]: updated }, activeFile: { ...s.activeFile, [sessionId]: filePath } }
  }),
  closeFile: (sessionId, filePath) => set(s => {
    const updated    = (s.openFiles[sessionId] ?? []).filter(f => f !== filePath)
    let   nextActive = s.activeFile[sessionId] ?? null
    if (nextActive === filePath) nextActive = updated.length > 0 ? updated[updated.length - 1] : null
    return { openFiles: { ...s.openFiles, [sessionId]: updated }, activeFile: { ...s.activeFile, [sessionId]: nextActive } }
  }),
  setActiveFile: (sessionId, filePath) => set(s => ({
    activeFile: { ...s.activeFile, [sessionId]: filePath }
  })),

  getRecentTabs: () => {
    const { sessions } = get()
    return [...sessions]
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      .slice(0, 4)
      .filter(s => s.title && s.title.trim() !== '')
  },

  setScreen: (screen) => set({ screen }),

  loadSession: (session) => set(s => {
    if (s.sessions.find(x => x.id === session.id)) return s
    if (session.type === 'project' && session.rootPath) {
      if (s.sessions.find(x => x.type === 'project' && x.rootPath === session.rootPath)) return s
    }
    return { sessions: [...s.sessions, { ...session, title: cleanTitleStr(session.title) }] }
  }),

  addSession: (session) => set(s => {
    if (s.sessions.find(x => x.id === session.id)) return s
    return { sessions: [...s.sessions, { ...session, title: cleanTitleStr(session.title) }], screen: 'session' }
  }),

  setActiveSession: (id) => set(s => ({
    activeSessionId: id, screen: 'session',
    sessions: s.sessions.map(sess => ({
      ...sess,
      isActive: sess.id === id,
      lastAccessedAt: sess.id === id ? Date.now() : sess.lastAccessedAt,
    })),
  })),

  updateSessionTitle: (id, title) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === id ? { ...sess, title: cleanTitleStr(title) } : sess
    )
  })),

  closeSession: (id) => set(s => ({
    sessions: s.sessions.filter(sess => sess.id !== id),
    activeSessionId: null,
    screen: 'welcome',
    // Clean up sending/streaming state if the closed session was active
    sendingSessionId:   s.sendingSessionId   === id ? null : s.sendingSessionId,
    streamingSessionId: s.streamingSessionId === id ? null : s.streamingSessionId,
  })),

  addMessage: (sessionId, msg) => set(s => ({
    sessions: s.sessions.map(sess => {
      if (sess.id !== sessionId) return sess
      if (sess.messages.find(m => m.id === msg.id)) return sess
      return { ...sess, messages: [...sess.messages, msg] }
    })
  })),

  appendStream: (sessionId, taskId, chunk) => set(s => ({
    sessions: s.sessions.map(sess => {
      if (sess.id !== sessionId) return sess
      const exists = sess.messages.find(m => m.taskId === taskId && m.type === 'stream')
      if (exists) {
        return { ...sess, messages: sess.messages.map(m =>
          m.taskId === taskId && m.type === 'stream' ? { ...m, content: m.content + chunk } : m
        )}
      }
      return { ...sess, messages: [...sess.messages, {
        id: `stream-${taskId}-${Date.now()}`,
        type: 'stream' as MessageType,
        content: chunk, taskId,
        timestamp: Date.now(),
      }]}
    })
  })),

  finalizeStream: (sessionId, taskId) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId
        ? { ...sess, messages: sess.messages.map(m =>
            m.taskId === taskId && m.type === 'stream'
              ? { ...m, type: 'agent' as MessageType }
              : m
          )}
        : sess
    )
  })),

  addAgent: (sessionId, agent) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId ? { ...sess, agents: [...sess.agents, agent] } : sess
    )
  })),
  updateAgent: (sessionId, agentId, upd) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId
        ? { ...sess, agents: sess.agents.map(a => a.id === agentId ? { ...a, ...upd } : a) }
        : sess
    )
  })),
  addWrittenFile: (sessionId, filePath) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId && !sess.writtenFiles.includes(filePath)
        ? { ...sess, writtenFiles: [...sess.writtenFiles, filePath] }
        : sess
    )
  })),
  setAllFiles: (sessionId, files) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId ? { ...sess, allFiles: files } : sess
    )
  })),
  setSessionSummary: (sessionId, summary) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId ? { ...sess, summary } : sess
    )
  })),

  setSessionProvider: (sessionId, provider, model) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId ? { ...sess, sessionProvider: provider, sessionModel: model } : sess
    )
  })),
  setSessionEffort: (sessionId, effort, thinking) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId ? { ...sess, sessionEffort: effort, sessionThinking: thinking ?? sess.sessionThinking } : sess
    )
  })),
  setModels:        (models)        => set({ models }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setLeftExpanded:  (v) => set({ leftExpanded: v }),
  setRightExpanded: (v) => set({ rightExpanded: v }),
  setConnected:     (v) => set({ isConnected: v }),
  setOnline:        (v) => set({ isOnline: v }),
  setUserName:      (name) => set({ userName: name }),
}))
