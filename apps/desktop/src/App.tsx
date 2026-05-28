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
    addSession,
  } = useAppStore()

  const activeSession   = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = activeSession?.type === 'project'

  // Right sidebar only visible for project sessions
  const showRight = screen === 'session' && isProjectSession

  useEffect(() => {
    api.getModels().then(({ models }) => {
      setModels(models)
      const selected = models.find((m: any) => m.isSelected)
      if (selected) setSelectedModel(selected.name)
    }).catch(console.error)

    api.getSessions().then(({ sessions: saved }) => {
      saved.forEach((s: any) => {
        addSession({
          id: s.id, type: s.type, title: s.title,
          rootPath: s.rootPath, summary: s.summary,
          agents: [], messages: [], allFiles: [], writtenFiles: [],
          lastAccessedAt: new Date(s.updatedAt).getTime(),
          isActive: false,
        })
      })
    }).catch(console.error)
  }, [])

  const leftW  = leftExpanded ? '220px' : '48px'
  const rightW = showRight ? (rightExpanded ? '260px' : '40px') : '0px'
  const cols   = showRight
    ? `${leftW} 1fr ${rightW}`
    : `${leftW} 1fr`

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols,
      gridTemplateRows: '40px 1fr',
      height: '100vh', width: '100vw', overflow: 'hidden',
      transition: 'grid-template-columns 0.2s ease',
    }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <TopBar />
      </div>
      <LeftBar />
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <TabStrip />
        {screen === 'welcome' ? <WelcomeScreen /> : <ChatPanel />}
      </div>
      {showRight && <RightSidebar />}
    </div>
  )
}
