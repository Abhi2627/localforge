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
  const { setModels, setSelectedModel, addProject, setActiveProject, sidebarVisible } = useAppStore()

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

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: sidebarVisible ? '48px 1fr 260px' : '48px 1fr',
      gridTemplateRows: '40px 1fr',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      transition: 'grid-template-columns 0.2s ease',
    }}>
      {/* Full-width topbar */}
      <div style={{ gridColumn: '1 / -1' }}>
        <TopBar />
      </div>
      <IconBar />
      <ChatPanel />
      {sidebarVisible && <RightSidebar />}
    </div>
  )
}
