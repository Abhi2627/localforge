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
import './index.css'

// Breakpoints at which sidebars auto-collapse
const BP_LEFT_COLLAPSE  = 700   // px — collapse left bar below this
const BP_RIGHT_COLLAPSE = 900   // px — collapse right bar below this
const BP_LEFT_HIDE      = 480   // px — hide left bar completely (icon-only still shows)

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

  // Track window width for responsive layout
  const [winW, setWinW] = useState(window.innerWidth)

  const handleResize = useCallback(() => {
    const w = window.innerWidth
    setWinW(w)
    // Auto-collapse when window gets small — don't expand automatically
    if (w < BP_LEFT_COLLAPSE)  setLeftExpanded(false)
    if (w < BP_RIGHT_COLLAPSE) setRightExpanded(false)
  }, [setLeftExpanded, setRightExpanded])

  useEffect(() => {
    window.addEventListener('resize', handleResize)
    handleResize() // run once on mount
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  // Guard against React StrictMode double-invocation
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
        s.title &&
        s.title.trim() !== '' &&
        s.title !== 'Chat' &&
        !s.id.includes('titlegentmp')
      )

      for (const s of clean) {
        let messages: Message[] = []
        try {
          const result = await api.getSession(s.id)
          const seen = new Set<string>()
          messages = (result.messages ?? [])
            .filter((m: any) => {
              if (seen.has(m.id)) return false
              seen.add(m.id)
              return true
            })
            .map((m: any) => ({
              id:        m.id,
              type:      (m.role === 'user' ? 'user' : 'agent') as Message['type'],
              content:   m.content,
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

  // Compute column widths responsively
  const isNarrow     = winW < BP_LEFT_COLLAPSE
  const leftW        = leftExpanded && !isNarrow ? '220px' : '48px'
  const rightW       = showRight
    ? (rightExpanded && winW >= BP_RIGHT_COLLAPSE ? '260px' : '40px')
    : '0px'

  const cols = showRight
    ? `${leftW} 1fr ${rightW}`
    : `${leftW} 1fr`

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols,
      gridTemplateRows: '40px 1fr',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      transition: 'grid-template-columns 0.2s ease',
    }}>
      <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
        <TopBar />
      </div>
      <div style={{ minWidth: 0, overflow: 'hidden' }}>
        <LeftBar />
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', minHeight: 0, minWidth: 0,
      }}>
        <TabStrip />
        {screen === 'welcome' ? <WelcomeScreen /> : <ChatPanel />}
      </div>
      {showRight && (
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          <RightSidebar />
        </div>
      )}
    </div>
  )
}
