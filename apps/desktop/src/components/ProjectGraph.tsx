import { useMemo, useState, useCallback, useRef, useEffect } from 'react'

interface Props { files: string[]; rootPath: string }
interface Node { id: string; label: string; x: number; y: number; color: string; isFolder: boolean; size: number }
interface Edge { source: string; target: string }

const IGNORE = ['node_modules', 'dist', '.git', 'build', '.next', '.tauri', 'target']

function fileColor(name: string, isFolder: boolean): string {
  if (isFolder) return '#8b5cf6'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['tsx','jsx'].includes(ext)) return '#3dd68c'
  if (['ts','js'].includes(ext))   return '#3b82f6'
  if (['css','scss'].includes(ext)) return '#eab308'
  if (['json','yaml','toml'].includes(ext)) return '#06b6d4'
  if (['md','txt'].includes(ext))  return '#a78bfa'
  if (['rs'].includes(ext))        return '#f97316'
  if (['py'].includes(ext))        return '#facc15'
  return '#94a3b8'
}

function buildGraph(files: string[], rootPath: string): { nodes: Node[]; edges: Edge[] } {
  if (files.length === 0 || !rootPath) return { nodes: [], edges: [] }
  const filtered = files.filter(f => {
    const rel = f.replace(rootPath, '').replace(/^[/\\]/, '')
    return !IGNORE.some(ig => rel.split(/[/\\]/)[0] === ig) &&
      /\.(ts|tsx|js|jsx|css|scss|json|md|yaml|yml|toml|rs|py)$/.test(f)
  }).slice(0, 60)
  if (filtered.length === 0) return { nodes: [], edges: [] }

  const nodeMap = new Map<string, { id: string; label: string; isFolder: boolean; children: string[] }>()
  nodeMap.set(rootPath, { id: rootPath, label: rootPath.split('/').pop() ?? 'project', isFolder: true, children: [] })

  filtered.forEach(file => {
    const parts = file.replace(rootPath, '').replace(/^[/\\]/, '').replace(/\\/g, '/').split('/').filter(Boolean)
    let cur = rootPath
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1
      const next = `${cur}/${part}`, nodeId = isLast ? file : next
      if (!nodeMap.has(nodeId)) {
        nodeMap.get(cur)!.children.push(nodeId)
        nodeMap.set(nodeId, { id: nodeId, label: part, isFolder: !isLast, children: [] })
      }
      cur = next
    })
  })

  const positions = new Map<string, { x: number; y: number }>()
  const LR = [0, 100, 185, 260, 325, 380]
  const queue: Array<{ id: string; level: number; aStart: number; aEnd: number }> = [
    { id: rootPath, level: 0, aStart: 0, aEnd: Math.PI * 2 }
  ]
  positions.set(rootPath, { x: 0, y: 0 })
  while (queue.length > 0) {
    const { id, level, aStart, aEnd } = queue.shift()!
    const node = nodeMap.get(id)
    if (!node || node.children.length === 0) continue
    const r = LR[Math.min(level + 1, LR.length - 1)], spread = aEnd - aStart
    node.children.forEach((childId, i) => {
      const angle = aStart + (spread / node.children.length) * (i + 0.5)
      positions.set(childId, { x: Math.cos(angle) * r, y: Math.sin(angle) * r })
      const child = nodeMap.get(childId)
      if (child && child.children.length > 0)
        queue.push({
          id: childId, level: level + 1,
          aStart: aStart + (spread / node.children.length) * i,
          aEnd:   aStart + (spread / node.children.length) * (i + 1),
        })
    })
  }

  const nodes: Node[] = Array.from(nodeMap.values()).map(n => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    return { id: n.id, label: n.label, x: pos.x, y: pos.y, color: fileColor(n.label, n.isFolder), isFolder: n.isFolder, size: n.isFolder ? (n.id === rootPath ? 11 : 7) : 4 }
  })
  const edges: Edge[] = []
  nodeMap.forEach(n => n.children.forEach(c => edges.push({ source: n.id, target: c })))
  return { nodes, edges }
}

export default function ProjectGraph({ files, rootPath }: Props) {
  const { nodes, edges } = useMemo(() => buildGraph(files, rootPath), [files.join('|'), rootPath])

  const containerRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [panning, setPanning]     = useState(false)
  const [tooltip, setTooltip]     = useState<string | null>(null)
  const panStart = useRef({ mx: 0, my: 0, tx: 0, ty: 0 })

  // Incrementing fitKey is the only way to trigger re-fit from the reset button
  const [fitKey, setFitKey] = useState(0)

  const doFit = useCallback(() => {
    if (nodes.length === 0 || !containerRef.current) return
    const el = containerRef.current
    const W = el.clientWidth || 300, H = el.clientHeight || 200
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const gW = maxX - minX || 1, gH = maxY - minY || 1
    const scale = Math.min((W - 96) / gW, (H - 96) / gH, 2.5)
    setTransform({
      x: W / 2 - ((minX + maxX) / 2) * scale,
      y: H / 2 - ((minY + maxY) / 2) * scale,
      scale,
    })
  }, [nodes])

  // Fit when nodes change or when fitKey increments (reset button)
  useEffect(() => { doFit() }, [nodes, fitKey, doFit])
  // Also fit after DOM settles
  useEffect(() => { const t = setTimeout(doFit, 200); return () => clearTimeout(t) }, [nodes, doFit])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    setTransform(t => {
      const ns = Math.min(6, Math.max(0.15, t.scale * (e.deltaY < 0 ? 1.12 : 0.9)))
      const r = ns / t.scale
      return { x: mx - (mx - t.x) * r, y: my - (my - t.y) * r, scale: ns }
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

  if (nodes.length === 0) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>
      Graph builds after project is scanned
    </div>
  )

  const { x: tx, y: ty, scale } = transform

  return (
    <div ref={containerRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg-primary)', userSelect: 'none', minHeight: 0, cursor: panning ? 'grabbing' : 'grab' }}
      onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={handleWheel}
    >
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }} onMouseDown={onBgDown} />

      <svg style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
        <g transform={`translate(${tx},${ty}) scale(${scale})`}>
          {edges.map((e, i) => {
            const s = nodes.find(n => n.id === e.source), t = nodes.find(n => n.id === e.target)
            if (!s || !t) return null
            return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
              stroke="var(--border-light)" strokeWidth={0.8/scale} opacity={0.4} />
          })}
          {nodes.map(node => (
            <g key={node.id} transform={`translate(${node.x},${node.y})`} style={{ pointerEvents: 'auto' }}
              onMouseEnter={() => setTooltip(node.label)} onMouseLeave={() => setTooltip(null)}>
              <circle r={node.size} fill={node.color} stroke="var(--bg-primary)" strokeWidth={1.2/scale}
                style={{ filter: node.isFolder ? `drop-shadow(0 0 ${4/scale}px ${node.color}80)` : 'none' }} />
              <text y={node.size + 9/scale} textAnchor="middle" fontSize={8/scale}
                fill={node.isFolder ? 'var(--text-primary)' : 'var(--text-muted)'}
                fontWeight={node.isFolder ? 600 : 400}
                style={{ fontFamily: 'system-ui,sans-serif', paintOrder: 'stroke', stroke: 'var(--bg-primary)', strokeWidth: 2.5/scale }}>
                {node.label.length > 18 ? node.label.slice(0, 16) + '…' : node.label}
              </text>
            </g>
          ))}
        </g>
      </svg>

      {tooltip && (
        <div style={{ position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 10, color: 'var(--text-primary)', pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
          {tooltip}
        </div>
      )}

      {/* Legend */}
      <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10, background: 'rgba(10,10,10,0.9)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', pointerEvents: 'none' }}>
        {[['#8b5cf6','Folder'],['#3dd68c','Component'],['#3b82f6','Module'],['#eab308','Style'],['#06b6d4','Config']].map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 10, display: 'flex', gap: 3 }}>
        {[
          { l: '+', t: 'Zoom in',    f: () => setTransform(t => { const c = containerRef.current; const W = c?.clientWidth??300, H = c?.clientHeight??200; const ns = Math.min(6, t.scale*1.25); const r = ns/t.scale; return { x: W/2-(W/2-t.x)*r, y: H/2-(H/2-t.y)*r, scale: ns } }) },
          { l: '−', t: 'Zoom out',   f: () => setTransform(t => { const c = containerRef.current; const W = c?.clientWidth??300, H = c?.clientHeight??200; const ns = Math.max(0.15, t.scale*0.8); const r = ns/t.scale; return { x: W/2-(W/2-t.x)*r, y: H/2-(H/2-t.y)*r, scale: ns } }) },
          { l: '⊡', t: 'Reset view', f: () => setFitKey(k => k + 1) },
        ].map(b => (
          <button key={b.l} onClick={b.f} title={b.t} style={{ background: 'rgba(10,10,10,0.9)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', width: 22, height: 22, cursor: 'pointer', fontSize: b.l==='⊡'?13:15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {b.l}
          </button>
        ))}
      </div>

      {/* Zoom % */}
      <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 10, fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', pointerEvents: 'none' }}>
        {Math.round(scale * 100)}%
      </div>
    </div>
  )
}
