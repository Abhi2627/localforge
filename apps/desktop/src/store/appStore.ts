import { create } from 'zustand'

export type AgentRole = 'frontend' | 'backend' | 'fullstack' | 'test' | 'review'
export type MessageType = 'user' | 'agent' | 'system' | 'stream'

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

export interface Project {
  id: string
  name: string
  rootPath: string
  agents: Agent[]
  messages: Message[]
  writtenFiles: string[]
  isActive: boolean
}

export interface OllamaModel {
  name: string
  sizeGb: string
  isSelected: boolean
  isFallback: boolean
}

export type ActiveView = 'chat' | 'terminal' | 'files'

interface AppState {
  projects:         Project[]
  activeProjectId:  string | null
  models:           OllamaModel[]
  selectedModel:    string
  activeView:       ActiveView
  sidebarVisible:   boolean
  iconBarVisible:   boolean
  terminalVisible:  boolean
  isConnected:      boolean

  setProjects:         (projects: Project[]) => void
  addProject:          (project: Project) => void
  setActiveProject:    (id: string) => void
  addMessage:          (projectId: string, msg: Message) => void
  appendStream:        (projectId: string, taskId: string, chunk: string) => void
  finalizeStream:      (projectId: string, taskId: string) => void
  addAgent:            (projectId: string, agent: Agent) => void
  updateAgent:         (projectId: string, agentId: string, update: Partial<Agent>) => void
  addWrittenFile:      (projectId: string, filePath: string) => void
  setModels:           (models: OllamaModel[]) => void
  setSelectedModel:    (model: string) => void
  setActiveView:       (view: ActiveView) => void
  setSidebarVisible:   (v: boolean) => void
  setIconBarVisible:   (v: boolean) => void
  setTerminalVisible:  (v: boolean) => void
  setConnected:        (v: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  projects:        [],
  activeProjectId: null,
  models:          [],
  selectedModel:   '',
  activeView:      'chat',
  sidebarVisible:  true,
  iconBarVisible:  true,
  terminalVisible: false,
  isConnected:     false,

  setProjects:      (projects) => set({ projects }),
  addProject:       (project)  => set(s => ({ projects: [...s.projects, project] })),
  setActiveProject: (id)       => set(s => ({
    activeProjectId: id,
    projects: s.projects.map(p => ({ ...p, isActive: p.id === id }))
  })),

  addMessage: (projectId, msg) => set(s => ({
    projects: s.projects.map(p =>
      p.id === projectId ? { ...p, messages: [...p.messages, msg] } : p
    )
  })),

  appendStream: (projectId, taskId, chunk) => set(s => ({
    projects: s.projects.map(p => {
      if (p.id !== projectId) return p
      const exists = p.messages.find(m => m.taskId === taskId && m.type === 'stream')
      if (exists) {
        return { ...p, messages: p.messages.map(m =>
          m.taskId === taskId && m.type === 'stream' ? { ...m, content: m.content + chunk } : m
        )}
      }
      return { ...p, messages: [...p.messages, {
        id: `stream-${taskId}-${Date.now()}`,
        type: 'stream' as MessageType,
        content: chunk,
        taskId,
        timestamp: Date.now()
      }]}
    })
  })),

  finalizeStream: (projectId, taskId) => set(s => ({
    projects: s.projects.map(p =>
      p.id === projectId ? { ...p, messages: p.messages.map(m =>
        m.taskId === taskId && m.type === 'stream' ? { ...m, type: 'agent' as MessageType } : m
      )} : p
    )
  })),

  addAgent: (projectId, agent) => set(s => ({
    projects: s.projects.map(p =>
      p.id === projectId ? { ...p, agents: [...p.agents, agent] } : p
    )
  })),

  updateAgent: (projectId, agentId, update) => set(s => ({
    projects: s.projects.map(p =>
      p.id === projectId ? { ...p, agents: p.agents.map(a =>
        a.id === agentId ? { ...a, ...update } : a
      )} : p
    )
  })),

  addWrittenFile: (projectId, filePath) => set(s => ({
    projects: s.projects.map(p =>
      p.id === projectId && !p.writtenFiles.includes(filePath)
        ? { ...p, writtenFiles: [...p.writtenFiles, filePath] }
        : p
    )
  })),

  setModels:          (models)        => set({ models }),
  setSelectedModel:   (selectedModel) => set({ selectedModel }),
  setActiveView:      (activeView)    => set({ activeView }),
  setSidebarVisible:  (v) => set({ sidebarVisible: v }),
  setIconBarVisible:  (v) => set({ iconBarVisible: v }),
  setTerminalVisible: (v) => set({ terminalVisible: v }),
  setConnected:       (v) => set({ isConnected: v }),
}))
