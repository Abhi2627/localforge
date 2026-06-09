import { useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts'

// ── Chart colour palette (VSCode-adjacent dark theme) ────────────────────────
const PALETTE = [
  '#569cd6','#3dd68c','#f59e0b','#ce9178','#4ec9b0',
  '#d670d6','#f14c4c','#ffd700','#29b8db','#a78bfa',
]

interface ChartSpec {
  type:   'line' | 'bar' | 'pie' | 'area'
  title?: string
  xKey?:  string
  data:   Record<string, any>[]
  keys:   string[]  // data keys to plot (excluding xKey)
}

// ── Parse chart spec from raw string ────────────────────────────────────────
function parseChartSpec(raw: string): ChartSpec | null {
  try {
    const obj = JSON.parse(raw)

    // Explicit chart spec: { type, title, xKey, data }
    if (obj.type && Array.isArray(obj.data) && obj.data.length > 0) {
      const xKey = obj.xKey ?? Object.keys(obj.data[0])[0]
      const keys = obj.keys ?? Object.keys(obj.data[0]).filter(k => k !== xKey && typeof obj.data[0][k] === 'number')
      return { type: obj.type, title: obj.title, xKey, data: obj.data, keys }
    }

    // Plain array of objects — auto-detect
    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
      const firstKeys = Object.keys(obj[0])
      const xKey      = firstKeys[0]
      const numKeys   = firstKeys.filter((k, i) => i > 0 && typeof obj[0][k] === 'number')
      if (numKeys.length === 0) return null
      // Guess type: if keys suggest proportions → pie, else bar
      const type = numKeys.length === 1 && obj.length <= 8 ? 'pie' : 'bar'
      return { type, xKey, data: obj, keys: numKeys }
    }

    return null
  } catch {
    return null
  }
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:'#252526', border:'1px solid #3c3c3c', borderRadius:6, padding:'8px 12px', fontSize:11, boxShadow:'0 4px 12px rgba(0,0,0,0.5)' }}>
      {label != null && <div style={{ color:'#cccccc', marginBottom:4, fontWeight:600 }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color ?? PALETTE[i], display:'flex', gap:8 }}>
          <span>{p.name}:</span>
          <span style={{ fontWeight:600 }}>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Pie custom label ──────────────────────────────────────────────────────────
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  if (percent < 0.05) return null
  const RADIAN = Math.PI / 180
  const r  = innerRadius + (outerRadius - innerRadius) * 0.5
  const x  = cx + r * Math.cos(-midAngle * RADIAN)
  const y  = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

// ── Main chart renderer ───────────────────────────────────────────────────────
interface Props {
  raw:   string   // raw JSON string from the ```chart block
  type?: string   // optional override from block language tag (e.g. "chart:bar")
}

export default function ChartBlock({ raw, type: typeOverride }: Props) {
  const spec = useMemo(() => {
    const parsed = parseChartSpec(raw)
    if (!parsed) return null
    if (typeOverride && ['line','bar','pie','area'].includes(typeOverride)) {
      return { ...parsed, type: typeOverride as ChartSpec['type'] }
    }
    return parsed
  }, [raw, typeOverride])

  if (!spec) {
    // Fallback: show as plain code block
    return (
      <code style={{ display:'block', background:'#1e1e1e', border:'1px solid #3c3c3c', borderRadius:6, padding:'10px 14px', fontSize:12, fontFamily:'monospace', overflowX:'auto', margin:'6px 0', color:'#d4d4d4', lineHeight:1.6 }}>
        {raw}
      </code>
    )
  }

  const { title, data, keys, xKey, type } = spec
  const h = 240  // chart height

  return (
    <div style={{ background:'#1e1e1e', border:'1px solid #3c3c3c', borderRadius:8, padding:'14px 12px', margin:'6px 0', overflow:'hidden' }}>
      {title && (
        <div style={{ fontSize:12, fontWeight:600, color:'#cccccc', marginBottom:10, textAlign:'center', letterSpacing:'0.02em' }}>
          {title}
        </div>
      )}

      {/* LINE CHART */}
      {type === 'line' && (
        <ResponsiveContainer width="100%" height={h}>
          <LineChart data={data} margin={{ top:4, right:16, bottom:4, left:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a"/>
            <XAxis dataKey={xKey} tick={{ fontSize:10, fill:'#858585' }} axisLine={{ stroke:'#3c3c3c' }} tickLine={false}/>
            <YAxis tick={{ fontSize:10, fill:'#858585' }} axisLine={false} tickLine={false} width={40}/>
            <Tooltip content={<DarkTooltip/>}/>
            {keys.length > 1 && <Legend wrapperStyle={{ fontSize:11, color:'#858585' }}/>}
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2} dot={{ r:3, fill:PALETTE[i % PALETTE.length] }} activeDot={{ r:5 }}/>
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* AREA CHART */}
      {type === 'area' && (
        <ResponsiveContainer width="100%" height={h}>
          <AreaChart data={data} margin={{ top:4, right:16, bottom:4, left:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a"/>
            <XAxis dataKey={xKey} tick={{ fontSize:10, fill:'#858585' }} axisLine={{ stroke:'#3c3c3c' }} tickLine={false}/>
            <YAxis tick={{ fontSize:10, fill:'#858585' }} axisLine={false} tickLine={false} width={40}/>
            <Tooltip content={<DarkTooltip/>}/>
            {keys.length > 1 && <Legend wrapperStyle={{ fontSize:11, color:'#858585' }}/>}
            {keys.map((k, i) => (
              <Area key={k} type="monotone" dataKey={k}
                stroke={PALETTE[i % PALETTE.length]}
                fill={`${PALETTE[i % PALETTE.length]}22`}
                strokeWidth={2}/>
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* BAR CHART */}
      {type === 'bar' && (
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={data} margin={{ top:4, right:16, bottom:4, left:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false}/>
            <XAxis dataKey={xKey} tick={{ fontSize:10, fill:'#858585' }} axisLine={{ stroke:'#3c3c3c' }} tickLine={false}/>
            <YAxis tick={{ fontSize:10, fill:'#858585' }} axisLine={false} tickLine={false} width={40}/>
            <Tooltip content={<DarkTooltip/>}/>
            {keys.length > 1 && <Legend wrapperStyle={{ fontSize:11, color:'#858585' }}/>}
            {keys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]}
                radius={[3, 3, 0, 0]} maxBarSize={48}/>
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* PIE CHART */}
      {type === 'pie' && (
        <ResponsiveContainer width="100%" height={h}>
          <PieChart>
            <Pie
              data={data}
              dataKey={keys[0]}
              nameKey={xKey}
              cx="50%" cy="50%"
              outerRadius={90}
              labelLine={false}
              label={PieLabel}
            >
              {data.map((_: any, i: number) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]}/>
              ))}
            </Pie>
            <Tooltip content={<DarkTooltip/>}/>
            <Legend wrapperStyle={{ fontSize:11, color:'#858585' }}/>
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
