import { MessageCircle, Terminal, FolderOpen, Settings, PanelRightOpen } from 'lucide-react'
import { useAppStore, type ActiveView } from '../store/appStore'

const VIEWS: { id: ActiveView; Icon: any; label: string }[] = [
  { id: 'chat',     Icon: MessageCircle, label: 'Chat' },
  { id: 'terminal', Icon: Terminal,      label: 'Terminal' },
  { id: 'files',    Icon: FolderOpen,    label: 'Files' },
]

export default function IconBar() {
  const { activeView, setActiveView, setTerminalVisible, terminalVisible, sidebarVisible, setSidebarVisible } = useAppStore()

  function handleClick(id: ActiveView) {
    if (id === 'terminal') {
      setTerminalVisible(!terminalVisible)
    } else {
      setActiveView(id)
    }
  }

  return (
    <div className="iconbar">
      {VIEWS.map(({ id, Icon, label }) => (
        <button
          key={id}
          className={`icon-btn ${activeView === id ? 'active' : ''}`}
          title={label}
          onClick={() => handleClick(id)}
        >
          <Icon size={17} />
        </button>
      ))}

      <div style={{ flex: 1 }} />

      {/* Toggle right sidebar */}
      <button
        className={`icon-btn ${sidebarVisible ? 'active' : ''}`}
        title={sidebarVisible ? 'Collapse workspace' : 'Expand workspace'}
        onClick={() => setSidebarVisible(!sidebarVisible)}
      >
        <PanelRightOpen size={17} />
      </button>

      <button className="icon-btn" title="Settings">
        <Settings size={17} />
      </button>
    </div>
  )
}
