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

function safeTs(val: any): number {
  if (!val) return Date.now()
  const t = new Date(val).getTime()
  return isNaN(t) ? Date.now() : t
}

export default function App() {
  useWebSocket()
  const {
    setModels, setSelectedModel,
    screen, leftExpanded, rightExpanded,
    setLeftExpanded, setRightExpanded,
    sessions, activeSessionId,
    loadSession, setAllFiles, setSessionSummary,
  } = useAppStore()

  const activeSession    = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = screen === 'session' && activeSession?.type === 'project'
  const showRight        = isProjectSession

  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalCwd,  setTerminalCwd]  = useState<string | undefined>(undefined)

  const openSystemTerminal  = useCallback(() => { setTerminalCwd(undefined); setTerminalOpen(true) }, [])
  const openProjectTerminal = useCallback((cwd: string) => { setTerminalCwd(cwd); setTerminalOpen(true) }, [])

  const scannedProjects = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!activeSession || activeSession.type !== 'project' || !activeSession.rootPath) return
    if (scannedProjects.current.has(activeSession.id)) return
    scannedProjects.current.add(activeSession.id)
    setTerminalCwd(activeSession.rootPath)
    if (activeSession.allFiles.length > 0) return
    api.openProject(activeSession.id, activeSession.rootPath)
      .then(result => {
        if (result.fileList?.length) setAllFiles(activeSession.id, result.fileList)
        return api.getProjectSummary(activeSession.id)
      })
      .then(({ summary }) => { if (summary) setSessionSummary(activeSession.id, summary) })
      .catch(console.error)
  }, [activeSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

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

    api.getModels()
      .then(({ models }) => {
        setModels(models)
        const selected = models.find((m: any) => m.isSelected)
        if (selected) setSelectedModel(selected.name)
      })
      .catch(err => console.error('[App] getModels failed:', err))

    api.getSessions()
      .then(async ({ sessions: saved }) => {
        // Filter out junk sessions
        const clean = (saved ?? []).filter((s: any) =>
          s?.id && s?.title &&
          s.title.trim() !== '' &&
          s.title !== 'Chat' &&
          !s.id.includes('titlegentmp')
        )

        for (const s of clean) {
          let messages: Message[] = []
          try {
            const result = await api.getSession(s.id)
            const seen   = new Set<string>()
            messages = (result.messages ?? [])
              .filter((m: any) => {
                if (!m?.id) return false
                if (seen.has(m.id)) return false
                seen.add(m.id)
                return true
              })
              .map((m: any): Message => ({
                id:        m.id,
                type:      (m.role === 'user' ? 'user' : 'agent') as Message['type'],
                content:   m.content ?? '',
                agentName: m.agentName ?? undefined,
                timestamp: safeTs(m.createdAt),
              }))
          } catch (e) {
            // Individual session load failure — skip it, don't crash the whole loop
            console.warn(`[App] Failed to load session ${s.id}:`, e)
          }

          try {
            loadSession({
              id:             s.id,
              type:           s.type ?? 'chat',
              title:          s.title,
              rootPath:       s.rootPath,
              summary:        s.summary,
              createdAt:      s.createdAt,
              updatedAt:      s.updatedAt,
              agents:         [],
              messages,
              allFiles:       [],
              writtenFiles:   [],
              lastAccessedAt: safeTs(s.updatedAt),
              isActive:       false,
            })
          } catch (e) {
            console.warn(`[App] Failed to load session into store ${s.id}:`, e)
          }
        }
      })
      .catch(err => console.error('[App] getSessions failed:', err))

  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isNarrow = winW < BP_LEFT_COLLAPSE
  const leftW    = leftExpanded && !isNarrow ? '220px' : '48px'
  const rightW   = showRight ? (rightExpanded && winW >= BP_RIGHT_COLLAPSE ? '280px' : '40px') : '0px'
  const cols     = showRight ? `${leftW} 1fr ${rightW}` : `${leftW} 1fr`
  const TERM_H   = 260

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols,
      gridTemplateRows: `40px 1fr${terminalOpen ? ` ${TERM_H}px` : ''}`,
      height: '100vh', width: '100vw', overflow: 'hidden',
      transition: 'grid-template-columns 0.2s ease, grid-template-rows 0.2s ease',
    }}>
      <div style={{ gridColumn: '1 / -1', minWidth: 0 }}><TopBar /></div>

      <div style={{ minWidth: 0, overflow: 'hidden' }}>
        <LeftBar onOpenTerminal={openSystemTerminal} onOpenProjectTerminal={openProjectTerminal} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, minWidth: 0 }}>
        <TabStrip />
        {screen === 'welcome'
          ? <WelcomeScreen />
          : <ChatPanel onOpenTerminal={openProjectTerminal} />
        }
      </div>

      {showRight && (
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          <RightSidebar onOpenTerminal={openProjectTerminal} />
        </div>
      )}

      {terminalOpen && (
        <div style={{ gridColumn: '1 / -1', borderTop: '2px solid var(--accent)', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <TerminalPanel cwd={terminalCwd} onClose={() => setTerminalOpen(false)} />
        </div>
      )}
    </div>
  )
}
