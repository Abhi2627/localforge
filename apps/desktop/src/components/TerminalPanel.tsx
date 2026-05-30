import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Plus, Terminal as TerminalIcon, AlertCircle, Bug, Radio } from 'lucide-react'

interface Props {
  cwd?:    string
  onClose: () => void
}

interface TermTab { id: string; label: string; cwd?: string }
type PanelType = 'terminal' | 'output' | 'problems' | 'debug' | 'ports'

let _counter = 1

// ── Single xterm instance ─────────────────────────────────────────────────────
// Key design decisions:
//   1. Container is always position:absolute inset:0 so xterm always has real dimensions
//   2. Hidden tabs use opacity:0 + pointerEvents:none (NOT visibility/display:none)
//      This keeps the DOM painted so xterm can measure col/row counts correctly
//   3. WebSocket connects to ws://localhost:3001/terminal (absolute URL, works in Tauri)
//   4. ResizeObserver calls fitAddon.fit() whenever the panel resizes

function XTermInstance({ cwd, active }: { cwd?: string; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<any>(null)
  const wsRef        = useRef<WebSocket | null>(null)
  const fitAddonRef  = useRef<any>(null)
  const roRef        = useRef<ResizeObserver | null>(null)
  const readyRef     = useRef(false)  // true once term + ws are both ready

  const doFit = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current) return
    try {
      fitAddonRef.current.fit()
      const dims = fitAddonRef.current.proposeDimensions()
      if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
      }
    } catch { }
  }, [])

  useEffect(() => {
    let mounted = true

    async function init() {
      // Dynamic imports so xterm doesn't block initial render
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      await import('@xterm/xterm/css/xterm.css')

      if (!mounted || !containerRef.current) return

      const term = new Terminal({
        cursorBlink:      true,
        fontSize:         13,
        fontFamily:       "'SF Mono','Fira Code','Cascadia Code',Menlo,monospace",
        scrollback:       5000,
        convertEol:       true,
        allowProposedApi: true,
        theme: {
          background:          '#0d0d0d',
          foreground:          '#e8e8e8',
          cursor:              '#7c6af7',
          cursorAccent:        '#0d0d0d',
          selectionBackground: '#7c6af730',
          black:   '#1a1a1a', brightBlack:   '#555',
          red:     '#f56565', brightRed:     '#fc8181',
          green:   '#3dd68c', brightGreen:   '#68d391',
          yellow:  '#f5a623', brightYellow:  '#f6ad55',
          blue:    '#7c6af7', brightBlue:    '#a78bfa',
          magenta: '#c084fc', brightMagenta: '#d8b4fe',
          cyan:    '#22d3ee', brightCyan:    '#67e8f9',
          white:   '#e8e8e8', brightWhite:   '#fff',
        },
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      termRef.current     = term
      fitAddonRef.current = fitAddon

      term.open(containerRef.current)

      // Initial fit — container already has real dimensions because it's always rendered
      setTimeout(() => { if (mounted) doFit() }, 30)

      // WebSocket — absolute URL required for Tauri webview
      const cwdParam = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
      const ws = new WebSocket(`ws://localhost:3001/terminal${cwdParam}`)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mounted) return
        readyRef.current = true
        doFit()  // Send initial size to PTY
      }

      ws.onmessage = (e) => {
        if (!mounted) return
        try { term.write(e.data) } catch { }
      }

      ws.onclose = () => {
        if (!mounted) return
        try { term.writeln('\r\n\x1b[90m[shell exited — open a new tab to continue]\x1b[0m') } catch { }
      }

      ws.onerror = () => {
        if (!mounted) return
        try {
          term.writeln('\r\n\x1b[31m[Cannot connect to terminal server]\x1b[0m')
          term.writeln('\x1b[90m  Make sure the agent server is running:\x1b[0m')
          term.writeln('\x1b[90m  cd packages/agent-core && npm run dev\x1b[0m\r\n')
        } catch { }
      }

      // Keystrokes → PTY
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      })

      // Resize observer — refit when panel dimensions change
      roRef.current = new ResizeObserver(() => { if (mounted) doFit() })
      roRef.current.observe(containerRef.current)
    }

    init()

    return () => {
      mounted = false
      roRef.current?.disconnect()
      wsRef.current?.close()
      termRef.current?.dispose()
      termRef.current     = null
      fitAddonRef.current = null
      wsRef.current       = null
      readyRef.current    = false
    }
  }, [cwd]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus and refit when this tab becomes active
  useEffect(() => {
    if (!active) return
    // Small delay to let CSS transition finish before measuring
    const t = setTimeout(() => {
      doFit()
      termRef.current?.focus()
    }, 60)
    return () => clearTimeout(t)
  }, [active, doFit])

  return (
    <div
      ref={containerRef}
      style={{
        position:      'absolute',
        inset:         0,
        // Use opacity instead of visibility/display so xterm always has real dimensions.
        // display:none would make clientWidth=0, breaking fitAddon.
        opacity:       active ? 1 : 0,
        pointerEvents: active ? 'auto' : 'none',
        // Layer active terminal on top
        zIndex:        active ? 1 : 0,
      }}
    />
  )
}

// ── Panel tabs ───────────────────────────────────────────────────────────────

const PANEL_TABS: Array<{ id: PanelType; label: string; Icon: any }> = [
  { id: 'terminal', label: 'Terminal',      Icon: TerminalIcon },
  { id: 'output',   label: 'Output',        Icon: TerminalIcon },
  { id: 'problems', label: 'Problems',      Icon: AlertCircle  },
  { id: 'debug',    label: 'Debug Console', Icon: Bug          },
  { id: 'ports',    label: 'Ports',         Icon: Radio        },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function TerminalPanel({ cwd, onClose }: Props) {
  const [panel,        setPanel]        = useState<PanelType>('terminal')
  const [terminals,    setTerminals]    = useState<TermTab[]>([
    { id: 'term-1', label: cwd ? (cwd.split('/').pop() ?? 'shell') : 'shell', cwd },
  ])
  const [activeTermId, setActiveTermId] = useState('term-1')

  function addTerminal() {
    _counter++
    const id    = `term-${_counter}`
    const label = cwd ? (cwd.split('/').pop() ?? 'shell') : 'shell'
    setTerminals(prev => [...prev, { id, label, cwd }])
    setActiveTermId(id)
    setPanel('terminal')
  }

  function closeTerminal(id: string) {
    setTerminals(prev => {
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) { onClose(); return prev }
      if (activeTermId === id) setActiveTermId(next[next.length - 1].id)
      return next
    })
  }

  const tabBtn: React.CSSProperties = {
    border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 11, display: 'flex', alignItems: 'center', gap: 5,
    padding: '0 12px', height: '100%', whiteSpace: 'nowrap',
    transition: 'color 0.1s',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d0d0d', overflow: 'hidden' }}>

      {/* ── Header bar ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'stretch', background: '#141414', borderBottom: '1px solid #252525', flexShrink: 0, height: 32 }}>

        {/* Panel type tabs */}
        <div style={{ display: 'flex', alignItems: 'stretch', borderRight: '1px solid #252525', flexShrink: 0 }}>
          {PANEL_TABS.map(({ id, label, Icon }) => {
            const isActive = panel === id
            return (
              <button key={id} onClick={() => setPanel(id)}
                style={{ ...tabBtn, color: isActive ? '#e8e8e8' : '#555', fontWeight: isActive ? 500 : 400, borderBottom: isActive ? '2px solid #7c6af7' : '2px solid transparent' }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = '#aaa' }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = '#555' }}
              >
                <Icon size={11} />{label}
              </button>
            )
          })}
        </div>

        {/* Terminal instance tabs */}
        {panel === 'terminal' && (
          <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflow: 'hidden' }}>
            {terminals.map(term => {
              const isActive = term.id === activeTermId
              return (
                <div key={term.id}
                  onClick={() => setActiveTermId(term.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0 8px 0 12px', cursor: 'pointer', flexShrink: 0,
                    borderRight: '1px solid #252525',
                    background: isActive ? '#1e1e1e' : 'transparent',
                    color: isActive ? '#e8e8e8' : '#555',
                    fontSize: 11, whiteSpace: 'nowrap',
                    borderBottom: isActive ? '2px solid #3dd68c' : '2px solid transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#1a1a1a' }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <TerminalIcon size={11} style={{ flexShrink: 0 }} />
                  <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{term.label}</span>
                  <button
                    onClick={e => { e.stopPropagation(); closeTerminal(term.id) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 2, borderRadius: 3, opacity: 0.4, flexShrink: 0 }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '0.4'}
                  ><X size={10} /></button>
                </div>
              )
            })}
            <button onClick={addTerminal} title="New terminal"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, border: 'none', background: 'transparent', color: '#555', cursor: 'pointer', flexShrink: 0, borderBottom: '2px solid transparent' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#aaa'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#555'}
            ><Plus size={13} /></button>
          </div>
        )}

        {/* Close button */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 8, flexShrink: 0 }}>
          <button onClick={onClose} title="Close panel"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', display: 'flex', padding: 4, borderRadius: 3 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#e8e8e8'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#555'}
          ><X size={13} /></button>
        </div>
      </div>

      {/* ── Content area ───────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>

        {/* All XTerm instances — always in DOM, only active one is visible */}
        {terminals.map(term => (
          <XTermInstance
            key={term.id}
            cwd={term.cwd}
            active={panel === 'terminal' && term.id === activeTermId}
          />
        ))}

        {/* Static info panels */}
        {panel !== 'terminal' && (
          <div style={{ position: 'absolute', inset: 0, padding: '12px 16px', fontSize: 12, color: '#555', fontFamily: 'monospace', lineHeight: 1.6, overflowY: 'auto', zIndex: 2 }}>
            {panel === 'output'   && <><div style={{ color:'#444', marginBottom:8, fontSize:11 }}>— Output —</div><div>No output.</div></>}
            {panel === 'problems' && <><div style={{ color:'#444', marginBottom:8, fontSize:11 }}>— Problems —</div><div style={{display:'flex',alignItems:'center',gap:8,color:'#3dd68c'}}><AlertCircle size={13}/><span>No problems detected.</span></div></>}
            {panel === 'debug'    && <><div style={{ color:'#444', marginBottom:8, fontSize:11 }}>— Debug Console —</div><div>Start a debug session to see output here.</div></>}
            {panel === 'ports'    && <><div style={{ color:'#444', marginBottom:8, fontSize:11 }}>— Forwarded Ports —</div><div>No ports forwarded.</div></>}
          </div>
        )}
      </div>
    </div>
  )
}
