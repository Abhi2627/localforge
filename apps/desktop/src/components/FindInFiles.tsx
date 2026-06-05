import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, CaseSensitive, WholeWord, ChevronRight, ChevronDown, FileText, Loader, Filter } from 'lucide-react'

interface Match {
  line:       number
  col:        number
  text:       string
  matchStart: number
  matchEnd:   number
}
interface FileResult {
  file:    string
  relPath: string
  matches: Match[]
}
interface SearchResult {
  results: FileResult[]
  total:   number
  capped:  boolean
}

interface Props {
  rootPath:   string
  onOpenFile: (filePath: string, line?: number) => void
}

export default function FindInFiles({ rootPath, onOpenFile }: Props) {
  const [query,         setQuery]         = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord,     setWholeWord]     = useState(false)
  const [includeGlob,   setIncludeGlob]   = useState('')
  const [excludeGlob,   setExcludeGlob]   = useState('node_modules,dist,build')
  const [showFilters,   setShowFilters]   = useState(false)
  const [results,       setResults]       = useState<SearchResult | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [expanded,      setExpanded]      = useState<Set<string>>(new Set())

  const inputRef    = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => { inputRef.current?.focus() }, [])

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim() || !rootPath) { setResults(null); return }
    setLoading(true)
    try {
      const enc = encodeURIComponent
      const url = `http://localhost:3001/project/search/files?rootPath=${enc(rootPath)}&query=${enc(q)}&caseSensitive=${caseSensitive}&wholeWord=${wholeWord}${includeGlob ? `&includeGlob=${enc(includeGlob)}` : ''}${excludeGlob ? `&excludeGlob=${enc(excludeGlob)}` : ''}`
      const res  = await fetch(url)
      const data = await res.json()
      setResults(data)
      const autoExpand = new Set<string>()
      ;(data.results ?? []).forEach((f: FileResult) => { if (f.matches.length <= 5) autoExpand.add(f.relPath) })
      setExpanded(autoExpand)
    } catch { setResults(null) }
    setLoading(false)
  }, [rootPath, caseSensitive, wholeWord, includeGlob, excludeGlob])

  function handleQueryChange(val: string) {
    setQuery(val)
    clearTimeout(debounceRef.current)
    if (!val.trim()) { setResults(null); return }
    debounceRef.current = setTimeout(() => runSearch(val), 350)
  }

  useEffect(() => {
    if (query.trim()) runSearch(query)
  }, [caseSensitive, wholeWord, includeGlob, excludeGlob]) // eslint-disable-line

  function toggleExpand(relPath: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }

  function HighlightedLine({ text, start, end }: { text: string; start: number; end: number }) {
    return (
      <span style={{ fontFamily:'monospace', fontSize:11, whiteSpace:'pre' }}>
        <span style={{ color:'#858585' }}>{text.slice(0, start)}</span>
        <span style={{ background:'rgba(255,213,0,0.35)', color:'#ffd700', fontWeight:600, borderRadius:2 }}>{text.slice(start, end)}</span>
        <span style={{ color:'#858585' }}>{text.slice(end)}</span>
      </span>
    )
  }

  const totalFiles   = results?.results.length ?? 0
  const totalMatches = results?.total ?? 0

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>

      {/* Search bar */}
      <div style={{ padding:'8px', flexShrink:0, borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:4, background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:6, padding:'4px 8px', marginBottom:4 }}>
          <Search size={12} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { clearTimeout(debounceRef.current); runSearch(query) }
              if (e.key === 'Escape') { setQuery(''); setResults(null) }
            }}
            placeholder="Search across files…"
            style={{ flex:1, background:'transparent', border:'none', outline:'none', color:'var(--text-primary)', fontSize:12 }}
          />
          {loading && <Loader size={11} style={{ animation:'spin 1s linear infinite', color:'var(--accent)', flexShrink:0 }}/>}
          {query && !loading && (
            <button onClick={() => { setQuery(''); setResults(null) }}
              style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:0 }}>
              <X size={11}/>
            </button>
          )}
        </div>

        {/* Options row */}
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <button title="Case Sensitive (Alt+C)" onClick={() => setCaseSensitive(v => !v)}
            style={{ display:'flex', alignItems:'center', justifyContent:'center', width:24, height:22, borderRadius:4, border:`1px solid ${caseSensitive ? 'var(--accent)' : 'transparent'}`, background:caseSensitive ? 'var(--accent-dim)' : 'transparent', cursor:'pointer', color:caseSensitive ? 'var(--accent)' : 'var(--text-muted)' }}>
            <CaseSensitive size={13}/>
          </button>
          <button title="Whole Word (Alt+W)" onClick={() => setWholeWord(v => !v)}
            style={{ display:'flex', alignItems:'center', justifyContent:'center', width:24, height:22, borderRadius:4, border:`1px solid ${wholeWord ? 'var(--accent)' : 'transparent'}`, background:wholeWord ? 'var(--accent-dim)' : 'transparent', cursor:'pointer', color:wholeWord ? 'var(--accent)' : 'var(--text-muted)' }}>
            <WholeWord size={13}/>
          </button>
          <button title="File filters" onClick={() => setShowFilters(v => !v)}
            style={{ display:'flex', alignItems:'center', height:22, borderRadius:4, padding:'0 6px', border:`1px solid ${showFilters ? 'var(--accent)' : 'transparent'}`, background:showFilters ? 'var(--accent-dim)' : 'transparent', cursor:'pointer', color:showFilters ? 'var(--accent)' : 'var(--text-muted)' }}>
            <Filter size={11}/>
          </button>
          {results && !loading && (
            <span style={{ fontSize:10, color:'var(--text-muted)', marginLeft:'auto' }}>
              {totalMatches > 0
                ? `${totalMatches}${results.capped ? '+' : ''} results in ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`
                : 'No results'
              }
            </span>
          )}
        </div>

        {/* File filters */}
        {showFilters && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:4 }}>
            {[
              { label:'Include', value:includeGlob, set:setIncludeGlob, placeholder:'*.ts, *.tsx' },
              { label:'Exclude', value:excludeGlob, set:setExcludeGlob, placeholder:'node_modules,dist' },
            ].map(({ label, value, set, placeholder }) => (
              <div key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:10, color:'var(--text-muted)', width:50, flexShrink:0 }}>{label}</span>
                <input value={value} onChange={e => set(e.target.value)} placeholder={placeholder}
                  style={{ flex:1, background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:4, padding:'3px 6px', color:'var(--text-primary)', fontSize:11, outline:'none', fontFamily:'monospace' }}/>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
        {!query.trim() && (
          <div style={{ padding:'24px 12px', textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>
            <Search size={24} style={{ opacity:0.3, display:'block', margin:'0 auto 8px' }}/>
            Type to search across all files in this project
            <div style={{ marginTop:8, fontSize:11, opacity:0.7 }}>Cmd+Shift+F to open · Esc to close</div>
          </div>
        )}

        {query.trim() && !loading && results && totalMatches === 0 && (
          <div style={{ padding:'24px 12px', textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>
            No results for <strong style={{ color:'var(--text-secondary)' }}>"{query}"</strong>
          </div>
        )}

        {results?.capped && (
          <div style={{ padding:'4px 10px', background:'rgba(245,158,11,0.1)', borderBottom:'1px solid var(--border)', fontSize:10, color:'#f59e0b' }}>
            ⚠ Results capped at 500 — refine your search
          </div>
        )}

        {(results?.results ?? []).map(fileResult => {
          const isExpanded = expanded.has(fileResult.relPath)
          const parts    = fileResult.relPath.split('/')
          const fileName = parts.pop() ?? fileResult.relPath
          const dirPath  = parts.join('/')
          return (
            <div key={fileResult.relPath}>
              <div onClick={() => toggleExpand(fileResult.relPath)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 8px', cursor:'pointer', background:'var(--bg-tertiary)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:1 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='var(--bg-tertiary)'}>
                {isExpanded
                  ? <ChevronDown  size={12} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
                  : <ChevronRight size={12} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
                }
                <FileText size={12} style={{ color:'var(--accent)', flexShrink:0 }}/>
                <span style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', fontFamily:'monospace' }}>{fileName}</span>
                {dirPath && <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{dirPath}</span>}
                <span style={{ fontSize:10, color:'var(--accent)', flexShrink:0, padding:'1px 6px', borderRadius:8, background:'var(--accent-dim)', fontWeight:600 }}>
                  {fileResult.matches.length}
                </span>
              </div>

              {isExpanded && fileResult.matches.map((match, mi) => (
                <div key={mi}
                  onClick={() => onOpenFile(fileResult.file, match.line)}
                  style={{ display:'flex', alignItems:'baseline', gap:8, padding:'3px 8px 3px 28px', cursor:'pointer', borderBottom:'1px solid rgba(255,255,255,0.02)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='var(--bg-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='transparent'}>
                  <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'monospace', flexShrink:0, width:32, textAlign:'right', userSelect:'none' }}>
                    {match.line}
                  </span>
                  <div style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    <HighlightedLine text={match.text} start={match.matchStart} end={match.matchEnd}/>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
