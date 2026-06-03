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
import TerminalPanel from './components/TerminalPanel'
import { getDeletedIds, markDeleted } from './hooks/deletedSessions'
import './index.css'

const BP_LEFT_COLLAPSE  = 700
const BP_RIGHT_COLLAPSE = 900

function safeTs(val: any): number {
  if (!val) return Date.now()
  const t = new Date(val).getTime()
  return isNaN(t) ? Date.now() : t
}

async function waitForServer(maxAttempts = 20): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(1500) })
      if (res.ok) return true
    } catch { }
    await new Promise(r => setTimeout(r, 800))
  }
  return false
}

// Session IDs that should never be loaded
function isGarbageSession(s: any): boolean {
  if (!s?.id || !s?.title) return true
  if (s.title.trim() === '') return true
  if (getDeletedIds().has(s.id)) return true
  return false
}

export default function App() {
  useWebSocket()
  const {
    setModels, setSelectedModel,
    screen, leftExpanded, rightExpanded,
    setLeftExpanded, setRightExpanded,
    sessions, activeSessionId,
    loadSession, setAllFiles, setSessionSummary,
  } = useAppStore()

  const activeSession    = sessions.find(s => s.id === activeSessionId)
  const isProjectSession = screen === 'session' && activeSession?.type === 'project'
  const showRight        = isProjectSession

  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalCwd,  setTerminalCwd]  = useState<string | undefined>(undefined)
  const [serverReady,  setServerReady]  = useState(false)
  const [serverError,  setServerError]  = useState(false)

  const openSystemTerminal  = useCallback(() => { setTerminalCwd(undefined); setTerminalOpen(true) }, [])
  const openProjectTerminal = useCallback((cwd: string) => { setTerminalCwd(cwd); setTerminalOpen(true) }, [])

  const scannedProjects = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!activeSession || activeSession.type !== 'project' || !activeSession.rootPath) return
    if (scannedProjects.current.has(activeSession.id)) return
    scannedProjects.current.add(activeSession.id)
    setTerminalCwd(activeSession.rootPath)
    if (activeSession.allFiles.length > 0) return
    api.openProject(activeSession.id, activeSession.rootPath)
      .then(result => {
        if (result.fileList?.length) setAllFiles(activeSession.id, result.fileList)
        return api.getProjectSummary(activeSession.id)
      })
      .then(({ summary }) => { if (summary) setSessionSummary(activeSession.id, summary) })
      .catch(console.error)
  }, [activeSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const [winW, setWinW] = useState(window.innerWidth)
  const handleResize = useCallback(() => {
    const w = window.innerWidth
    setWinW(w)
    if (w < BP_LEFT_COLLAPSE)  setLeftExpanded(false)
    if (w < BP_RIGHT_COLLAPSE) setRightExpanded(false)
  }, [setLeftExpanded, setRightExpanded])

  useEffect(() => {
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  const loadedRef = useRef(false)
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    waitForServer().then(async (online) => {
      if (!online) { setServerError(true); return }
      setServerReady(true)

      // Load models
      api.getModels()
        .then(({ models }) => {
          setModels(models)
          const selected = models.find((m: any) => m.isSelected)
          if (selected) setSelectedModel(selected.name)
        })
        .catch(err => console.error('[App] getModels:', err))

      // Load and clean sessions
      api.getSessions()
        .then(async ({ sessions: saved }) => {
          const all = saved ?? []

          // Mark garbage sessions as deleted in localStorage so they never reload
          const garbage = all.filter(isGarbageSession)
          for (const s of garbage) {
            markDeleted(s.id)
            api.deleteSession(s.id).catch(() => {})
          }

          const clean = all.filter((s: any) => !isGarbageSession(s))

          for (const s of clean) {
            let messages: Message[] = []
            try {
              const result = await api.getSession(s.id)
              const seen   = new Set<string>()
              messages = (result.messages ?? [])
                .filter((m: any) => {
                  if (!m?.id) return false
                  if (seen.has(m.id)) return false
                  seen.add(m.id)
                  return true
                })
                .map((m: any): Message => ({
                  id:        m.id,
                  type:      (m.role === 'user' ? 'user' : 'agent') as Message['type'],
                  content:   m.content ?? '',
                  agentName: m.agentName,
                  timestamp: safeTs(m.createdAt),
                }))
            } catch { }

            loadSession({
              id:             s.id,
              type:           s.type ?? 'chat',
              title:          s.title,
              rootPath:       s.rootPath,
              summary:        s.summary,
              createdAt:      s.createdAt,
              updatedAt:      s.updatedAt,
              agents:         [],
              messages,
              allFiles:       [],
              writtenFiles:   [],
              lastAccessedAt: safeTs(s.updatedAt),
              isActive:       false,
            })
          }
        })
        .catch(err => console.error('[App] getSessions:', err))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isNarrow = winW < BP_LEFT_COLLAPSE
  const leftW    = leftExpanded && !isNarrow ? '220px' : '48px'
  const rightW   = showRight ? (rightExpanded && winW >= BP_RIGHT_COLLAPSE ? '280px' : '40px') : '0px'
  const cols     = showRight ? `${leftW} 1fr ${rightW}` : `${leftW} 1fr`
  const TERM_H   = 260

  if (!serverReady && !serverError) {
    return (
      <div style={{ height:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'var(--bg-primary)', gap:16 }}>
        <div style={{ fontSize:24, fontWeight:700, color:'var(--text-primary)' }}>LocalForge</div>
        <div style={{ display:'flex', alignItems:'center', gap:10, color:'var(--text-muted)', fontSize:13 }}>
          <div style={{ width:16, height:16, border:'2px solid var(--accent)', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
          Starting agent server…
        </div>
        <div style={{ fontSize:11, color:'var(--text-muted)', opacity:0.6 }}>
          Make sure <code style={{ fontFamily:'monospace', color:'var(--accent)' }}>npm run dev</code> is running in packages/agent-core
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (serverError) {
    return (
      <div style={{ height:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'var(--bg-primary)', gap:16 }}>
        <div style={{ fontSize:24, fontWeight:700, color:'var(--text-primary)' }}>LocalForge</div>
        <div style={{ color:'var(--red)', fontSize:13 }}>⚠ Cannot connect to agent server</div>
        <div style={{ fontSize:12, color:'var(--text-muted)', textAlign:'center', maxWidth:360, lineHeight:1.7 }}>
          Start the server first:<br/>
          <code style={{ fontFamily:'monospace', color:'var(--accent)', fontSize:11 }}>cd packages/agent-core && npm run dev</code>
        </div>
        <button onClick={() => { loadedRef.current=false; setServerError(false); setServerReady(false) }}
          style={{ padding:'8px 20px', background:'var(--accent)', border:'none', borderRadius:8, color:'white', fontSize:13, cursor:'pointer', marginTop:8 }}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:cols, gridTemplateRows:`40px 1fr${terminalOpen?` ${TERM_H}px`:''}`, height:'100vh', width:'100vw', overflow:'hidden', transition:'grid-template-columns 0.2s ease, grid-template-rows 0.2s ease' }}>
      <div style={{ gridColumn:'1 / -1', minWidth:0 }}><TopBar /></div>

      <div style={{ minWidth:0, overflow:'hidden' }}>
        <LeftBar onOpenTerminal={openSystemTerminal} onOpenProjectTerminal={openProjectTerminal}/>
      </div>

      <div style={{ display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0, minWidth:0 }}>
        <TabStrip/>
        {screen === 'welcome' ? <WelcomeScreen/> : <ChatPanel onOpenTerminal={openProjectTerminal}/>}
      </div>

      {showRight && (
        <div style={{ minWidth:0, overflow:'hidden' }}>
          <RightSidebar onOpenTerminal={openProjectTerminal}/>
        </div>
      )}

      {terminalOpen && (
        <div style={{ gridColumn:'1 / -1', borderTop:'2px solid var(--accent)', minHeight:0, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <TerminalPanel cwd={terminalCwd} onClose={() => setTerminalOpen(false)}/>
        </div>
      )}
    </div>
  )
}
