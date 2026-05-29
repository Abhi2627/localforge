import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore, type Message } from './store/appStore'
import { useWebSocket } from './hooks/useWebSocket'
import { api } from './hooks/useApi'
import TopBar from './components/TopBar'
import LeftBar from './components/LeftBar'
import ChatPanel from './components/ChatPanel'
import RightSidebar from './components/RightSidebar'
import WelcomeScreen from './components/WelcomeScreen'
import TabStrip from './components/TabStrip'
import TerminalPanel from './components/TerminalPanel'
import './index.css'

const BP_LEFT_COLLAPSE  = 700
const BP_RIGHT_COLLAPSE = 900

export default function App() {
  useWebSocket()
  const {
    setModels, setSelectedModel,
    screen, leftExpanded, rightExpanded,
    setLeftExpanded, setRightExpanded,
    sessions, activeSessionId,
    loadSession,
  } = useAppStore()

  const activeSession    = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = screen === 'session' && activeSession?.type === 'project'
  const showRight        = isProjectSession

  // Terminal state — lives at App level so it spans full width below the editor
  const [terminalOpen, setTerminalOpen]   = useState(false)
  const [terminalCwd,  setTerminalCwd]    = useState<string | undefined>(undefined)

  // Called from LeftBar terminal button — opens system root terminal
  const openSystemTerminal = useCallback(() => {
    setTerminalCwd(undefined)   // undefined = home dir on server
    setTerminalOpen(true)
  }, [])

  // Called when a project session opens the terminal
  const openProjectTerminal = useCallback((cwd: string) => {
    setTerminalCwd(cwd)
    setTerminalOpen(true)
  }, [])

  // When active session changes, update terminal cwd if it's a project
  useEffect(() => {
    if (activeSession?.type === 'project' && activeSession.rootPath) {
      setTerminalCwd(activeSession.rootPath)
    }
  }, [activeSessionId])

  const [winW, setWinW] = useState(window.innerWidth)
  const handleResize = useCallback(() => {
    const w = window.innerWidth
    setWinW(w)
    if (w < BP_LEFT_COLLAPSE)  setLeftExpanded(false)
    if (w < BP_RIGHT_COLLAPSE) setRightExpanded(false)
  }, [setLeftExpanded, setRightExpanded])

  useEffect(() => {
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  const loadedRef = useRef(false)
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    api.getModels().then(({ models }) => {
      setModels(models)
      const selected = models.find((m: any) => m.isSelected)
      if (selected) setSelectedModel(selected.name)
    }).catch(console.error)

    api.getSessions().then(async ({ sessions: saved }) => {
      const clean = saved.filter((s: any) =>
        s.title && s.title.trim() !== '' && s.title !== 'Chat' && !s.id.includes('titlegentmp')
      )
      for (const s of clean) {
        let messages: Message[] = []
        try {
          const result = await api.getSession(s.id)
          const seen = new Set<string>()
          messages = (result.messages ?? [])
            .filter((m: any) => { if (seen.has(m.id)) return false; seen.add(m.id); return true })
            .map((m: any) => ({
              id: m.id,
              type: (m.role === 'user' ? 'user' : 'agent') as Message['type'],
              content: m.content,
              agentName: m.agentName ?? undefined,
              timestamp: new Date(m.createdAt).getTime(),
            }))
        } catch { }
        loadSession({
          id: s.id, type: s.type, title: s.title,
          rootPath: s.rootPath, summary: s.summary,
          agents: [], messages, allFiles: [], writtenFiles: [],
          lastAccessedAt: new Date(s.updatedAt).getTime(),
          isActive: false,
        })
      }
    }).catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isNarrow = winW < BP_LEFT_COLLAPSE
  const leftW    = leftExpanded && !isNarrow ? '220px' : '48px'
  const rightW   = showRight ? (rightExpanded && winW >= BP_RIGHT_COLLAPSE ? '280px' : '40px') : '0px'
  const cols     = showRight ? `${leftW} 1fr ${rightW}` : `${leftW} 1fr`

  // Terminal height
  const TERMINAL_H = 260

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols,
      gridTemplateRows: `40px 1fr${terminalOpen ? ` ${TERMINAL_H}px` : ''}`,
      height: '100vh', width: '100vw', overflow: 'hidden',
      transition: 'grid-template-columns 0.2s ease, grid-template-rows 0.2s ease',
    }}>
      {/* Top bar — spans all columns */}
      <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
        <TopBar />
      </div>

      {/* Left sidebar */}
      <div style={{ minWidth: 0, overflow: 'hidden', gridRow: terminalOpen ? '2 / 3' : '2' }}>
        <LeftBar
          onOpenTerminal={openSystemTerminal}
          onOpenProjectTerminal={openProjectTerminal}
        />
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, minWidth: 0 }}>
        <TabStrip />
        {screen === 'welcome' ? <WelcomeScreen /> : <ChatPanel />}
      </div>

      {/* Right sidebar */}
      {showRight && (
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          <RightSidebar onOpenTerminal={openProjectTerminal} />
        </div>
      )}

      {/* Terminal — spans all columns at the bottom, VSCode-style */}
      {terminalOpen && (
        <div style={{
          gridColumn: '1 / -1',
          borderTop: '2px solid var(--accent)',
          background: '#0a0a0a',
          minHeight: 0, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <TerminalPanel
            cwd={terminalCwd}
            onClose={() => setTerminalOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
