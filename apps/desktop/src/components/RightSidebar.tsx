import { FileText } from 'lucide-react'
import { useAppStore } from '../store/appStore'

function AgentStatusRow({ agentId, projectId }: { agentId: string; projectId: string }) {
  const agent = useAppStore(s =>
    s.projects.find(p => p.id === projectId)?.agents.find(a => a.id === agentId)
  )
  if (!agent) return null

  const badgeClass = `agent-badge badge-${agent.role}`
  const statusColor = agent.status === 'running'
    ? 'var(--green)' : agent.status === 'failed'
    ? 'var(--red)' : 'var(--text-muted)'

  return (
    <div style={{ padding: '5px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span className={badgeClass}>{agent.role.slice(0, 2).toUpperCase()}</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{agent.name}</span>
        <span style={{ fontSize: 10, color: statusColor }}>{agent.status}</span>
      </div>
      {agent.currentTask && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3,
          paddingLeft: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {agent.currentTask.slice(0, 50)}
        </div>
      )}
      {agent.status === 'running' && (
        <div className="progress-bar" style={{ marginTop: 4 }}>
          <div className="progress-fill pulse" style={{ width: '60%' }} />
        </div>
      )}
    </div>
  )
}

export default function RightSidebar() {
  const { projects, activeProjectId, setActiveProject, sidebarVisible } = useAppStore()
  const activeProject = projects.find(p => p.id === activeProjectId)

  // When collapsed, render nothing — IconBar toggle button brings it back
  if (!sidebarVisible) return null

  return (
    <div className="right-sidebar">
      <div className="sidebar-section">
        <div className="sidebar-label">Workspace</div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">Active projects</div>
        {projects.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 2px' }}>
            No projects yet — click + to create one
          </div>
        )}
        {projects.map(p => {
          const isRunning = p.agents.some(a => a.status === 'running')
          const isSelected = p.id === activeProjectId
          return (
            <button key={p.id}
              className={`project-pill ${isSelected ? 'active' : ''}`}
              onClick={() => setActiveProject(p.id)}>
              <span className={`status-dot ${isRunning ? 'dot-green' : isSelected ? 'dot-amber' : 'dot-gray'}`} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                {p.agents.length}a
              </span>
            </button>
          )
        })}
      </div>

      {activeProject && activeProject.writtenFiles.length > 0 && (
        <div className="sidebar-section" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="sidebar-label">Files written</div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {activeProject.writtenFiles.map(f => (
              <div key={f} className="file-tree-item new">
                <FileText size={12} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {f.replace(activeProject.rootPath, '').replace(/^\//, '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeProject && activeProject.agents.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-label">Agents</div>
          {activeProject.agents.map(a => (
            <AgentStatusRow key={a.id} agentId={a.id} projectId={activeProject.id} />
          ))}
        </div>
      )}
    </div>
  )
}
