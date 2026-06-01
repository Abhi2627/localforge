/**
 * QRPreview.tsx
 *
 * Generates a QR code encoding http://<LAN_IP>:<port>
 * so the user can scan it on their phone and preview their dev server.
 *
 * Uses the `qrcode` npm package to render onto a <canvas>.
 * Opens as a modal from the TopBar via a Smartphone icon button.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Smartphone, RefreshCw, ExternalLink } from 'lucide-react'

const COMMON_PORTS = [
  { label: 'Vite (5173)',      port: 5173 },
  { label: 'Next.js (3000)',   port: 3000 },
  { label: 'Angular (4200)',   port: 4200 },
  { label: 'Astro (4321)',     port: 4321 },
  { label: 'Custom…',         port: 0   },
]

interface Props { onClose: () => void }

export default function QRPreview({ onClose }: Props) {
  const [lanIp,      setLanIp]      = useState('')
  const [port,       setPort]       = useState(5173)
  const [customPort, setCustomPort] = useState('')
  const [isCustom,   setIsCustom]   = useState(false)
  const [loading,    setLoading]    = useState(true)
  const [qrError,    setQrError]    = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const fetchIp = useCallback(async () => {
    try {
      const res  = await fetch('http://localhost:3001/network/info')
      const data = await res.json()
      setLanIp(data.lanIp ?? '127.0.0.1')
    } catch {
      setLanIp('127.0.0.1')
    }
  }, [])

  useEffect(() => { fetchIp() }, [fetchIp])

  const effectivePort = isCustom ? parseInt(customPort || '0') : port
  const previewUrl    = lanIp ? `http://${lanIp}:${effectivePort}` : ''

  useEffect(() => {
    if (!previewUrl || !canvasRef.current || !lanIp) return
    if (effectivePort < 1 || effectivePort > 65535 || isNaN(effectivePort)) return
    setLoading(true)
    setQrError('')

    import('qrcode').then(QRCode => {
      QRCode.toCanvas(canvasRef.current!, previewUrl, {
        width:  200,
        margin: 2,
        color:  { dark: '#0d0d0d', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
        .then(() => setLoading(false))
        .catch((err: Error) => { setQrError(err.message); setLoading(false) })
    }).catch(() => {
      setQrError('Run npm install in apps/desktop to enable QR generation.')
      setLoading(false)
    })
  }, [previewUrl, lanIp, effectivePort])

  const isLocal = lanIp === '127.0.0.1' || lanIp === '::1' || !lanIp

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:14, padding:24, width:320, display:'flex', flexDirection:'column', gap:16, boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Smartphone size={16} style={{ color:'var(--accent)' }}/>
            <span style={{ fontSize:15, fontWeight:700, color:'var(--text-primary)' }}>Preview on device</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:4, borderRadius:4 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
          ><X size={15}/></button>
        </div>

        {/* No LAN IP warning */}
        {isLocal && (
          <div style={{ padding:'8px 10px', background:'rgba(245,101,101,0.1)', border:'1px solid rgba(245,101,101,0.3)', borderRadius:8, fontSize:11, color:'var(--red)', lineHeight:1.6 }}>
            ⚠ No LAN IP found. Connect your Mac to Wi-Fi — your phone and Mac must be on the same network.
          </div>
        )}

        {/* Port picker */}
        <div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6, fontWeight:500 }}>Dev server port</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
            {COMMON_PORTS.map(({ label, port: p }) => {
              const isActive = p === 0 ? isCustom : (!isCustom && port === p)
              return (
                <button key={label}
                  onClick={() => { if (p === 0) { setIsCustom(true) } else { setIsCustom(false); setPort(p) } }}
                  style={{ padding:'4px 9px', borderRadius:8, border:`1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`, background: isActive ? 'var(--accent-dim)' : 'transparent', color: isActive ? 'var(--accent)' : 'var(--text-muted)', fontSize:10, cursor:'pointer', fontWeight: isActive ? 600 : 400 }}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {isCustom && (
            <input autoFocus type="number" placeholder="Port e.g. 8080" value={customPort}
              onChange={e => setCustomPort(e.target.value)}
              style={{ marginTop:8, width:'100%', background:'var(--bg-tertiary)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', color:'var(--text-primary)', fontSize:12, outline:'none', boxSizing:'border-box' }}
            />
          )}
        </div>

        {/* QR canvas */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
          <div style={{ padding:10, background:'white', borderRadius:10, position:'relative', width:220, height:220, display:'flex', alignItems:'center', justifyContent:'center' }}>
            {loading && (
              <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'white', borderRadius:10, zIndex:1 }}>
                <RefreshCw size={20} style={{ color:'#ccc', animation:'spin 1s linear infinite' }}/>
              </div>
            )}
            {qrError
              ? <div style={{ fontSize:11, color:'#888', textAlign:'center', padding:8, lineHeight:1.6 }}>{qrError}</div>
              : <canvas ref={canvasRef} />
            }
          </div>

          {/* URL + open button */}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <code style={{ fontSize:12, color:'var(--accent)', fontFamily:'monospace', background:'var(--bg-tertiary)', padding:'3px 8px', borderRadius:5 }}>
              {previewUrl || '—'}
            </code>
            {previewUrl && (
              <button onClick={() => window.open(previewUrl, '_blank')} title="Open in browser"
                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:2 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
              ><ExternalLink size={13}/></button>
            )}
          </div>
        </div>

        {/* Instructions */}
        <ol style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.8, paddingLeft:16, margin:0 }}>
          <li>Start your dev server on this Mac</li>
          <li>Connect your phone to the same Wi-Fi</li>
          <li>Open Camera and scan the QR code</li>
        </ol>

        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )
}
