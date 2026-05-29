import { useState, useEffect, useRef } from 'react'
import { Save, Copy, Check, FileCode, Loader } from 'lucide-react'
import { api } from '../hooks/useApi'

interface Props {
  filePath: string
  onSaveSuccess?: () => void
}

export default function FileEditorPanel({ filePath, onSaveSuccess }: Props) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)

  const filename = filePath.replace(/\\/g, '/').split('/').pop() ?? 'file'

  useEffect(() => {
    setLoading(true)
    setError('')
    setSuccess(false)
    api.readFile(filePath)
      .then(res => {
        setContent(res.content ?? '')
        setLoading(false)
      })
      .catch(err => {
        setError(`Failed to read file: ${err.message}`)
        setLoading(false)
      })
  }, [filePath])

  // Sync scroll between textarea and line numbers
  function handleScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      await api.writeFile(filePath, content)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
      if (onSaveSuccess) onSaveSuccess()
    } catch (err: any) {
      setError(`Failed to save file: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Handle Tab key in textarea
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const updated = content.substring(0, start) + '  ' + content.substring(end)
      setContent(updated)
      
      // Reset cursor position on next render
      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      }, 0)
    }
  }

  const lines = content.split('\n')
  const lineCount = Math.max(1, lines.length)

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', gap: 10 }}>
        <Loader size={20} className="pulse" style={{ animation: 'spin 1.5s linear infinite', color: 'var(--accent)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loading file content…</span>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden', minHeight: 0 }}>
      {/* File editor header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileCode size={14} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{filename}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
            {filePath}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {error && <span style={{ fontSize: 11, color: 'var(--red)', marginRight: 8 }}>{error}</span>}
          {success && <span style={{ fontSize: 11, color: 'var(--green)', marginRight: 8 }}>Saved successfully!</span>}

          <button
            onClick={handleCopy}
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            title="Copy file contents"
          >
            {copied ? <Check size={14} style={{ color: 'var(--green)' }} /> : <Copy size={14} />}
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--accent)', border: 'none', borderRadius: 6,
              padding: '4px 10px', color: 'white', fontSize: 11, fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
              transition: 'background 0.15s'
            }}
          >
            {saving ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        {/* Line Numbers */}
        <div
          ref={lineNumbersRef}
          style={{
            width: 44, padding: '10px 0', borderRight: '1px solid var(--border)',
            background: 'var(--bg-secondary)', color: 'var(--text-muted)',
            fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace", fontSize: 12,
            lineHeight: '1.6', textAlign: 'right', paddingRight: 8,
            overflow: 'hidden', userSelect: 'none', flexShrink: 0
          }}
        >
          {Array.from({ length: lineCount }).map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          style={{
            flex: 1, height: '100%', border: 'none', outline: 'none', resize: 'none',
            background: 'transparent', color: 'var(--text-primary)',
            fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace", fontSize: 12,
            lineHeight: '1.6', padding: '10px 14px',
            whiteSpace: 'pre', overflowX: 'auto', overflowY: 'auto'
          }}
        />
      </div>
    </div>
  )
}
