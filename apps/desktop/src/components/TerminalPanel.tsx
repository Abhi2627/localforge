import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Plus, AlertTriangle } from 'lucide-react'

interface Props {
  cwd?:    string
  onClose: () => void
}

interface TermTab {
  id:      string
  label:   string
  cwd?:    string
  hasErr:  boolean  // red dot = command exited with error, blue = running/ok
}

type PanelType = 'problems' | 'output' | 'debug' | 'terminal' | 'ports'

let _counter = 1

// ── Exact VSCode Dark+ colour tokens ─────────────────────────────────────────
const C = {
  panelBg:        '#1e1e1e',
  panelHeader:    '#252526',
  border:         '#3c3c3c',
  activeFg:       '#cccccc',
  inactiveFg:     '#8b8b8b',
  activeTabBg:    '#1e1e1e',
  sidebarBg:      '#252526',
  sidebarHover:   '#2a2d2e',
  sidebarActive:  '#37373d',
  sidebarText:    '#cccccc',
  sidebarMuted:   '#8b8b8b',
  accent:         '#0078d4',
  accentBorder:   '#e7e7e7',
  green:          '#23d18b',
  red:            '#f14c4c',
  yellow:         '#cca700',
}

// ── Single xterm instance ────────────────────────────────────────────────────
function XTermInstance({ cwd, active }: { cwd?: string; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<any>(null)
  const wsRef        = useRef<WebSocket | null>(null)
  const fitAddonRef  = useRef<any>(null)
  const roRef        = useRef<ResizeObserver | null>(null)

  const doFit = useCallback(() => {
    const el = containerRef.current
    if (!fitAddonRef.current || !termRef.current || !el) return
    // Don't fit before the container is actually laid out — fitting a 0-size
    // element produces a 1×1 terminal that never recovers (the "tiny terminal" bug).
    if (el.clientWidth < 8 || el.clientHeight < 8) return
    try {
      fitAddonRef.current.fit()
      const dims = fitAddonRef.current.proposeDimensions()
      if (dims && dims.cols > 0 && dims.rows > 0 && wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
    } catch { }
  }, [])

  // Retry fitting until the container has a real size (handles panel open/animation).
  const fitWhenReady = useCallback((tries = 0) => {
    const el = containerRef.current
    if (!el) return
    if (el.clientWidth >= 8 && el.clientHeight >= 8) { doFit(); return }
    if (tries < 30) requestAnimationFrame(() => fitWhenReady(tries + 1))
  }, [doFit])

  useEffect(() => {
    let mounted = true
    async function init() {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      await import('@xterm/xterm/css/xterm.css')
      if (!mounted || !containerRef.current) return

      const term = new Terminal({
        cursorBlink:           true,
        cursorStyle:           'block',
        fontSize:              14,
        lineHeight:            1.2,
        letterSpacing:         0,
        fontFamily:            "'SF Mono','Cascadia Code','Fira Code',Menlo,'Courier New',monospace",
        fontWeight:            '400',
        fontWeightBold:        '700',
        scrollback:            10000,
        convertEol:            true,
        allowProposedApi:      true,
        rightClickSelectsWord: true,
        // Exact VSCode Dark+ terminal colours
        theme: {
          background:          '#1e1e1e',
          foreground:          '#cccccc',
          cursor:              '#aeafad',
          cursorAccent:        '#1e1e1e',
          selectionBackground: 'rgba(255,255,255,0.25)',
          black:   '#000000', brightBlack:   '#666666',
          red:     '#cd3131', brightRed:     '#f14c4c',
          green:   '#0dbc79', brightGreen:   '#23d18b',
          yellow:  '#e5e510', brightYellow:  '#f5f543',
          blue:    '#2472c8', brightBlue:    '#3b8eea',
          magenta: '#bc3fbc', brightMagenta: '#d670d6',
          cyan:    '#11a8cd', brightCyan:    '#29b8db',
          white:   '#e5e5e5', brightWhite:   '#e5e5e5',
        },
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      termRef.current = term; fitAddonRef.current = fitAddon
      term.open(containerRef.current)

      // GPU-accelerated rendering for crisp, non-blurry text. Loaded defensively:
      // if @xterm/addon-webgl isn't installed (or the context is lost) we silently
      // fall back to the default renderer.
      try {
        // @ts-ignore — optional dep declared in package.json; bundled on install
        const { WebglAddon } = await import('@xterm/addon-webgl')
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => { try { webgl.dispose() } catch { } })
        term.loadAddon(webgl)
      } catch { /* default renderer */ }

      fitWhenReady()

      const ws = new WebSocket(`ws://localhost:3001/terminal${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`)
      wsRef.current = ws
      ws.onopen    = () => { if (!mounted) return; doFit() }
      ws.onmessage = (e) => { if (!mounted) return; try { term.write(e.data) } catch { } }
      ws.onclose   = () => { if (!mounted) return; try { term.writeln('\r\n\x1b[90m[Process exited]\x1b[0m') } catch { } }
      ws.onerror   = () => {
        if (!mounted) return
        try {
          term.writeln('\r\n\x1b[31m[Terminal server not running]\x1b[0m')
          term.writeln('\x1b[2m  cd packages/agent-core && npm run dev\x1b[0m\r\n')
        } catch { }
      }
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }))
      })

      roRef.current = new ResizeObserver(() => { if (mounted) doFit() })
      roRef.current.observe(containerRef.current)
    }
    init()
    return () => {
      mounted = false
      roRef.current?.disconnect()
      wsRef.current?.close()
      termRef.current?.dispose()
      termRef.current = null; fitAddonRef.current = null; wsRef.current = null
    }
  }, [cwd]) // eslint-disable-line

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => { fitWhenReady(); termRef.current?.focus() }, 60)
    return () => clearTimeout(t)
  }, [active, fitWhenReady])

  return (
    <div ref={containerRef} style={{
      position: 'absolute', inset: 0, padding: '4px 4px 2px 8px',
      opacity:       active ? 1 : 0,
      pointerEvents: active ? 'auto' : 'none',
      zIndex:        active ? 1 : 0,
      background:    '#1e1e1e',
    }} />
  )
}

// ── Dropdown menu ─────────────────────────────────────────────────────────────
interface MenuItem { label?: string; shortcut?: string; action?: () => void; divider?: boolean; sub?: boolean }

function DropdownMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', right: 0, zIndex: 999,
      background: '#252526', border: '1px solid #454545',
      borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
      minWidth: 240, padding: '4px 0', userSelect: 'none',
    }}>
      {items.map((item, i) => item.divider
        ? <div key={i} style={{ height:1, background:'#454545', margin:'4px 0' }}/>
        : (
          <div key={i}
            onClick={() => { item.action?.(); onClose() }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 12px', cursor: item.action ? 'pointer' : 'default',
              fontSize: 12, color: item.action ? '#cccccc' : '#8b8b8b',
              gap: 20,
            }}
            onMouseEnter={e => { if (item.action) (e.currentTarget as HTMLElement).style.background = '#094771' }}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            <span>{item.label}{item.sub ? ' ▶' : ''}</span>
            {item.shortcut && <span style={{ fontSize:11, color:'#8b8b8b', flexShrink:0 }}>{item.shortcut}</span>}
          </div>
        )
      )}
    </div>
  )
}

// ── Panel type tabs ───────────────────────────────────────────────────────────
const PANEL_TYPES: Array<{ id: PanelType; label: string }> = [
  { id: 'problems', label: 'PROBLEMS'      },
  { id: 'output',   label: 'OUTPUT'        },
  { id: 'debug',    label: 'DEBUG CONSOLE' },
  { id: 'terminal', label: 'TERMINAL'      },
  { id: 'ports',    label: 'PORTS'         },
]

// ── Main component ────────────────────────────────────────────────────────────
export default function TerminalPanel({ cwd, onClose }: Props) {
  const [panel,        setPanel]        = useState<PanelType>('terminal')
  const [terminals,    setTerminals]    = useState<TermTab[]>([
    { id:'term-1', label: cwd ? (cwd.split('/').pop() ?? 'zsh') : 'zsh', cwd, hasErr: false },
  ])
  const [activeTermId, setActiveTermId] = useState('term-1')
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  // Add new tab when cwd prop changes
  const prevCwdRef = useRef<string | undefined>(cwd)
  useEffect(() => {
    if (prevCwdRef.current === cwd) return
    prevCwdRef.current = cwd
    _counter++
    const id = `term-${_counter}`
    setTerminals(prev => [...prev, { id, label: cwd ? (cwd.split('/').pop() ?? 'zsh') : 'zsh', cwd, hasErr: false }])
    setActiveTermId(id); setPanel('terminal')
  }, [cwd])

  function addTerminal(newCwd?: string) {
    _counter++
    const id = `term-${_counter}`
    const label = newCwd ? (newCwd.split('/').pop() ?? 'zsh') : (cwd ? (cwd.split('/').pop() ?? 'zsh') : 'zsh')
    setTerminals(prev => [...prev, { id, label, cwd: newCwd ?? cwd, hasErr: false }])
    setActiveTermId(id); setPanel('terminal')
  }

  function killTerminal(id: string) {
    setTerminals(prev => {
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) { onClose(); return prev }
      if (activeTermId === id) setActiveTermId(next[next.length - 1].id)
      return next
    })
  }

  function clearTerminal() {
    // Send Ctrl+L to the active terminal
    // We can't directly access the terminal ref here, so we dispatch a custom event
    window.dispatchEvent(new CustomEvent('localforge:terminal-clear', { detail: { id: activeTermId } }))
  }

  const plusMenuItems: MenuItem[] = [
    { label: 'New Terminal',          shortcut: '^⇧`',   action: () => addTerminal() },
    { label: 'New Terminal Window',   shortcut: '^⇧⌥`' },
    { label: 'Split Terminal',        shortcut: '⌘\\' },
    { divider: true },
    { label: 'bash',                  action: () => addTerminal() },
    { label: 'zsh',                   action: () => addTerminal() },
    { label: 'JavaScript Debug Terminal' },
    { label: 'Split Terminal with Profile', sub: true },
    { divider: true },
    { label: 'Configure Terminal Settings' },
    { label: 'Select Default Profile' },
    { divider: true },
    { label: 'Run Task...' },
    { label: 'Configure Tasks...' },
  ]

  const moreMenuItems: MenuItem[] = [
    { label: 'Scroll to Previous Command', shortcut: '⌘↑' },
    { label: 'Scroll to Next Command',     shortcut: '⌘↓' },
    { label: 'Clear Terminal',             shortcut: '⌘K',  action: clearTerminal },
    { divider: true },
    { label: 'Run Active File',            action: () => {} },
    { label: 'Run Selected Text',          action: () => {} },
    { label: 'Start Dictation' },
    { divider: true },
    { label: 'Go to Recent Directory...', shortcut: '⌘G'  },
    { label: 'Run Recent Command...',     shortcut: '^⌥R' },
  ]

  const iconBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, border: 'none', background: 'transparent',
    color: C.inactiveFg, cursor: 'pointer', flexShrink: 0, borderRadius: 4,
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:C.panelBg, overflow:'hidden' }}>

      {/* ── Panel header ─────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'stretch', background:C.panelHeader, borderBottom:`1px solid ${C.border}`, flexShrink:0, height:35 }}>

        {/* Panel type tabs — left side */}
        <div style={{ display:'flex', alignItems:'stretch', flex:1 }}>
          {PANEL_TYPES.map(({ id, label }) => {
            const isActive = panel === id
            return (
              <button key={id} onClick={() => setPanel(id)}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: '0 12px', height: '100%', whiteSpace: 'nowrap',
                  fontSize: 11, letterSpacing: '0.04em',
                  color: isActive ? C.activeFg : C.inactiveFg,
                  fontWeight: isActive ? 500 : 400,
                  // VSCode uses a top highlight line on active tab
                  boxShadow: isActive ? `inset 0 1px 0 ${C.accentBorder}` : 'none',
                  borderBottom: isActive ? `1px solid ${C.panelBg}` : '1px solid transparent',
                  marginTop: 1, transition: 'color 0.1s',
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = C.activeFg }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = C.inactiveFg }}>
                {label}
              </button>
            )
          })}
        </div>

        {/* Right side action buttons */}
        <div style={{ display:'flex', alignItems:'center', paddingRight:4, gap:0, position:'relative', flexShrink:0 }}>

          {/* + New terminal (with dropdown) */}
          <div style={{ position:'relative' }}>
            <button style={iconBtn} title="New Terminal"
              onClick={() => { setShowPlusMenu(v => !v); setShowMoreMenu(false) }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.activeFg}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.inactiveFg}>
              <Plus size={16}/>
            </button>
            {showPlusMenu && <DropdownMenu items={plusMenuItems} onClose={() => setShowPlusMenu(false)}/>}
          </div>

          {/* ... More actions (with dropdown) */}
          <div style={{ position:'relative' }}>
            <button style={iconBtn} title="More Actions..."
              onClick={() => { setShowMoreMenu(v => !v); setShowPlusMenu(false) }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.activeFg}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.inactiveFg}>
              <span style={{ fontSize:16, letterSpacing:1, lineHeight:1 }}>···</span>
            </button>
            {showMoreMenu && <DropdownMenu items={moreMenuItems} onClose={() => setShowMoreMenu(false)}/>}
          </div>

          {/* Maximise */}
          <button style={iconBtn} title="Maximise Panel Size"
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.activeFg}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.inactiveFg}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 3h4v1H4v3H3V3zm6 0h4v4h-1V4h-3V3zM3 9h1v3h3v1H3V9zm9 3h-3v1h4V9h-1v3z"/>
            </svg>
          </button>

          {/* Close × */}
          <button style={iconBtn} title="Close Panel" onClick={onClose}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.activeFg}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.inactiveFg}>
            <X size={14}/>
          </button>
        </div>
      </div>

      {/* ── Main body: terminal content + right sidebar ───────────── */}
      <div style={{ flex:1, display:'flex', minHeight:0, overflow:'hidden' }}>

        {/* Terminal content area */}
        <div style={{ flex:1, position:'relative', minHeight:0, overflow:'hidden' }}>

          {/* All xterm instances */}
          {terminals.map(term => (
            <XTermInstance
              key={term.id}
              cwd={term.cwd}
              active={panel === 'terminal' && term.id === activeTermId}
            />
          ))}

          {/* Static panel content */}
          {panel !== 'terminal' && (
            <div style={{ position:'absolute', inset:0, padding:'12px 16px', fontSize:12, color:C.inactiveFg, fontFamily:"'SF Mono','Cascadia Code',Menlo,monospace", lineHeight:1.8, overflowY:'auto', zIndex:2, background:C.panelBg }}>
              {panel === 'problems' && (
                <div style={{ display:'flex', alignItems:'center', gap:8, color:C.green }}>
                  <span>✓</span>
                  <span>No problems have been detected in the workspace.</span>
                </div>
              )}
              {panel === 'output'   && <div>No output.</div>}
              {panel === 'debug'    && <div>Start a debug session to see output here.</div>}
              {panel === 'ports'    && (
                <div>
                  <div style={{ marginBottom:8 }}>No forwarded ports.</div>
                  <table style={{ borderCollapse:'collapse', width:'100%', fontSize:11 }}>
                    <thead>
                      <tr style={{ color:C.inactiveFg, borderBottom:`1px solid ${C.border}` }}>
                        {['Port','Local Address','Running Process','Visibility','Origin'].map(h => (
                          <th key={h} style={{ textAlign:'left', padding:'4px 16px 4px 0', fontWeight:400 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right sidebar: terminal instance list (like VSCode) ─── */}
        {panel === 'terminal' && (
          <div style={{
            width: 160, flexShrink:0,
            background: C.sidebarBg,
            borderLeft: `1px solid ${C.border}`,
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto', overflowX: 'hidden',
          }}>
            {terminals.map(term => {
              const isActive = term.id === activeTermId
              return (
                <div key={term.id}
                  onClick={() => setActiveTermId(term.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 8px 6px 12px', cursor: 'pointer',
                    background: isActive ? C.sidebarActive : 'transparent',
                    // VSCode: active terminal has a left accent bar
                    borderLeft: isActive ? `2px solid ${C.accent}` : '2px solid transparent',
                    transition: 'background 0.1s',
                    minWidth: 0,
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = C.sidebarHover }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>

                  {/* Status dot — blue = running, red = error */}
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: term.hasErr ? C.red : C.accent,
                    boxShadow: `0 0 4px ${term.hasErr ? C.red : C.accent}55`,
                  }}/>

                  {/* Label */}
                  <span style={{
                    flex: 1, fontSize: 11, fontFamily: "'SF Mono','Cascadia Code',Menlo,monospace",
                    color: isActive ? C.sidebarText : C.inactiveFg,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: isActive ? 500 : 400,
                  }}>
                    {term.label}
                  </span>

                  {/* Warning icon (shown when there are issues) */}
                  {term.hasErr && (
                    <AlertTriangle size={11} style={{ color: C.yellow, flexShrink:0 }}/>
                  )}

                  {/* Kill button — shown on hover */}
                  <button
                    onClick={e => { e.stopPropagation(); killTerminal(term.id) }}
                    title="Kill Terminal"
                    className="term-kill-btn"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: C.inactiveFg, display: 'flex', padding: 2, borderRadius: 3,
                      flexShrink: 0, opacity: 0, transition: 'opacity 0.1s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.activeFg; (e.currentTarget as HTMLElement).style.background = '#3a3a3a' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.inactiveFg; (e.currentTarget as HTMLElement).style.background = 'none' }}>
                    <X size={10}/>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Show kill button on row hover */}
      <style>{`
        div:hover > .term-kill-btn { opacity: 1 !important; }
        .xterm-viewport::-webkit-scrollbar { width: 8px; }
        .xterm-viewport::-webkit-scrollbar-thumb { background: #424242; border-radius: 4px; }
        .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  )
}
