import { useState, useMemo, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown, Bot, GitBranch, LayoutDashboard, Plus, Loader, File, Folder, FolderOpen, Search, LucideIcon, Network, AlertTriangle, RefreshCw, CheckCircle, XCircle, AlertCircle, GitMerge } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import AgentModal from './AgentModal'
import ProjectGraph from './ProjectGraph'
import GitPanel from './GitPanel'

interface RightSidebarProps { onOpenTerminal: (cwd: string) => void }

// ── File tree ─────────────────────────────────────────────────────────────────

interface TreeNode { name: string; path: string; isDir: boolean; children: TreeNode[]; isNew: boolean }

function buildTree(files: string[], rootPath: string, newFiles: Set<string>): TreeNode[] {
  const root: TreeNode = { name: '', path: rootPath, isDir: true, children: [], isNew: false }
  for (const file of files) {
    const rel = file.replace(rootPath, '').replace(/^[/\\]/, '')
    const parts = rel.split(/[/\\]/).filter(Boolean)
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i], isLast = i === parts.length - 1
      let child = node.children.find(c => c.name === part)
      if (!child) { child = { name: part, path: `${node.path}/${part}`, isDir: !isLast, children: [], isNew: newFiles.has(file) && isLast }; node.children.push(child) }
      if (!isLast) node = child
    }
  }
  function sort(ns: TreeNode[]) { ns.sort((a, b) => a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)); ns.forEach(n => sort(n.children)) }
  sort(root.children)
  return root.children
}

function nodeMatchesFilter(node: TreeNode, filter: string): boolean {
  if (!filter) return true
  if (node.name.toLowerCase().includes(filter.toLowerCase())) return true
  return node.children.some(c => nodeMatchesFilter(c, filter))
}

function FileTreeNode({ node, depth = 0, filter }: { node: TreeNode; depth?: number; filter: string }) {
  const [open, setOpen] = useState(depth < 2)
  const activeSessionId = useAppStore(s => s.activeSessionId)
  const openFileFn = useAppStore(s => s.openFile)
  if (!nodeMatchesFilter(node, filter)) return null
  const indent = depth * 12
  if (node.isDir) {
    const isOpen = filter ? true : open
    return (
      <div>
        <div onClick={() => setOpen(!open)}
          style={{ display:'flex', alignItems:'center', gap:4, padding:`3px 8px 3px ${8+indent}px`, cursor:'pointer', fontSize:13, color:'var(--text-secondary)', userSelect:'none' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
          {isOpen ? <ChevronDown size={12} style={{flexShrink:0,opacity:0.6}}/> : <ChevronRight size={12} style={{flexShrink:0,opacity:0.6}}/>}
          {isOpen ? <FolderOpen size={14} style={{flexShrink:0,color:'#dcb67a'}}/> : <Folder size={14} style={{flexShrink:0,color:'#dcb67a'}}/>}
          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{node.name}</span>
        </div>
        {isOpen && node.children.map(child => <FileTreeNode key={child.path} node={child} depth={depth+1} filter={filter}/>)}
      </div>
    )
  }
  const ext = node.name.split('.').pop() ?? '', col = fileColor(ext)
  const hl = !!(filter && node.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div
      style={{ display:'flex', alignItems:'center', gap:5, padding:`3px 8px 3px ${22+indent}px`, cursor:'pointer', fontSize:13, color:hl?'var(--accent)':node.isNew?'var(--green)':'var(--text-secondary)', background:hl?'var(--accent-dim)':'transparent' }}
      onClick={() => { if (activeSessionId) openFileFn(activeSessionId, node.path) }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = hl?'var(--accent-dim)':'var(--bg-hover)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = hl?'var(--accent-dim)':'transparent'}>
      <File size={13} style={{flexShrink:0,color:col}}/>
      <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{node.name}</span>
      {node.isNew && <span style={{fontSize:10,color:'var(--green)',flexShrink:0}}>M</span>}
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
  const sc = agent.status==='running'?'var(--green)':agent.status==='failed'?'var(--red)':'var(--text-secondary)'
  return (
    <div style={{padding:'7px 12px',borderBottom:'1px solid var(--border)'}}>
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        <span className={`agent-badge badge-${agent.role}`} style={{flexShrink:0,fontSize:10}}>{agent.role.slice(0,2).toUpperCase()}</span>
        <span style={{flex:1,fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{agent.name}</span>
        {agent.status==='running'&&<span style={{width:6,height:6,borderRadius:'50%',background:'var(--green)',flexShrink:0}}/>}
        <span style={{fontSize:11,color:sc}}>{agent.status}</span>
      </div>
      {agent.currentTask&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{agent.currentTask.slice(0,50)}</div>}
      {agent.status==='running'&&<div className="progress-bar" style={{marginTop:4}}><div className="progress-fill pulse" style={{width:'60%'}}/></div>}
    </div>
  )
}

// ── Symbols panel ──────────────────────────────────────────────────────────────

type SymbolKind = 'function'|'class'|'interface'|'type'|'enum'|'constant'|'component'|'route'
interface SymbolNode { name: string; kind: SymbolKind; line: number; exported: boolean; file: string }
interface Conflict   { name: string; kind: SymbolKind; files: string[] }
interface GraphSummary { totalSymbols: number; byKind: Record<string,number>; byFile: Array<{file:string;count:number}>; conflicts: Conflict[] }

const KIND_COLOR: Record<string,string> = { function:'#3b82f6',class:'#8b5cf6',interface:'#06b6d4',type:'#a78bfa',enum:'#f59e0b',constant:'#94a3b8',component:'#3dd68c',route:'#f97316' }
const KIND_LETTER: Record<string,string> = { function:'f',class:'C',interface:'I',type:'T',enum:'E',constant:'c',component:'R',route:'@' }

function SymbolsPanel({ sessionId }: { sessionId: string }) {
  const [summary, setSummary] = useState<GraphSummary|null>(null)
  const [symbols, setSymbols] = useState<SymbolNode[]>([])
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(false)
  const [tab,     setTab]     = useState<'symbols'|'conflicts'>('symbols')
  const [kindFilter, setKindFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sumRes, symRes] = await Promise.all([
        fetch(`http://localhost:3001/project/${sessionId}/symbols/summary`),
        fetch(`http://localhost:3001/project/${sessionId}/symbols`),
      ])
      setSummary(await sumRes.json())
      setSymbols((await symRes.json()).symbols ?? [])
    } catch { }
    setLoading(false)
  }, [sessionId])

  useEffect(() => { load() }, [load])

  const filtered = symbols.filter(s => (kindFilter==='all' || s.kind===kindFilter) && (!search || s.name.toLowerCase().includes(search.toLowerCase())))
  const kinds = summary ? Object.keys(summary.byKind).filter(k => summary.byKind[k] > 0) : []

  return (
    <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden',minHeight:0}}>
      {summary && (
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
          <span style={{fontSize:12,color:'var(--text-primary)',fontWeight:500}}>{summary.totalSymbols} symbols</span>
          {summary.conflicts.length>0 && <span style={{display:'flex',alignItems:'center',gap:3,fontSize:11,color:'#f59e0b'}}><AlertTriangle size={11}/>{summary.conflicts.length} conflict{summary.conflicts.length>1?'s':''}</span>}
          <button onClick={load} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',display:'flex',padding:2}}>
            <RefreshCw size={12} style={{animation:loading?'spin 1s linear infinite':'none'}}/>
          </button>
        </div>
      )}
      {/* Tabs */}
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',flexShrink:0}}>
        {(['symbols','conflicts'] as const).map(t => (
          <button key={t} onClick={()=>setTab(t)}
            style={{padding:'5px 12px',border:'none',background:'transparent',cursor:'pointer',fontSize:12,fontWeight:tab===t?600:400,color:tab===t?'var(--accent)':'var(--text-secondary)',borderBottom:tab===t?'2px solid var(--accent)':'2px solid transparent',textTransform:'capitalize'}}>
            {t}{t==='conflicts'&&summary&&summary.conflicts.length>0?` (${summary.conflicts.length})`:''}
          </button>
        ))}
      </div>
      {tab==='symbols' ? (
        <>
          <div style={{padding:'5px 8px',flexShrink:0}}>
            <input placeholder="Search symbols…" value={search} onChange={e=>setSearch(e.target.value)}
              style={{width:'100%',background:'var(--bg-tertiary)',border:'1px solid var(--border)',borderRadius:5,padding:'4px 10px',color:'var(--text-primary)',fontSize:12,outline:'none',boxSizing:'border-box'}}/>
          </div>
          {kinds.length>1 && (
            <div style={{display:'flex',gap:4,padding:'0 8px 5px',flexWrap:'wrap',flexShrink:0}}>
              <button onClick={()=>setKindFilter('all')}
                style={{padding:'2px 8px',borderRadius:10,border:`1px solid ${kindFilter==='all'?'var(--accent)':'var(--border)'}`,background:kindFilter==='all'?'var(--accent-dim)':'transparent',color:kindFilter==='all'?'var(--accent)':'var(--text-secondary)',fontSize:10,cursor:'pointer',fontWeight:kindFilter==='all'?600:400}}>all</button>
              {kinds.map(k => (
                <button key={k} onClick={()=>setKindFilter(k)}
                  style={{padding:'2px 8px',borderRadius:10,border:`1px solid ${kindFilter===k?(KIND_COLOR[k]??'var(--accent)'):'var(--border)'}`,background:kindFilter===k?`${KIND_COLOR[k]??'var(--accent)'}22`:'transparent',color:kindFilter===k?(KIND_COLOR[k]??'var(--accent)'):'var(--text-secondary)',fontSize:10,cursor:'pointer',fontWeight:kindFilter===k?600:400}}>{k}</button>
              ))}
            </div>
          )}
          <div style={{flex:1,overflowY:'auto',paddingBottom:4}}>
            {loading&&symbols.length===0
              ? <div style={{padding:'12px',fontSize:12,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:6}}><Loader size={12} style={{animation:'spin 1s linear infinite'}}/>Scanning…</div>
              : filtered.length===0
                ? <div style={{padding:'10px 12px',fontSize:12,color:'var(--text-muted)'}}>{symbols.length===0?'No symbols yet':'No matches'}</div>
                : filtered.slice(0,200).map((s,i) => {
                    const rel = s.file.split('/').slice(-2).join('/'), col = KIND_COLOR[s.kind]??'#888'
                    return (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:7,padding:'4px 10px'}}
                        onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
                        onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
                        <span style={{width:15,height:15,borderRadius:3,background:`${col}22`,color:col,fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontFamily:'monospace'}}>{KIND_LETTER[s.kind]??'?'}</span>
                        <span style={{flex:1,fontSize:12,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
                        {!s.exported&&<span style={{fontSize:10,color:'var(--text-muted)',flexShrink:0}}>local</span>}
                        <span style={{fontSize:10,color:'var(--text-muted)',flexShrink:0,fontFamily:'monospace',maxWidth:90,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rel}:{s.line}</span>
                      </div>
                    )
                  })
            }
            {filtered.length>200 && <div style={{padding:'4px 10px',fontSize:11,color:'var(--text-muted)'}}>Showing 200 of {filtered.length}</div>}
          </div>
        </>
      ) : (
        <div style={{flex:1,overflowY:'auto'}}>
          {!summary||summary.conflicts.length===0
            ? <div style={{padding:'12px',fontSize:12,color:'var(--green)'}}>✓ No conflicts</div>
            : summary.conflicts.map((c,i) => (
                <div key={i} style={{padding:'9px 10px',borderBottom:'1px solid var(--border)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                    <AlertTriangle size={12} style={{color:'#f59e0b',flexShrink:0}}/>
                    <span style={{fontSize:13,fontWeight:500,color:'var(--text-primary)'}}>{c.name}</span>
                    <span style={{fontSize:10,color:KIND_COLOR[c.kind]??'#888',background:`${KIND_COLOR[c.kind]??'#888'}22`,padding:'1px 5px',borderRadius:4}}>{c.kind}</span>
                  </div>
                  <div style={{fontSize:11,color:'var(--text-muted)',paddingLeft:18}}>
                    {c.files.map((f,fi)=><div key={fi} style={{color:'var(--text-secondary)',fontFamily:'monospace',fontSize:11}}>{f.split('/').slice(-2).join('/')}</div>)}
                  </div>
                </div>
              ))
          }
        </div>
      )}
    </div>
  )
}

// ── Contracts panel ────────────────────────────────────────────────────────────

interface ApiCall    { method:string; path:string; file:string; line:number }
interface ApiRoute   { method:string; path:string; file:string; line:number }
interface Violation  { kind:'missing_route'|'method_mismatch'; call:ApiCall; similar:ApiRoute[] }
interface ContractSummary { totalCalls:number; totalRoutes:number; matched:number; violations:number; orphans:number; health:'good'|'warn'|'bad' }
interface ContractReport  { calls:ApiCall[]; routes:ApiRoute[]; violations:Violation[]; orphans:{route:ApiRoute}[]; summary:ContractSummary }
const METHOD_COLOR: Record<string,string> = { GET:'#3dd68c',POST:'#3b82f6',PUT:'#f59e0b',DELETE:'#ef4444',PATCH:'#a78bfa',ANY:'#94a3b8' }

function ContractsPanel({ sessionId }: { sessionId: string }) {
  const [report,  setReport]  = useState<ContractReport|null>(null)
  const [loading, setLoading] = useState(false)
  const [tab,     setTab]     = useState<'violations'|'routes'|'calls'>('violations')

  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await fetch(`http://localhost:3001/project/${sessionId}/contracts`); setReport(await res.json()) } catch { }
    setLoading(false)
  }, [sessionId])

  useEffect(() => { load() }, [load])

  const health = report?.summary?.health
  const healthIcon = health==='good'
    ? <CheckCircle size={13} style={{color:'var(--green)'}}/>
    : health==='warn'
    ? <AlertCircle size={13} style={{color:'#f59e0b'}}/>
    : <XCircle size={13} style={{color:'var(--red)'}}/>

  return (
    <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden',minHeight:0}}>
      {report?.summary && (
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderBottom:'1px solid var(--border)',flexShrink:0,flexWrap:'wrap'}}>
          {healthIcon}
          <span style={{fontSize:12,color:'var(--text-primary)',fontWeight:500}}>{report.summary.violations===0?'No violations':`${report.summary.violations} violation${report.summary.violations>1?'s':''}`}</span>
          <span style={{fontSize:11,color:'var(--text-secondary)'}}>{report.summary.totalCalls} calls · {report.summary.totalRoutes} routes</span>
          <button onClick={load} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',display:'flex',padding:2}}>
            <RefreshCw size={12} style={{animation:loading?'spin 1s linear infinite':'none'}}/>
          </button>
        </div>
      )}
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',flexShrink:0}}>
        {(['violations','routes','calls'] as const).map(t => (
          <button key={t} onClick={()=>setTab(t)}
            style={{padding:'5px 12px',border:'none',background:'transparent',cursor:'pointer',fontSize:12,fontWeight:tab===t?600:400,color:tab===t?'var(--accent)':'var(--text-secondary)',borderBottom:tab===t?'2px solid var(--accent)':'2px solid transparent',textTransform:'capitalize'}}>
            {t}{t==='violations'&&report&&report.summary.violations>0?` (${report.summary.violations})`:''}
          </button>
        ))}
      </div>
      <div style={{flex:1,overflowY:'auto'}}>
        {loading&&!report
          ? <div style={{padding:'12px',fontSize:12,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:6}}><Loader size={12} style={{animation:'spin 1s linear infinite'}}/>Scanning…</div>
          : tab==='violations'
            ? (!report||report.violations.length===0
                ? <div style={{padding:'12px',fontSize:12,color:'var(--green)',display:'flex',alignItems:'center',gap:6}}><CheckCircle size={14}/>All calls matched</div>
                : report.violations.map((v,i) => (
                    <div key={i} style={{padding:'9px 10px',borderBottom:'1px solid var(--border)'}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                        <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:4,background:`${METHOD_COLOR[v.call.method]??'#888'}22`,color:METHOD_COLOR[v.call.method]??'#888',flexShrink:0}}>{v.call.method}</span>
                        <span style={{fontSize:12,fontWeight:500,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,fontFamily:'monospace'}}>{v.call.path}</span>
                        <span style={{fontSize:10,color:v.kind==='missing_route'?'var(--red)':'#f59e0b',flexShrink:0,fontWeight:600}}>{v.kind==='missing_route'?'MISSING':'METHOD'}</span>
                      </div>
                      <div style={{fontSize:11,color:'var(--text-secondary)',paddingLeft:4}}>{v.call.file.split('/').slice(-2).join('/')}:{v.call.line}</div>
                      {v.similar.length>0 && <div style={{fontSize:11,color:'var(--text-muted)',paddingLeft:4,marginTop:2}}>Exists as: {v.similar.map(r=>r.method).join(', ')}</div>}
                    </div>
                  ))
              )
            : tab==='routes'
              ? (report?.routes??[]).map((r,i) => (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:7,padding:'5px 10px'}}
                    onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
                    onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
                    <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:4,background:`${METHOD_COLOR[r.method]??'#888'}22`,color:METHOD_COLOR[r.method]??'#888',flexShrink:0,minWidth:40,textAlign:'center'}}>{r.method}</span>
                    <span style={{fontSize:12,color:'var(--text-primary)',fontFamily:'monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{r.path}</span>
                    <span style={{fontSize:10,color:'var(--text-muted)',flexShrink:0}}>{r.file.split('/').pop()}:{r.line}</span>
                  </div>
                ))
              : (report?.calls??[]).map((c,i) => (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:7,padding:'5px 10px'}}
                    onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
                    onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
                    <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:4,background:`${METHOD_COLOR[c.method]??'#888'}22`,color:METHOD_COLOR[c.method]??'#888',flexShrink:0,minWidth:40,textAlign:'center'}}>{c.method}</span>
                    <span style={{fontSize:12,color:'var(--text-primary)',fontFamily:'monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{c.path}</span>
                    <span style={{fontSize:10,color:'var(--text-muted)',flexShrink:0}}>{c.file.split('/').pop()}:{c.line}</span>
                  </div>
                ))
        }
      </div>
    </div>
  )
}

// ── Main sidebar ───────────────────────────────────────────────────────────────

const HDR = 32   // section header height — was 28

export default function RightSidebar({ onOpenTerminal: _ot }: RightSidebarProps) {
  const { sessions, activeSessionId, rightExpanded } = useAppStore()
  const session = sessions.find(s => s.id === activeSessionId)

  const [fileSearch,     setFileSearch]    = useState('')
  const [showSearch,     setShowSearch]    = useState(false)
  const [showAgentModal, setShowAgentModal]= useState(false)
  const [open,  setOpen]  = useState({ explorer:true, git:false, contracts:false, agents:true, symbols:false, graph:true })
  const [maxId, setMaxId] = useState<string|null>(null)
  const [graphFullscreenAt, setGraphFullscreenAt] = useState<number|null>(null)

  const allFiles    = session?.allFiles    ?? []
  const written     = session?.writtenFiles ?? []
  const mergedFiles = useMemo(() => [...new Set([...allFiles,...written])], [allFiles.join(','),written.join(',')])
  const newFileSet  = useMemo(() => new Set(written), [written.join(',')])
  const tree        = useMemo(() => session?.rootPath ? buildTree(mergedFiles, session.rootPath, newFileSet) : [], [mergedFiles.join(','),session?.rootPath,written.join(',')])

  if (!rightExpanded) {
    const hasRunning = session?.agents.some(a => a.status==='running')
    return (
      <div style={{width:40,background:'var(--bg-secondary)',borderLeft:'1px solid var(--border)',display:'flex',flexDirection:'column',alignItems:'center',paddingTop:10,gap:6,height:'100%'}}>
        {([{Icon:FolderOpen,label:'Files',dot:false},{Icon:GitMerge,label:'Git',dot:false},{Icon:GitBranch,label:'Contracts',dot:false},{Icon:Bot,label:'Agents',dot:!!hasRunning},{Icon:Network,label:'Symbols',dot:false}] as {Icon:LucideIcon,label:string,dot:boolean}[]).map(({Icon,label,dot}) => (
          <div key={label} title={label} style={{position:'relative'}}>
            <button className="icon-btn" style={{width:32,height:32}}><Icon size={15}/></button>
            {dot && <span style={{position:'absolute',top:5,right:5,width:5,height:5,borderRadius:'50%',background:'var(--green)',boxShadow:'0 0 4px var(--green)'}}/>}
          </div>
        ))}
      </div>
    )
  }

  function toggleOpen(id: string) { if (maxId===id) { setMaxId(null); return }; setOpen(p => ({ ...p, [id]: !(p as any)[id] })) }
  function toggleMax(id: string) { if (maxId===id) { setMaxId(null) } else { setMaxId(id); setOpen(p => ({ ...p, [id]: true })) } }
  function isExp(id: string) { return maxId ? maxId===id : (open as any)[id] }
  function secStyle(id: string): React.CSSProperties {
    const base: React.CSSProperties = { display:'flex', flexDirection:'column', overflow:'hidden', borderBottom:'1px solid var(--border)' }
    if (maxId) return maxId===id ? {...base,flex:1,minHeight:0} : {...base,flexShrink:0,height:HDR}
    const weights: Record<string,number> = { explorer:3, git:2, contracts:1.5, agents:1, symbols:2, graph:1 }
    return (open as any)[id] ? {...base,flex:weights[id]??1,minHeight:HDR+40} : {...base,flexShrink:0,height:HDR}
  }

  const sections: Array<{id:string;Icon:LucideIcon;title:string;extra?:React.ReactNode;body:React.ReactNode}> = [
    {
      id:'explorer', Icon:FolderOpen,
      title: `Explorer${mergedFiles.length>0?` (${mergedFiles.length})`:''}`,
      extra: <button className="icon-btn" style={{width:18,height:18}} onClick={e=>{e.stopPropagation();setShowSearch(v=>!v)}}><Search size={11}/></button>,
      body: (
        <>
          {showSearch && <input autoFocus placeholder="Search files…" value={fileSearch} onChange={e=>setFileSearch(e.target.value)}
            style={{flexShrink:0,margin:'5px 8px',background:'var(--bg-tertiary)',border:'1px solid var(--border)',borderRadius:5,padding:'4px 10px',color:'var(--text-primary)',fontSize:12,outline:'none'}}/>}
          <div style={{flex:1,overflowY:'auto',overflowX:'hidden',paddingBottom:4}}>
            {tree.length===0
              ? <div style={{padding:'10px 12px',fontSize:12,color:'var(--text-muted)'}}>No files yet</div>
              : tree.map(n => <FileTreeNode key={n.path} node={n} depth={0} filter={fileSearch}/>)
            }
          </div>
        </>
      ),
    },
    {
      id:'git', Icon:GitMerge, title:'Source Control',
      body: session?.rootPath
        ? <GitPanel sessionId={session.id}/>
        : <div style={{padding:'10px 12px',fontSize:12,color:'var(--text-muted)'}}>Open a project to see git status</div>,
    },
    {
      id:'contracts', Icon:GitBranch, title:'API Contracts',
      body: session
        ? <ContractsPanel sessionId={session.id}/>
        : <div style={{padding:'10px 12px',fontSize:12,color:'var(--text-muted)'}}>Open a project to check contracts</div>,
    },
    {
      id:'agents', Icon:Bot, title:`Agents (${session?.agents.length??0})`,
      extra: session?.type==='project'
        ? <button className="icon-btn" style={{width:18,height:18}} onClick={e=>{e.stopPropagation();setShowAgentModal(true)}}><Plus size={11}/></button>
        : undefined,
      body: (
        <div style={{flex:1,overflowY:'auto'}}>
          {(!session||session.agents.length===0)
            ? session?.type==='project'
              ? <div style={{padding:'10px 12px'}}>
                  <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:8}}>No agents yet.</div>
                  <button onClick={()=>setShowAgentModal(true)} style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'7px 12px',background:'var(--accent)',border:'none',borderRadius:7,color:'white',fontSize:12,fontWeight:500,cursor:'pointer',justifyContent:'center'}}><Plus size={13}/> Add first agent</button>
                </div>
              : <div style={{padding:'10px 12px',fontSize:12,color:'var(--text-muted)'}}>Available in project sessions</div>
            : <>
                {session.agents.map(a => <AgentRow key={a.id} agentId={a.id} sessionId={session.id}/>)}
                <button onClick={()=>setShowAgentModal(true)} style={{display:'flex',alignItems:'center',gap:5,margin:'6px 10px',padding:'5px 8px',background:'transparent',border:'1px dashed var(--border-light)',borderRadius:6,color:'var(--text-secondary)',fontSize:12,cursor:'pointer',width:'calc(100% - 20px)',justifyContent:'center'}}><Plus size={11}/> Add agent</button>
              </>
          }
        </div>
      ),
    },
    {
      id:'symbols', Icon:Network, title:'Knowledge Graph',
      body: session
        ? <SymbolsPanel sessionId={session.id}/>
        : <div style={{padding:'10px 12px',fontSize:12,color:'var(--text-muted)'}}>Open a project</div>,
    },
    {
      id:'graph', Icon:LayoutDashboard, title:'Project Graph',
      extra: <button className="icon-btn" style={{width:18,height:18}} onClick={e=>{e.stopPropagation();setGraphFullscreenAt(Date.now())}}>⤢</button>,
      body: <ProjectGraph files={mergedFiles} rootPath={session?.rootPath??''}/>,
    },
  ]

  return (
    <div style={{background:'var(--bg-secondary)',borderLeft:'1px solid var(--border)',display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>

      {/* Sidebar header */}
      <div style={{height:36,flexShrink:0,padding:'0 12px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:6}}>
        <LayoutDashboard size={13} style={{color:'var(--text-muted)',flexShrink:0}}/>
        <span style={{fontSize:12,fontWeight:600,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>
          {session?.rootPath?.split('/').pop() ?? session?.title ?? 'No project open'}
        </span>
        {session?.type==='project' && !session.summary && session.rootPath &&
          <Loader size={11} style={{animation:'spin 1s linear infinite',flexShrink:0,color:'var(--text-muted)'}}/>
        }
      </div>

      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>
        {sections.map(sec => {
          const exp = isExp(sec.id), isMax = maxId===sec.id
          return (
            <div key={sec.id} style={secStyle(sec.id)}>
              {/* Section header — bigger text, brighter color */}
              <div
                onClick={() => toggleOpen(sec.id)}
                style={{height:HDR,flexShrink:0,display:'flex',alignItems:'center',gap:6,padding:'0 10px',cursor:'pointer',userSelect:'none',borderBottom:exp?'1px solid var(--border)':'none',background:isMax?'var(--accent-dim)':'transparent'}}
                onMouseEnter={e => { if (!isMax) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isMax?'var(--accent-dim)':'transparent' }}
              >
                {exp
                  ? <ChevronDown size={11} style={{color:'var(--text-secondary)',flexShrink:0}}/>
                  : <ChevronRight size={11} style={{color:'var(--text-secondary)',flexShrink:0}}/>
                }
                <sec.Icon size={13} style={{color:isMax?'var(--accent)':'var(--text-secondary)',flexShrink:0}}/>
                {/* Section title: 12px, bright, uppercase */}
                <span style={{flex:1,fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',color:isMax?'var(--accent)':'var(--text-secondary)'}}>
                  {sec.title}
                </span>
                {sec.extra && <div onClick={e=>e.stopPropagation()}>{sec.extra}</div>}
                <button
                  onClick={e => { e.stopPropagation(); toggleMax(sec.id) }}
                  style={{background:'none',border:'none',cursor:'pointer',color:isMax?'var(--accent)':'var(--text-secondary)',padding:'0 2px',display:'flex',fontSize:12,lineHeight:1}}
                >{isMax?'▾':'▸'}</button>
              </div>
              {exp && <div style={{flex:1,overflow:'hidden',minHeight:0,display:'flex',flexDirection:'column'}}>{sec.body}</div>}
            </div>
          )
        })}
      </div>

      {showAgentModal && session && <AgentModal sessionId={session.id} projectId={session.id} onClose={()=>setShowAgentModal(false)}/>}

      {graphFullscreenAt!==null && session && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}
          onClick={()=>setGraphFullscreenAt(null)}>
          <div style={{background:'var(--bg-secondary)',border:'1px solid var(--border)',borderRadius:12,padding:16,width:'86vw',height:'86vh',display:'flex',flexDirection:'column',gap:8}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
              <span style={{fontSize:14,fontWeight:600,color:'var(--text-primary)'}}>Project graph — {session.title}</span>
              <button className="icon-btn" onClick={()=>setGraphFullscreenAt(null)} style={{width:28,height:28}}>✕</button>
            </div>
            <div style={{flex:1,overflow:'hidden',minHeight:0,display:'flex',flexDirection:'column'}}>
              <ProjectGraph key={`fullscreen-${graphFullscreenAt}`} files={mergedFiles} rootPath={session.rootPath??''} fitTrigger={graphFullscreenAt}/>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
