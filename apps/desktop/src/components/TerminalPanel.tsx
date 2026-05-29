import { useEffect, useRef, useState } from 'react'
import { X, Minus } from 'lucide-react'

interface Props {
  onClose: () => void
}

export default function TerminalPanel({ onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<any>(null)
  const fitRef       = useRef<any>(null)
  const wsRef        = useRef<WebSocket | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let term: any
    let fitAddon: any

    async function init() {
      // Dynamically import xterm to avoid SSR issues
      const { Terminal }    = await import('@xterm/xterm')
      const { FitAddon }    = await import('@xterm/addon-fit')
      await import('@xterm/xterm/css/xterm.css')

      term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        theme: {
          background:  '#0a0a0a',
          foreground:  '#e8e8e8',
          cursor:      '#7c6af7',
          selectionBackground: '#7c6af730',
          black:       '#1a1a1a',
          brightBlack: '#555',
          red:         '#f56565',
          green:       '#3dd68c',
          yellow:      '#f5a623',
          blue:        '#7c6af7',
          magenta:     '#c084fc',
          cyan:        '#22d3ee',
          white:       '#e8e8e8',
          brightWhite: '#ffffff',
        },
        scrollback:   2000,
        convertEol:   true,
      })

      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)

      if (containerRef.current) {
        term.open(containerRef.current)
        fitAddon.fit()
        setReady(true)
      }

      termRef.current = term
      fitRef.current  = fitAddon

      // Connect to terminal WebSocket on agent server
      const ws = new WebSocket('ws://localhost:3001/terminal')
      wsRef.current = ws

      ws.onopen = () => {
        term.writeln('\x1b[32m✓ LocalForge Terminal\x1b[0m')
        term.writeln('\x1b[90mType commands and press Enter\x1b[0m')
        term.writeln('')
      }

      ws.onerror = () => {
        // Fallback: local pseudo-terminal without server
        term.writeln('\x1b[33mAgent server not connected — running in local mode\x1b[0m')
        term.writeln('')
        runLocalTerminal(term)
      }

      ws.onmessage = (e) => term.write(e.data)

      // Send keystrokes to server
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      })
    }

    // Simple local echo terminal when server WS is unavailable
    function runLocalTerminal(term: any) {
      let line = ''
      const prompt = '\x1b[35m❯\x1b[0m '
      term.write(prompt)

      term.onData((data: string) => {
        if (data === '\r') {
          term.writeln('')
          if (line.trim()) handleCommand(term, line.trim())
          line = ''
          term.write(prompt)
        } else if (data === '\u007f') {
          if (line.length > 0) {
            line = line.slice(0, -1)
            term.write('\b \b')
          }
        } else if (data >= ' ') {
          line += data
          term.write(data)
        }
      })
    }

    function handleCommand(term: any, cmd: string) {
      const parts = cmd.split(' ')
      switch (parts[0]) {
        case 'clear':
        case 'cls':
          term.clear()
          break
        case 'echo':
          term.writeln(parts.slice(1).join(' '))
          break
        case 'help':
          term.writeln('Available: clear, echo, help')
          term.writeln('For full shell access, ensure the agent server is running.')
          break
        default:
          term.writeln(`\x1b[31mCommand not found: ${parts[0]}\x1b[0m`)
          term.writeln('Run the agent server for full terminal support.')
      }
    }

    init()

    // Resize handler
    const observer = new ResizeObserver(() => {
      fitRef.current?.fit()
    })
    if (containerRef.current) observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      wsRef.current?.close()
      term?.dispose()
    }
  }, [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', background: '#0a0a0a',
      borderTop: '1px solid var(--border)',
    }}>
      {/* Terminal header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
          Terminal
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="Minimise" onClick={onClose}>
            <Minus size={11} />
          </button>
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="Close" onClick={onClose}>
            <X size={11} />
          </button>
        </div>
      </div>

      {/* xterm container */}
      <div
        ref={containerRef}
        style={{ flex: 1, padding: '6px 4px', overflow: 'hidden' }}
      />
    </div>
  )
}
