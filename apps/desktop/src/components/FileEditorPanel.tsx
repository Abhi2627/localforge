import { useState, useEffect, useRef, useCallback } from 'react'
import { Copy, Check, FileCode, Loader, Cloud } from 'lucide-react'
import path from 'path-browserify'
import { api } from '../hooks/useApi'

const AUTOSAVE_DELAY = 800

interface Props {
  filePath: string
  rootPath?: string
  onSaveSuccess?: () => void
}

function highlight(code: string, ext: string): string {
  if (!['ts','tsx','js','jsx','py','json','css','scss','html','sh','rs','go'].includes(ext)) return escHtml(code)
  let s = escHtml(code)
  if (ext === 'json') {
    return s
      .replace(/(&quot;[^&]*&quot;)(\s*:)/g, '<span style="color:#9cdcfe">$1</span>$2')
      .replace(/:\s*(&quot;[^&]*&quot;)/g, ': <span style="color:#ce9178">$1</span>')
      .replace(/\b(true|false|null)\b/g, '<span style="color:#569cd6">$1</span>')
      .replace(/\b(-?\d+\.?\d*)\b/g, '<span style="color:#b5cea8">$1</span>')
  }
  if (['css','scss'].includes(ext)) {
    return s
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#6a9955">$1</span>')
      .replace(/([.#]?[\w-]+)\s*(?=\{)/g, '<span style="color:#d7ba7d">$1</span>')
      .replace(/([\w-]+)\s*:/g, '<span style="color:#9cdcfe">$1</span>:')
      .replace(/:\s*(#[0-9a-fA-F]{3,8}|[\w-]+(?:\(.*?\))?)/g, ': <span style="color:#ce9178">$1</span>')
  }
  if (ext === 'html') {
    return s
      .replace(/(&lt;\/?)([\w-]+)/g, '$1<span style="color:#4ec9b0">$2</span>')
      .replace(/([\w-]+)=(&quot;)/g, '<span style="color:#9cdcfe">$1</span>=$2')
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span style="color:#6a9955">$1</span>')
  }
  const keywords: Record<string, string[]> = {
    ts:  ['import','export','from','const','let','var','function','class','interface','type','enum','extends','implements','return','if','else','for','while','do','switch','case','break','continue','new','this','super','async','await','try','catch','finally','throw','typeof','instanceof','void','null','undefined','true','false','in','of','default','static','readonly','abstract','public','private','protected','declare','namespace','module','as','is'],
    tsx: ['import','export','from','const','let','var','function','class','interface','type','enum','extends','implements','return','if','else','for','while','do','switch','case','break','continue','new','this','super','async','await','try','catch','finally','throw','typeof','instanceof','void','null','undefined','true','false','in','of','default','static','readonly','abstract','public','private','protected'],
    js:  ['import','export','from','const','let','var','function','class','return','if','else','for','while','do','switch','case','break','continue','new','this','super','async','await','try','catch','finally','throw','typeof','instanceof','void','null','undefined','true','false','in','of','default','static'],
    jsx: ['import','export','from','const','let','var','function','class','return','if','else','for','while','do','switch','case','break','continue','new','this','super','async','await','try','catch','finally','throw','typeof','instanceof','void','null','undefined','true','false','in','of','default','static'],
    py:  ['import','from','def','class','return','if','elif','else','for','while','break','continue','try','except','finally','raise','with','as','in','is','not','and','or','None','True','False','pass','lambda','yield','global','nonlocal','del','assert'],
    rs:  ['fn','let','mut','const','static','struct','enum','impl','trait','use','mod','pub','crate','super','self','match','if','else','for','while','loop','return','break','continue','true','false','Some','None','Ok','Err','Box','Vec','String','str','i32','i64','u32','u64','usize','bool','f32','f64'],
    go:  ['func','var','const','type','struct','interface','import','package','return','if','else','for','range','switch','case','break','continue','goto','defer','go','chan','map','nil','true','false','make','new','append','len','cap','close','delete'],
  }
  const kws = keywords[ext] ?? keywords['js']
  if (ext === 'py') s = s.replace(/(#[^\n]*)/g, '<span style="color:#6a9955">$1</span>')
  else { s = s.replace(/(\/\/[^\n]*)/g, '<span style="color:#6a9955">$1</span>'); s = s.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#6a9955">$1</span>') }
  s = s.replace(/(&quot;(?:[^&]|&(?!quot;))*&quot;|&#x27;(?:[^&]|&(?!#x27;))*&#x27;|`[^`]*`)/g, '<span style="color:#ce9178">$1</span>')
  s = s.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#b5cea8">$1</span>')
  s = s.replace(new RegExp(`\\b(${kws.join('|')})\\b`, 'g'), '<span style="color:#569cd6">$1</span>')
  s = s.replace(/\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, '<span style="color:#dcdcaa">$1</span>')
  s = s.replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g, '<span style="color:#4ec9b0">$1</span>')
  return s
}
function escHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
}

// ── Breadcrumb: full path as clickable segments ───────────────────────────────
function Breadcrumb({ filePath, rootPath }: { filePath: string; rootPath?: string }) {
  const normalized = filePath.replace(/\\/g, '/')
  const rel = rootPath
    ? normalized.replace(rootPath.replace(/\\/g, '/').replace(/\/$/, '') + '/', '')
    : normalized
  const parts = rel.split('/').filter(Boolean)
  return (
    <div style={{ display:'flex', alignItems:'center', flex:1, minWidth:0, overflow:'hidden' }}>
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1
        return (
          <span key={i} style={{ display:'flex', alignItems:'center', flexShrink: isLast ? 1 : 0, minWidth:0 }}>
            {i > 0 && <span style={{ color:'#555', fontSize:11, margin:'0 2px', userSelect:'none', flexShrink:0 }}>›</span>}
            <span style={{
              fontSize:11, fontFamily:'monospace', whiteSpace:'nowrap',
              color: isLast ? '#d4d4d4' : '#858585',
              fontWeight: isLast ? 600 : 400,
              overflow: isLast ? 'hidden' : 'visible',
              textOverflow: isLast ? 'ellipsis' : 'clip',
            }}>{part}</span>
          </span>
        )
      })}
    </div>
  )
}

// ── Minimap ───────────────────────────────────────────────────────────────────
const MINIMAP_W      = 100
const MINIMAP_LINE_H = 2
const MINIMAP_FONT   = '1.7px monospace'

function lineColor(line: string): string {
  const t = line.trim()
  if (!t) return ''
  if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return '#6a9955'
  if (/^(import|export|from|const|let|var|function|class|interface|type|enum|return|if|else|for|while|async|await|def|fn)\b/.test(t)) return '#569cd6'
  if (/^[A-Z][a-zA-Z]/.test(t)) return '#4ec9b0'
  if (t.startsWith("'") || t.startsWith('"') || t.startsWith('`')) return '#ce9178'
  if (t.startsWith('<') || t.startsWith('}') || t.startsWith('{')) return '#ffd700'
  return '#9cdcfe'
}

function Minimap({ lines, visibleStart, visibleCount, onClickLine, changedLines }: {
  lines: string[]; visibleStart: number; visibleCount: number
  totalLines: number; onClickLine: (l: number) => void; changedLines?: Set<number>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const FULL_H    = lines.length * MINIMAP_LINE_H

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.width = MINIMAP_W; canvas.height = Math.max(lines.length * MINIMAP_LINE_H, 1)
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, MINIMAP_W, canvas.height)
    ctx.font = MINIMAP_FONT; ctx.textBaseline = 'top'
    lines.forEach((line, i) => {
      const y = i * MINIMAP_LINE_H
      if (changedLines?.has(i+1)) { ctx.fillStyle='rgba(61,214,140,0.18)'; ctx.fillRect(0,y,MINIMAP_W,MINIMAP_LINE_H) }
      const color = changedLines?.has(i+1) ? '#3dd68c' : lineColor(line)
      if (!color || !line.trim()) return
      ctx.fillStyle = color
      const indent = (line.length - line.trimStart().length) * 0.5
      ctx.fillText(line.trimStart(), Math.min(indent, MINIMAP_W*0.25), y+0.1, MINIMAP_W - Math.min(indent, MINIMAP_W*0.25))
    })
  }, [lines, changedLines]) // eslint-disable-line

  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    el.scrollTop = Math.max(0, visibleStart*MINIMAP_LINE_H + visibleCount*MINIMAP_LINE_H/2 - el.clientHeight/2)
  }, [visibleStart, visibleCount])

  return (
    <div style={{ width:MINIMAP_W, flexShrink:0, background:'#1e1e1e', borderLeft:'1px solid #2a2a2a', display:'flex', flexDirection:'column' }}>
      <div ref={scrollRef}
        onClick={e => { const el=scrollRef.current; if(!el) return; const rect=el.getBoundingClientRect(); onClickLine(Math.max(0,Math.min(Math.floor((e.clientY-rect.top+el.scrollTop)/MINIMAP_LINE_H),lines.length-1))) }}
        style={{ flex:1, overflow:'hidden', cursor:'pointer', position:'relative' }}>
        <div style={{ width:MINIMAP_W, height:FULL_H, position:'relative' }}>
          <canvas ref={canvasRef} width={MINIMAP_W} height={Math.max(FULL_H,1)} style={{ display:'block', imageRendering:'pixelated' }}/>
          <div style={{ position:'absolute', left:0, top:visibleStart*MINIMAP_LINE_H, width:MINIMAP_W, height:Math.max(visibleCount*MINIMAP_LINE_H,20), background:'rgba(255,255,255,0.13)', border:'1px solid rgba(255,255,255,0.35)', pointerEvents:'none', boxSizing:'border-box', borderRadius:2 }}/>
        </div>
      </div>
    </div>
  )
}

// ── Breakpoint gutter ─────────────────────────────────────────────────────────
function BreakpointGutter({ lineCount, breakpoints, onToggle, lineHeight, paddingTop }: {
  lineCount:number; breakpoints:Set<number>; onToggle:(l:number)=>void; lineHeight:number; paddingTop:number
}) {
  const [hovered, setHovered] = useState<number|null>(null)
  return (
    <div style={{ width:16, flexShrink:0, background:'#1e1e1e', overflow:'hidden', paddingTop }}>
      {Array.from({ length:lineCount }, (_,i) => {
        const line=i+1, active=breakpoints.has(line), show=active||hovered===line
        return (
          <div key={i} style={{ height:lineHeight, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}
            onMouseEnter={()=>setHovered(line)} onMouseLeave={()=>setHovered(null)} onClick={()=>onToggle(line)}>
            {show && <div style={{ width:9, height:9, borderRadius:'50%', background:active?'#e51400':'rgba(229,20,0,0.35)', boxShadow:active?'0 0 4px rgba(229,20,0,0.8)':'none', transition:'all 0.1s' }}/>}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FileEditorPanel({ filePath, rootPath, onSaveSuccess }: Props) {
  const [content,      setContent]      = useState('')
  const [loading,      setLoading]      = useState(true)
  const [copied,       setCopied]       = useState(false)
  const [error,        setError]        = useState('')
  const [saveState,    setSaveState]    = useState<'saved'|'unsaved'|'saving'>('saved')
  const [breakpoints,  setBreakpoints]  = useState<Set<number>>(new Set())
  const [visibleStart, setVisibleStart] = useState(0)
  const [visibleCount, setVisibleCount] = useState(40)

  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const highlightRef   = useRef<HTMLPreElement>(null)
  const autoSaveTimer  = useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
  const savedContent   = useRef('')

  const LINE_H  = 19.2
  const PAD_TOP = 10
  const ext     = filePath.split('.').pop()?.toLowerCase() ?? ''

  const resolvedPath = (() => {
    if (!filePath) return ''
    if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) return filePath
    return rootPath ? path.join(rootPath, filePath) : filePath
  })()

  useEffect(() => {
    setLoading(true); setError(''); setSaveState('saved'); setBreakpoints(new Set())
    clearTimeout(autoSaveTimer.current)
    api.readFile(resolvedPath)
      .then(res => { const c = res.content ?? ''; setContent(c); savedContent.current = c; setLoading(false) })
      .catch(err => { setError(`Failed to read: ${err.message}`); setLoading(false) })
  }, [resolvedPath])

  useEffect(() => () => clearTimeout(autoSaveTimer.current), [])

  const doSave = useCallback(async (text: string) => {
    if (text === savedContent.current) return
    setSaveState('saving')
    try {
      await api.writeFile(resolvedPath, text)
      savedContent.current = text; setSaveState('saved'); onSaveSuccess?.()
    } catch (err: any) { setError(`Auto-save failed: ${err.message}`); setSaveState('unsaved') }
  }, [resolvedPath, onSaveSuccess])

  function handleChange(val: string) {
    setContent(val); setSaveState('unsaved')
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => doSave(val), AUTOSAVE_DELAY)
  }

  const syncScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = el.scrollTop
    if (highlightRef.current) { highlightRef.current.scrollTop = el.scrollTop; highlightRef.current.scrollLeft = el.scrollLeft }
    setVisibleStart(Math.floor(el.scrollTop / LINE_H))
    setVisibleCount(Math.ceil(el.clientHeight / LINE_H))
  }, [LINE_H])

  useEffect(() => {
    const el = textareaRef.current; if (!el) return
    setVisibleCount(Math.ceil(el.clientHeight / LINE_H))
  }, [loading, LINE_H])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget, s = ta.selectionStart, end = ta.selectionEnd
      const next = content.substring(0,s) + '  ' + content.substring(end)
      handleChange(next)
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = s + 2 }, 0)
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault(); clearTimeout(autoSaveTimer.current); doSave(content)
    }
  }

  function handleMinimapClick(line: number) {
    const ta = textareaRef.current; if (!ta) return
    ta.scrollTop = Math.max(0, line * LINE_H - ta.clientHeight / 2)
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = ta.scrollTop
    if (highlightRef.current)   highlightRef.current.scrollTop   = ta.scrollTop
    setVisibleStart(Math.floor(ta.scrollTop / LINE_H))
  }

  const lines       = content.split('\n')
  const lineCount   = Math.max(1, lines.length)
  const highlighted = highlight(content + '\n', ext)
  const monoStyle: React.CSSProperties = {
    fontFamily: "'SF Mono','Fira Code','Cascadia Code',Menlo,monospace",
    fontSize:12, lineHeight:'1.6', tabSize:2, whiteSpace:'pre', overflowWrap:'normal',
    padding:`${PAD_TOP}px 14px`, margin:0,
  }

  const SaveStatus = () => {
    if (saveState==='saving')  return <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'var(--text-muted)', flexShrink:0 }}><Loader size={11} style={{ animation:'spin 1s linear infinite' }}/>Saving…</span>
    if (saveState==='unsaved') return <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'#f59e0b', flexShrink:0 }}>●  Unsaved</span>
    return <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'#3dd68c', flexShrink:0 }}><Cloud size={11}/>Saved</span>
  }

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#1e1e1e', gap:10 }}>
      <Loader size={18} style={{ animation:'spin 1.2s linear infinite', color:'var(--accent)' }}/>
      <span style={{ fontSize:12, color:'var(--text-secondary)' }}>Loading…</span>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#1e1e1e', overflow:'hidden', minHeight:0 }}>
      {/* Header: breadcrumb + auto-save status */}
      <div style={{ height:32, flexShrink:0, display:'flex', alignItems:'center', gap:8, padding:'0 12px', borderBottom:'1px solid #333', background:'#252526' }}>
        <FileCode size={12} style={{ color:'var(--accent)', flexShrink:0 }}/>
        <Breadcrumb filePath={filePath} rootPath={rootPath}/>
        {error && <span style={{ fontSize:10, color:'var(--red)', flexShrink:0, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{error}</span>}
        <SaveStatus/>
        <button onClick={() => navigator.clipboard.writeText(content).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000) })}
          title="Copy all" style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:4, borderRadius:4, flexShrink:0 }}
          onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='var(--text-primary)'}
          onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color='var(--text-muted)'}>
          {copied ? <Check size={12} style={{ color:'#3dd68c' }}/> : <Copy size={12}/>}
        </button>
        {breakpoints.size > 0 && (
          <span style={{ fontSize:10, color:'#e51400', background:'rgba(229,20,0,0.12)', padding:'1px 6px', borderRadius:4, fontWeight:600, flexShrink:0 }}>
            {breakpoints.size} bp
          </span>
        )}
      </div>

      {/* Editor: gutter | line numbers | code | minimap */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
        <BreakpointGutter lineCount={lineCount} breakpoints={breakpoints}
          onToggle={line => setBreakpoints(prev => { const n=new Set(prev); n.has(line)?n.delete(line):n.add(line); return n })}
          lineHeight={LINE_H} paddingTop={PAD_TOP}/>
        <div ref={lineNumbersRef} style={{ width:46, flexShrink:0, overflow:'hidden', background:'#1e1e1e', borderRight:'1px solid #333', textAlign:'right', ...monoStyle, padding:`${PAD_TOP}px 8px ${PAD_TOP}px 0` }}>
          {Array.from({ length:lineCount }, (_,i) => (
            <div key={i} style={{ lineHeight:'1.6', color:breakpoints.has(i+1)?'#e51400':'#858585' }}>{i+1}</div>
          ))}
        </div>
        <div style={{ flex:1, position:'relative', overflow:'hidden' }}>
          <pre ref={highlightRef} aria-hidden dangerouslySetInnerHTML={{ __html:highlighted }}
            style={{ ...monoStyle, position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none', color:'#d4d4d4', background:'#1e1e1e', margin:0, zIndex:1 }}/>
          <textarea ref={textareaRef} value={content}
            onChange={e => handleChange(e.target.value)}
            onScroll={syncScroll} onKeyDown={handleKeyDown}
            spellCheck={false} autoCorrect="off" autoCapitalize="off"
            style={{ ...monoStyle, position:'absolute', inset:0, width:'100%', height:'100%', border:'none', outline:'none', resize:'none', background:'transparent', color:'transparent', caretColor:'#aeafad', zIndex:2, overflowX:'auto', overflowY:'auto' }}/>
        </div>
        <Minimap lines={lines} visibleStart={visibleStart} visibleCount={visibleCount}
          totalLines={lineCount} onClickLine={handleMinimapClick}/>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
