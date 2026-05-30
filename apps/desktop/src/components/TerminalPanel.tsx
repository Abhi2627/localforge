import { useEffect, useRef, useState } from 'react'
import { X, Plus, Terminal as TerminalIcon, AlertCircle, Bug, Radio } from 'lucide-react'

interface Props {
  cwd?:    string
  onClose: () => void
}

interface TermTab { id: string; label: string; cwd?: string }

type PanelType = 'terminal' | 'output' | 'problems' | 'debug' | 'ports'

let _counter = 1

// One xterm.js instance — mounted once, shown/hidden via CSS display
function XTermInstance({ cwd, active }: { cwd?: string; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<any>(null)
  const wsRef        = useRef<WebSocket | null>(null)
  const fitRef       = useRef<any>(null)
  const roRef        = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    let mounted = true

    async function init() {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      await import('@xterm/xterm/css/xterm.css')

      if (!mounted || !containerRef.current) return

      const term = new Terminal({
        cursorBlink: true, fontSize: 13,
        fontFamily: "'SF Mono','Fira Code','Cascadia Code',Menlo,monospace",
        theme: {
          background: '#0d0d0d', foreground: '#e8e8e8',
          cursor: '#7c6af7', cursorAccent: '#0d0d0d',
          selectionBackground: '#7c6af730',
          black:'#1a1a1a', brightBlack:'#555',
          red:'#f56565',   brightRed:'#fc8181',
          green:'#3dd68c', brightGreen:'#68d391',
          yellow:'#f5a623',brightYellow:'#f6ad55',
          blue:'#7c6af7',  brightBlue:'#a78bfa',
          magenta:'#c084fc',brightMagenta:'#d8b4fe',
          cyan:'#22d3ee',  brightCyan:'#67e8f9',
          white:'#e8e8e8', brightWhite:'#fff',
        },
        scrollback: 5000, convertEol: true, allowProposedApi: true,
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      termRef.current = term
      fitRef.current  = fitAddon

      term.open(containerRef.current)

      const doFit = () => {
        try {
          fitAddon.fit()
          const dims = fitAddon.proposeDimensions()
          if (dims && wsRef.current?.readyState === WebSocket.OPEN)
            wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
        } catch { }
      }

      setTimeout(doFit, 80)

      const cwdParam = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
      const ws = new WebSocket(`ws://localhost:3001/terminal${cwdParam}`)
      wsRef.current = ws

      ws.onopen  = () => setTimeout(doFit, 50)
      ws.onmessage = e => { try { term.write(e.data) } catch { } }
      ws.onclose   = () => { try { term.writeln('\r\n\x1b[90m[shell exited]\x1b[0m') } catch { } }
      ws.onerror   = () => {
        try {
          term.writeln('\r\n\x1b[31m[Cannot connect to terminal server]\x1b[0m')
          term.writeln('\x1b[90m  cd packages/agent-core && npm run dev\x1b[0m\r\n')
        } catch { }
      }

      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'input', data }))
      })

      roRef.current = new ResizeObserver(doFit)
      roRef.current.observe(containerRef.current)
    }

    init()

    return () => {
      mounted = false
      roRef.current?.disconnect()
      wsRef.current?.close()
      termRef.current?.dispose()
    }
  }, [cwd])

  // Focus when tab becomes active
  useEffect(() => {
    if (active) setTimeout(() => termRef.current?.focus(), 60)
  }, [active])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', inset: 0,
        // Hide with visibility+pointerEvents so xterm DOM stays mounted (avoids remounting on tab switch)
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
      }}
    />
  )
}

const PANEL_TABS: Array<{ id: PanelType; label: string; Icon: any }> = [
  { id: 'terminal', label: 'Terminal',      Icon: TerminalIcon },
  { id: 'output',   label: 'Output',        Icon: TerminalIcon },
  { id: 'problems', label: 'Problems',      Icon: AlertCircle  },
  { id: 'debug',    label: 'Debug Console', Icon: Bug          },
  { id: 'ports',    label: 'Ports',         Icon: Radio        },
]

export default function TerminalPanel({ cwd, onClose }: Props) {
  const [panel,       setPanel]       = useState<PanelType>('terminal')
  const [terminals,   setTerminals]   = useState<TermTab[]>([
    { id: 'term-1', label: cwd ? (cwd.split('/').pop() ?? 'zsh') : 'zsh', cwd },
  ])
  const [activeTermId, setActiveTermId] = useState('term-1')

  function addTerminal() {
    _counter++
    const id    = `term-${_counter}`
    const label = cwd ? (cwd.split('/').pop() ?? 'zsh') : 'zsh'
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

  const btnBase: React.CSSProperties = {
    border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 11, display: 'flex', alignItems: 'center', gap: 5,
    padding: '0 12px', height: '100%', whiteSpace: 'nowrap',
    transition: 'color 0.12s',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d0d0d', overflow: 'hidden' }}>

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'stretch', background: '#141414', borderBottom: '1px solid #252525', flexShrink: 0, height: 32 }}>

        {/* Panel type tabs */}
        <div style={{ display: 'flex', alignItems: 'stretch', borderRight: '1px solid #252525', flexShrink: 0 }}>
          {PANEL_TABS.map(tab => {
            const active = panel === tab.id
            return (
              <button key={tab.id} onClick={() => setPanel(tab.id)}
                style={{ ...btnBase, color: active ? '#e8e8e8' : '#555', fontWeight: active ? 500 : 400, borderBottom: active ? '2px solid #7c6af7' : '2px solid transparent' }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#aaa' }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#555' }}
              >
                <tab.Icon size={11} />{tab.label}
              </button>
            )
          })}
        </div>

        {/* Terminal instance tabs — only when terminal panel active */}
        {panel === 'terminal' && (
          <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflow: 'hidden' }}>
            {terminals.map(term => {
              const active = term.id === activeTermId
              return (
                <div key={term.id} onClick={() => setActiveTermId(term.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 12px', cursor: 'pointer', borderRight: '1px solid #252525', background: active ? '#1e1e1e' : 'transparent', color: active ? '#e8e8e8' : '#555', fontSize: 11, whiteSpace: 'nowrap', borderBottom: active ? '2px solid #3dd68c' : '2px solid transparent', transition: 'background 0.12s', flexShrink: 0 }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = '#1a1a1a' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <TerminalIcon size={11} style={{ flexShrink: 0 }} />
                  <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{term.label}</span>
                  <button onClick={e => { e.stopPropagation(); closeTerminal(term.id) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 2, borderRadius: 3, opacity: 0.5, flexShrink: 0 }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '0.5'}
                  ><X size={10} /></button>
                </div>
              )
            })}
            {/* New terminal */}
            <button onClick={addTerminal} title="New terminal (same cwd)"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, border: 'none', background: 'transparent', color: '#555', cursor: 'pointer', flexShrink: 0, borderBottom: '2px solid transparent' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#aaa'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#555'}
            ><Plus size={13} /></button>
          </div>
        )}

        {/* Spacer + close */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 8, flexShrink: 0 }}>
          <button onClick={onClose} title="Close panel"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', display: 'flex', padding: 4, borderRadius: 3 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#e8e8e8'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#555'}
          ><X size={13} /></button>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>

        {/* All terminal instances — always mounted, toggled via visibility */}
        {terminals.map(term => (
          <XTermInstance key={term.id} cwd={term.cwd} active={panel === 'terminal' && term.id === activeTermId} />
        ))}

        {/* Static panels */}
        {panel !== 'terminal' && (
          <div style={{ position: 'absolute', inset: 0, padding: '12px 16px', fontSize: 12, color: '#555', fontFamily: 'monospace', lineHeight: 1.6, overflowY: 'auto' }}>
            {panel === 'output' && <>
              <div style={{ color: '#444', marginBottom: 8, fontSize: 11 }}>— Output —</div>
              <div>No output to display.</div>
            </>}
            {panel === 'problems' && <>
              <div style={{ color: '#444', marginBottom: 8, fontSize: 11 }}>— Problems —</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#3dd68c' }}>
                <AlertCircle size={13} /><span>No problems detected.</span>
              </div>
            </>}
            {panel === 'debug' && <>
              <div style={{ color: '#444', marginBottom: 8, fontSize: 11 }}>— Debug Console —</div>
              <div>Start a debug session to see output here.</div>
            </>}
            {panel === 'ports' && <>
              <div style={{ color: '#444', marginBottom: 8, fontSize: 11 }}>— Forwarded Ports —</div>
              <div>No ports forwarded.</div>
            </>}
          </div>
        )}
      </div>
    </div>
  )
}
