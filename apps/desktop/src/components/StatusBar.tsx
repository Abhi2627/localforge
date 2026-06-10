import { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

// ── Types ─────────────────────────────────────────────────────────────────────
interface StatusBarProps {
  cursorLine?:    number
  cursorCol?:     number
  language?:      string
  encoding?:      string
  lineEnding?:    string
  indentSize?:    number
}

// ── Git branch hook ───────────────────────────────────────────────────────────
function useGitBranch(rootPath?: string) {
  const [branch,   setBranch]   = useState<string>('')
  const [ahead,    setAhead]    = useState(0)
  const [behind,   setBehind]   = useState(0)
  const [dirty,    setDirty]    = useState(false)

  useEffect(() => {
    if (!rootPath) { setBranch(''); return }
    async function fetchBranch() {
      try {
        const enc  = encodeURIComponent
        const res  = await fetch(`http://localhost:3001/project/git/status?sessionId=__status__&rootPath=${enc(rootPath as string)}`)
        if (!res.ok) return
        const data = await res.json()
        setBranch(data.branch ?? data.currentBranch ?? '')
        setDirty((data.staged?.length ?? 0) + (data.unstaged?.length ?? 0) > 0)
        setAhead(data.ahead  ?? 0)
        setBehind(data.behind ?? 0)
      } catch { }
    }
    fetchBranch()
    const t = setInterval(fetchBranch, 5000)
    return () => clearInterval(t)
  }, [rootPath])

  return { branch, ahead, behind, dirty }
}

// ── Error/warning count hook ──────────────────────────────────────────────────
function useDiagnostics(rootPath?: string) {
  const [errors,   setErrors]   = useState(0)
  const [warnings, setWarnings] = useState(0)

  useEffect(() => {
    if (!rootPath) return
    // Listen for TypeScript errors emitted by the dev server
    // For now, we poll the build status endpoint if available
    // Defaults to 0 — will be updated when agent reports errors
    function handleDiag(e: CustomEvent) {
      setErrors(e.detail?.errors   ?? 0)
      setWarnings(e.detail?.warnings ?? 0)
    }
    window.addEventListener('localforge:diagnostics', handleDiag as EventListener)
    return () => window.removeEventListener('localforge:diagnostics', handleDiag as EventListener)
  }, [rootPath])

  return { errors, warnings }
}

// ── Separator ─────────────────────────────────────────────────────────────────
function Sep() {
  return <div style={{ width:1, height:14, background:'rgba(255,255,255,0.12)', margin:'0 4px', flexShrink:0 }}/>
}

// ── Status item ───────────────────────────────────────────────────────────────
function Item({ children, title, onClick, accent }: {
  children: React.ReactNode; title?: string; onClick?: () => void; accent?: string
}) {
  return (
    <div
      title={title}
      onClick={onClick}
      style={{
        display:     'flex', alignItems:'center', gap:4,
        padding:     '0 8px', height:'100%',
        fontSize:    11, color: accent ?? 'rgba(255,255,255,0.75)',
        cursor:      onClick ? 'pointer' : 'default',
        userSelect:  'none', flexShrink:0, whiteSpace:'nowrap',
        transition:  'background 0.1s',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)' }}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
    >
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StatusBar({
  cursorLine   = 1,
  cursorCol    = 1,
  language,
  encoding     = 'UTF-8',
  lineEnding   = 'LF',
  indentSize   = 2,
}: StatusBarProps) {
  const { sessions, activeSessionId, selectedModel } = useAppStore()
  const session  = sessions.find(s => s.id === activeSessionId)
  const rootPath = session?.type === 'project' ? session.rootPath : undefined

  const { branch, ahead, behind, dirty } = useGitBranch(rootPath)
  const { errors, warnings }             = useDiagnostics(rootPath)

  const [mcpConnected, setMcpConnected] = useState(false)
  useEffect(() => {
    function onMcp(e: CustomEvent) { setMcpConnected(e.detail?.connected ?? false) }
    window.addEventListener('localforge:mcp-status', onMcp as EventListener)
    return () => window.removeEventListener('localforge:mcp-status', onMcp as EventListener)
  }, [])

  const modelShort = selectedModel?.split(':')[0] ?? ''

  return (
    <div style={{
      height:          22,
      background:      '#007acc',   // VSCode exact blue
      display:         'flex',
      alignItems:      'stretch',
      justifyContent:  'space-between',
      overflow:        'hidden',
      flexShrink:      0,
      userSelect:      'none',
    }}>

      {/* ── Left section ── */}
      <div style={{ display:'flex', alignItems:'stretch' }}>
        {/* Branch */}
        {branch ? (
          <Item title={`Git branch: ${branch}${dirty ? ' (uncommitted changes)' : ''}`}>
            {/* branch icon */}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ opacity:0.9, flexShrink:0 }}>
              <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5c0 .68-.44 1.26-1.05 1.47L6 9a1 1 0 0 0 1 1h1.5a1.5 1.5 0 0 1 1.5 1.5v.05A1.5 1.5 0 1 1 8.5 13H8a2 2 0 0 1-2-2l-.05-2.53A1.5 1.5 0 0 1 5.5 3.5zm1 1a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zm4.5 7.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z"/>
            </svg>
            <span style={{ fontWeight: dirty ? 500 : 400 }}>
              {branch}{dirty ? '*' : ''}
            </span>
            {ahead  > 0 && <span title={`${ahead} commit(s) ahead`}  style={{ opacity:0.8, fontSize:10 }}>↑{ahead}</span>}
            {behind > 0 && <span title={`${behind} commit(s) behind`} style={{ opacity:0.8, fontSize:10 }}>↓{behind}</span>}
          </Item>
        ) : rootPath ? (
          <Item title="No git branch detected">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ opacity:0.6 }}>
              <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5c0 .68-.44 1.26-1.05 1.47L6 9a1 1 0 0 0 1 1h1.5a1.5 1.5 0 0 1 1.5 1.5v.05A1.5 1.5 0 1 1 8.5 13H8a2 2 0 0 1-2-2l-.05-2.53A1.5 1.5 0 0 1 5.5 3.5zm1 1a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zm4.5 7.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z"/>
            </svg>
            <span style={{ opacity:0.6 }}>no git</span>
          </Item>
        ) : null}

        <Sep/>

        {/* Errors / warnings */}
        <Item
          title={`${errors} error(s), ${warnings} warning(s)`}
          accent={errors > 0 ? '#f48771' : warnings > 0 ? '#cca700' : 'rgba(255,255,255,0.75)'}
        >
          {/* error icon */}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 3.5h1.5v5h-1.5v-5zm0 6h1.5v1.5h-1.5V10.5z"/>
          </svg>
          <span>{errors}</span>
          {/* warning icon */}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ marginLeft:4 }}>
            <path d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28 2.28 13H13.72L8 2.28zM7.5 5.75h1v4h-1v-4zm0 5.25h1v1h-1v-1z"/>
          </svg>
          <span>{warnings}</span>
        </Item>

        {/* MCP connected indicator */}
        {mcpConnected && (
          <>
            <Sep/>
            <Item title="MCP filesystem connected">
              <div style={{ width:6, height:6, borderRadius:'50%', background:'#3dd68c', boxShadow:'0 0 4px #3dd68c88', flexShrink:0 }}/>
              <span style={{ fontSize:10, opacity:0.8 }}>MCP</span>
            </Item>
          </>
        )}
      </div>

      {/* ── Right section ── */}
      <div style={{ display:'flex', alignItems:'stretch' }}>

        {/* Active model */}
        {modelShort && (
          <Item title={`Active model: ${selectedModel}`}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ opacity:0.8 }}>
              <path d="M9.5 2A1.5 1.5 0 0 1 11 3.5v1A1.5 1.5 0 0 1 9.5 6h-3A1.5 1.5 0 0 1 5 4.5v-1A1.5 1.5 0 0 1 6.5 2h3zm-3 1a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-3zM3 7.5A1.5 1.5 0 0 1 4.5 6h7A1.5 1.5 0 0 1 13 7.5v1A1.5 1.5 0 0 1 11.5 10h-7A1.5 1.5 0 0 1 3 8.5v-1zm1.5-.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-7zM2.5 11A1.5 1.5 0 0 0 1 12.5v1A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-1A1.5 1.5 0 0 0 13.5 11h-11zm0 1h11a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5z"/>
            </svg>
            {modelShort}
          </Item>
        )}

        <Sep/>

        {/* Cursor position */}
        <Item title={`Line ${cursorLine}, Column ${cursorCol}`}>
          Ln {cursorLine}, Col {cursorCol}
        </Item>

        <Sep/>

        {/* Indentation */}
        <Item title="Indentation: Spaces">
          Spaces: {indentSize}
        </Item>

        <Sep/>

        {/* Encoding */}
        <Item title="File encoding">
          {encoding}
        </Item>

        <Sep/>

        {/* Line ending */}
        <Item title="Line ending">
          {lineEnding}
        </Item>

        {/* Language mode */}
        {language && (
          <>
            <Sep/>
            <Item title={`Language mode: ${language}`}>
              {language}
            </Item>
          </>
        )}

        <Sep/>

        {/* LocalForge branding */}
        <Item title="LocalForge">
          <span style={{ fontWeight:700, opacity:0.85, letterSpacing:'0.03em', fontSize:10 }}>LocalForge</span>
        </Item>
      </div>
    </div>
  )
}
