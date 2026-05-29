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
  { title: 'Model fallback chain',       desc: 'If a model fails or runs out of memory, LocalForge automatically falls back to the next available model.' },
  { title: 'Context reconstruction',     desc: 'On crash recovery, context is rebuilt from actual disk state — no hallucinations on resume.' },
  { title: 'File search',                desc: 'Search across all project files instantly from the workspace sidebar.' },
  { title: 'Cross-platform',             desc: 'Runs identically on macOS, Windows, and Linux — one codebase, one binary.' },
  { title: 'Auto project onboarding',    desc: 'Opening an existing project auto-scans files and generates a full technical summary for agents.' },
  { title: 'Tab strip',                  desc: 'Quickly switch between your most recently accessed chats, projects, and terminals.' },
]

const ROWS = [
  FEATURES.slice(0,  4),
  FEATURES.slice(4,  8),
  FEATURES.slice(8,  12),
  FEATURES.slice(12, 16),
  FEATURES.slice(16, 20),
]

const DIRECTIONS: Array<'left' | 'right'> = ['left', 'right', 'left', 'right', 'left']

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{
      flexShrink: 0, width: 200,
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '11px 13px',
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
  return (
    <div style={{ overflow: 'hidden', width: '100%' }}>
      <div style={{ display: 'flex', gap: 10, animation: `scroll-${direction}-${items.length} 36s linear infinite`, width: 'max-content' }}>
        {tripled.map((f, i) => <FeatureCard key={i} {...f} />)}
      </div>
      <style>{`
        @keyframes scroll-left-${items.length}  { 0% { transform: translateX(0) } 100% { transform: translateX(-${shift}) } }
        @keyframes scroll-right-${items.length} { 0% { transform: translateX(-${shift}) } 100% { transform: translateX(0) } }
      `}</style>
    </div>
  )
}

export default function WelcomeScreen() {
  const { addSession, setActiveSession, isConnected, userName } = useAppStore()
  const [showProjectModal, setShowProjectModal] = useState(false)

  const greeting = userName
    ? `Welcome onboard, ${userName} 👋`
    : 'Welcome to LocalForge'

  const subtext = userName
    ? 'Local-first AI coding agent. No cloud. No subscription. Everything runs on your machine.'
    : 'Local-first AI coding agent. No cloud. No subscription. Everything runs on your machine.'

  function newChat() {
    const id = nanoid()
    addSession({ id, type: 'chat', title: 'New chat', agents: [], messages: [], allFiles: [], writtenFiles: [], lastAccessedAt: Date.now(), isActive: true })
    setActiveSession(id)
    api.createSession(id, 'chat', 'New chat').catch(console.error)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'var(--bg-primary)', gap: 12 }}>

      <div style={{ textAlign: 'center', padding: '0 20px' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, letterSpacing: '-0.5px' }}>
          {userName ? (
            <>Welcome onboard, <span style={{ color: 'var(--accent)' }}>{userName}</span> 👋</>
          ) : (
            <>Welcome to <span style={{ color: 'var(--accent)' }}>LocalForge</span></>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 420, margin: '0 auto' }}>
          {subtext}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={newChat} style={{ background: 'transparent', border: '1px solid var(--border-light)', borderRadius: 8, padding: '8px 24px', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
            New chat
          </button>
          <button onClick={() => setShowProjectModal(true)} style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '8px 24px', color: 'white', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
            New project
          </button>
        </div>
      </div>

      {isConnected ? (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ROWS.map((row, i) => <ScrollRow key={i} items={row} direction={DIRECTIONS[i]} />)}
        </div>
      ) : (
        <div style={{ padding: '0 40px', maxWidth: 560, width: '100%' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 14 }}>
            Agent server offline — start with{' '}
            <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>npm run dev</code>
            {' '}in packages/agent-core
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {FEATURES.slice(0, 8).map((f, i) => <FeatureCard key={i} {...f} />)}
          </div>
        </div>
      )}

      {showProjectModal && <NewProjectModal onClose={() => setShowProjectModal(false)} />}
    </div>
  )
}
