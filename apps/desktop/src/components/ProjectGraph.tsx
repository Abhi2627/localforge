import { useMemo, useState, useCallback, useRef, useEffect } from 'react'

interface Props {
  files:    string[]
  rootPath: string
  width?:   number   // optional explicit width for fullscreen
  height?:  number   // optional explicit height for fullscreen
}

interface Node {
  id:       string
  label:    string
  x:        number
  y:        number
  color:    string
  isFolder: boolean
  size:     number
}

interface Edge {
  source: string
  target: string
}

const IGNORE = ['node_modules', 'dist', '.git', 'build', '.next', '.tauri']

function fileColor(name: string, isFolder: boolean): string {
  if (isFolder) return '#8b5cf6'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['tsx', 'jsx'].includes(ext)) return '#3dd68c'
  if (['ts', 'js'].includes(ext))   return '#3b82f6'
  if (['css', 'scss'].includes(ext)) return '#eab308'
  if (['json', 'yaml', 'toml'].includes(ext)) return '#06b6d4'
  if (['md', 'txt'].includes(ext))  return '#a78bfa'
  if (['rs'].includes(ext))         return '#f97316'
  if (['py'].includes(ext))         return '#facc15'
  return '#94a3b8'
}

function buildGraph(files: string[], rootPath: string): { nodes: Node[]; edges: Edge[] } {
  if (files.length === 0) return { nodes: [], edges: [] }

  const filtered = files
    .filter(f => {
      const rel = f.replace(rootPath, '').replace(/^[/\\]/, '')
      return !IGNORE.some(ig => rel.startsWith(ig)) &&
        /\.(ts|tsx|js|jsx|css|scss|json|md|yaml|yml|toml|rs|py)$/.test(f)
    })
    .slice(0, 60)

  const nodeMap = new Map<string, {
    id: string; label: string; isFolder: boolean; children: string[]; parent: string | null
  }>()

  const rootLabel = rootPath.split('/').pop() ?? 'project'
  nodeMap.set(rootPath, { id: rootPath, label: rootLabel, isFolder: true, children: [], parent: null })

  filtered.forEach(file => {
    const rel   = file.replace(rootPath, '').replace(/^[/\\]/, '').replace(/\\/g, '/')
    const parts = rel.split('/')
    let   cur   = rootPath

    for (let i = 0; i < parts.length; i++) {
      const part   = parts[i]
      const isLast = i === parts.length - 1
      const next   = `${cur}/${part}`
      const nodeId = isLast ? file : next

      if (!nodeMap.has(nodeId)) {
        const parent = nodeMap.get(cur)!
        nodeMap.set(nodeId, { id: nodeId, label: part, isFolder: !isLast, children: [], parent: cur })
        parent.children.push(nodeId)
      }
      cur = next
    }
  })

  // Radial BFS layout — positions relative to a 0,0 origin
  // Will be centred on first render via fitView
  const positions = new Map<string, { x: number; y: number }>()
  const levelRadius = [0, 90, 170, 240, 300, 355]

  const queue: Array<{ id: string; level: number; aStart: number; aEnd: number }> = [
    { id: rootPath, level: 0, aStart: 0, aEnd: Math.PI * 2 }
  ]
  positions.set(rootPath, { x: 0, y: 0 })

  while (queue.length > 0) {
    const { id, level, aStart, aEnd } = queue.shift()!
    const node = nodeMap.get(id)
    if (!node || node.children.length === 0) continue

    const r      = levelRadius[Math.min(level + 1, levelRadius.length - 1)]
    const spread = aEnd - aStart

    node.children.forEach((childId, i) => {
      const angle = aStart + (spread / node.children.length) * (i + 0.5)
      positions.set(childId, { x: Math.cos(angle) * r, y: Math.sin(angle) * r })
      const child = nodeMap.get(childId)
      if (child && child.children.length > 0) {
        queue.push({
          id: childId, level: level + 1,
          aStart: aStart + (spread / node.children.length) * i,
          aEnd:   aStart + (spread / node.children.length) * (i + 1),
        })
      }
    })
  }

  const nodes: Node[] = Array.from(nodeMap.values()).map(n => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    return {
      id: n.id, label: n.label,
      x: pos.x, y: pos.y,
      color: fileColor(n.label, n.isFolder),
      isFolder: n.isFolder,
      size: n.isFolder ? (n.id === rootPath ? 11 : 7) : 4,
    }
  })

  const edges: Edge[] = []
  nodeMap.forEach(n => { n.children.forEach(c => edges.push({ source: n.id, target: c })) })

  return { nodes, edges }
}

export default function ProjectGraph({ files, rootPath }: Props) {
  const { nodes, edges } = useMemo(() => buildGraph(files, rootPath), [files.join('|'), rootPath])

  const containerRef = useRef<HTMLDivElement>(null)
  // transform state: { x, y } = pan offset in screen pixels, scale = zoom level
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [panning,   setPanning]   = useState(false)
  const [tooltip,   setTooltip]   = useState<string | null>(null)
  const panStart = useRef({ mx: 0, my: 0, tx: 0, ty: 0 })
  const fitted   = useRef(false)

  // Auto-fit graph into container on first render / when nodes change
  useEffect(() => {
    if (nodes.length === 0 || !containerRef.current) return
    fitted.current = false
  }, [nodes])

  useEffect(() => {
    if (nodes.length === 0 || !containerRef.current || fitted.current) return
    fitted.current = true
    const el = containerRef.current
    const W  = el.clientWidth  || 280
    const H  = el.clientHeight || 200

    // Bounding box of all nodes
    const xs = nodes.map(n => n.x)
    const ys = nodes.map(n => n.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const gW = maxX - minX || 1
    const gH = maxY - minY || 1

    const padding = 40
    const scale   = Math.min((W - padding * 2) / gW, (H - padding * 2) / gH, 2)
    const cx      = (minX + maxX) / 2
    const cy      = (minY + maxY) / 2

    setTransform({ x: W / 2 - cx * scale, y: H / 2 - cy * scale, scale })
  }, [nodes])

  // Zoom toward mouse cursor — correct formula:
  // new_pan = cursor - (cursor - old_pan) * (new_scale / old_scale)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const el   = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    const my   = e.clientY - rect.top

    setTransform(t => {
      const factor   = e.deltaY < 0 ? 1.12 : 0.9
      const newScale = Math.min(6, Math.max(0.2, t.scale * factor))
      const ratio    = newScale / t.scale
      return {
        x:     mx - (mx - t.x) * ratio,
        y:     my - (my - t.y) * ratio,
        scale: newScale,
      }
    })
  }, [])

  function onBgDown(e: React.MouseEvent) {
    setPanning(true)
    panStart.current = { mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y }
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!panning) return
    setTransform(t => ({
      ...t,
      x: panStart.current.tx + e.clientX - panStart.current.mx,
      y: panStart.current.ty + e.clientY - panStart.current.my,
    }))
  }
  function onMouseUp() { setPanning(false) }

  function fitView() {
    fitted.current = false
    // trigger re-fit
    setTransform(t => ({ ...t }))
  }

  if (files.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>
        Graph builds after files are scanned
      </div>
    )
  }

  const { x: tx, y: ty, scale } = transform

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg-primary)', userSelect: 'none', minHeight: 160, cursor: panning ? 'grabbing' : 'grab' }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={handleWheel}
    >
      {/* Panning layer */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }} onMouseDown={onBgDown} />

      <svg style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
        <g transform={`translate(${tx},${ty}) scale(${scale})`}>
          {edges.map((e, i) => {
            const s = nodes.find(n => n.id === e.source)
            const t = nodes.find(n => n.id === e.target)
            if (!s || !t) return null
            return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
              stroke="var(--border-light)" strokeWidth={0.8 / scale} opacity={0.5} />
          })}
          {nodes.map(node => (
            <g key={node.id} transform={`translate(${node.x},${node.y})`}
              style={{ pointerEvents: 'auto', cursor: 'default' }}
              onMouseEnter={() => setTooltip(node.label)}
              onMouseLeave={() => setTooltip(null)}
            >
              <circle r={node.size} fill={node.color} stroke="var(--bg-primary)" strokeWidth={1.2 / scale}
                style={{ filter: node.isFolder ? `drop-shadow(0 0 ${4 / scale}px ${node.color}60)` : 'none' }} />
              {/* Label — always same screen size regardless of zoom */}
              <text
                y={node.size + 9 / scale}
                textAnchor="middle"
                fontSize={8 / scale}
                fill={node.isFolder ? 'var(--text-primary)' : 'var(--text-muted)'}
                fontWeight={node.isFolder ? 600 : 400}
                style={{ fontFamily: 'system-ui, sans-serif', paintOrder: 'stroke', stroke: 'var(--bg-primary)', strokeWidth: 2.5 / scale }}
              >
                {node.label.length > 18 ? node.label.slice(0, 16) + '…' : node.label}
              </text>
            </g>
          ))}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '3px 8px', fontSize: 10, color: 'var(--text-primary)',
          pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap', fontFamily: 'monospace',
        }}>
          {tooltip}
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8, zIndex: 10,
        background: 'rgba(15,15,15,0.85)', border: '1px solid var(--border)',
        borderRadius: 5, padding: '5px 8px', pointerEvents: 'none',
      }}>
        {[
          { color: '#8b5cf6', label: 'Folder' },
          { color: '#3dd68c', label: 'Component' },
          { color: '#3b82f6', label: 'Module' },
          { color: '#eab308', label: 'Style' },
          { color: '#06b6d4', label: 'Config' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{l.label}</span>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 10, display: 'flex', gap: 3 }}>
        {[
          { label: '+', action: () => setTransform(t => { const c = containerRef.current; const W = c?.clientWidth ?? 200; const H = c?.clientHeight ?? 160; const ns = Math.min(6, t.scale * 1.25); const r = ns / t.scale; return { x: W/2 - (W/2 - t.x)*r, y: H/2 - (H/2 - t.y)*r, scale: ns } }) },
          { label: '−', action: () => setTransform(t => { const c = containerRef.current; const W = c?.clientWidth ?? 200; const H = c?.clientHeight ?? 160; const ns = Math.max(0.2, t.scale * 0.8); const r = ns / t.scale; return { x: W/2 - (W/2 - t.x)*r, y: H/2 - (H/2 - t.y)*r, scale: ns } }) },
          { label: '⊡', action: fitView },
        ].map(b => (
          <button key={b.label} onClick={b.action} style={{
            background: 'rgba(15,15,15,0.85)', border: '1px solid var(--border)',
            borderRadius: 4, color: 'var(--text-secondary)', width: 22, height: 22,
            cursor: 'pointer', fontSize: b.label === '⊡' ? 13 : 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{b.label}</button>
        ))}
      </div>

      {/* Zoom indicator */}
      <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 10, fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
        {Math.round(scale * 100)}%
      </div>
    </div>
  )
}
