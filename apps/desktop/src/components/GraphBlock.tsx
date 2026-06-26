import { useEffect, useRef, useState, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GraphFunction {
  fn:     string
  color?: string
  label?: string
}

export interface GraphParam {
  name:   string
  label?: string
  min:    number
  max:    number
  value:  number
  step?:  number
}

export interface GraphSpec {
  title?:    string
  functions: GraphFunction[]
  params?:   GraphParam[]
  xDomain?:  [number, number]
  yDomain?:  [number, number]
  grid?:     boolean
}

// ── Parser ────────────────────────────────────────────────────────────────────
export function parseGraphSpec(raw: string): GraphSpec | null {
  try {
    const obj = JSON.parse(raw.trim())
    if (typeof obj === 'string') return { functions: [{ fn: obj }] }
    if (Array.isArray(obj))      return { functions: obj.map((f: any) => typeof f === 'string' ? { fn: f } : f) }
    if (obj.fn || obj.functions) return {
      title:     obj.title,
      functions: obj.fn ? [{ fn: obj.fn, color: obj.color, label: obj.label }] : (obj.functions ?? []),
      params:    obj.params,
      xDomain:   obj.xDomain ?? obj.xRange,
      yDomain:   obj.yDomain ?? obj.yRange,
      grid:      obj.grid ?? true,
    }
    return null
  } catch { return null }
}

// ── Colour palette ────────────────────────────────────────────────────────────
const COLORS = ['#569cd6', '#3dd68c', '#f59e0b', '#ce9178', '#d670d6', '#4ec9b0', '#f14c4c', '#ffd700']

// ── Safe expression evaluator ─────────────────────────────────────────────────
// Replaces ^ with ** and common math names, then uses Function()
// Also handles LaTeX-style expressions that models sometimes output
function sanitizeFnExpr(expr: string): string {
  let e = expr
    // Strip LaTeX formatting that leaks into fn expressions
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')   // \frac{a}{b} → (a)/(b)
    .replace(/\\sqrt\{([^}]*)\}/g, 'sqrt($1)')                // \sqrt{x} → sqrt(x)
    .replace(/\\left\(/g, '(').replace(/\\right\)/g, ')')     // \left( → (
    .replace(/\\left\[/g, '[').replace(/\\right\]/g, ']')
    .replace(/\\cdot/g, '*')                                   // \cdot → *
    .replace(/\\times/g, '*')                                  // \times → *
    // Remove \( and \) wrappers (inline math delimiters)
    .replace(/\\\(/g, '').replace(/\\\)/g, '')
    .replace(/\\\[/g, '').replace(/\\\]/g, '')
    // Strip remaining \commands (but NOT ^ which is exponentiation)
    .replace(/\\frac/g, '').replace(/\\sqrt/g, 'sqrt')
    .replace(/\\[a-zA-Z]+/g, '')                               // remove remaining \commands
    // Remove subscripts: x_{0} → x, x_i → x
    .replace(/_\{[^}]*\}/g, '').replace(/_[a-z0-9]/g, '')
    // { } → ( ) for grouping
    .replace(/\{/g, '(').replace(/\}/g, ')')
    // Clean up empty parens left by stripping
    .replace(/\(\)/g, '')
  return e
}

function buildEvaluator(expr: string, paramNames: string[]): ((vars: Record<string, number>) => number) | null {
  try {
    let e = sanitizeFnExpr(expr)
      .replace(/\^/g, '**')
      .replace(/\bsin\b/g, 'Math.sin')
      .replace(/\bcos\b/g, 'Math.cos')
      .replace(/\btan\b/g, 'Math.tan')
      .replace(/\basin\b/g, 'Math.asin')
      .replace(/\bacos\b/g, 'Math.acos')
      .replace(/\batan\b/g, 'Math.atan')
      .replace(/\batan2\b/g, 'Math.atan2')
      .replace(/\bsinh\b/g, 'Math.sinh')
      .replace(/\bcosh\b/g, 'Math.cosh')
      .replace(/\btanh\b/g, 'Math.tanh')
      .replace(/\bsqrt\b/g, 'Math.sqrt')
      .replace(/\babs\b/g, 'Math.abs')
      .replace(/\bexp\b/g, 'Math.exp')
      .replace(/\bln\b/g, 'Math.log')
      .replace(/\blog10\b/g, 'Math.log10')
      .replace(/\blog2\b/g, 'Math.log2')
      .replace(/\blog\b/g, 'Math.log10')
      .replace(/\bfloor\b/g, 'Math.floor')
      .replace(/\bceil\b/g, 'Math.ceil')
      .replace(/\bround\b/g, 'Math.round')
      .replace(/\bsign\b/g, 'Math.sign')
      .replace(/\bmax\b/g, 'Math.max')
      .replace(/\bmin\b/g, 'Math.min')
      .replace(/\bpow\b/g, 'Math.pow')
      .replace(/\bpi\b/g, 'Math.PI')
      .replace(/\bPI\b/g, 'Math.PI')
      .replace(/\be\b/g, 'Math.E')
      // Handle implicit multiplication: 2x → 2*x, 2(x) → 2*(x)
      .replace(/(\d)([a-zA-Z(])/g, '$1*$2')
      .replace(/([a-zA-Z])(\()/g, '$1$2')  // don't double-add * before Math.xxx
    const args = ['x', ...paramNames].join(', ')
    // eslint-disable-next-line no-new-func
    const fn = new Function(args, `"use strict"; try { const result = (${e}); return (typeof result === 'number' && isFinite(result)) ? result : NaN; } catch { return NaN; }`)
    return (vars: Record<string, number>) => {
      const xVal = vars['x'] ?? 0
      const pVals = paramNames.map(n => vars[n] ?? 0)
      try {
        const result = fn(xVal, ...pVals)
        return typeof result === 'number' && isFinite(result) ? result : NaN
      } catch { return NaN }
    }
  } catch { return null }
}

// Compute the initial view. If yDomain isn't given, auto-scale Y by sampling the
// functions across the x-domain — otherwise everything is clamped to [-10,10] and
// curves like x^2 (0→100) render clipped and "wrong".
function computeInitialView(spec: GraphSpec, params: Record<string, number>) {
  const xMin = spec.xDomain?.[0] ?? -10
  const xMax = spec.xDomain?.[1] ?? 10
  if (spec.yDomain) return { xMin, xMax, yMin: spec.yDomain[0], yMax: spec.yDomain[1] }

  const paramNames = (spec.params ?? []).map(p => p.name)
  let lo = Infinity, hi = -Infinity
  for (const f of spec.functions ?? []) {
    const ev = buildEvaluator(f.fn, paramNames); if (!ev) continue
    for (let i = 0; i <= 240; i++) {
      const x = xMin + (i / 240) * (xMax - xMin)
      const y = ev({ ...params, x })
      if (Number.isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { xMin, xMax, yMin: -10, yMax: 10 }
  if (lo === hi) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.12 || 1
  return { xMin, xMax, yMin: lo - pad, yMax: hi + pad }
}

// ── Canvas graph renderer ─────────────────────────────────────────────────────
interface CanvasGraphProps {
  spec:    GraphSpec
  params:  Record<string, number>
  width:   number
  height:  number
}

function CanvasGraph({ spec, params, width, height }: CanvasGraphProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null)
  const [view, setView]   = useState(() => computeInitialView(spec, params))
  const dragRef   = useRef<{ startX: number; startY: number; view: typeof view } | null>(null)

  const PAD = 40  // padding for axes labels

  // World → canvas
  const toCanvas = useCallback((wx: number, wy: number, v: typeof view) => ({
    cx: PAD + (wx - v.xMin) / (v.xMax - v.xMin) * (width - PAD * 2),
    cy: height - PAD - (wy - v.yMin) / (v.yMax - v.yMin) * (height - PAD * 2),
  }), [width, height])

  // Canvas → world
  const toWorld = useCallback((cx: number, cy: number, v: typeof view) => ({
    wx: v.xMin + (cx - PAD) / (width - PAD * 2) * (v.xMax - v.xMin),
    wy: v.yMin + (1 - (cy - PAD) / (height - PAD * 2)) * (v.yMax - v.yMin),
  }), [width, height])

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#1e1e1e'
    ctx.fillRect(0, 0, width, height)

    const v = view
    const paramNames = (spec.params ?? []).map(p => p.name)

    // Grid
    if (spec.grid !== false) {
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1
      // Vertical grid lines
      const xStep = niceStep(v.xMax - v.xMin)
      for (let gx = Math.ceil(v.xMin / xStep) * xStep; gx <= v.xMax; gx += xStep) {
        const { cx } = toCanvas(gx, 0, v)
        ctx.beginPath(); ctx.moveTo(cx, PAD); ctx.lineTo(cx, height - PAD); ctx.stroke()
      }
      // Horizontal grid lines
      const yStep = niceStep(v.yMax - v.yMin)
      for (let gy = Math.ceil(v.yMin / yStep) * yStep; gy <= v.yMax; gy += yStep) {
        const { cy } = toCanvas(0, gy, v)
        ctx.beginPath(); ctx.moveTo(PAD, cy); ctx.lineTo(width - PAD, cy); ctx.stroke()
      }
    }

    // Axes
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5
    // X-axis
    const { cy: axisY } = toCanvas(0, 0, v)
    const clampedAxisY  = Math.max(PAD, Math.min(height - PAD, axisY))
    ctx.beginPath(); ctx.moveTo(PAD, clampedAxisY); ctx.lineTo(width - PAD, clampedAxisY); ctx.stroke()
    // Y-axis
    const { cx: axisX } = toCanvas(0, 0, v)
    const clampedAxisX  = Math.max(PAD, Math.min(width - PAD, axisX))
    ctx.beginPath(); ctx.moveTo(clampedAxisX, PAD); ctx.lineTo(clampedAxisX, height - PAD); ctx.stroke()

    // Axis labels
    ctx.fillStyle = '#858585'; ctx.font = '10px monospace'; ctx.textAlign = 'center'
    const xStep2 = niceStep(v.xMax - v.xMin)
    for (let gx = Math.ceil(v.xMin / xStep2) * xStep2; gx <= v.xMax; gx += xStep2) {
      if (Math.abs(gx) < xStep2 * 0.01) continue
      const { cx } = toCanvas(gx, 0, v)
      ctx.fillText(fmtNum(gx), cx, Math.min(height - PAD + 14, clampedAxisY + 14))
    }
    ctx.textAlign = 'right'
    const yStep2 = niceStep(v.yMax - v.yMin)
    for (let gy = Math.ceil(v.yMin / yStep2) * yStep2; gy <= v.yMax; gy += yStep2) {
      if (Math.abs(gy) < yStep2 * 0.01) continue
      const { cy } = toCanvas(0, gy, v)
      ctx.fillText(fmtNum(gy), Math.max(PAD - 4, clampedAxisX - 4), cy + 3)
    }

    // Plot each function
    const steps = width * 2
    let anyPlotted = false
    ;(spec.functions ?? []).forEach((f, fi) => {
      const evaluator = buildEvaluator(f.fn, paramNames)
      if (!evaluator) {
        console.warn('[GraphBlock] Failed to build evaluator for:', f.fn)
        return
      }
      const allParams = { ...params }
      ctx.strokeStyle = f.color ?? COLORS[fi % COLORS.length]
      ctx.lineWidth   = 2
      ctx.beginPath()
      let started = false
      for (let s = 0; s <= steps; s++) {
        const wx = v.xMin + (s / steps) * (v.xMax - v.xMin)
        allParams['x'] = wx
        const wy = evaluator(allParams)
        if (isNaN(wy) || !isFinite(wy)) { started = false; continue }
        const { cx, cy } = toCanvas(wx, wy, v)
        if (!started) { ctx.moveTo(cx, cy); started = true } else ctx.lineTo(cx, cy)
      }
      ctx.stroke()
      anyPlotted = true
    })

    // If nothing was plotted, show a helpful error message on the canvas
    if (!anyPlotted && spec.functions.length > 0) {
      ctx.fillStyle = '#555'
      ctx.font = '12px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Could not evaluate: ' + (spec.functions[0]?.fn ?? '').slice(0, 50), width / 2, height / 2 - 10)
      ctx.font = '10px monospace'
      ctx.fillStyle = '#444'
      ctx.fillText('Check that all variables are defined as parameters', width / 2, height / 2 + 10)
    }

    // Crosshair + tooltip at mouse position
    if (mouse) {
      const { wx, wy: _ } = toWorld(mouse.x, mouse.y, v)
      const { cx: mcx, cy: mcy } = toCanvas(wx, _, v)
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(mcx, PAD); ctx.lineTo(mcx, height - PAD); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(PAD, mcy); ctx.lineTo(width - PAD, mcy); ctx.stroke()
      ctx.setLineDash([])
      // Dots on each function at x = wx
      ;(spec.functions ?? []).forEach((f, dotIdx) => {
        const evaluator = buildEvaluator(f.fn, (spec.params ?? []).map(p => p.name))
        if (!evaluator) return
        const allParams = { ...params, x: wx }
        const wy2 = evaluator(allParams)
        if (isNaN(wy2)) return
        const { cx: dx, cy: dy } = toCanvas(wx, wy2, v)
        if (dy < PAD || dy > height - PAD) return
        ctx.beginPath()
        ctx.arc(dx, dy, 4, 0, Math.PI * 2)
        ctx.fillStyle = f.color ?? COLORS[dotIdx % COLORS.length]
        ctx.fill()
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
      })
      // Tooltip
      const lines = [`x = ${wx.toFixed(3)}`]
      ;(spec.functions ?? []).forEach((f) => {
        const evaluator = buildEvaluator(f.fn, (spec.params ?? []).map(p => p.name))
        if (!evaluator) return
        const wy2 = evaluator({ ...params, x: wx })
        if (!isNaN(wy2)) lines.push(`${f.label ?? f.fn.slice(0,14)} = ${wy2.toFixed(3)}`)
      })
      const tw = Math.max(...lines.map(l => l.length)) * 6.5 + 16
      const th = lines.length * 16 + 10
      let tx = mouse.x + 12, ty = mouse.y - th / 2
      if (tx + tw > width - 4) tx = mouse.x - tw - 12
      if (ty < 4) ty = 4
      if (ty + th > height - 4) ty = height - th - 4
      ctx.fillStyle = 'rgba(30,30,30,0.92)'; ctx.strokeStyle = '#555'; ctx.lineWidth = 1
      roundRect(ctx, tx, ty, tw, th, 5)
      ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#cccccc'; ctx.font = '11px monospace'; ctx.textAlign = 'left'
      lines.forEach((l, li) => ctx.fillText(l, tx + 8, ty + 14 + li * 16))
    }
  }, [spec, params, view, mouse, width, height, toCanvas, toWorld])

  // Mouse events — drag to pan
  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, view: { ...view } }
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    const sv = dragRef.current.view
    const xRange = sv.xMax - sv.xMin
    const yRange = sv.yMax - sv.yMin
    const dWx = -dx / (width - PAD * 2) * xRange
    const dWy =  dy / (height - PAD * 2) * yRange
    setView({ xMin: sv.xMin + dWx, xMax: sv.xMax + dWx, yMin: sv.yMin + dWy, yMax: sv.yMax + dWy })
  }
  function onMouseUp() { dragRef.current = null }
  function onMouseLeave() { setMouse(null); dragRef.current = null }

  // Scroll to zoom
  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.12 : 0.88
    const rect   = e.currentTarget.getBoundingClientRect()
    const mx     = e.clientX - rect.left
    const my     = e.clientY - rect.top
    const { wx, wy } = toWorld(mx, my, view)
    setView(v => ({
      xMin: wx + (v.xMin - wx) * factor,
      xMax: wx + (v.xMax - wx) * factor,
      yMin: wy + (v.yMin - wy) * factor,
      yMax: wy + (v.yMax - wy) * factor,
    }))
  }

  // Reset view (re-runs the same auto Y-scaling used on mount)
  function resetView() {
    setView(computeInitialView(spec, params))
  }

  return (
    <div style={{ position:'relative' }}>
      <canvas ref={canvasRef} width={width} height={height}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseLeave}
        onWheel={onWheel}
        style={{ display:'block', cursor: dragRef.current ? 'grabbing' : 'crosshair', width:'100%', height }}
      />
      <button onClick={resetView}
        title="Reset view"
        style={{ position:'absolute', top:8, right:8, background:'rgba(30,30,30,0.85)', border:'1px solid #555', borderRadius:5, color:'#cccccc', fontSize:11, padding:'3px 8px', cursor:'pointer' }}>
        Reset
      </button>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function niceStep(range: number): number {
  const raw  = range / 8
  const exp  = Math.floor(Math.log10(raw))
  const frac = raw / Math.pow(10, exp)
  const nice = frac < 1.5 ? 1 : frac < 3.5 ? 2 : frac < 7.5 ? 5 : 10
  return nice * Math.pow(10, exp)
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 10000 || (Math.abs(n) < 0.01 && n !== 0)) return n.toExponential(1)
  return parseFloat(n.toPrecision(4)).toString()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ── Main GraphBlock component ─────────────────────────────────────────────────
interface Props { raw: string; spec?: GraphSpec }

export default function GraphBlock({ raw, spec: specProp }: Props) {
  const spec = specProp ?? parseGraphSpec(raw)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(520)
  const [params, setParams] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    spec?.params?.forEach(p => { init[p.name] = p.value })
    return init
  })

  useEffect(() => {
    const el = containerRef.current; if (!el) return
    const ro = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width || 520)
    })
    ro.observe(el)
    setWidth(el.clientWidth || 520)
    return () => ro.disconnect()
  }, [])

  if (!spec) {
    return (
      <div style={{ background:'#252526', border:'1px solid #3c3c3c', borderRadius:6, padding:'10px 14px', margin:'6px 0' }}>
        <code style={{ fontSize:11, color:'#ce9178', fontFamily:'monospace' }}>Invalid graph: {raw.slice(0,80)}</code>
      </div>
    )
  }

  const HEIGHT = 320

  return (
    <div ref={containerRef} style={{ background:'#1e1e1e', border:'1px solid #3c3c3c', borderRadius:8, margin:'8px 0', overflow:'hidden' }}>
      {/* Header */}
      {spec.title && (
        <div style={{ padding:'6px 14px', borderBottom:'1px solid #3c3c3c', background:'#252526', fontSize:12, fontWeight:600, color:'#cccccc' }}>
          📈 {spec.title}
        </div>
      )}

      {/* Canvas */}
      <CanvasGraph spec={spec} params={params} width={width} height={HEIGHT}/>

      {/* Usage hint */}
      <div style={{ padding:'4px 10px', background:'#252526', borderTop:'1px solid #2a2a2a', fontSize:10, color:'#555', display:'flex', gap:12 }}>
        <span>🖱 drag to pan</span>
        <span>⚲ scroll to zoom</span>
        <span>crosshair = x/y values</span>
      </div>

      {/* Parameter sliders */}
      {spec.params && spec.params.length > 0 && (
        <div style={{ padding:'10px 14px', borderTop:'1px solid #3c3c3c', background:'#252526', display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#858585', textTransform:'uppercase', letterSpacing:'0.05em' }}>
            Parameters — real-time
          </div>
          {spec.params.map(p => (
            <div key={p.name} style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:110, flexShrink:0 }}>
                <code style={{ fontSize:12, color:'#569cd6', fontFamily:'monospace', fontWeight:600 }}>{p.name}</code>
                {p.label && <span style={{ fontSize:10, color:'#858585', marginLeft:5 }}>{p.label}</span>}
              </div>
              <input type="range"
                min={p.min} max={p.max}
                step={p.step ?? (p.max - p.min) / 200}
                value={params[p.name] ?? p.value}
                onChange={e => setParams(prev => ({ ...prev, [p.name]: parseFloat(e.target.value) }))}
                style={{ flex:1, accentColor:'#569cd6', cursor:'pointer', height:4 }}
              />
              <code style={{ width:52, textAlign:'right', fontSize:12, color:'#d4d4d4', fontFamily:'monospace', flexShrink:0 }}>
                {(params[p.name] ?? p.value).toFixed(2)}
              </code>
            </div>
          ))}
        </div>
      )}

      {/* Function legend */}
      {spec.functions.length > 0 && (
        <div style={{ padding:'6px 14px 8px', borderTop:'1px solid #2a2a2a', display:'flex', gap:12, flexWrap:'wrap' }}>
          {spec.functions.map((f, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#858585' }}>
              <div style={{ width:16, height:2, background: f.color ?? COLORS[i % COLORS.length], borderRadius:1 }}/>
              <code style={{ fontFamily:'monospace', fontSize:11, color:'#cccccc' }}>
                y = {f.fn}{f.label ? ` (${f.label})` : ''}
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
