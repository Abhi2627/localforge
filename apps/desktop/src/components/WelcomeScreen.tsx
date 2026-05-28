import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { nanoid } from '../hooks/nanoid'
import NewProjectModal from './NewProjectModal'

const FEATURES = [
  { title: 'Multi-agent orchestration', desc: 'Run frontend, backend and test agents in parallel or sequentially based on your hardware.' },
  { title: 'Fully local & private', desc: 'No data leaves your machine. Works completely offline with Ollama-powered models.' },
  { title: 'Crash recovery', desc: 'Write-ahead log ensures agents resume from the exact task after any crash — no re-prompting.' },
  { title: 'Internet RAG', desc: 'Auto-fetches live web context when the model hits its knowledge cutoff. No retraining needed.' },
  { title: 'Knowledge graph', desc: 'Tracks every function and interface written to prevent cross-agent drift across files.' },
  { title: 'Model advisor', desc: 'Monitors agent failures and recommends better Ollama models based on your task patterns.' },
  { title: 'Preview on device', desc: 'QR code lets you open built apps on any phone or tablet — no install needed on the device.' },
  { title: 'API contract enforcer', desc: 'Detects frontend/backend interface mismatches before they compound into bugs.' },
  { title: 'Integrated terminal', desc: 'Full terminal inside the app. Run your built projects without switching windows.' },
  { title: 'Chat & learn mode', desc: 'Conversational AI explains any concept — code, math, design — in simple terms.' },
  { title: 'Hardware-aware scheduling', desc: 'Auto-detects RAM and GPU to decide parallel or sequential agent execution.' },
  { title: 'Project flow graph', desc: 'Visual graph of component connections and data flow, always up to date as agents write code.' },
]

const ROW1 = FEATURES.slice(0, 4)
const ROW2 = FEATURES.slice(4, 8)
const ROW3 = FEATURES.slice(8, 12)

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{
      flexShrink: 0, width: 210,
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{desc}</div>
    </div>
  )
}

function ScrollRow({ items, direction }: { items: typeof ROW1; direction: 'left' | 'right' }) {
  const tripled = [...items, ...items, ...items]
  return (
    <div style={{ overflow: 'hidden', width: '100%' }}>
      <div style={{
        display: 'flex', gap: 10,
        animation: `scroll-${direction} 40s linear infinite`,
        width: 'max-content',
      }}>
        {tripled.map((f, i) => <FeatureCard key={i} {...f} />)}
      </div>
    </div>
  )
}

export default function WelcomeScreen() {
  const { addSession, setActiveSession, isConnected } = useAppStore()
  const [showProjectModal, setShowProjectModal] = useState(false)

  function newChat() {
    const id = nanoid()
    addSession({ id, type: 'chat', title: 'New chat', agents: [], messages: [], writtenFiles: [], lastAccessedAt: Date.now(), isActive: true })
    setActiveSession(id)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      <style>{`
        @keyframes scroll-left  { 0% { transform: translateX(0) } 100% { transform: translateX(calc(-220px * ${ROW1.length})) } }
        @keyframes scroll-right { 0% { transform: translateX(calc(-220px * ${ROW1.length})) } 100% { transform: translateX(0) } }
      `}</style>

      <div style={{ textAlign: 'center', padding: '40px 20px 28px' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, letterSpacing: '-0.5px' }}>
          Welcome to <span style={{ color: 'var(--accent)' }}>LocalForge</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 420, margin: '0 auto' }}>
          Local-first AI coding agent. No cloud. No subscription. Everything runs on your machine.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
          <button onClick={newChat} style={{ background: 'transparent', border: '1px solid var(--border-light)', borderRadius: 8, padding: '8px 24px', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
            New chat
          </button>
          <button onClick={() => setShowProjectModal(true)} style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '8px 24px', color: 'white', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
            New project
          </button>
        </div>
      </div>

      {isConnected ? (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
          <ScrollRow items={ROW1} direction="left" />
          <ScrollRow items={ROW2} direction="right" />
          <ScrollRow items={ROW3} direction="left" />
        </div>
      ) : (
        <div style={{ padding: '10px 40px', maxWidth: 560, width: '100%' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 16 }}>
            Agent server offline — start it with{' '}
            <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>npm run dev</code>
            {' '}in packages/agent-core
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {FEATURES.slice(0, 6).map((f, i) => <FeatureCard key={i} {...f} />)}
          </div>
        </div>
      )}

      {showProjectModal && <NewProjectModal onClose={() => setShowProjectModal(false)} />}
    </div>
  )
}
