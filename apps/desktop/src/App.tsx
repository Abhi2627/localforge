import { useEffect } from 'react'
import { useAppStore } from './store/appStore'
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
    addSession, addMessage,
  } = useAppStore()

  const activeSession    = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = screen === 'session' && activeSession?.type === 'project'
  const showRight        = isProjectSession

  useEffect(() => {
    api.getModels().then(({ models }) => {
      setModels(models)
      const selected = models.find((m: any) => m.isSelected)
      if (selected) setSelectedModel(selected.name)
    }).catch(console.error)

    api.getSessions().then(({ sessions: saved }) => {
      const clean = saved.filter((s: any) =>
        s.title &&
        s.title.trim() !== '' &&
        s.title !== 'Chat' &&
        !s.id.endsWith('-titlegentmp')
      )

      // Load each session and its messages
      clean.forEach(async (s: any) => {
        addSession({
          id: s.id, type: s.type, title: s.title,
          rootPath: s.rootPath, summary: s.summary,
          agents: [], messages: [], allFiles: [], writtenFiles: [],
          lastAccessedAt: new Date(s.updatedAt).getTime(),
          isActive: false,
        })

        // Load persisted messages for this session
        try {
          const { messages } = await api.getSession(s.id)
          messages.forEach((m: any) => {
            addMessage(s.id, {
              id:        m.id,
              type:      m.role === 'user' ? 'user' : 'agent',
              content:   m.content,
              agentName: m.agentName ?? undefined,
              timestamp: new Date(m.createdAt).getTime(),
            })
          })
        } catch { }
      })
    }).catch(console.error)
  }, [])

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
