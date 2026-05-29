import { useMemo, useState, useEffect, useRef } from 'react'

interface Props {
  files: string[]
  rootPath: string
}

interface Node {
  id: string
  label: string
  x: number
  y: number
  vx: number
  vy: number
  color: string
  isFolder: boolean
}

interface Edge {
  source: string
  target: string
}

function getNodeColor(name: string, isFolder: boolean): string {
  if (isFolder) return 'var(--accent)' // Folders are brand purple
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['tsx', 'jsx'].includes(ext)) return '#3dd68c' // React/Components
  if (['ts', 'js'].includes(ext)) return '#3b82f6' // Modules/Code
  if (['css', 'scss'].includes(ext)) return '#eab308' // Styles
  if (['json', 'yaml', 'toml'].includes(ext)) return '#06b6d4' // Configs
  if (['md', 'txt'].includes(ext)) return '#8b5cf6' // Markdown/Docs
  return '#94a3b8' // Default file color
}

export default function ProjectGraph({ files, rootPath }: Props) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0 })
  
  const containerRef = useRef<HTMLDivElement>(null)

  // 1. Process files into a folder-file structural graph
  const rawGraph = useMemo(() => {
    if (files.length === 0) return { nodes: [], edges: [] }

    const IGNORE = ['node_modules', 'dist', '.git', 'build', '.next', '.tauri']
    const filteredFiles = files.filter(f => {
      const rel = f.replace(rootPath, '').replace(/^[/\\]/, '')
      return !IGNORE.some(ig => rel.startsWith(ig)) &&
        /\.(ts|tsx|js|jsx|css|scss|json|md|yaml|yml|toml)$/.test(f)
    }).slice(0, 100) // cap at 100 nodes for good layout complexity

    const nodeMap = new Map<string, { id: string; label: string; isFolder: boolean }>()
    const edgeSet = new Set<string>()

    // Add root folder
    const rootName = rootPath.replace(/\\/g, '/').split('/').pop() ?? 'project'
    nodeMap.set(rootPath, { id: rootPath, label: rootName, isFolder: true })

    filteredFiles.forEach(file => {
      const rel = file.replace(rootPath, '').replace(/^[/\\]/, '')
      const parts = rel.replace(/\\/g, '/').split('/')
      
      let currentPath = rootPath
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const parentPath = currentPath
        currentPath = currentPath ? `${currentPath}/${part}` : part
        const isLast = i === parts.length - 1

        if (isLast) {
          // File node
          nodeMap.set(file, { id: file, label: part, isFolder: false })
          edgeSet.add(`${parentPath}||${file}`)
        } else {
          // Folder node
          if (!nodeMap.has(currentPath)) {
            nodeMap.set(currentPath, { id: currentPath, label: part, isFolder: true })
          }
          edgeSet.add(`${parentPath}||${currentPath}`)
        }
      }
    })

    const nodesList = Array.from(nodeMap.values()).map((n, i) => {
      // Place nodes in a soft random circular spread around center
      const angle = (i / nodeMap.size) * Math.PI * 2
      const radius = 100 + Math.random() * 80
      return {
        id: n.id,
        label: n.label,
        x: 400 + Math.cos(angle) * radius,
        y: 300 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        color: getNodeColor(n.label, n.isFolder),
        isFolder: n.isFolder
      }
    })

    const edgesList = Array.from(edgeSet).map(key => {
      const [source, target] = key.split('||')
      return { source, target }
    })

    return { nodes: nodesList, edges: edgesList }
  }, [files, rootPath])

  // Sync raw graph data to animated state
  useEffect(() => {
    setNodes(rawGraph.nodes)
    setEdges(rawGraph.edges)
  }, [rawGraph])

  // 2. Physics Simulation Loop
  useEffect(() => {
    if (nodes.length === 0) return

    let animationFrameId: number
    const friction = 0.82
    const springStrength = 0.05
    const springLength = 55
    const repulsionStrength = 800
    const gravity = 0.02

    function tick() {
      setNodes(prevNodes => {
        if (prevNodes.length === 0) return prevNodes

        // Deep copy nodes to calculate forces
        const nextNodes = prevNodes.map(n => ({ ...n }))
        const nodeIndex = new Map(nextNodes.map(n => [n.id, n]))

        // Repulsion force between ALL pairs
        for (let i = 0; i < nextNodes.length; i++) {
          const nodeA = nextNodes[i]
          for (let j = i + 1; j < nextNodes.length; j++) {
            const nodeB = nextNodes[j]
            const dx = nodeB.x - nodeA.x
            const dy = nodeB.y - nodeA.y
            const distSq = dx * dx + dy * dy + 0.1
            const dist = Math.sqrt(distSq)

            if (dist < 280) {
              const force = repulsionStrength / distSq
              const forceX = (dx / dist) * force
              const forceY = (dy / dist) * force
              
              if (nodeA.id !== draggedNodeId) {
                nodeA.vx -= forceX
                nodeA.vy -= forceY
              }
              if (nodeB.id !== draggedNodeId) {
                nodeB.vx += forceX
                nodeB.vy += forceY
              }
            }
          }
        }

        // Attraction forces between connected nodes
        edges.forEach(edge => {
          const nodeA = nodeIndex.get(edge.source)
          const nodeB = nodeIndex.get(edge.target)
          if (!nodeA || !nodeB) return

          const dx = nodeB.x - nodeA.x
          const dy = nodeB.y - nodeA.y
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.1
          const force = (dist - springLength) * springStrength
          const forceX = (dx / dist) * force
          const forceY = (dy / dist) * force

          if (nodeA.id !== draggedNodeId) {
            nodeA.vx += forceX
            nodeA.vy += forceY
          }
          if (nodeB.id !== draggedNodeId) {
            nodeB.vx -= forceX
            nodeB.vy -= forceY
          }
        })

        // Gentle gravity towards center (400, 300)
        nextNodes.forEach(node => {
          if (node.id === draggedNodeId) return
          node.vx += (400 - node.x) * gravity
          node.vy += (300 - node.y) * gravity

          // Apply friction and update coordinates
          node.vx *= friction
          node.vy *= friction
          node.x += node.vx
          node.y += node.vy
        })

        return nextNodes
      })

      animationFrameId = requestAnimationFrame(tick)
    }

    animationFrameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrameId)
  }, [edges, draggedNodeId, nodes.length])

  // Mouse Interaction: Drag Node
  function handleNodeMouseDown(e: React.MouseEvent, node: Node) {
    e.stopPropagation()
    setDraggedNodeId(node.id)
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (draggedNodeId) {
      // Calculate coordinates inside scale/panned SVG workspace
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      
      const clientX = e.clientX - rect.left
      const clientY = e.clientY - rect.top
      
      // Reverse zoom & pan transform to match actual node coordinate space
      const x = (clientX - pan.x) / zoom
      const y = (clientY - pan.y) / zoom

      setNodes(prev => prev.map(n => n.id === draggedNodeId ? { ...n, x, y, vx: 0, vy: 0 } : n))
    } else if (isPanning) {
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      setPan({ x: panStartRef.current.x + dx, y: panStartRef.current.y + dy })
    }
  }

  function handleMouseUp() {
    setDraggedNodeId(null)
    setIsPanning(false)
  }

  // Panning
  function handleBgMouseDown(e: React.MouseEvent) {
    setIsPanning(true)
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }

  // Zooming
  function handleWheel(e: React.WheelEvent) {
    const delta = e.deltaY < 0 ? 1.1 : 0.9
    const nextZoom = Math.min(4, Math.max(0.2, zoom * delta))
    setZoom(nextZoom)
  }

  if (files.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 12,
      }}>
        Graph builds after files are scanned
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{
        flex: 1, overflow: 'hidden', position: 'relative', outline: 'none',
        cursor: isPanning ? 'grabbing' : draggedNodeId ? 'grabbing' : 'grab',
        background: 'var(--bg-primary)', userSelect: 'none', minHeight: 180
      }}
    >
      {/* Background Pan Handler */}
      <div
        onMouseDown={handleBgMouseDown}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      />

      <svg
        style={{
          width: '100%', height: '100%', position: 'relative', zIndex: 2,
          pointerEvents: 'none'
        }}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {edges.map((edge, index) => {
            const sourceNode = nodes.find(n => n.id === edge.source)
            const targetNode = nodes.find(n => n.id === edge.target)
            if (!sourceNode || !targetNode) return null
            return (
              <line
                key={index}
                x1={sourceNode.x}
                y1={sourceNode.y}
                x2={targetNode.x}
                y2={targetNode.y}
                stroke="var(--border-light)"
                strokeWidth={1.2}
                opacity={0.35}
              />
            )
          })}

          {/* Nodes */}
          {nodes.map(node => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              style={{ pointerEvents: 'auto', cursor: 'grab' }}
              onMouseDown={(e) => handleNodeMouseDown(e, node)}
            >
              <circle
                r={node.isFolder ? 8 : 5}
                fill={node.color}
                stroke="var(--bg-primary)"
                strokeWidth={1.5}
                style={{
                  filter: node.isFolder ? 'drop-shadow(0 0 3px rgba(139,92,246,0.3))' : 'none',
                  transition: 'r 0.15s'
                }}
              />
              <text
                y={node.isFolder ? 16 : 12}
                textAnchor="middle"
                fontSize={8}
                fill={node.isFolder ? 'var(--text-primary)' : 'var(--text-secondary)'}
                fontWeight={node.isFolder ? 600 : 400}
                style={{
                  fontFamily: 'system-ui, sans-serif',
                  paintOrder: 'stroke',
                  stroke: 'var(--bg-primary)',
                  strokeWidth: 2,
                  strokeLinejoin: 'round'
                }}
              >
                {node.label}
              </text>
            </g>
          ))}
        </g>
      </svg>

      {/* Control Buttons & Legend overlays */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8, zIndex: 10,
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 6, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4,
        pointerEvents: 'none', opacity: 0.85
      }}>
        <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>Legend</div>
        {[
          { color: 'var(--accent)', label: 'Folders (Hubs)' },
          { color: '#3dd68c', label: 'React Components' },
          { color: '#3b82f6', label: 'Code Modules' },
          { color: '#eab308', label: 'Stylesheets' },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: item.color }} />
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{item.label}</span>
          </div>
        ))}
      </div>

      <div style={{
        position: 'absolute', top: 8, right: 8, zIndex: 10,
        display: 'flex', gap: 4
      }}>
        <button
          onClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
          style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text-secondary)', padding: '4px 8px',
            fontSize: 10, cursor: 'pointer', fontWeight: 500
          }}
        >
          Reset View
        </button>
      </div>
    </div>
  )
}
