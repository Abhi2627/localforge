import { useState, useMemo } from 'react'
import { ChevronRight, ChevronDown, Bot, GitBranch, LayoutDashboard, Plus, Loader, File, Folder, FolderOpen, Search, LucideIcon } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import AgentModal from './AgentModal'
import ProjectGraph from './ProjectGraph'

interface RightSidebarProps {
  onOpenTerminal: (cwd: string) => void
}

interface TreeNode {
  name: string; path: string; isDir: boolean; children: TreeNode[]; isNew: boolean
}

function buildTree(files: string[], rootPath: string, newFiles: Set<string>): TreeNode[] {
  const root: TreeNode = { name: '', path: rootPath, isDir: true, children: [], isNew: false }
  for (const file of files) {
    const rel   = file.replace(rootPath, '').replace(/^[/\\]/, '')
    const parts = rel.split(/[/\\]/).filter(Boolean)
    let   node  = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i], isLast = i === parts.length - 1
      let child = node.children.find(c => c.name === part)
      if (!child) {
        child = { name: part, path: `${node.path}/${part}`, isDir: !isLast, children: [], isNew: newFiles.has(file) && isLast }
        node.children.push(child)
      }
      if (!isLast) node = child
    }
  }
  function sort(ns: TreeNode[]) {
    ns.sort((a, b) => a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name))
    ns.forEach(n => sort(n.children))
  }
  sort(root.children)
  return root.children
}

function nodeMatchesFilter(node: TreeNode, filter: string): boolean {
  if (!filter) return true
  if (node.name.toLowerCase().includes(filter.toLowerCase())) return true
  return node.children.some(c => nodeMatchesFilter(c, filter))
}

function FileTreeNode({ node, depth = 0, filter }: { node: TreeNode; depth?: number; filter: string }) {
  const [open, setOpen]  = useState(depth < 2)
  const activeSessionId  = useAppStore(s => s.activeSessionId)
  const openFileFn       = useAppStore(s => s.openFile)
  if (!nodeMatchesFilter(node, filter)) return null
  const indent = depth * 12
  if (node.isDir) {
    const isOpen = filter ? true : open
    return (
      <div>
        <div onClick={() => setOpen(!open)}
          style={{ display:'flex', alignItems:'center', gap:3, padding:`2px 8px 2px ${8+indent}px`, cursor:'pointer', fontSize:12, color:'var(--text-secondary)', userSelect:'none' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
        >
          {isOpen ? <ChevronDown size={11} style={{flexShrink:0,opacity:0.5}}/> : <ChevronRight size={11} style={{flexShrink:0,opacity:0.5}}/>}
          {isOpen ? <FolderOpen size={13} style={{flexShrink:0,color:'#dcb67a'}}/> : <Folder size={13} style={{flexShrink:0,color:'#dcb67a'}}/>}
          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{node.name}</span>
        </div>
        {isOpen && node.children.map(child => <FileTreeNode key={child.path} node={child} depth={depth+1} filter={filter}/>)}
      </div>
    )
  }
  const ext = node.name.split('.').pop() ?? ''
  const col = fileColor(ext)
  const hl  = !!(filter && node.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div
      style={{ display:'flex', alignItems:'center', gap:5, padding:`2px 8px 2px ${20+indent}px`, cursor:'pointer', fontSize:12, color:hl?'var(--accent)':node.isNew?'var(--green)':'var(--text-secondary)', background:hl?'var(--accent-dim)':'transparent' }}
      onClick={() => { if (activeSessionId) openFileFn(activeSessionId, node.path) }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = hl?'var(--accent-dim)':'var(--bg-hover)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = hl?'var(--accent-dim)':'transparent'}
    >
      <File size={12} style={{flexShrink:0,color:col}}/>
      <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{node.name}</span>
      {node.isNew && <span style={{fontSize:9,color:'var(--green)',flexShrink:0}}>M</span>}
    </div>
  )
}

function fileColor(ext: string): string {
  const m: Record<string,string> = { ts:'#3178c6',tsx:'#3178c6',js:'#f7df1e',jsx:'#61dafb',css:'#264de4',scss:'#cc6699',html:'#e44d26',json:'#5ba4a4',md:'#aaa',rs:'#dea584',py:'#3572a5',go:'#00add8',toml:'#9c4221',yaml:'#cb171e',yml:'#cb171e',sh:'#89e051',svg:'#ffb13b',png:'#aaa',jpg:'#aaa',gif:'#aaa' }
  return m[ext] ?? 'var(--text-muted)'
}

function AgentRow({ agentId, sessionId }: { agentId: string; sessionId: string }) {
  const agent = useAppStore(s => s.sessions.find(p => p.id===sessionId)?.agents.find(a => a.id===agentId))
  if (!agent) return null
  const sc = agent.status==='running'?'var(--green)':agent.status==='failed'?'var(--red)':'var(--text-muted)'
  return (
    <div style={{padding:'5px 12px',borderBottom:'1px solid var(--border)'}}>
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        <span className={`agent-badge badge-${agent.role}`} style={{flexShrink:0,fontSize:9}}>{agent.role.slice(0,2).toUpperCase()}</span>
        <span style={{flex:1,fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{agent.name}</span>
        {agent.status==='running'&&<span style={{width:5,height:5,borderRadius:'50%',background:'var(--green)',flexShrink:0}}/>}
        <span style={{fontSize:10,color:sc}}>{agent.status}</span>
      </div>
      {agent.currentTask&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{agent.currentTask.slice(0,50)}</div>}
      {agent.status==='running'&&<div className="progress-bar" style={{marginTop:3}}><div className="progress-fill pulse" style={{width:'60%'}}/></div>}
    </div>
  )
}

const HDR = 28

export default function RightSidebar({ onOpenTerminal: _ot }: RightSidebarProps) {
  const { sessions, activeSessionId, rightExpanded } = useAppStore()
  const session = sessions.find(s => s.id === activeSessionId)

  // ALL hooks before any early return
  const [fileSearch,     setFileSearch]     = useState('')
  const [showSearch,     setShowSearch]     = useState(false)
  const [showAgentModal, setShowAgentModal] = useState(false)
  const [open,  setOpen]  = useState({ explorer:true, git:false, agents:true, graph:true })
  const [maxId, setMaxId] = useState<string|null>(null)

  // graphFullscreen tracks WHEN the fullscreen was opened (number, not bool)
  // so ProjectGraph receives a new fitTrigger value each time the overlay opens
  const [graphFullscreenAt, setGraphFullscreenAt] = useState<number | null>(null)

  const allFiles    = session?.allFiles    ?? []
  const written     = session?.writtenFiles ?? []
  const mergedFiles = useMemo(() => [...new Set([...allFiles, ...written])], [allFiles.join(','), written.join(',')])
  const newFileSet  = useMemo(() => new Set(written), [written.join(',')])
  const tree        = useMemo(
    () => session?.rootPath ? buildTree(mergedFiles, session.rootPath, newFileSet) : [],
    [mergedFiles.join(','), session?.rootPath, written.join(',')]
  )

  if (!rightExpanded) {
    const hasRunning = session?.agents.some(a => a.status === 'running')
    return (
      <div style={{width:40,background:'var(--bg-secondary)',borderLeft:'1px solid var(--border)',display:'flex',flexDirection:'column',alignItems:'center',paddingTop:10,gap:6,height:'100%'}}>
        {([{Icon:FolderOpen,label:'Files',dot:false},{Icon:GitBranch,label:'Git',dot:false},{Icon:Bot,label:'Agents',dot:!!hasRunning}] as {Icon:LucideIcon,label:string,dot:boolean}[]).map(({Icon,label,dot})=>(
          <div key={label} title={label} style={{position:'relative'}}>
            <button className="icon-btn" style={{width:32,height:32}}><Icon size={15}/></button>
            {dot&&<span style={{position:'absolute',top:5,right:5,width:5,height:5,borderRadius:'50%',background:'var(--green)',boxShadow:'0 0 4px var(--green)'}}/>}
          </div>
        ))}
      </div>
    )
  }

  function toggleOpen(id: string) {
    if (maxId===id) { setMaxId(null); return }
    setOpen(p => ({ ...p, [id]: !(p as any)[id] }))
  }
  function toggleMax(id: string) {
    if (maxId===id) { setMaxId(null) }
    else            { setMaxId(id); setOpen(p => ({ ...p, [id]: true })) }
  }
  function isExp(id: string): boolean {
    return maxId ? maxId===id : (open as any)[id]
  }
  function secStyle(id: string): React.CSSProperties {
    const base: React.CSSProperties = { display:'flex', flexDirection:'column', overflow:'hidden', borderBottom:'1px solid var(--border)' }
    if (maxId) {
      if (maxId===id) return { ...base, flex:1, minHeight:0 }
      return { ...base, flexShrink:0, height:HDR }
    }
    if ((open as any)[id]) {
      const w: Record<string,number> = { explorer:3, git:0.4, agents:1, graph:1 }
      return { ...base, flex: w[id]??1, minHeight: HDR+40 }
    }
    return { ...base, flexShrink:0, height:HDR }
  }

  const sections: Array<{ id:string; Icon:LucideIcon; title:string; extra?:React.ReactNode; body:React.ReactNode }> = [
    {
      id:'explorer', Icon:FolderOpen,
      title:`Explorer${mergedFiles.length>0?` (${mergedFiles.length})`:''}`,
      extra:(
        <button className="icon-btn" style={{width:16,height:16}} title="Search"
          onClick={e=>{e.stopPropagation();setShowSearch(v=>!v)}}>
          <Search size={10}/>
        </button>
      ),
      body:(
        <>
          {showSearch&&(
            <input autoFocus placeholder="Search files…" value={fileSearch} onChange={e=>setFileSearch(e.target.value)}
              style={{flexShrink:0,margin:'4px 8px',background:'var(--bg-tertiary)',border:'1px solid var(--border)',borderRadius:4,padding:'3px 8px',color:'var(--text-primary)',fontSize:11,outline:'none'}}/>
          )}
          <div style={{flex:1,overflowY:'auto',overflowX:'hidden',paddingBottom:4}}>
            {tree.length===0
              ? <div style={{padding:'8px 12px',fontSize:11,color:'var(--text-muted)'}}>No files yet</div>
              : tree.map(n=><FileTreeNode key={n.path} node={n} depth={0} filter={fileSearch}/>)
            }
          </div>
        </>
      ),
    },
    {
      id:'git', Icon:GitBranch, title:'Source Control', extra:undefined,
      body:<div style={{padding:'8px 12px',fontSize:11,color:'var(--text-muted)'}}>Git integration — Phase 3</div>,
    },
    {
      id:'agents', Icon:Bot,
      title:`Agents (${session?.agents.length??0})`,
      extra: session?.type==='project'?(
        <button className="icon-btn" style={{width:16,height:16}} title="Add agent"
          onClick={e=>{e.stopPropagation();setShowAgentModal(true)}}><Plus size={10}/></button>
      ):undefined,
      body:(
        <div style={{flex:1,overflowY:'auto'}}>
          {(!session||session.agents.length===0)?(
            session?.type==='project'?(
              <div style={{padding:'8px 12px'}}>
                <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:8}}>No agents yet.</div>
                <button onClick={()=>setShowAgentModal(true)}
                  style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'6px 10px',background:'var(--accent)',border:'none',borderRadius:6,color:'white',fontSize:11,fontWeight:500,cursor:'pointer',justifyContent:'center'}}>
                  <Plus size={12}/> Add first agent
                </button>
              </div>
            ):<div style={{padding:'8px 12px',fontSize:11,color:'var(--text-muted)'}}>Available in project sessions</div>
          ):(
            <>
              {session.agents.map(a=><AgentRow key={a.id} agentId={a.id} sessionId={session.id}/>)}
              <button onClick={()=>setShowAgentModal(true)}
                style={{display:'flex',alignItems:'center',gap:5,margin:'5px 10px',padding:'4px 8px',background:'transparent',border:'1px dashed var(--border-light)',borderRadius:5,color:'var(--text-muted)',fontSize:11,cursor:'pointer',width:'calc(100% - 20px)',justifyContent:'center'}}>
                <Plus size={10}/> Add agent
              </button>
            </>
          )}
        </div>
      ),
    },
    {
      id:'graph', Icon:LayoutDashboard, title:'Project Graph',
      extra:(
        <button className="icon-btn" style={{width:16,height:16}} title="Fullscreen"
          onClick={e=>{
            e.stopPropagation()
            // Store timestamp so fullscreen ProjectGraph gets a fresh fitTrigger
            setGraphFullscreenAt(Date.now())
          }}>⤢</button>
      ),
      body:<ProjectGraph files={mergedFiles} rootPath={session?.rootPath??''}/>,
    },
  ]

  return (
    <div style={{background:'var(--bg-secondary)',borderLeft:'1px solid var(--border)',display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>

      <div style={{height:32,flexShrink:0,padding:'0 12px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:6}}>
        <LayoutDashboard size={12} style={{color:'var(--text-muted)',flexShrink:0}}/>
        <span style={{fontSize:11,fontWeight:600,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>
          {session?.rootPath?.split('/').pop()??session?.title??'No project open'}
        </span>
        {session?.type==='project'&&!session.summary&&session.rootPath&&(
          <Loader size={10} style={{animation:'spin 1s linear infinite',flexShrink:0,color:'var(--text-muted)'}}/>
        )}
      </div>

      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>
        {sections.map(sec => {
          const exp   = isExp(sec.id)
          const isMax = maxId===sec.id
          return (
            <div key={sec.id} style={secStyle(sec.id)}>
              <div
                onClick={()=>toggleOpen(sec.id)}
                style={{ height:HDR, flexShrink:0, display:'flex', alignItems:'center', gap:5, padding:'0 10px', cursor:'pointer', userSelect:'none', borderBottom: exp ? '1px solid var(--border)' : 'none', background: isMax ? 'var(--accent-dim)' : 'transparent' }}
                onMouseEnter={e=>{if(!isMax)(e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}}
                onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=isMax?'var(--accent-dim)':'transparent'}}
              >
                {exp ? <ChevronDown size={10} style={{color:'var(--text-muted)',flexShrink:0}}/> : <ChevronRight size={10} style={{color:'var(--text-muted)',flexShrink:0}}/>}
                <sec.Icon size={12} style={{color:isMax?'var(--accent)':'var(--text-muted)',flexShrink:0}}/>
                <span style={{flex:1,fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em',color:isMax?'var(--accent)':'var(--text-muted)'}}>
                  {sec.title}
                </span>
                {sec.extra&&<div onClick={e=>e.stopPropagation()}>{sec.extra}</div>}
                <button onClick={e=>{e.stopPropagation();toggleMax(sec.id)}}
                  style={{background:'none',border:'none',cursor:'pointer',color:isMax?'var(--accent)':'var(--text-muted)',padding:'0 2px',display:'flex',fontSize:11,lineHeight:1}}
                  title={isMax?'Restore':'Maximise'}
                >{isMax?'▾':'▸'}</button>
              </div>
              {exp&&(
                <div style={{flex:1,overflow:'hidden',minHeight:0,display:'flex',flexDirection:'column'}}>
                  {sec.body}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showAgentModal&&session&&(
        <AgentModal sessionId={session.id} projectId={session.id} onClose={()=>setShowAgentModal(false)}/>
      )}

      {/* Fullscreen graph overlay */}
      {graphFullscreenAt !== null && session && (
        <div
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}
          onClick={()=>setGraphFullscreenAt(null)}
        >
          <div
            style={{background:'var(--bg-secondary)',border:'1px solid var(--border)',borderRadius:12,padding:16,width:'86vw',height:'86vh',display:'flex',flexDirection:'column',gap:8}}
            onClick={e=>e.stopPropagation()}
          >
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
              <span style={{fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>
                Project graph — {session.title}
              </span>
              <button className="icon-btn" onClick={()=>setGraphFullscreenAt(null)} style={{width:26,height:26}}>✕</button>
            </div>
            {/* key forces fresh mount; fitTrigger=graphFullscreenAt tells graph to fit after overlay paints */}
            <div style={{flex:1,overflow:'hidden',minHeight:0,display:'flex',flexDirection:'column'}}>
              <ProjectGraph
                key={`fullscreen-${graphFullscreenAt}`}
                files={mergedFiles}
                rootPath={session.rootPath ?? ''}
                fitTrigger={graphFullscreenAt}
              />
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
