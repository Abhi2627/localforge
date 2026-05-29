import { useState } from 'react'
import { FileText, Bot, GitBranch, Search, Maximize2, FolderOpen, LayoutDashboard, Plus, Loader, Terminal } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import AgentModal from './AgentModal'
import ProjectGraph from './ProjectGraph'
import TerminalPanel from './TerminalPanel'

function CollapsedRight() {
  const session    = useAppStore(s => s.sessions.find(p => p.id === s.activeSessionId))
  const hasRunning = session?.agents.some(a => a.status === 'running')
  return (
    <div style={{ width: 40, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10, gap: 6, height: '100%' }}>
      {[
        { Icon: LayoutDashboard, label: 'Workspace', dot: false },
        { Icon: FolderOpen,      label: 'Files',     dot: false },
        { Icon: GitBranch,       label: 'Git',       dot: false },
        { Icon: Bot,             label: 'Agents',    dot: !!hasRunning },
        { Icon: Terminal,        label: 'Terminal',  dot: false },
      ].map(({ Icon, label, dot }) => (
        <div key={label} title={label} style={{ position: 'relative' }}>
          <button className="icon-btn" style={{ width: 32, height: 32 }}><Icon size={15} /></button>
          {dot && <span style={{ position: 'absolute', top: 5, right: 5, width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 4px var(--green)' }} />}
        </div>
      ))}
    </div>
  )
}

function SectionHeader({ icon: Icon, title, extra }: { icon: any; title: string; extra?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <Icon size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{title}</span>
      {extra}
    </div>
  )
}

function EmptyNote({ text }: { text: string }) {
  return <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)' }}>{text}</div>
}

function AgentRow({ agentId, sessionId }: { agentId: string; sessionId: string }) {
  const agent = useAppStore(s => s.sessions.find(p => p.id === sessionId)?.agents.find(a => a.id === agentId))
  if (!agent) return null
  const statusColor = agent.status === 'running' ? 'var(--green)' : agent.status === 'failed' ? 'var(--red)' : 'var(--text-muted)'
  return (
    <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className={`agent-badge badge-${agent.role}`} style={{ flexShrink: 0 }}>
          {agent.role.slice(0, 2).toUpperCase()}
        </span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
        {agent.status === 'running' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 4px var(--green)', flexShrink: 0 }} />}
        <span style={{ fontSize: 10, color: statusColor, flexShrink: 0 }}>{agent.status}</span>
      </div>
      {agent.currentTask && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, paddingLeft: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.currentTask.slice(0, 48)}
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
  const { sessions, activeSessionId, rightExpanded } = useAppStore()
  const session = sessions.find(s => s.id === activeSessionId)

  const [fileSearch, setFileSearch]   = useState('')
  const [showSearch, setShowSearch]   = useState(false)
  const [showAgentModal, setShowAgentModal] = useState(false)
  const [showTerminal, setShowTerminal]     = useState(false)
  const [graphFullscreen, setGraphFullscreen] = useState(false)

  if (!rightExpanded) return <CollapsedRight />

  const allFiles     = session?.allFiles ?? []
  const writtenFiles = session?.writtenFiles ?? []
  const mergedFiles  = [...new Set([...allFiles, ...writtenFiles])]
  const isNewFile    = (f: string) => writtenFiles.includes(f)
  const filteredFiles = mergedFiles.filter(f =>
    !fileSearch || f.toLowerCase().includes(fileSearch.toLowerCase())
  )
  const relativePath = (f: string) =>
    session?.rootPath ? f.replace(session.rootPath, '').replace(/^[/\\]/, '') : f

  return (
    <div style={{ background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Workspace ─────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        <SectionHeader icon={LayoutDashboard} title={`Workspace — ${session?.title ?? 'none'}`} />
        <div style={{ padding: '6px 12px 8px' }}>
          {session ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                  {session.type}
                </span>
                {session.rootPath && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {session.rootPath.split('/').pop()}
                  </span>
                )}
              </div>
              {session.summary ? (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, maxHeight: 72, overflowY: 'auto' }}>
                  {session.summary}
                </div>
              ) : session.type === 'project' && session.rootPath ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                  <Loader size={10} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                  Scanning project…
                </div>
              ) : null}
            </div>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No session open</span>
          )}
        </div>
      </div>

      {/* Scrollable sections */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

        {/* ── Files ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border)', minHeight: 0 }}>
          <SectionHeader icon={FolderOpen} title={`Files (${mergedFiles.length})`}
            extra={
              <div style={{ display: 'flex', gap: 3 }}>
                <button className="icon-btn" style={{ width: 18, height: 18 }} onClick={() => setShowSearch(!showSearch)} title="Search"><Search size={11} /></button>
                <button className="icon-btn" style={{ width: 18, height: 18 }} title="Fullscreen"><Maximize2 size={11} /></button>
              </div>
            }
          />
          {showSearch && (
            <input autoFocus placeholder="Search files…" value={fileSearch}
              onChange={e => setFileSearch(e.target.value)}
              style={{ flexShrink: 0, margin: '4px 10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
            />
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
            {filteredFiles.length === 0
              ? <EmptyNote text={fileSearch ? 'No matches' : 'No files yet'} />
              : filteredFiles.map(f => (
                <div key={f} className={`file-tree-item ${isNewFile(f) ? 'new' : ''}`} style={{ padding: '3px 12px' }}>
                  <FileText size={11} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>{relativePath(f)}</span>
                  {isNewFile(f) && <span style={{ fontSize: 9, color: 'var(--accent)', marginLeft: 'auto', flexShrink: 0 }}>new</span>}
                </div>
              ))
            }
          </div>
        </div>

        {/* ── Git ───────────────────────────────────────────────── */}
        <div style={{ flex: 0.6, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border)', minHeight: 0 }}>
          <SectionHeader icon={GitBranch} title="Git" />
          <EmptyNote text="Git integration — Phase 3" />
        </div>

        {/* ── Agents ───────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border)', minHeight: 0 }}>
          <SectionHeader icon={Bot} title={`Agents (${session?.agents.length ?? 0})`}
            extra={
              session?.type === 'project' && (
                <button className="icon-btn" style={{ width: 18, height: 18 }} title="Add agent" onClick={() => setShowAgentModal(true)}>
                  <Plus size={11} />
                </button>
              )
            }
          />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {(!session || session.agents.length === 0) ? (
              session?.type === 'project' ? (
                <div style={{ padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>No agents yet. Add one to start building.</div>
                  <button onClick={() => setShowAgentModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 10px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: 'white', fontSize: 11, fontWeight: 500, cursor: 'pointer', justifyContent: 'center' }}>
                    <Plus size={12} /> Add first agent
                  </button>
                </div>
              ) : <EmptyNote text="Available in project sessions" />
            ) : (
              <>
                {session.agents.map(a => <AgentRow key={a.id} agentId={a.id} sessionId={session.id} />)}
                <button onClick={() => setShowAgentModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '6px 12px', padding: '5px 8px', background: 'transparent', border: '1px dashed var(--border-light)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', width: 'calc(100% - 24px)', justifyContent: 'center' }}>
                  <Plus size={11} /> Add agent
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Project graph ─────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border)', minHeight: 0 }}>
          <SectionHeader icon={LayoutDashboard} title="Project graph"
            extra={
              <button className="icon-btn" style={{ width: 18, height: 18 }} title="Fullscreen" onClick={() => setGraphFullscreen(true)}>
                <Maximize2 size={11} />
              </button>
            }
          />
          <ProjectGraph files={mergedFiles} rootPath={session?.rootPath ?? ''} />
        </div>

        {/* ── Terminal — project sessions only ──────────────────── */}
        <div style={{
          flexShrink: 0,
          height: showTerminal ? '220px' : 'auto',
          minHeight: showTerminal ? 180 : 'auto',
          borderTop: showTerminal ? '2px solid var(--accent)' : 'none',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          transition: 'height 0.2s ease',
        }}>
          {/* Terminal header — always visible */}
          <div
            onClick={() => setShowTerminal(!showTerminal)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', cursor: 'pointer', flexShrink: 0,
              borderTop: '1px solid var(--border)',
              background: showTerminal ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
              color: showTerminal ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            <Terminal size={12} />
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>Terminal</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{showTerminal ? '▾' : '▸'}</span>
          </div>

          {/* xterm panel */}
          {showTerminal && (
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              <TerminalPanel
                cwd={session?.rootPath}
                onClose={() => setShowTerminal(false)}
              />
            </div>
          )}
        </div>

      </div>

      {/* Agent modal */}
      {showAgentModal && session && (
        <AgentModal sessionId={session.id} projectId={session.id} onClose={() => setShowAgentModal(false)} />
      )}

      {/* Graph fullscreen overlay */}
      {graphFullscreen && session && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
          onClick={() => setGraphFullscreen(false)}>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, width: '80vw', height: '80vh', display: 'flex', flexDirection: 'column', gap: 8 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Project graph — {session.title}</span>
              <button className="icon-btn" onClick={() => setGraphFullscreen(false)} style={{ width: 26, height: 26 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ProjectGraph files={mergedFiles} rootPath={session.rootPath ?? ''} />
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
