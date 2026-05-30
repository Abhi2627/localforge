import { useState, useEffect, useRef, useCallback } from 'react'
import { Save, Copy, Check, FileCode, Loader } from 'lucide-react'
import { api } from '../hooks/useApi'

interface Props {
  filePath: string
  onSaveSuccess?: () => void
}

// Token-based syntax highlighter — pure regex, no dependencies
function highlight(code: string, ext: string): string {
  if (!['ts','tsx','js','jsx','py','json','css','scss','html','sh','rs','go'].includes(ext)) {
    return escHtml(code)
  }

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

  // JS/TS/Python/Rust/Go
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

  // Comments
  if (['py'].includes(ext)) {
    s = s.replace(/(#[^\n]*)/g, '<span style="color:#6a9955">$1</span>')
  } else {
    s = s.replace(/(\/\/[^\n]*)/g, '<span style="color:#6a9955">$1</span>')
    s = s.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#6a9955">$1</span>')
  }

  // Strings
  s = s.replace(/(&quot;(?:[^&]|&(?!quot;))*&quot;|&#x27;(?:[^&]|&(?!#x27;))*&#x27;|`[^`]*`)/g,
    '<span style="color:#ce9178">$1</span>')

  // Numbers
  s = s.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#b5cea8">$1</span>')

  // Keywords
  const kwRe = new RegExp(`\\b(${kws.join('|')})\\b`, 'g')
  s = s.replace(kwRe, '<span style="color:#569cd6">$1</span>')

  // Function names
  s = s.replace(/\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, '<span style="color:#dcdcaa">$1</span>')

  // Types (PascalCase)
  s = s.replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g, '<span style="color:#4ec9b0">$1</span>')

  return s
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

export default function FileEditorPanel({ filePath, onSaveSuccess }: Props) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [copied,  setCopied]  = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState(false)

  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const highlightRef   = useRef<HTMLPreElement>(null)

  const ext      = filePath.split('.').pop()?.toLowerCase() ?? ''
  const filename = filePath.replace(/\\/g, '/').split('/').pop() ?? 'file'

  useEffect(() => {
    setLoading(true); setError(''); setSuccess(false)
    api.readFile(filePath)
      .then(res => { setContent(res.content ?? ''); setLoading(false) })
      .catch(err => { setError(`Failed to read: ${err.message}`); setLoading(false) })
  }, [filePath])

  // Sync scroll: textarea → line numbers and highlight layer
  const syncScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const top  = e.currentTarget.scrollTop
    const left = e.currentTarget.scrollLeft
    if (lineNumbersRef.current)  lineNumbersRef.current.scrollTop  = top
    if (highlightRef.current) { highlightRef.current.scrollTop = top; highlightRef.current.scrollLeft = left }
  }, [])

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
    // Tab → 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta    = e.currentTarget
      const start = ta.selectionStart
      const end   = ta.selectionEnd
      const next  = content.substring(0, start) + '  ' + content.substring(end)
      setContent(next)
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2 }, 0)
    }
    // Ctrl/Cmd+S → save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault(); handleSave()
    }
  }

  const lineCount    = Math.max(1, content.split('\n').length)
  const highlighted  = highlight(content + '\n', ext)

  // Shared font style — textarea and pre must match exactly
  const monoStyle: React.CSSProperties = {
    fontFamily:  "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    fontSize:    12,
    lineHeight:  '1.6',
    tabSize:     2,
    whiteSpace:  'pre',
    overflowWrap: 'normal',
    padding:     '10px 14px',
    margin:      0,
  }

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', gap: 10 }}>
      <Loader size={18} style={{ animation: 'spin 1.2s linear infinite', color: 'var(--accent)' }} />
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loading…</span>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1e1e1e', overflow: 'hidden', minHeight: 0 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileCode size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{filename}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{filePath}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {error   && <span style={{ fontSize: 11, color: 'var(--red)' }}>{error}</span>}
          {success && <span style={{ fontSize: 11, color: 'var(--green)' }}>Saved ✓</span>}
          <button onClick={handleCopy} className="icon-btn" style={{ width: 26, height: 26 }} title="Copy">
            {copied ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
          </button>
          <button onClick={handleSave} disabled={saving} title="Save (⌘S)"
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '4px 10px', color: 'white', fontSize: 11, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
            Save
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, position: 'relative' }}>

        {/* Line numbers */}
        <div ref={lineNumbersRef} style={{
          width: 46, flexShrink: 0, overflow: 'hidden',
          background: '#1e1e1e', borderRight: '1px solid #333',
          color: '#495162', textAlign: 'right',
          ...monoStyle, padding: '10px 8px 10px 0',
        }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} style={{ lineHeight: '1.6' }}>{i + 1}</div>
          ))}
        </div>

        {/* Wrapper for overlay highlight + textarea */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Syntax-highlighted layer (behind, non-interactive) */}
          <pre
            ref={highlightRef}
            aria-hidden
            dangerouslySetInnerHTML={{ __html: highlighted }}
            style={{
              ...monoStyle,
              position: 'absolute', inset: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
              color: '#d4d4d4',
              background: '#1e1e1e',
              margin: 0,
              zIndex: 1,
            }}
          />

          {/* Transparent textarea on top — captures input */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            onScroll={syncScroll}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            style={{
              ...monoStyle,
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              border: 'none', outline: 'none', resize: 'none',
              background: 'transparent',
              color: 'transparent',          // text invisible — highlight layer shows it
              caretColor: '#aeafad',          // but cursor is visible
              zIndex: 2,
              overflowX: 'auto', overflowY: 'auto',
            }}
          />
        </div>
      </div>

      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
