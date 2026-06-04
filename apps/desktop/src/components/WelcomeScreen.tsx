import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { api } from '../hooks/useApi'
import { nanoid } from '../hooks/nanoid'
import NewProjectModal from './NewProjectModal'

const FEATURES = [
  { title: 'Multi-agent orchestration',  desc: 'Run frontend, backend and test agents in parallel or sequentially based on your hardware.' },
  { title: 'Fully local & private',      desc: 'No data leaves your machine. Works completely offline with Ollama-powered models.' },
  { title: 'Crash recovery',             desc: 'Write-ahead log ensures agents resume from the exact task after any crash — no re-prompting.' },
  { title: 'Internet RAG',               desc: 'Auto-fetches live web context when the model hits its knowledge cutoff. No retraining needed.' },
  { title: 'Knowledge graph',            desc: 'Tracks every function and interface written to prevent cross-agent drift across files.' },
  { title: 'Model advisor',              desc: 'Monitors agent failures and recommends better Ollama models based on your task patterns.' },
  { title: 'Preview on device',          desc: 'QR code lets you open built apps on any phone or tablet — no install needed on the device.' },
  { title: 'API contract enforcer',      desc: 'Detects frontend/backend interface mismatches before they compound into bugs.' },
  { title: 'Integrated terminal',        desc: 'Full terminal inside the app. Run your built projects without switching windows.' },
  { title: 'Chat & learn mode',          desc: 'Conversational AI explains any concept — code, math, design — in simple terms.' },
  { title: 'Hardware-aware scheduling',  desc: 'Auto-detects RAM and GPU to decide parallel or sequential agent execution.' },
  { title: 'Project flow graph',         desc: 'Visual graph of component connections and data flow, always up to date as agents write code.' },
  { title: 'Session persistence',        desc: 'All chats and projects are saved locally. Pick up exactly where you left off after restart.' },
  { title: 'Native folder picker',       desc: 'Open any folder as a project — just like VS Code. LocalForge reads everything instantly.' },
  { title: 'Model fallback chain',       desc: 'If a model fails, LocalForge automatically falls back to the next available model.' },
  { title: 'Cross-platform',            desc: 'Runs identically on macOS, Windows, and Linux — one codebase, one binary.' },
]

const ROWS = [
  FEATURES.slice(0, 4),
  FEATURES.slice(4, 8),
  FEATURES.slice(8, 12),
  FEATURES.slice(12, 16),
]

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{
      flexShrink: 0, width: 200,
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 13px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{desc}</div>
    </div>
  )
}

function ScrollRow({ items, direction }: { items: typeof ROWS[0]; direction: 'left' | 'right' }) {
  const tripled = [...items, ...items, ...items]
  const cardW   = 210
  const shift   = `${cardW * items.length}px`
  const key     = `${direction}-${items.length}`
  return (
    <div style={{ overflow: 'hidden', width: '100%' }}>
      <div style={{
        display: 'flex', gap: 10, paddingLeft: 16,
        animation: `scroll-${key} 36s linear infinite`,
        width: 'max-content',
      }}>
        {tripled.map((f, i) => <FeatureCard key={i} {...f} />)}
      </div>
      <style>{`
        @keyframes scroll-${key}-left  { 0% { transform: translateX(0) } 100% { transform: translateX(calc(-${shift} - 16px)) } }
        @keyframes scroll-left-${items.length}  { 0% { transform: translateX(0) } 100% { transform: translateX(calc(-${shift} - 16px)) } }
        @keyframes scroll-right-${items.length} { 0% { transform: translateX(calc(-${shift} - 16px)) } 100% { transform: translateX(0) } }
      `}</style>
    </div>
  )
}

export default function WelcomeScreen() {
  const { addSession, setActiveSession, userName } = useAppStore()
  const [showProjectModal, setShowProjectModal] = useState(false)

  function newChat() {
    const id = nanoid()
    addSession({ id, type: 'chat', title: 'New chat', agents: [], messages: [], allFiles: [], writtenFiles: [], lastAccessedAt: Date.now(), isActive: true })
    setActiveSession(id)
    api.createSession(id, 'chat', 'New chat').catch(console.error)
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      overflow: 'hidden',
      minHeight: 0,
      height: '100%',
      gap: 24,
    }}>

      {/* Greeting — vertically centred, always visible */}
      <div style={{ textAlign: 'center', padding: '0 32px', flexShrink: 0 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, letterSpacing: '-0.5px', lineHeight: 1.3 }}>
          {userName
            ? <>Welcome onboard, <span style={{ color: 'var(--accent)' }}>{userName}</span> 👋</>
            : <>Welcome to <span style={{ color: 'var(--accent)' }}>LocalForge</span></>
          }
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 420, margin: '0 auto', lineHeight: 1.7 }}>
          Local-first AI coding agent. No cloud. No subscription. Everything runs on your machine.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
          <button onClick={newChat} style={{
            background: 'transparent', border: '1px solid var(--border-light)',
            borderRadius: 8, padding: '9px 28px', color: 'var(--text-primary)',
            fontSize: 13, cursor: 'pointer', fontWeight: 500,
          }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)'}
          >
            New chat
          </button>
          <button onClick={() => setShowProjectModal(true)} style={{
            background: 'var(--accent)', border: 'none',
            borderRadius: 8, padding: '9px 28px', color: 'white',
            fontSize: 13, cursor: 'pointer', fontWeight: 500,
          }}>
            New project
          </button>
        </div>
      </div>

      {/* Scrolling feature rows — 3 rows max, masked edges */}
      <div style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
        maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
      }}>
        {ROWS.slice(0, 3).map((row, i) => (
          <ScrollRow key={i} items={row} direction={i % 2 === 0 ? 'left' : 'right'} />
        ))}
      </div>

      {showProjectModal && <NewProjectModal onClose={() => setShowProjectModal(false)} />}
    </div>
  )
}
