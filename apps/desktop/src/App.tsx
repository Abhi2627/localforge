import { useEffect } from 'react'
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

export default function App() {
  useWebSocket()
  const {
    setModels, setSelectedModel,
    screen, leftExpanded, rightExpanded,
    sessions, activeSessionId,
    addSession,
  } = useAppStore()

  const activeSession    = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = screen === 'session' && activeSession?.type === 'project'
  const showRight        = isProjectSession

  useEffect(() => {
    // Load models
    api.getModels().then(({ models }) => {
      setModels(models)
      const selected = models.find((m: any) => m.isSelected)
      if (selected) setSelectedModel(selected.name)
    }).catch(console.error)

    // Load all sessions with their messages in one pass
    // Build complete session objects BEFORE adding to store
    // so there is zero cross-contamination between sessions
    api.getSessions().then(async ({ sessions: saved }) => {
      const clean = saved.filter((s: any) =>
        s.title &&
        s.title.trim() !== '' &&
        s.title !== 'Chat' &&
        !s.id.endsWith('-titlegentmp')
      )

      for (const s of clean) {
        // Fetch messages for this specific session
        let messages: Message[] = []
        try {
          const result = await api.getSession(s.id)
          messages = (result.messages ?? []).map((m: any) => ({
            id:        m.id,
            type:      (m.role === 'user' ? 'user' : 'agent') as Message['type'],
            content:   m.content,
            agentName: m.agentName ?? undefined,
            timestamp: new Date(m.createdAt).getTime(),
          }))
        } catch { }

        // Add session with its messages already populated
        addSession({
          id:             s.id,
          type:           s.type,
          title:          s.title,
          rootPath:       s.rootPath,
          summary:        s.summary,
          agents:         [],
          messages,           // ← messages included upfront, not added separately
          allFiles:       [],
          writtenFiles:   [],
          lastAccessedAt: new Date(s.updatedAt).getTime(),
          isActive:       false,
        })
      }
    }).catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const leftW  = leftExpanded ? '220px' : '48px'
  const rightW = showRight ? (rightExpanded ? '260px' : '40px') : '0px'
  const cols   = showRight ? `${leftW} 1fr ${rightW}` : `${leftW} 1fr`

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols,
      gridTemplateRows: '40px 1fr',
      height: '100vh', width: '100vw', overflow: 'hidden',
      transition: 'grid-template-columns 0.2s ease',
    }}>
      <div style={{ gridColumn: '1 / -1' }}><TopBar /></div>
      <LeftBar />
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <TabStrip />
        {screen === 'welcome' ? <WelcomeScreen /> : <ChatPanel />}
      </div>
      {showRight && <RightSidebar />}
    </div>
  )
}
