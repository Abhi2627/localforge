import { useState, useEffect, useRef, useCallback } from 'react'
import { Save, Copy, Check, FileCode, Loader } from 'lucide-react'
import { api } from '../hooks/useApi'

interface Props {
  filePath: string
  onSaveSuccess?: () => void
}

// ── Syntax highlighter ────────────────────────────────────────────────────────
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

// ── Minimap ───────────────────────────────────────────────────────────────────
const MINIMAP_W      = 80    // px width of minimap
const MINIMAP_LINE_H = 2     // px per line in minimap
const MINIMAP_CHAR_W = 0.6   // px per character in minimap

interface MinimapProps {
  lines:        string[]
  visibleStart: number   // 0-based first visible line
  visibleCount: number   // number of visible lines
  totalLines:   number
  onClickLine:  (line: number) => void
  changedLines?: Set<number>  // for diff highlights
}

function Minimap({ lines, visibleStart, visibleCount, onClickLine, changedLines }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const FULL_H    = lines.length * MINIMAP_LINE_H

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width  = MINIMAP_W
    canvas.height = Math.max(FULL_H, 1)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, MINIMAP_W, Math.max(FULL_H, 1))
    ctx.fillStyle = '#1e1e1e'
    ctx.fillRect(0, 0, MINIMAP_W, Math.max(FULL_H, 1))
    lines.forEach((line, i) => {
      const y = i * MINIMAP_LINE_H
      if (changedLines?.has(i + 1)) {
        ctx.fillStyle = 'rgba(61,214,140,0.35)'
        ctx.fillRect(0, y, MINIMAP_W, MINIMAP_LINE_H)
      }
      const trimmed = line.trimStart()
      const indent  = line.length - trimmed.length
      const x       = indent * MINIMAP_CHAR_W
      const w       = Math.min(trimmed.length * MINIMAP_CHAR_W, MINIMAP_W - x)
      if (w > 0) {
        ctx.fillStyle = changedLines?.has(i + 1) ? '#7ec8a0' : '#555770'
        ctx.fillRect(x, y + 0.3, w, 1)
      }
    })
  }, [lines, changedLines]) // eslint-disable-line

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const y    = e.clientY - rect.top
    const line = Math.floor(y / MINIMAP_LINE_H)
    onClickLine(Math.max(0, Math.min(line, lines.length - 1)))
  }

  const viewportH  = Math.max(visibleCount * MINIMAP_LINE_H, 20)
  const viewportY  = visibleStart * MINIMAP_LINE_H
  const scaleRatio = FULL_H > 0 ? 1 : 1

  return (
    <div
      onClick={handleClick}
      style={{ width: MINIMAP_W, flexShrink: 0, background: '#1e1e1e', borderLeft: '1px solid #2a2a2a', overflow: 'hidden', position: 'relative', cursor: 'pointer' }}
    >
      {/* Canvas — full file overview */}
      <div style={{ width: MINIMAP_W, height: FULL_H, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={MINIMAP_W}
          height={Math.max(FULL_H, 1)}
          style={{ display: 'block', imageRendering: 'pixelated' }}
        />
        {/* Viewport indicator — shows which part of the file is visible */}
        <div style={{
          position: 'absolute', left: 0, top: viewportY * scaleRatio,
          width: MINIMAP_W, height: viewportH,
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.12)',
          pointerEvents: 'none',
          boxSizing: 'border-box',
        }}/>
      </div>
    </div>
  )
}

// ── Breakpoint gutter ─────────────────────────────────────────────────────────
interface BreakpointGutterProps {
  lineCount:   number
  breakpoints: Set<number>
  onToggle:    (line: number) => void
  lineHeight:  number
  paddingTop:  number
}

function BreakpointGutter({ lineCount, breakpoints, onToggle, lineHeight, paddingTop }: BreakpointGutterProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  return (
    <div style={{ width: 16, flexShrink: 0, background: '#1e1e1e', overflow: 'hidden', paddingTop }}>
      {Array.from({ length: lineCount }, (_, i) => {
        const line    = i + 1
        const active  = breakpoints.has(line)
        const isHover = hovered === line
        const show    = active || isHover
        return (
          <div
            key={i}
            style={{ height: lineHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            onMouseEnter={() => setHovered(line)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onToggle(line)}
          >
            {show && (
              <div style={{
                width: 9, height: 9, borderRadius: '50%',
                background: active ? '#e51400' : 'rgba(229,20,0,0.35)',
                boxShadow: active ? '0 0 4px rgba(229,20,0,0.8)' : 'none',
                transition: 'all 0.1s',
                flexShrink: 0,
              }}/>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FileEditorPanel({ filePath, onSaveSuccess }: Props) {
  const [content,     setContent]     = useState('')
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [copied,      setCopied]      = useState(false)
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState(false)
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set())
  const [visibleStart,setVisibleStart]= useState(0)
  const [visibleCount,setVisibleCount]= useState(40)

  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const highlightRef   = useRef<HTMLPreElement>(null)
  const editorBodyRef  = useRef<HTMLDivElement>(null)

  const ext      = filePath.split('.').pop()?.toLowerCase() ?? ''
  const filename = filePath.replace(/\\/g, '/').split('/').pop() ?? 'file'

  const LINE_H    = 19.2   // lineHeight 1.6 × fontSize 12
  const PAD_TOP   = 10

  useEffect(() => {
    setLoading(true); setError(''); setSuccess(false); setBreakpoints(new Set())
    api.readFile(filePath)
      .then(res => { setContent(res.content ?? ''); setLoading(false) })
      .catch(err => { setError(`Failed to read: ${err.message}`); setLoading(false) })
  }, [filePath])

  // Sync scroll: textarea → line numbers and highlight layer, update minimap viewport
  const syncScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const el   = e.currentTarget
    const top  = el.scrollTop
    const left = el.scrollLeft
    if (lineNumbersRef.current)  lineNumbersRef.current.scrollTop = top
    if (highlightRef.current)  { highlightRef.current.scrollTop = top; highlightRef.current.scrollLeft = left }
    const firstVisible = Math.floor(top / LINE_H)
    const visCount     = Math.ceil((el.clientHeight) / LINE_H)
    setVisibleStart(firstVisible)
    setVisibleCount(visCount)
  }, [LINE_H])

  // Measure visible lines on mount/resize
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const visCount = Math.ceil(el.clientHeight / LINE_H)
    setVisibleCount(visCount)
  }, [loading, LINE_H])

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  async function handleSave() {
    if (saving) return
    setSaving(true); setError(''); setSuccess(false)
    try {
      await api.writeFile(filePath, content)
      setSuccess(true); setTimeout(() => setSuccess(false), 2000)
      onSaveSuccess?.()
    } catch (err: any) { setError(`Save failed: ${err.message}`) }
    finally { setSaving(false) }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget, start = ta.selectionStart, end = ta.selectionEnd
      const next = content.substring(0, start) + '  ' + content.substring(end)
      setContent(next)
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2 }, 0)
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() }
  }

  function toggleBreakpoint(line: number) {
    setBreakpoints(prev => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })
  }

  // Minimap click — scroll editor to that line
  function handleMinimapClick(line: number) {
    const ta = textareaRef.current
    if (!ta) return
    const targetTop = line * LINE_H - ta.clientHeight / 2
    ta.scrollTop = Math.max(0, targetTop)
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = ta.scrollTop
    if (highlightRef.current)   highlightRef.current.scrollTop   = ta.scrollTop
    setVisibleStart(Math.floor(ta.scrollTop / LINE_H))
  }

  const lines      = content.split('\n')
  const lineCount  = Math.max(1, lines.length)
  const highlighted = highlight(content + '\n', ext)

  const monoStyle: React.CSSProperties = {
    fontFamily:   "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    fontSize:     12,
    lineHeight:   '1.6',
    tabSize:      2,
    whiteSpace:   'pre',
    overflowWrap: 'normal',
    padding:      `${PAD_TOP}px 14px`,
    margin:       0,
  }

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg-primary)', gap:10 }}>
      <Loader size={18} style={{ animation:'spin 1.2s linear infinite', color:'var(--accent)' }}/>
      <span style={{ fontSize:12, color:'var(--text-secondary)' }}>Loading…</span>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#1e1e1e', overflow:'hidden', minHeight:0 }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'5px 12px', borderBottom:'1px solid var(--border)', background:'var(--bg-secondary)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <FileCode size={13} style={{ color:'var(--accent)', flexShrink:0 }}/>
          <span style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)' }}>{filename}</span>
          <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:260 }}>{filePath}</span>
          {breakpoints.size > 0 && (
            <span style={{ fontSize:10, color:'#e51400', background:'rgba(229,20,0,0.12)', padding:'1px 6px', borderRadius:4, fontWeight:600 }}>
              {breakpoints.size} bp
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
          {error   && <span style={{ fontSize:11, color:'var(--red)' }}>{error}</span>}
          {success && <span style={{ fontSize:11, color:'var(--green)' }}>Saved ✓</span>}
          <button onClick={handleCopy} className="icon-btn" style={{ width:26, height:26 }} title="Copy">
            {copied ? <Check size={12} style={{ color:'var(--green)' }}/> : <Copy size={12}/>}
          </button>
          <button onClick={handleSave} disabled={saving} title="Save (⌘S)"
            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--accent)', border:'none', borderRadius:5, padding:'4px 10px', color:'white', fontSize:11, fontWeight:500, cursor:saving?'not-allowed':'pointer', opacity:saving?0.7:1 }}>
            {saving ? <Loader size={11} style={{ animation:'spin 1s linear infinite' }}/> : <Save size={11}/>}
            Save
          </button>
        </div>
      </div>

      {/* Editor body: breakpoint gutter | line numbers | code | minimap */}
      <div ref={editorBodyRef} style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* Breakpoint gutter (left of line numbers) */}
        <BreakpointGutter
          lineCount={lineCount}
          breakpoints={breakpoints}
          onToggle={toggleBreakpoint}
          lineHeight={LINE_H}
          paddingTop={PAD_TOP}
        />

        {/* Line numbers */}
        <div ref={lineNumbersRef} style={{
          width:46, flexShrink:0, overflow:'hidden',
          background:'#1e1e1e', borderRight:'1px solid #333',
          color:'#858585',           // brighter — was #495162
          textAlign:'right',
          ...monoStyle, padding:`${PAD_TOP}px 8px ${PAD_TOP}px 0`,
        }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} style={{ lineHeight:'1.6', color: breakpoints.has(i+1) ? '#e51400' : '#858585' }}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code area */}
        <div style={{ flex:1, position:'relative', overflow:'hidden' }}>
          {/* Syntax-highlighted layer */}
          <pre
            ref={highlightRef}
            aria-hidden
            dangerouslySetInnerHTML={{ __html: highlighted }}
            style={{ ...monoStyle, position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none', color:'#d4d4d4', background:'#1e1e1e', margin:0, zIndex:1 }}
          />
          {/* Transparent textarea */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            onScroll={syncScroll}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            style={{ ...monoStyle, position:'absolute', inset:0, width:'100%', height:'100%', border:'none', outline:'none', resize:'none', background:'transparent', color:'transparent', caretColor:'#aeafad', zIndex:2, overflowX:'auto', overflowY:'auto' }}
          />
        </div>

        {/* Minimap */}
        <Minimap
          lines={lines}
          visibleStart={visibleStart}
          visibleCount={visibleCount}
          totalLines={lineCount}
          onClickLine={handleMinimapClick}
        />
      </div>

      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
