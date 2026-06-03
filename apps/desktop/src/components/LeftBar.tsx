import { useState, useRef, useEffect } from 'react'
import { MessageCircle, FolderOpen, Puzzle, Settings, User, ChevronDown, ChevronRight, MoreHorizontal, Terminal } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { api } from '../hooks/useApi'
import { nanoid } from '../hooks/nanoid'
import NewProjectModal from './NewProjectModal'
import AccountModal from './AccountModal'
import SettingsModal from './SettingsModal'

const STORAGE_KEY = 'localforge_username'

interface LeftBarProps {
  onOpenTerminal:        () => void
  onOpenProjectTerminal: (cwd: string) => void
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' })
  } catch { return iso }
}

function SessionItem({ session }: { session: any }) {
  const { activeSessionId, setActiveSession, updateSessionTitle, closeSession } = useAppStore()
  const isActive = session.id === activeSessionId
  const [showMenu,  setShowMenu]  = useState(false)
  const [renaming,  setRenaming]  = useState(false)
  const [renameVal, setRenameVal] = useState(session.title)
  const [deleting,  setDeleting]  = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef  = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showMenu) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMenu])

  if (!session.title || session.title.trim() === '') return null

  function handleRename(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      updateSessionTitle(session.id, renameVal)
      api.createSession(session.id, session.type, renameVal, session.rootPath).catch(() => {})
      setRenaming(false)
    }
    if (e.key === 'Escape') setRenaming(false)
  }

  // Bug 2 fix: await the server delete before removing from store
  async function handleDelete() {
    setShowMenu(false)
    setDeleting(true)
    try {
      await api.deleteSession(session.id)
    } catch {
      // Server delete failed — still remove from UI to avoid zombie sessions
    }
    closeSession(session.id)
    setDeleting(false)
  }

  return (
    <div style={{ position:'relative', opacity: deleting ? 0.4 : 1, transition: 'opacity 0.2s' }}>
      <div onClick={() => setActiveSession(session.id)}
        style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 8px 6px 20px', borderRadius:6, background:isActive?'var(--accent-dim)':'transparent', color:isActive?'var(--accent)':'var(--text-secondary)', cursor:'pointer', fontSize:13, borderLeft:isActive?'2px solid var(--accent)':'2px solid transparent', transition:'background 0.15s' }}
        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background='var(--bg-hover)' }}
        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background='transparent' }}
      >
        {renaming ? (
          <input autoFocus value={renameVal} onChange={e=>setRenameVal(e.target.value)} onKeyDown={handleRename} onBlur={()=>setRenaming(false)} onClick={e=>e.stopPropagation()}
            style={{ flex:1, background:'var(--bg-tertiary)', border:'1px solid var(--accent)', borderRadius:4, padding:'1px 6px', color:'var(--text-primary)', fontSize:13, outline:'none' }}/>
        ) : (
          <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{session.title}</span>
        )}
        <button ref={btnRef} onClick={e=>{e.stopPropagation();setShowMenu(v=>!v)}}
          style={{ background:'none', border:'none', cursor:'pointer', color:'inherit', padding:0, display:'flex', opacity:0.6 }}>
          <MoreHorizontal size={13}/>
        </button>
      </div>

      {showMenu && (
        <div ref={menuRef} style={{ position:'fixed', left:228, top:(() => { if (btnRef.current) { const r=btnRef.current.getBoundingClientRect(); return Math.min(r.top, window.innerHeight-160) } return 100 })(), zIndex:200, background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:8, padding:4, minWidth:200, boxShadow:'0 8px 24px rgba(0,0,0,0.5)' }}>
          <div style={{ padding:'6px 10px 8px', borderBottom:'1px solid var(--border)', marginBottom:3 }}>
            {session.createdAt && <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:2 }}>Created: <span style={{ color:'var(--text-secondary)' }}>{formatDate(session.createdAt)}</span></div>}
            {session.updatedAt && <div style={{ fontSize:11, color:'var(--text-muted)' }}>Updated: <span style={{ color:'var(--text-secondary)' }}>{formatDate(session.updatedAt)}</span></div>}
          </div>
          {[
            { label:'Rename', action:()=>{setRenaming(true);setShowMenu(false)}, color:'var(--text-secondary)' },
            { label:'Delete', action:handleDelete, color:'var(--red)' },
          ].map(item => (
            <button key={item.label} onClick={item.action}
              style={{ display:'block', width:'100%', textAlign:'left', padding:'7px 10px', background:'none', border:'none', color:item.color, fontSize:13, cursor:'pointer', borderRadius:4 }}
              onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
              onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='none'}
            >{item.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChatSection({ sessions, expanded }: { sessions: any[]; expanded: boolean }) {
  const [open, setOpen] = useState(true)
  const { addSession, setActiveSession } = useAppStore()
  const filtered = sessions.filter(s => s.type==='chat' && s.title && s.title.trim()!=='')

  function createNewChat() {
    const id = nanoid()
    addSession({ id, type:'chat', title:'New chat', agents:[], messages:[], allFiles:[], writtenFiles:[], lastAccessedAt:Date.now(), isActive:true })
    setActiveSession(id)
    api.createSession(id, 'chat', 'New chat').catch(() => {})
  }

  if (!expanded) return (
    <button title="Chats" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', padding:'9px 0', border:'none', background:'transparent', color:'var(--text-secondary)', cursor:'pointer' }}>
      <MessageCircle size={18}/>
    </button>
  )
  return (
    <div style={{ marginBottom:4 }}>
      <button onClick={()=>setOpen(!open)}
        style={{ display:'flex', alignItems:'center', gap:6, width:'100%', padding:'7px 10px', background:'none', border:'none', cursor:'pointer', color:'var(--text-secondary)', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        <MessageCircle size={14}/><span style={{ flex:1, textAlign:'left' }}>Chats</span>
        {open?<ChevronDown size={12}/>:<ChevronRight size={12}/>}
      </button>
      {open && (
        <div>
          <button onClick={createNewChat}
            style={{ display:'block', width:'calc(100% - 20px)', margin:'3px 10px 5px', padding:'7px 0', background:'var(--accent)', border:'none', borderRadius:6, color:'white', fontSize:13, fontWeight:500, cursor:'pointer', textAlign:'center' }}>
            New chat
          </button>
          {filtered.length===0 && <div style={{ padding:'3px 20px', fontSize:12, color:'var(--text-muted)' }}>No history</div>}
          {filtered.map(s => <SessionItem key={s.id} session={s}/>)}
        </div>
      )}
    </div>
  )
}

function ProjectSection({ sessions, expanded }: { sessions: any[]; expanded: boolean }) {
  const [open, setOpen] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const seen = new Set<string>()
  const filtered = sessions
    .filter(s => s.type==='project' && s.title && s.title.trim()!=='')
    .filter(s => { const key=s.rootPath??s.id; if (seen.has(key)) return false; seen.add(key); return true })

  if (!expanded) return (
    <button title="Projects" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', padding:'9px 0', border:'none', background:'transparent', color:'var(--text-secondary)', cursor:'pointer' }}>
      <FolderOpen size={18}/>
    </button>
  )
  return (
    <div style={{ marginBottom:4 }}>
      <button onClick={()=>setOpen(!open)}
        style={{ display:'flex', alignItems:'center', gap:6, width:'100%', padding:'7px 10px', background:'none', border:'none', cursor:'pointer', color:'var(--text-secondary)', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        <FolderOpen size={14}/><span style={{ flex:1, textAlign:'left' }}>Projects</span>
        {open?<ChevronDown size={12}/>:<ChevronRight size={12}/>}
      </button>
      {open && (
        <div>
          <button onClick={()=>setShowModal(true)}
            style={{ display:'block', width:'calc(100% - 20px)', margin:'3px 10px 5px', padding:'7px 0', background:'var(--accent)', border:'none', borderRadius:6, color:'white', fontSize:13, fontWeight:500, cursor:'pointer', textAlign:'center' }}>
            Open project
          </button>
          {filtered.length===0 && <div style={{ padding:'3px 20px', fontSize:12, color:'var(--text-muted)' }}>No history</div>}
          {filtered.map(s => <SessionItem key={s.id} session={s}/>)}
        </div>
      )}
      {showModal && <NewProjectModal onClose={()=>setShowModal(false)}/>}
    </div>
  )
}

export default function LeftBar({ onOpenTerminal, onOpenProjectTerminal }: LeftBarProps) {
  const { sessions, leftExpanded: expanded, setUserName, activeSessionId } = useAppStore()
  const [showAccount,  setShowAccount]  = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const activeSession = sessions.find(s => s.id === activeSessionId)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) setUserName(saved)
  }, [])

  function handleTerminalClick() {
    if (activeSession?.type==='project' && activeSession.rootPath) {
      onOpenProjectTerminal(activeSession.rootPath)
    } else {
      onOpenTerminal()
    }
  }

  const bottomButtons = [
    { Icon: Terminal, label: 'Terminal', action: handleTerminalClick },
    { Icon: User,     label: 'Account',  action: () => setShowAccount(true) },
    { Icon: Settings, label: 'Settings', action: () => setShowSettings(true) },
  ]

  return (
    <div style={{ background:'var(--bg-secondary)', borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{ flex:1, overflowY:'auto', overflowX:'hidden', paddingTop:6 }}>
        <ChatSection    sessions={sessions} expanded={expanded}/>
        <ProjectSection sessions={sessions} expanded={expanded}/>
        {expanded ? (
          <button style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 10px', border:'none', background:'transparent', color:'var(--text-secondary)', cursor:'pointer', fontSize:13 }}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color='var(--text-secondary)'}
          ><Puzzle size={15}/><span>Extensions</span></button>
        ) : (
          <button title="Extensions" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', padding:'9px 0', border:'none', background:'transparent', color:'var(--text-secondary)', cursor:'pointer' }}>
            <Puzzle size={18}/>
          </button>
        )}
      </div>

      <div style={{ borderTop:'1px solid var(--border)', padding:'4px 0' }}>
        {bottomButtons.map(({ Icon, label, action }) => (
          <button key={label} onClick={action} title={!expanded ? label : undefined}
            style={{ display:'flex', alignItems:'center', gap:expanded?9:0, justifyContent:expanded?'flex-start':'center', width:'100%', padding:expanded?'8px 12px':'9px 0', border:'none', background:'transparent', color:'var(--text-secondary)', cursor:'pointer', fontSize:13, fontWeight:400, transition:'color 0.15s' }}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color='var(--text-secondary)'}
          >
            <Icon size={16}/>
            {expanded && <span>{label}</span>}
          </button>
        ))}
      </div>

      {showAccount  && <AccountModal  onClose={()=>setShowAccount(false)}/>}
      {showSettings && <SettingsModal onClose={()=>setShowSettings(false)}/>}
    </div>
  )
}
