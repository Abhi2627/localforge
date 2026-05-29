import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface Props {
  cwd?: string        // project root path — terminal opens here
  onClose: () => void
}

export default function TerminalPanel({ cwd, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let term: any
    let fitAddon: any
    let ws: WebSocket | null = null
    let resizeObserver: ResizeObserver

    async function init() {
      const { Terminal }  = await import('@xterm/xterm')
      const { FitAddon }  = await import('@xterm/addon-fit')
      await import('@xterm/xterm/css/xterm.css')

      term = new Terminal({
        cursorBlink:  true,
        fontSize:     12,
        fontFamily:   "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        theme: {
          background:          '#0a0a0a',
          foreground:          '#e8e8e8',
          cursor:              '#7c6af7',
          cursorAccent:        '#0a0a0a',
          selectionBackground: '#7c6af730',
          black:    '#1a1a1a', brightBlack:   '#555555',
          red:      '#f56565', brightRed:     '#fc8181',
          green:    '#3dd68c', brightGreen:   '#68d391',
          yellow:   '#f5a623', brightYellow:  '#f6ad55',
          blue:     '#7c6af7', brightBlue:    '#a78bfa',
          magenta:  '#c084fc', brightMagenta: '#d8b4fe',
          cyan:     '#22d3ee', brightCyan:    '#67e8f9',
          white:    '#e8e8e8', brightWhite:   '#ffffff',
        },
        scrollback:  5000,
        convertEol:  true,
        allowProposedApi: true,
      })

      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)

      if (containerRef.current) {
        term.open(containerRef.current)
        setTimeout(() => fitAddon.fit(), 50)
      }

      // Connect to PTY WebSocket — pass cwd as query param
      const cwdParam = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
      ws = new WebSocket(`ws://localhost:3001/terminal${cwdParam}`)

      ws.onopen = () => {
        // Send initial size after connection
        const dims = fitAddon.proposeDimensions()
        if (dims) {
          ws!.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
        }
      }

      ws.onmessage = (e) => {
        // Raw terminal data from PTY
        term.write(e.data)
      }

      ws.onclose = () => {
        term.writeln('\r\n\x1b[90m[Terminal disconnected]\x1b[0m')
      }

      ws.onerror = () => {
        term.writeln('\r\n\x1b[31m[Could not connect to terminal server]\x1b[0m')
        term.writeln('\x1b[90mMake sure the agent server is running: npm run dev\x1b[0m\r\n')
      }

      // Send keystrokes to PTY
      term.onData((data: string) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      })

      // Resize terminal when container resizes
      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit()
        const dims = fitAddon.proposeDimensions()
        if (dims && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
        }
      })
      if (containerRef.current) resizeObserver.observe(containerRef.current)
    }

    init()

    return () => {
      resizeObserver?.disconnect()
      ws?.close()
      term?.dispose()
    }
  }, [cwd])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>Terminal</span>
          {cwd && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {cwd.split('/').pop()}
            </span>
          )}
        </div>
        <button className="icon-btn" style={{ width: 22, height: 22 }} title="Close terminal" onClick={onClose}>
          <X size={11} />
        </button>
      </div>

      {/* xterm.js container */}
      <div ref={containerRef} style={{ flex: 1, padding: '4px', overflow: 'hidden', minHeight: 0 }} />
    </div>
  )
}
