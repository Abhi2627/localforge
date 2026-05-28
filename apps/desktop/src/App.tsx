import { useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { useWebSocket } from './hooks/useWebSocket'
import { api } from './hooks/useApi'
import TopBar from './components/TopBar'
import IconBar from './components/IconBar'
import ChatPanel from './components/ChatPanel'
import RightSidebar from './components/RightSidebar'
import './index.css'

export default function App() {
  useWebSocket()
  const { setModels, setSelectedModel, addProject, setActiveProject, sidebarVisible, iconBarVisible } = useAppStore()

  useEffect(() => {
    api.getModels().then(({ models }) => {
      setModels(models)
      const selected = models.find((m: any) => m.isSelected)
      if (selected) setSelectedModel(selected.name)
    }).catch(console.error)

    api.getProjects().then(({ projects: existing }) => {
      existing.forEach((p: any) => {
        addProject({
          id: p.id, name: p.name, rootPath: p.rootPath,
          agents: [], messages: [], writtenFiles: [], isActive: false
        })
      })
      if (existing.length > 0) setActiveProject(existing[0].id)
    }).catch(console.error)
  }, [])

  const cols = [
    iconBarVisible ? '48px' : '0px',
    '1fr',
    sidebarVisible ? '260px' : '0px',
  ].join(' ')

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
      <div style={{ gridColumn: '1 / -1' }}>
        <TopBar />
      </div>
      {iconBarVisible && <IconBar />}
      <ChatPanel />
      {sidebarVisible && <RightSidebar />}
    </div>
  )
}
