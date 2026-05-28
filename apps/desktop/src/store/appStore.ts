import { create } from 'zustand'

export type AgentRole = 'frontend' | 'backend' | 'fullstack' | 'test' | 'review'
export type MessageType = 'user' | 'agent' | 'system' | 'stream'
export type SessionType = 'chat' | 'project' | 'terminal'

export interface Message {
  id: string
  type: MessageType
  content: string
  agentName?: string
  agentRole?: AgentRole
  taskId?: string
  filePath?: string
  timestamp: number
}

export interface Agent {
  id: string
  name: string
  role: AgentRole
  status: 'idle' | 'running' | 'done' | 'failed'
  currentTask?: string
}

// A Session is either a Chat, a Project, or a Terminal
export interface Session {
  id: string
  type: SessionType
  title: string
  rootPath?: string         // only for projects
  agents: Agent[]
  messages: Message[]
  writtenFiles: string[]
  lastAccessedAt: number    // unix ms — used for tab strip logic
  isActive: boolean
}

export interface OllamaModel {
  name: string
  sizeGb: string
  isSelected: boolean
  isFallback: boolean
}

export type ActiveView = 'chat' | 'project' | 'terminal' | 'extensions'
export type AppScreen = 'welcome' | 'session'

interface AppState {
  screen:           AppScreen
  sessions:         Session[]
  activeSessionId:  string | null
  activeView:       ActiveView
  models:           OllamaModel[]
  selectedModel:    string
  leftExpanded:     boolean
  rightExpanded:    boolean
  isConnected:      boolean

  // Derived: recent sessions within 24h for tab strip
  getRecentTabs:    () => Session[]

  // Actions
  setScreen:           (s: AppScreen) => void
  addSession:          (session: Session) => void
  setActiveSession:    (id: string) => void
  updateSessionTitle:  (id: string, title: string) => void
  closeSession:        (id: string) => void
  addMessage:          (sessionId: string, msg: Message) => void
  appendStream:        (sessionId: string, taskId: string, chunk: string) => void
  finalizeStream:      (sessionId: string, taskId: string) => void
  addAgent:            (sessionId: string, agent: Agent) => void
  updateAgent:         (sessionId: string, agentId: string, update: Partial<Agent>) => void
  addWrittenFile:      (sessionId: string, filePath: string) => void
  setModels:           (models: OllamaModel[]) => void
  setSelectedModel:    (model: string) => void
  setActiveView:       (view: ActiveView) => void
  setLeftExpanded:     (v: boolean) => void
  setRightExpanded:    (v: boolean) => void
  setConnected:        (v: boolean) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  screen:          'welcome',
  sessions:        [],
  activeSessionId: null,
  activeView:      'chat',
  models:          [],
  selectedModel:   '',
  leftExpanded:    true,
  rightExpanded:   true,
  isConnected:     false,

  getRecentTabs: () => {
    const { sessions } = get()
    const now = Date.now()
    const within24h = sessions.filter(s => now - s.lastAccessedAt < 24 * 60 * 60 * 1000)
    return within24h
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      .slice(0, 5)
  },

  setScreen: (screen) => set({ screen }),

  addSession: (session) => set(s => ({
    sessions: [...s.sessions, session],
    screen: 'session',
  })),

  setActiveSession: (id) => set(s => ({
    activeSessionId: id,
    screen: 'session',
    sessions: s.sessions.map(sess => ({
      ...sess,
      isActive: sess.id === id,
      lastAccessedAt: sess.id === id ? Date.now() : sess.lastAccessedAt,
    })),
  })),

  updateSessionTitle: (id, title) => set(s => ({
    sessions: s.sessions.map(sess => sess.id === id ? { ...sess, title } : sess)
  })),

  closeSession: (id) => set(s => {
    const remaining = s.sessions.filter(sess => sess.id !== id)
    const newActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null
    return {
      sessions: remaining,
      activeSessionId: newActive,
      screen: newActive ? 'session' : 'welcome',
    }
  }),

  addMessage: (sessionId, msg) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId ? { ...sess, messages: [...sess.messages, msg] } : sess
    )
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
        content: chunk, taskId, timestamp: Date.now()
      }]}
    })
  })),

  finalizeStream: (sessionId, taskId) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId ? { ...sess, messages: sess.messages.map(m =>
        m.taskId === taskId && m.type === 'stream' ? { ...m, type: 'agent' as MessageType } : m
      )} : sess
    )
  })),

  addAgent: (sessionId, agent) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId ? { ...sess, agents: [...sess.agents, agent] } : sess
    )
  })),

  updateAgent: (sessionId, agentId, update) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId ? { ...sess, agents: sess.agents.map(a =>
        a.id === agentId ? { ...a, ...update } : a
      )} : sess
    )
  })),

  addWrittenFile: (sessionId, filePath) => set(s => ({
    sessions: s.sessions.map(sess =>
      sess.id === sessionId && !sess.writtenFiles.includes(filePath)
        ? { ...sess, writtenFiles: [...sess.writtenFiles, filePath] }
        : sess
    )
  })),

  setModels:         (models)        => set({ models }),
  setSelectedModel:  (selectedModel) => set({ selectedModel }),
  setActiveView:     (activeView)    => set({ activeView }),
  setLeftExpanded:   (v) => set({ leftExpanded: v }),
  setRightExpanded:  (v) => set({ rightExpanded: v }),
  setConnected:      (v) => set({ isConnected: v }),
}))
