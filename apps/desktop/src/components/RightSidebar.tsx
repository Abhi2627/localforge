import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  ChevronRight, ChevronDown, Bot, LayoutDashboard,
  Plus, Loader, File, Folder, FolderOpen, Search, Network,
  AlertTriangle, RefreshCw, CheckCircle, XCircle, AlertCircle,
  GitBranch, GitMerge, X
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import AgentModal from './AgentModal'
import ProjectGraph from './ProjectGraph'
import GitPanel from './GitPanel'

interface RightSidebarProps { onOpenTerminal: (cwd: string) => void }

// ── File tree ─────────────────────────────────────────────────────────────────
interface TreeNode { name: string; path: string; isDir: boolean; children: TreeNode[]; isNew: boolean }

function buildTree(files: string[], rootPath: string, newFiles: Set<string>): TreeNode[] {
  const root: TreeNode = { name:'', path:rootPath, isDir:true, children:[], isNew:false }
  for (const file of files) {
    const rel = file.replace(rootPath,'').replace(/^[/\\]/,'')
    const parts = rel.split(/[/\\]/).filter(Boolean)
    let node = root
    for (let i=0; i<parts.length; i++) {
      const part=parts[i], isLast=i===parts.length-1
      let child = node.children.find(c=>c.name===part)
      if (!child) { child={ name:part, path:`${node.path}/${part}`, isDir:!isLast, children:[], isNew:newFiles.has(file)&&isLast }; node.children.push(child) }
      if (!isLast) node=child
    }
  }
  function sort(ns: TreeNode[]) { ns.sort((a,b)=>a.isDir!==b.isDir?(a.isDir?-1:1):a.name.localeCompare(b.name)); ns.forEach(n=>sort(n.children)) }
  sort(root.children)
  return root.children
}

function nodeMatchesFilter(node: TreeNode, filter: string): boolean {
  if (!filter) return true
  if (node.name.toLowerCase().includes(filter.toLowerCase())) return true
  return node.children.some(c=>nodeMatchesFilter(c,filter))
}

function fileColor(ext: string): string {
  const m: Record<string,string>={ts:'#3178c6',tsx:'#3178c6',js:'#f7df1e',jsx:'#61dafb',css:'#264de4',scss:'#cc6699',html:'#e44d26',json:'#5ba4a4',md:'#aaa',rs:'#dea584',py:'#3572a5',go:'#00add8',toml:'#9c4221',yaml:'#cb171e',yml:'#cb171e',sh:'#89e051',svg:'#ffb13b',png:'#aaa',jpg:'#aaa'}
  return m[ext]??'var(--text-muted)'
}

function FileTreeNode({ node, depth=0, filter }: { node:TreeNode; depth?:number; filter:string }) {
  const [open,setOpen] = useState(depth<2)
  const activeSessionId = useAppStore(s=>s.activeSessionId)
  const openFileFn      = useAppStore(s=>s.openFile)
  if (!nodeMatchesFilter(node,filter)) return null
  const indent = depth*12
  if (node.isDir) {
    const isOpen = filter ? true : open
    return (
      <div>
        <div onClick={()=>setOpen(!open)}
          style={{display:'flex',alignItems:'center',gap:4,padding:`3px 8px 3px ${8+indent}px`,cursor:'pointer',fontSize:12,color:'var(--text-secondary)',userSelect:'none'}}
          onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
          onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
          {isOpen?<ChevronDown size={11} style={{flexShrink:0,opacity:0.6}}/>:<ChevronRight size={11} style={{flexShrink:0,opacity:0.6}}/>}
          {isOpen?<FolderOpen size={13} style={{flexShrink:0,color:'#dcb67a'}}/>:<Folder size={13} style={{flexShrink:0,color:'#dcb67a'}}/>}
          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{node.name}</span>
        </div>
        {isOpen && node.children.map(c=><FileTreeNode key={c.path} node={c} depth={depth+1} filter={filter}/>)}
      </div>
    )
  }
  const ext=node.name.split('.').pop()??''
  const col=fileColor(ext)
  const hl=!!(filter&&node.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div
      style={{display:'flex',alignItems:'center',gap:5,padding:`3px 8px 3px ${22+indent}px`,cursor:'pointer',fontSize:12,color:hl?'var(--accent)':node.isNew?'var(--green)':'var(--text-secondary)',background:hl?'var(--accent-dim)':'transparent'}}
      onClick={()=>{ if(activeSessionId) openFileFn(activeSessionId,node.path) }}
      onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background=hl?'var(--accent-dim)':'var(--bg-hover)'}
      onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background=hl?'var(--accent-dim)':'transparent'}>
      <File size={12} style={{flexShrink:0,color:col}}/>
      <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{node.name}</span>
      {node.isNew&&<span style={{fontSize:9,color:'var(--green)',flexShrink:0}}>M</span>}
    </div>
  )
}

// ── Modal shell ───────────────────────────────────────────────────────────────
// Reusable full-screen modal — same pattern as SettingsModal
function PanelModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.72)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={onClose}
    >
      <div
        style={{ background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:14, width:'min(900px, 92vw)', height:'82vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,0.7)' }}
        onClick={e=>e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ height:44, flexShrink:0, padding:'0 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, background:'var(--bg-tertiary)', borderRadius:'14px 14px 0 0' }}>
          <span style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)', flex:1 }}>{title}</span>
          <button onClick={onClose}
            style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:4, borderRadius:6 }}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color='var(--text-muted)'}
          ><X size={16}/></button>
        </div>
        {/* Body */}
        <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', minHeight:0 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Knowledge Graph modal body ────────────────────────────────────────────────
type SymbolKind = 'function'|'class'|'interface'|'type'|'enum'|'constant'|'component'|'route'
interface SymbolNode  { name:string; kind:SymbolKind; line:number; exported:boolean; file:string }
interface Conflict    { name:string; kind:SymbolKind; files:string[] }
interface GraphSummary{ totalSymbols:number; byKind:Record<string,number>; conflicts:Conflict[] }
const KIND_COLOR:  Record<string,string>={function:'#3b82f6',class:'#8b5cf6',interface:'#06b6d4',type:'#a78bfa',enum:'#f59e0b',constant:'#94a3b8',component:'#3dd68c',route:'#f97316'}
const KIND_LETTER: Record<string,string>={function:'f',class:'C',interface:'I',type:'T',enum:'E',constant:'c',component:'R',route:'@'}

function KnowledgeGraphModalBody({ sessionId }: { sessionId: string }) {
  const [summary, setSummary] = useState<GraphSummary|null>(null)
  const [symbols, setSymbols] = useState<SymbolNode[]>([])
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(false)
  const [tab,     setTab]     = useState<'symbols'|'conflicts'>('symbols')
  const [kindF,   setKindF]   = useState('all')

  const load = useCallback(async()=>{
    setLoading(true)
    try {
      const [sr,symr] = await Promise.all([
        fetch(`http://localhost:3001/project/${sessionId}/symbols/summary`),
        fetch(`http://localhost:3001/project/${sessionId}/symbols`),
      ])
      setSummary(await sr.json()); setSymbols((await symr.json()).symbols??[])
    } catch{}
    setLoading(false)
  },[sessionId])
  useEffect(()=>{load()},[load])

  const filtered = symbols.filter(s=>(kindF==='all'||s.kind===kindF)&&(!search||s.name.toLowerCase().includes(search.toLowerCase())))
  const kinds = summary ? Object.keys(summary.byKind).filter(k=>summary.byKind[k]>0) : []

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      {/* Stats bar */}
      <div style={{display:'flex',alignItems:'center',gap:12,padding:'10px 20px',borderBottom:'1px solid var(--border)',flexShrink:0,flexWrap:'wrap'}}>
        <span style={{fontSize:13,color:'var(--text-primary)',fontWeight:500}}>{summary?.totalSymbols??'—'} symbols</span>
        {summary && summary.conflicts.length>0 && (
          <span style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#f59e0b'}}>
            <AlertTriangle size={12}/>{summary.conflicts.length} conflict{summary.conflicts.length>1?'s':''}
          </span>
        )}
        <div style={{display:'flex',borderBottom:'none',gap:8,marginLeft:'auto',alignItems:'center'}}>
          <button onClick={()=>setTab('symbols')} style={{padding:'4px 12px',borderRadius:6,border:`1px solid ${tab==='symbols'?'var(--accent)':'var(--border)'}`,background:tab==='symbols'?'var(--accent-dim)':'transparent',color:tab==='symbols'?'var(--accent)':'var(--text-secondary)',fontSize:12,cursor:'pointer',fontWeight:tab==='symbols'?600:400}}>Symbols</button>
          <button onClick={()=>setTab('conflicts')} style={{padding:'4px 12px',borderRadius:6,border:`1px solid ${tab==='conflicts'?'var(--accent)':'var(--border)'}`,background:tab==='conflicts'?'var(--accent-dim)':'transparent',color:tab==='conflicts'?'var(--accent)':'var(--text-secondary)',fontSize:12,cursor:'pointer',fontWeight:tab==='conflicts'?600:400}}>
            Conflicts{summary&&summary.conflicts.length>0?` (${summary.conflicts.length})`:''}
          </button>
          <button onClick={load} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',display:'flex',padding:4}}>
            <RefreshCw size={14} style={{animation:loading?'spin 1s linear infinite':'none'}}/>
          </button>
        </div>
      </div>

      {tab==='symbols' ? (
        <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden',minHeight:0}}>
          {/* Search + kind filter */}
          <div style={{padding:'10px 20px',borderBottom:'1px solid var(--border)',flexShrink:0,display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
            <input placeholder="Search symbols…" value={search} onChange={e=>setSearch(e.target.value)}
              style={{flex:1,minWidth:160,background:'var(--bg-tertiary)',border:'1px solid var(--border)',borderRadius:6,padding:'5px 10px',color:'var(--text-primary)',fontSize:13,outline:'none'}}/>
            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              <button onClick={()=>setKindF('all')} style={{padding:'3px 10px',borderRadius:10,border:`1px solid ${kindF==='all'?'var(--accent)':'var(--border)'}`,background:kindF==='all'?'var(--accent-dim)':'transparent',color:kindF==='all'?'var(--accent)':'var(--text-secondary)',fontSize:11,cursor:'pointer',fontWeight:kindF==='all'?600:400}}>all</button>
              {kinds.map(k=>(
                <button key={k} onClick={()=>setKindF(k)} style={{padding:'3px 10px',borderRadius:10,border:`1px solid ${kindF===k?(KIND_COLOR[k]??'var(--accent)'):'var(--border)'}`,background:kindF===k?`${KIND_COLOR[k]??'var(--accent)'}22`:'transparent',color:kindF===k?(KIND_COLOR[k]??'var(--accent)'):'var(--text-secondary)',fontSize:11,cursor:'pointer',fontWeight:kindF===k?600:400}}>{k}</button>
              ))}
            </div>
          </div>
          {/* Symbol list — 3-column grid for large modal */}
          <div style={{flex:1,overflowY:'auto',padding:'8px 20px'}}>
            {loading&&symbols.length===0
              ?<div style={{display:'flex',alignItems:'center',gap:8,color:'var(--text-muted)',fontSize:13,padding:'20px 0'}}><Loader size={14} style={{animation:'spin 1s linear infinite'}}/>Scanning project symbols…</div>
              :filtered.length===0
                ?<div style={{color:'var(--text-muted)',fontSize:13,padding:'20px 0'}}>{symbols.length===0?'No symbols found yet':'No matches'}</div>
                :<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:4}}>
                  {filtered.slice(0,500).map((s,i)=>{
                    const rel=s.file.split('/').slice(-2).join('/'), col=KIND_COLOR[s.kind]??'#888'
                    return(
                      <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 8px',borderRadius:6,background:'var(--bg-tertiary)',border:'1px solid var(--border)'}}
                        onMouseEnter={e=>(e.currentTarget as HTMLElement).style.borderColor='var(--accent)'}
                        onMouseLeave={e=>(e.currentTarget as HTMLElement).style.borderColor='var(--border)'}>
                        <span style={{width:18,height:18,borderRadius:4,background:`${col}22`,color:col,fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontFamily:'monospace'}}>{KIND_LETTER[s.kind]??'?'}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:500,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</div>
                          <div style={{fontSize:10,color:'var(--text-muted)',fontFamily:'monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rel}:{s.line}</div>
                        </div>
                        {!s.exported&&<span style={{fontSize:10,color:'var(--text-muted)',flexShrink:0}}>local</span>}
                      </div>
                    )
                  })}
                </div>
            }
          </div>
        </div>
      ) : (
        <div style={{flex:1,overflowY:'auto',padding:'16px 20px'}}>
          {!summary||summary.conflicts.length===0
            ?<div style={{display:'flex',alignItems:'center',gap:8,color:'var(--green)',fontSize:13}}><CheckCircle size={16}/>No symbol conflicts detected</div>
            :summary.conflicts.map((c,i)=>(
              <div key={i} style={{padding:'12px 14px',borderRadius:8,background:'var(--bg-tertiary)',border:'1px solid var(--border)',marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                  <AlertTriangle size={14} style={{color:'#f59e0b',flexShrink:0}}/>
                  <span style={{fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>{c.name}</span>
                  <span style={{fontSize:10,color:KIND_COLOR[c.kind]??'#888',background:`${KIND_COLOR[c.kind]??'#888'}22`,padding:'2px 6px',borderRadius:4}}>{c.kind}</span>
                </div>
                <div style={{fontSize:11,color:'var(--text-secondary)',paddingLeft:22}}>
                  {c.files.map((f,fi)=><div key={fi} style={{fontFamily:'monospace',marginBottom:2}}>{f.split('/').slice(-2).join('/')}</div>)}
                </div>
              </div>
            ))
          }
        </div>
      )}
    </div>
  )
}

// ── API Contracts modal body ──────────────────────────────────────────────────
interface ApiCall   { method:string; path:string; file:string; line:number }
interface ApiRoute  { method:string; path:string; file:string; line:number }
interface Violation { kind:'missing_route'|'method_mismatch'; call:ApiCall; similar:ApiRoute[] }
interface ContractSummary { totalCalls:number; totalRoutes:number; matched:number; violations:number; health:'good'|'warn'|'bad' }
interface ContractReport  { calls:ApiCall[]; routes:ApiRoute[]; violations:Violation[]; summary:ContractSummary }
const METHOD_COLOR: Record<string,string>={GET:'#3dd68c',POST:'#3b82f6',PUT:'#f59e0b',DELETE:'#ef4444',PATCH:'#a78bfa',ANY:'#94a3b8'}

function ContractsModalBody({ sessionId }: { sessionId:string }) {
  const [report, setReport]  = useState<ContractReport|null>(null)
  const [loading,setLoading] = useState(false)
  const [tab,    setTab]     = useState<'violations'|'routes'|'calls'>('violations')

  const load = useCallback(async()=>{
    setLoading(true)
    try{ const r=await fetch(`http://localhost:3001/project/${sessionId}/contracts`); setReport(await r.json()) }catch{}
    setLoading(false)
  },[sessionId])
  useEffect(()=>{load()},[load])

  const health=report?.summary?.health
  const HIcon = health==='good'?<CheckCircle size={14} style={{color:'var(--green)'}}/>:health==='warn'?<AlertCircle size={14} style={{color:'#f59e0b'}}/>:<XCircle size={14} style={{color:'var(--red)'}}/>

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      {/* Stats bar */}
      <div style={{display:'flex',alignItems:'center',gap:12,padding:'10px 20px',borderBottom:'1px solid var(--border)',flexShrink:0,flexWrap:'wrap'}}>
        {report?.summary ? <>{HIcon}<span style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>{report.summary.violations===0?'All API calls matched':`${report.summary.violations} violation${report.summary.violations>1?'s':''}`}</span><span style={{fontSize:12,color:'var(--text-secondary)'}}>{report.summary.totalCalls} calls · {report.summary.totalRoutes} routes · {report.summary.matched} matched</span></> : <span style={{fontSize:13,color:'var(--text-muted)'}}>Scanning…</span>}
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          {(['violations','routes','calls'] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{padding:'4px 12px',borderRadius:6,border:`1px solid ${tab===t?'var(--accent)':'var(--border)'}`,background:tab===t?'var(--accent-dim)':'transparent',color:tab===t?'var(--accent)':'var(--text-secondary)',fontSize:12,cursor:'pointer',fontWeight:tab===t?600:400,textTransform:'capitalize'}}>
              {t}{t==='violations'&&report&&report.summary.violations>0?` (${report.summary.violations})`:''}
            </button>
          ))}
          <button onClick={load} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',display:'flex',padding:4}}>
            <RefreshCw size={14} style={{animation:loading?'spin 1s linear infinite':'none'}}/>
          </button>
        </div>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'8px 20px'}}>
        {loading&&!report
          ?<div style={{display:'flex',alignItems:'center',gap:8,color:'var(--text-muted)',fontSize:13,padding:'20px 0'}}><Loader size={14} style={{animation:'spin 1s linear infinite'}}/>Analysing API contracts…</div>
          :tab==='violations'
            ?(!report||report.violations.length===0
                ?<div style={{display:'flex',alignItems:'center',gap:8,color:'var(--green)',fontSize:13,padding:'20px 0'}}><CheckCircle size={16}/>All frontend calls have matching backend routes</div>
                :<div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {report.violations.map((v,i)=>(
                    <div key={i} style={{padding:'12px 14px',borderRadius:8,background:'var(--bg-tertiary)',border:`1px solid ${v.kind==='missing_route'?'rgba(239,68,68,0.3)':'rgba(245,158,11,0.3)'}`}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                        <span style={{fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:4,background:`${METHOD_COLOR[v.call.method]??'#888'}22`,color:METHOD_COLOR[v.call.method]??'#888',flexShrink:0}}>{v.call.method}</span>
                        <code style={{fontSize:13,color:'var(--text-primary)',flex:1}}>{v.call.path}</code>
                        <span style={{fontSize:11,color:v.kind==='missing_route'?'var(--red)':'#f59e0b',fontWeight:600,flexShrink:0}}>{v.kind==='missing_route'?'MISSING ROUTE':'METHOD MISMATCH'}</span>
                      </div>
                      <div style={{fontSize:11,color:'var(--text-secondary)'}}>Called from: {v.call.file.split('/').slice(-2).join('/')}:{v.call.line}</div>
                      {v.similar.length>0&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>Similar routes found as: {v.similar.map(r=>`${r.method} ${r.path}`).join(', ')}</div>}
                    </div>
                  ))}
                </div>
              )
            :<div style={{display:'flex',flexDirection:'column',gap:4}}>
              {(tab==='routes'?report?.routes??[]:report?.calls??[]).map((r,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 10px',borderRadius:6,background:'var(--bg-tertiary)',border:'1px solid var(--border)'}}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.borderColor='var(--accent)'}
                  onMouseLeave={e=>(e.currentTarget as HTMLElement).style.borderColor='var(--border)'}>
                  <span style={{fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:4,background:`${METHOD_COLOR[r.method]??'#888'}22`,color:METHOD_COLOR[r.method]??'#888',flexShrink:0,minWidth:48,textAlign:'center'}}>{r.method}</span>
                  <code style={{fontSize:12,color:'var(--text-primary)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.path}</code>
                  <span style={{fontSize:11,color:'var(--text-muted)',flexShrink:0,fontFamily:'monospace'}}>{r.file.split('/').pop()}:{r.line}</span>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  )
}

// ── Agents modal body ─────────────────────────────────────────────────────────
function AgentsModalBody({ session, onAddAgent }: { session: any; onAddAgent: () => void }) {
  if (!session || session.type !== 'project') {
    return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:12,color:'var(--text-muted)'}}>
        <Bot size={36} style={{opacity:0.3}}/>
        <div style={{fontSize:14}}>Agents are available in project sessions only</div>
      </div>
    )
  }
  if (session.agents.length === 0) {
    return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:16}}>
        <Bot size={40} style={{opacity:0.25}}/>
        <div style={{fontSize:15,fontWeight:600,color:'var(--text-primary)'}}>No agents yet</div>
        <div style={{fontSize:13,color:'var(--text-secondary)',maxWidth:360,textAlign:'center',lineHeight:1.7}}>
          Add a specialised agent to handle specific tasks — frontend, backend, testing — in parallel or sequentially.
        </div>
        <button onClick={onAddAgent} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 24px',background:'var(--accent)',border:'none',borderRadius:8,color:'white',fontSize:13,fontWeight:600,cursor:'pointer'}}>
          <Plus size={15}/> Add first agent
        </button>
      </div>
    )
  }
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <div style={{padding:'10px 20px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
        <span style={{fontSize:13,color:'var(--text-primary)',fontWeight:500,flex:1}}>{session.agents.length} agent{session.agents.length>1?'s':''}</span>
        <button onClick={onAddAgent} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 14px',background:'var(--accent)',border:'none',borderRadius:7,color:'white',fontSize:12,fontWeight:500,cursor:'pointer'}}>
          <Plus size={13}/> Add agent
        </button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'12px 20px',display:'flex',flexDirection:'column',gap:8}}>
        {session.agents.map((a: any)=>{
          const sc=a.status==='running'?'var(--green)':a.status==='failed'?'var(--red)':'var(--text-secondary)'
          return (
            <div key={a.id} style={{padding:'12px 14px',borderRadius:8,background:'var(--bg-tertiary)',border:`1px solid ${a.status==='running'?'rgba(61,214,140,0.3)':'var(--border)'}`}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:a.currentTask?4:0}}>
                <span className={`agent-badge badge-${a.role}`} style={{flexShrink:0,fontSize:11}}>{a.role.slice(0,2).toUpperCase()}</span>
                <span style={{flex:1,fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>{a.name}</span>
                {a.status==='running'&&<span style={{width:8,height:8,borderRadius:'50%',background:'var(--green)',flexShrink:0,boxShadow:'0 0 6px var(--green)'}}/>}
                <span style={{fontSize:12,color:sc,fontWeight:500}}>{a.status}</span>
              </div>
              {a.currentTask&&<div style={{fontSize:12,color:'var(--text-secondary)',paddingLeft:30}}>{a.currentTask}</div>}
              {a.status==='running'&&<div className="progress-bar" style={{marginTop:6}}><div className="progress-fill pulse" style={{width:'60%'}}/></div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Project Graph modal body ──────────────────────────────────────────────────
function ProjectGraphModalBody({ files, rootPath }: { files: string[]; rootPath: string }) {
  return (
    <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column',padding:8,minHeight:0}}>
      <ProjectGraph key="modal-graph" files={files} rootPath={rootPath} fitTrigger={Date.now()}/>
    </div>
  )
}

// ── Collapsible section for sidebar ──────────────────────────────────────────
function SidebarSection({ title, expanded, onToggle, children }: {
  title: string; expanded: boolean; onToggle: () => void; children: React.ReactNode
}) {
  const HEADER_H = 28
  return (
    <div style={{
      display:    'flex',
      flexDirection: 'column',
      overflow:   'hidden',
      // When expanded: flex:1 with basis:0 means each section gets exactly equal space
      // When collapsed: flex:0, basis=header height, shrink=0 so header is always visible
      flex:       expanded ? '1 1 0' : `0 0 ${HEADER_H}px`,
      minHeight:  HEADER_H,
      transition: 'flex 0.2s ease',
    }}>
      {/* Section header */}
      <div
        onClick={onToggle}
        style={{ height:28, flexShrink:0, display:'flex', alignItems:'center', gap:6, padding:'0 10px', cursor:'pointer', userSelect:'none', borderBottom:'1px solid var(--border)', background:'var(--bg-secondary)' }}
        onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
        onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-secondary)'}
      >
        {expanded
          ? <ChevronDown size={11} style={{color:'var(--text-secondary)',flexShrink:0}}/>
          : <ChevronRight size={11} style={{color:'var(--text-secondary)',flexShrink:0}}/>
        }
        <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-secondary)', flex:1 }}>{title}</span>
      </div>
      {/* Section body */}
      {expanded && (
        <div style={{ flex:1, overflow:'hidden', minHeight:0, display:'flex', flexDirection:'column' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Main sidebar ──────────────────────────────────────────────────────────────
type ModalPanel = 'knowledge' | 'contracts' | 'agents' | 'graph' | null

export default function RightSidebar({ onOpenTerminal: _ot }: RightSidebarProps) {
  const { sessions, activeSessionId, rightExpanded, setRightExpanded } = useAppStore()
  const session = sessions.find(s => s.id === activeSessionId)

  const [openModal,      setOpenModal]      = useState<ModalPanel>(null)
  const [showAgentModal, setShowAgentModal] = useState(false)
  const [fileSearch,     setFileSearch]     = useState('')
  const [showSearch,     setShowSearch]     = useState(false)
  const [explorerOpen,   setExplorerOpen]   = useState(true)
  const [gitOpen,        setGitOpen]        = useState(true)

  const allFiles    = session?.allFiles    ?? []
  const written     = session?.writtenFiles ?? []
  const mergedFiles = useMemo(()=>[...new Set([...allFiles,...written])],[allFiles.join(','),written.join(',')]) // eslint-disable-line
  const newFileSet  = useMemo(()=>new Set(written),[written.join(',')]) // eslint-disable-line
  const tree        = useMemo(()=>session?.rootPath?buildTree(mergedFiles,session.rootPath,newFileSet):[],[mergedFiles.join(','),session?.rootPath,written.join(',')]) // eslint-disable-line

  const hasRunning = session?.agents.some(a=>a.status==='running')

  const modalTitles: Record<NonNullable<ModalPanel>, string> = {
    knowledge: 'Knowledge Graph',
    contracts: 'API Contracts',
    agents:    'Agents',
    graph:     'Project Graph',
  }

  function renderModalBody() {
    if (openModal === 'knowledge') return session
      ? <KnowledgeGraphModalBody sessionId={session.id}/>
      : <div style={{padding:24,color:'var(--text-muted)',fontSize:13}}>Open a project to view the knowledge graph</div>
    if (openModal === 'contracts') return session
      ? <ContractsModalBody sessionId={session.id}/>
      : <div style={{padding:24,color:'var(--text-muted)',fontSize:13}}>Open a project to check API contracts</div>
    if (openModal === 'agents') return <AgentsModalBody session={session} onAddAgent={()=>{setOpenModal(null);setShowAgentModal(true)}}/>
    if (openModal === 'graph') return session?.rootPath
      ? <ProjectGraphModalBody files={mergedFiles} rootPath={session.rootPath}/>
      : <div style={{padding:24,color:'var(--text-muted)',fontSize:13}}>Open a project to view the project graph</div>
    return null
  }

  // Collapsed sidebar — 6 icons: 4 open modals, 2 expand the sidebar
  if (!rightExpanded) {
    const collapsedIcons = [
      { icon:<Network size={14}/>,        label:'Knowledge Graph',                   action:()=>setOpenModal('knowledge') },
      { icon:<LayoutDashboard size={14}/>, label:'Project Graph',                     action:()=>setOpenModal('graph') },
      { icon:<Bot size={14}/>,            label:'Agents',                            action:()=>setOpenModal('agents'), dot:!!hasRunning },
      { icon:<GitBranch size={14}/>,      label:'API Contracts',                     action:()=>setOpenModal('contracts') },
      { icon:<FolderOpen size={14}/>,     label:'File Explorer — click to expand',   action:()=>setRightExpanded(true) },
      { icon:<GitMerge size={14}/>,       label:'Source Control — click to expand',  action:()=>setRightExpanded(true) },
    ]
    return (
      <div style={{width:40,background:'var(--bg-secondary)',borderLeft:'1px solid var(--border)',display:'flex',flexDirection:'column',alignItems:'center',paddingTop:8,gap:4,height:'100%'}}>
        {collapsedIcons.map(({icon,label,action,dot})=>(
          <div key={label} title={label} style={{position:'relative',width:'100%',display:'flex',justifyContent:'center'}}>
            <button
              onClick={action}
              style={{width:32,height:30,display:'flex',alignItems:'center',justifyContent:'center',background:'transparent',border:'1px solid transparent',borderRadius:6,cursor:'pointer',color:'var(--text-muted)',transition:'all 0.15s'}}
              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.color='var(--accent)';(e.currentTarget as HTMLElement).style.borderColor='var(--border)';(e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}}
              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.color='var(--text-muted)';(e.currentTarget as HTMLElement).style.borderColor='transparent';(e.currentTarget as HTMLElement).style.background='transparent'}}
            >{icon}</button>
            {dot&&<span style={{position:'absolute',top:3,right:3,width:5,height:5,borderRadius:'50%',background:'var(--green)',boxShadow:'0 0 4px var(--green)',pointerEvents:'none'}}/>}
          </div>
        ))}
        {/* render modals even when collapsed */}
        {openModal && (
          <PanelModal title={modalTitles[openModal]} onClose={()=>setOpenModal(null)}>
            {renderModalBody()}
          </PanelModal>
        )}
        {showAgentModal && session && <AgentModal sessionId={session.id} projectId={session.id} onClose={()=>setShowAgentModal(false)}/>}
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  return (
    <div style={{background:'var(--bg-secondary)',borderLeft:'1px solid var(--border)',display:'flex',flexDirection:'column',height:'100%',overflow:'hidden',width:'100%'}}>

      {/* ── Row 1: Project title ── */}
      <div style={{height:36,flexShrink:0,padding:'0 12px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:6}}>
        <LayoutDashboard size={12} style={{color:'var(--text-muted)',flexShrink:0}}/>
        <span style={{fontSize:12,fontWeight:700,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>
          {session?.rootPath?.split('/').pop() ?? session?.title ?? 'No project open'}
        </span>
        {session?.type==='project' && !session.summary && session.rootPath && (
          <Loader size={11} style={{animation:'spin 1s linear infinite',color:'var(--text-muted)',flexShrink:0}}/>
        )}
      </div>

      {/* ── Row 2: 4 icon buttons (horizontal) ── */}
      <div style={{height:40,flexShrink:0,borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-around',padding:'0 8px',background:'var(--bg-secondary)'}}>
        {[
          { id:'knowledge' as ModalPanel, icon:<Network size={16}/>,        label:'Knowledge Graph',  dot:false },
          { id:'graph'     as ModalPanel, icon:<LayoutDashboard size={16}/>, label:'Project Graph',    dot:false },
          { id:'agents'    as ModalPanel, icon:<Bot size={16}/>,             label:`Agents${session?.agents.length?` (${session.agents.length})`:''}`, dot:!!hasRunning },
          { id:'contracts' as ModalPanel, icon:<GitBranch size={16}/>,       label:'API Contracts',    dot:false },
        ].map(({ id, icon, label, dot }) => (
          <button
            key={id!}
            onClick={() => setOpenModal(id)}
            title={label}
            style={{
              position:'relative',
              display:'flex', alignItems:'center', justifyContent:'center',
              width:36, height:32, borderRadius:7, border:'1px solid transparent',
              background:'transparent', cursor:'pointer', color:'var(--text-muted)',
              transition:'all 0.15s',
            }}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='var(--bg-hover)';(e.currentTarget as HTMLElement).style.color='var(--text-primary)';(e.currentTarget as HTMLElement).style.borderColor='var(--border)'}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent';(e.currentTarget as HTMLElement).style.color='var(--text-muted)';(e.currentTarget as HTMLElement).style.borderColor='transparent'}}
          >
            {icon}
            {dot && <span style={{position:'absolute',top:3,right:3,width:5,height:5,borderRadius:'50%',background:'var(--green)',boxShadow:'0 0 4px var(--green)'}}/>}
          </button>
        ))}
      </div>

      {/* ── Rows 3+: File Explorer + Git (collapsible, flex split) ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>

        {/* Explorer section */}
        <SidebarSection
          title={`Explorer${mergedFiles.length>0?` (${mergedFiles.length})`:''}` }
          expanded={explorerOpen}
          onToggle={() => setExplorerOpen(v=>!v)}
        >
          {/* Search bar */}
          <div style={{padding:'4px 8px',flexShrink:0,display:'flex',alignItems:'center',gap:4,borderBottom:'1px solid var(--border)'}}>
            <button className="icon-btn" style={{width:20,height:20}} onClick={()=>setShowSearch(v=>!v)}><Search size={11}/></button>
            {showSearch && (
              <input autoFocus placeholder="Search…" value={fileSearch} onChange={e=>setFileSearch(e.target.value)}
                style={{flex:1,background:'var(--bg-tertiary)',border:'none',borderRadius:4,padding:'2px 6px',color:'var(--text-primary)',fontSize:11,outline:'none'}}/>
            )}
          </div>
          <div style={{flex:1,overflowY:'auto',overflowX:'hidden',paddingBottom:4}}>
            {tree.length===0
              ?<div style={{padding:'10px 12px',fontSize:11,color:'var(--text-muted)'}}>{session?.rootPath?'No files yet':'Open a project to see files'}</div>
              :tree.map(n=><FileTreeNode key={n.path} node={n} depth={0} filter={fileSearch}/>)
            }
          </div>
        </SidebarSection>

        {/* Divider line between sections */}
        <div style={{height:1,flexShrink:0,background:'var(--border)'}}/>

        {/* Git section */}
        <SidebarSection
          title="Source Control"
          expanded={gitOpen}
          onToggle={() => setGitOpen(v=>!v)}
        >
          {session?.rootPath
            ?<GitPanel sessionId={session.id}/>
            :<div style={{padding:'10px 12px',fontSize:11,color:'var(--text-muted)'}}>Open a project to see git status</div>
          }
        </SidebarSection>
      </div>

      {/* ── Modal windows ── */}
      {openModal && (
        <PanelModal title={modalTitles[openModal]} onClose={()=>setOpenModal(null)}>
          {renderModalBody()}
        </PanelModal>
      )}

      {showAgentModal && session && (
        <AgentModal sessionId={session.id} projectId={session.id} onClose={()=>setShowAgentModal(false)}/>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
