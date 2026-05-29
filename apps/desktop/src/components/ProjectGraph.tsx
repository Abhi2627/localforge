import { useMemo } from 'react'

interface Props {
  files: string[]
  rootPath: string
}

interface GraphNode {
  id:    string
  label: string
  x:     number
  y:     number
  color: string
  type:  string
}

interface GraphEdge {
  from: string
  to:   string
}

function getNodeColor(ext: string): string {
  if (['.tsx', '.jsx'].includes(ext)) return '#3dd68c'
  if (['.ts', '.js'].includes(ext))   return '#7c6af7'
  if (['.css', '.scss'].includes(ext)) return '#f5a623'
  if (['.json'].includes(ext))         return '#22d3ee'
  if (['.md', '.txt'].includes(ext))   return '#888'
  return '#555'
}

function getNodeType(ext: string): string {
  if (['.tsx', '.jsx'].includes(ext)) return 'component'
  if (['.ts', '.js'].includes(ext))   return 'module'
  if (['.css', '.scss'].includes(ext)) return 'style'
  if (['.json'].includes(ext))         return 'config'
  return 'file'
}

export default function ProjectGraph({ files, rootPath }: Props) {
  const { nodes, edges } = useMemo(() => {
    if (files.length === 0) return { nodes: [], edges: [] }

    // Filter to only source files, skip node_modules/dist
    const IGNORE = ['node_modules', 'dist', '.git', 'build', '.next']
    const sourceFiles = files.filter(f => {
      const rel = f.replace(rootPath, '').replace(/^[/\\]/, '')
      return !IGNORE.some(ig => rel.startsWith(ig)) &&
        /\.(ts|tsx|js|jsx|css|scss|json|md)$/.test(f)
    }).slice(0, 20) // cap at 20 nodes for clarity

    // Build nodes in a circular layout
    const total  = sourceFiles.length
    const cx     = 120
    const cy     = 90
    const radius = Math.min(70, 20 + total * 3)

    const nodes: GraphNode[] = sourceFiles.map((f, i) => {
      const rel   = f.replace(rootPath, '').replace(/^[/\\]/, '')
      const parts = rel.split('/')
      const name  = parts[parts.length - 1]
      const ext   = name.includes('.') ? '.' + name.split('.').pop()! : ''
      const angle = (i / total) * 2 * Math.PI - Math.PI / 2

      return {
        id:    f,
        label: name.length > 14 ? name.slice(0, 12) + '…' : name,
        x:     cx + radius * Math.cos(angle),
        y:     cy + radius * Math.sin(angle),
        color: getNodeColor(ext),
        type:  getNodeType(ext),
      }
    })

    // Simple edge heuristic: connect files in same directory
    const edges: GraphEdge[] = []
    const byDir = new Map<string, string[]>()
    sourceFiles.forEach(f => {
      const rel = f.replace(rootPath, '').replace(/^[/\\]/, '')
      const dir = rel.split('/').slice(0, -1).join('/')
      if (!byDir.has(dir)) byDir.set(dir, [])
      byDir.get(dir)!.push(f)
    })
    byDir.forEach(group => {
      for (let i = 0; i < group.length - 1; i++) {
        edges.push({ from: group[i], to: group[i + 1] })
      }
    })

    return { nodes, edges }
  }, [files, rootPath])

  if (nodes.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 12,
      }}>
        Graph builds after first agent run
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
      <svg
        viewBox="0 0 240 180"
        style={{ width: '100%', height: '100%' }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Edges */}
        {edges.map((e, i) => {
          const from = nodes.find(n => n.id === e.from)
          const to   = nodes.find(n => n.id === e.to)
          if (!from || !to) return null
          return (
            <line key={i}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="var(--border-light)" strokeWidth={0.5} opacity={0.6}
            />
          )
        })}

        {/* Nodes */}
        {nodes.map(node => (
          <g key={node.id}>
            <circle cx={node.x} cy={node.y} r={5}
              fill={node.color} opacity={0.9}
            />
            <text
              x={node.x} y={node.y + 9}
              textAnchor="middle" fontSize={4}
              fill="var(--text-muted)"
            >
              {node.label}
            </text>
          </g>
        ))}

        {/* Legend */}
        {[
          { color: '#3dd68c', label: 'Component' },
          { color: '#7c6af7', label: 'Module' },
          { color: '#f5a623', label: 'Style' },
        ].map((l, i) => (
          <g key={l.label} transform={`translate(6, ${6 + i * 8})`}>
            <circle cx={3} cy={3} r={2.5} fill={l.color} />
            <text x={8} y={6} fontSize={4} fill="var(--text-muted)">{l.label}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
