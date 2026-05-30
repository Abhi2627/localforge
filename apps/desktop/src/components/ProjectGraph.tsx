import { useMemo, useState, useCallback, useRef } from 'react'

interface Props {
  files: string[]
  rootPath: string
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

// Deterministic layout using a radial tree — no physics, no jitter
function buildGraph(files: string[], rootPath: string): { nodes: Node[]; edges: Edge[] } {
  if (files.length === 0) return { nodes: [], edges: [] }

  const filtered = files
    .filter(f => {
      const rel = f.replace(rootPath, '').replace(/^[/\\]/, '')
      return !IGNORE.some(ig => rel.startsWith(ig)) &&
        /\.(ts|tsx|js|jsx|css|scss|json|md|yaml|yml|toml|rs|py)$/.test(f)
    })
    .slice(0, 60)

  // Build folder/file tree
  const nodeMap = new Map<string, { id: string; label: string; isFolder: boolean; children: string[]; parent: string | null }>()
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

  // Radial layout: BFS from root, assign angles per level
  const positions = new Map<string, { x: number; y: number }>()
  const cx = 380
  const cy = 260
  const levelRadius = [0, 80, 150, 210, 265, 310]

  const queue: Array<{ id: string; level: number; angleStart: number; angleEnd: number }> = [
    { id: rootPath, level: 0, angleStart: 0, angleEnd: Math.PI * 2 }
  ]

  positions.set(rootPath, { x: cx, y: cy })

  while (queue.length > 0) {
    const { id, level, angleStart, angleEnd } = queue.shift()!
    const node     = nodeMap.get(id)
    if (!node) continue
    const children = node.children
    if (children.length === 0) continue

    const r = levelRadius[Math.min(level + 1, levelRadius.length - 1)]
    const spread = angleEnd - angleStart

    children.forEach((childId, i) => {
      const angle = angleStart + (spread / children.length) * (i + 0.5)
      positions.set(childId, {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      })
      const childNode = nodeMap.get(childId)
      if (childNode && childNode.children.length > 0) {
        const childAngleStart = angleStart + (spread / children.length) * i
        const childAngleEnd   = angleStart + (spread / children.length) * (i + 1)
        queue.push({ id: childId, level: level + 1, angleStart: childAngleStart, angleEnd: childAngleEnd })
      }
    })
  }

  const nodes: Node[] = Array.from(nodeMap.values()).map(n => {
    const pos = positions.get(n.id) ?? { x: cx, y: cy }
    return {
      id:       n.id,
      label:    n.label,
      x:        pos.x,
      y:        pos.y,
      color:    fileColor(n.label, n.isFolder),
      isFolder: n.isFolder,
      size:     n.isFolder ? (n.id === rootPath ? 10 : 7) : 4,
    }
  })

  const edges: Edge[] = []
  nodeMap.forEach(n => {
    n.children.forEach(childId => {
      edges.push({ source: n.id, target: childId })
    })
  })

  return { nodes, edges }
}

export default function ProjectGraph({ files, rootPath }: Props) {
  const { nodes, edges } = useMemo(() => buildGraph(files, rootPath), [files.join('|'), rootPath])

  const [zoom, setZoom]   = useState(1)
  const [pan,  setPan]    = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [tooltip, setTooltip] = useState<{ label: string; x: number; y: number } | null>(null)
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  const svgRef   = useRef<SVGSVGElement>(null)

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.12 : 0.9
    setZoom(z => Math.min(4, Math.max(0.25, z * factor)))
  }, [])

  function onBgDown(e: React.MouseEvent) {
    setPanning(true)
    panStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!panning) return
    setPan({ x: panStart.current.px + e.clientX - panStart.current.mx, y: panStart.current.py + e.clientY - panStart.current.my })
  }
  function onMouseUp() { setPanning(false) }

  function reset() { setZoom(1); setPan({ x: 0, y: 0 }) }

  if (files.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>
        Graph builds after files are scanned
      </div>
    )
  }

  return (
    <div
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg-primary)', userSelect: 'none', minHeight: 160, cursor: panning ? 'grabbing' : 'grab' }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={handleWheel}
    >
      {/* Panning background */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }} onMouseDown={onBgDown} />

      <svg ref={svgRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {edges.map((e, i) => {
            const s = nodes.find(n => n.id === e.source)
            const t = nodes.find(n => n.id === e.target)
            if (!s || !t) return null
            return (
              <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke="var(--border-light)" strokeWidth={0.8} opacity={0.5} />
            )
          })}

          {/* Nodes */}
          {nodes.map(node => (
            <g key={node.id} transform={`translate(${node.x},${node.y})`}
              style={{ pointerEvents: 'auto', cursor: 'default' }}
              onMouseEnter={() => setTooltip({ label: node.label, x: node.x, y: node.y })}
              onMouseLeave={() => setTooltip(null)}
            >
              <circle
                r={node.size}
                fill={node.color}
                stroke="var(--bg-primary)"
                strokeWidth={1.2}
                style={{ filter: node.isFolder ? `drop-shadow(0 0 4px ${node.color}60)` : 'none' }}
              />
              {/* Only label folders and top-level files to avoid clutter */}
              {(node.isFolder || node.size >= 4) && (
                <text
                  y={node.size + 8}
                  textAnchor="middle"
                  fontSize={7}
                  fill={node.isFolder ? 'var(--text-primary)' : 'var(--text-muted)'}
                  fontWeight={node.isFolder ? 600 : 400}
                  style={{ fontFamily: 'system-ui, sans-serif', paintOrder: 'stroke', stroke: 'var(--bg-primary)', strokeWidth: 2.5, strokeLinejoin: 'round' }}
                >
                  {node.label.length > 16 ? node.label.slice(0, 14) + '…' : node.label}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '3px 8px', fontSize: 10, color: 'var(--text-primary)',
          pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap',
          fontFamily: 'monospace',
        }}>
          {tooltip.label}
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8, zIndex: 10,
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 5, padding: '5px 8px', pointerEvents: 'none', opacity: 0.9,
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
      <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 10, display: 'flex', gap: 4 }}>
        <button onClick={() => setZoom(z => Math.min(4, z * 1.25))}
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', width: 22, height: 22, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
        <button onClick={() => setZoom(z => Math.max(0.25, z * 0.8))}
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', width: 22, height: 22, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
        <button onClick={reset}
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', padding: '0 6px', height: 22, cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center' }}>Reset</button>
      </div>
    </div>
  )
}
