import { useState } from 'react'
import { FileText, Bot, GitBranch, Search, Maximize2, FolderOpen, LayoutDashboard } from 'lucide-react'
import { useAppStore } from '../store/appStore'

function CollapsedRight() {
  const session = useAppStore(s => s.sessions.find(p => p.id === s.activeSessionId))
  const hasRunning = session?.agents.some(a => a.status === 'running')
  return (
    <div style={{
      width: 40, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 10, gap: 6, height: '100%',
    }}>
      {[
        { Icon: LayoutDashboard, label: 'Workspace', dot: false },
        { Icon: FolderOpen,      label: 'Files',     dot: false },
        { Icon: GitBranch,       label: 'Git',       dot: false },
        { Icon: Bot,             label: 'Agents',    dot: !!hasRunning },
      ].map(({ Icon, label, dot }) => (
        <div key={label} title={label} style={{ position: 'relative' }}>
          <button className="icon-btn" style={{ width: 32, height: 32 }}>
            <Icon size={15} />
          </button>
          {dot && (
            <span style={{
              position: 'absolute', top: 5, right: 5,
              width: 5, height: 5, borderRadius: '50%',
              background: 'var(--green)', boxShadow: '0 0 4px var(--green)',
            }} />
          )}
        </div>
      ))}
    </div>
  )
}

function SectionHeader({ icon: Icon, title, extra }: { icon: any; title: string; extra?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 12px',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      <Icon size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <span style={{
        flex: 1, fontSize: 10, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)',
      }}>
        {title}
      </span>
      {extra}
    </div>
  )
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>{text}</div>
  )
}

function AgentRow({ agentId, sessionId }: { agentId: string; sessionId: string }) {
  const agent = useAppStore(s => s.sessions.find(p => p.id === sessionId)?.agents.find(a => a.id === agentId))
  if (!agent) return null
  const statusColor = agent.status === 'running' ? 'var(--green)' : agent.status === 'failed' ? 'var(--red)' : 'var(--text-muted)'
  return (
    <div style={{ padding: '4px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className={`agent-badge badge-${agent.role}`}>{agent.role.slice(0, 2).toUpperCase()}</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
        <span style={{ fontSize: 10, color: statusColor }}>{agent.status}</span>
      </div>
      {agent.currentTask && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.currentTask.slice(0, 46)}
        </div>
      )}
      {agent.status === 'running' && (
        <div className="progress-bar" style={{ marginTop: 3 }}>
          <div className="progress-fill pulse" style={{ width: '60%' }} />
        </div>
      )}
    </div>
  )
}

export default function RightSidebar() {
  const { sessions, activeSessionId, rightExpanded } = useAppStore()
  const session = sessions.find(s => s.id === activeSessionId)
  const [fileSearch, setFileSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  if (!rightExpanded) return <CollapsedRight />

  const filteredFiles = (session?.writtenFiles ?? []).filter(f =>
    !fileSearch || f.toLowerCase().includes(fileSearch.toLowerCase())
  )

  return (
    <div style={{
      background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    }}>

      {/* ── Workspace — fixed top strip ─────── */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        <SectionHeader icon={LayoutDashboard} title={`Workspace — ${session?.title ?? 'none'}`} />
        <div style={{ padding: '6px 12px 8px' }}>
          {session ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                background: session.type === 'chat' ? 'var(--accent-dim)' : 'var(--green-dim)',
                color: session.type === 'chat' ? 'var(--accent)' : 'var(--green)',
              }}>
                {session.type}
              </span>
              {session.rootPath && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {session.rootPath.split('/').pop()}
                </span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No session open</span>
          )}
        </div>
      </div>

      {/* ── Four equal sections ──────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

        {/* File structure — flex: 1 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border)', minHeight: 0 }}>
          <SectionHeader icon={FolderOpen} title={`Files (${session?.writtenFiles.length ?? 0})`}
            extra={
              <div style={{ display: 'flex', gap: 3 }}>
                <button className="icon-btn" style={{ width: 18, height: 18 }} title="Search files" onClick={() => setShowSearch(!showSearch)}>
                  <Search size={11} />
                </button>
                <button className="icon-btn" style={{ width: 18, height: 18 }} title="Full view">
                  <Maximize2 size={11} />
                </button>
              </div>
            }
          />
          {showSearch && (
            <input autoFocus placeholder="Search files…" value={fileSearch}
              onChange={e => setFileSearch(e.target.value)}
              style={{
                flexShrink: 0, margin: '4px 10px',
                background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                borderRadius: 5, padding: '3px 8px', color: 'var(--text-primary)',
                fontSize: 11, outline: 'none',
              }}
            />
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
            {filteredFiles.length === 0
              ? <EmptyNote text={fileSearch ? 'No matches' : 'No files yet'} />
              : filteredFiles.map(f => (
                <div key={f} className="file-tree-item new" style={{ padding: '3px 12px' }}>
                  <FileText size={11} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {session?.rootPath ? f.replace(session.rootPath, '').replace(/^\//, '') : f}
                  </span>
                </div>
              ))
            }
          </div>
        </div>

        {/* Git structure — flex: 1 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border)', minHeight: 0 }}>
          <SectionHeader icon={GitBranch} title="Git structure" />
          <EmptyNote text={session?.type === 'project' ? 'Git integration coming soon' : 'Available in project sessions'} />
        </div>

        {/* Agents — flex: 1 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border)', minHeight: 0 }}>
          <SectionHeader icon={Bot} title={`Agents (${session?.agents.length ?? 0})`} />
          <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
            {(!session || session.agents.length === 0)
              ? <EmptyNote text={session?.type === 'project' ? 'No agents yet' : 'Available in project sessions'} />
              : session.agents.map(a => <AgentRow key={a.id} agentId={a.id} sessionId={session.id} />)
            }
          </div>
        </div>

        {/* Project graph — flex: 1 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <SectionHeader icon={LayoutDashboard} title="Project graph"
            extra={
              <button className="icon-btn" style={{ width: 18, height: 18 }} title="Full view">
                <Maximize2 size={11} />
              </button>
            }
          />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 12px' }}>
            <div style={{
              width: '100%', height: '100%', minHeight: 40,
              background: 'var(--bg-tertiary)', borderRadius: 6,
              border: '1px dashed var(--border-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '8px',
            }}>
              {session?.type === 'project' && session.writtenFiles.length > 0
                ? 'Graph builds after first write'
                : 'Available after project files are created'}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
