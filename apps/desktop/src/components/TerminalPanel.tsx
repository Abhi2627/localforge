import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface Props {
  cwd?: string
  onClose: () => void
}

export default function TerminalPanel({ cwd, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let term: any
    let fitAddon: any
    let ws: WebSocket | null = null
    let ro: ResizeObserver

    async function init() {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      await import('@xterm/xterm/css/xterm.css')

      term = new Terminal({
        cursorBlink: true,
        fontSize:    13,
        fontFamily:  "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
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
        scrollback:       5000,
        convertEol:       true,
        allowProposedApi: true,
      })

      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)

      const el = containerRef.current
      if (!el) return

      term.open(el)

      // Fit after a brief delay to let the DOM settle
      const doFit = () => {
        try {
          fitAddon.fit()
          const dims = fitAddon.proposeDimensions()
          if (dims && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
          }
        } catch { }
      }
      setTimeout(doFit, 80)

      // Connect to PTY WebSocket
      const cwdParam = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
      ws = new WebSocket(`ws://localhost:3001/terminal${cwdParam}`)

      ws.onopen = () => {
        setTimeout(doFit, 50)
      }
      ws.onmessage = e => term.write(e.data)
      ws.onclose   = () => { try { term.writeln('\r\n\x1b[90m[Terminal disconnected]\x1b[0m') } catch { } }
      ws.onerror   = () => {
        try {
          term.writeln('\r\n\x1b[31m[Cannot connect to terminal server]\x1b[0m')
          term.writeln('\x1b[90mStart the agent server:  npm run dev  (packages/agent-core)\x1b[0m\r\n')
        } catch { }
      }

      term.onData((data: string) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }))
      })

      // Resize on container size change
      ro = new ResizeObserver(doFit)
      ro.observe(el)
    }

    init()

    return () => {
      ro?.disconnect()
      ws?.close()
      term?.dispose()
    }
  }, [cwd])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d0d0d', overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 12px', borderBottom: '1px solid #222', background: '#141414', flexShrink: 0, height: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#888', fontWeight: 500 }}>Terminal</span>
          {cwd && (
            <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
              {cwd.replace(/\\/g, '/').split('/').pop()}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', display: 'flex', padding: 3, borderRadius: 3 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#e8e8e8'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#555'}
        >
          <X size={12} />
        </button>
      </div>

      {/* xterm container — no padding, xterm handles its own internal padding */}
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
      />
    </div>
  )
}
