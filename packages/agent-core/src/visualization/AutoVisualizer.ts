// ── Auto-visualization post-processor ────────────────────────────────────────
// Runs AFTER the model responds. Detects patterns in plain text and upgrades
// them to chart/graph/math blocks. Completely model-independent.

export interface VisualizationResult {
  content:    string
  upgraded:   boolean
  upgrades:   string[]
}

// ── Upgrade markdown tables to chart blocks ───────────────────────────────────
function upgradeTable(content: string): string {
  const tableRx = /(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)+)/g
  return content.replace(tableRx, (match) => {
    const lines = match.trim().split('\n').filter(l => l.trim())
    if (lines.length < 3) return match

    const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean)
    const rows    = lines.slice(2).map(l => l.split('|').map(c => c.trim()).filter(Boolean))

    // Only chart if there are numeric columns
    const numericCols = headers.slice(1).filter((_, i) =>
      rows.some(r => r[i + 1] && !isNaN(parseFloat(r[i + 1].replace(/[,%$K]/g, ''))))
    )
    if (numericCols.length === 0) return match

    const xKey = headers[0]
    const data = rows.map(row => {
      const obj: Record<string, any> = { [xKey]: row[0] ?? '' }
      headers.slice(1).forEach((h, i) => {
        const raw = row[i + 1] ?? ''
        const num = parseFloat(raw.replace(/[,%$K]/g, ''))
        obj[h] = isNaN(num) ? raw : num
      })
      return obj
    })

    const spec = { type: 'bar', title: `${xKey} overview`, data, keys: numericCols, xKey }
    // Keep the original table AND add a chart below it
    return `${match}\n\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\`\n`
  })
}

// ── Detect described functions and auto-add a graph block ─────────────────────
// Several phrasings small models use instead of emitting a ```graph``` block.
const FUNCTION_PATTERNS = [
  /(?:^|[\s(])(?:f|g|h|p|q|y)\s*\(\s*x\s*\)\s*=\s*([^\n,;.\\\[\]]+)/gim,   // f(x) = …
  /\by\s*=\s*([^\n,;.\\\[\]]+)/gim,                                        // y = …
  /\bplot(?:\s+the)?(?:\s+function|\s+graph(?:\s+of)?)?\s*:?\s*([^\n,;.\\\[\]]+)/gim, // plot …
  /\bgraph(?:\s+of)?\s*:?\s+([^\n,;.\\\[\]]+)/gim,                         // graph of …
]

// Tools we never want the model to send users to — we render inline instead.
const EXTERNAL_TOOL_RX = /\b(desmos|wolfram\s?alpha|geogebra|symbolab|graphing calculator)\b/i

// Only plot expressions whose ONLY variable is x (plus known math fns/constants).
// Prevents garbage plots from things like "y = m*x + b" (m, b would be read as 0).
const FUNC_RX = /\b(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|sqrt|abs|exp|ln|log10|log2|log|floor|ceil|round|sign|min|max|pow|pi)\b/gi
// Whatever remains after removing known fns/constants, the variable x, Euler's e,
// digits and operators — if anything (a letter) is left, the token isn't pure math.
function nonMathResidue(s: string): string {
  return s.replace(FUNC_RX, '').replace(/[xe]/gi, '').replace(/[0-9.\s+\-*/^(),]/g, '')
}

// Trim a captured string to just its leading mathematical part, dropping trailing
// prose the regex over-captured (e.g. "exp(-x^2) is a Gaussian" → "exp(-x^2)").
function trimToMath(expr: string): string {
  const kept: string[] = []
  for (const tok of expr.split(/\s+/)) {
    if (tok && nonMathResidue(tok) === '') kept.push(tok)
    else break
  }
  return kept.join(' ').trim()
}

function isPlottableFx(expr: string): boolean {
  if (!/x/i.test(expr)) return false                       // must involve x
  if (expr.length < 2 || expr.length > 60) return false
  if (!/[\^+\-*/]/.test(expr) && !FUNC_RX.test(expr)) return false   // must be an actual expression
  if (/\b(write|return|const|let|var|function|import|true|false|null)\b/.test(expr)) return false
  return nonMathResidue(expr) === ''                        // x/e/numbers/ops/known-fns only
}

function cleanExpr(raw: string): string {
  const cleaned = raw
    .replace(/\\\(/g, '').replace(/\\\)/g, '')   // strip inline math wrappers
    .replace(/\\cdot/g, '*').replace(/\\times/g, '*')
    .replace(/`/g, '')                            // strip code ticks
    .replace(/^\*+|\*+$/g, '')                    // strip markdown emphasis (keep internal * for multiply)
    .replace(/\s+/g, ' ')
    .trim()
  return trimToMath(cleaned)
}

function extractFunctions(content: string): string[] {
  // Skip if the model already rendered the visualisation correctly.
  if (content.includes('```graph') || content.includes('```chart')) return []
  // If the response is already math-rich (many \[...\] blocks) don't second-guess it.
  const mathBlockCount = (content.match(/\\\[/g) ?? []).length
  if (mathBlockCount > 3) return []

  const fns: string[] = []
  for (const rx of FUNCTION_PATTERNS) {
    let m: RegExpExecArray | null
    rx.lastIndex = 0
    while ((m = rx.exec(content)) !== null) {
      const expr = cleanExpr(m[1])
      if (isPlottableFx(expr)) fns.push(expr)
    }
  }
  return [...new Set(fns)].slice(0, 4)
}

// ── Main post-processor ───────────────────────────────────────────────────────
export function autoVisualize(content: string): VisualizationResult {
  let result     = content
  const upgrades: string[] = []

  // Skip if already has rich blocks (model did it right)
  const alreadyRich = result.includes('```chart') || result.includes('```graph')

  // 1. Upgrade markdown tables to charts (always — tables are data, data should be charted)
  const afterTable = upgradeTable(result)
  if (afterTable !== result) {
    result = afterTable
    upgrades.push('table→chart')
  }

  // 2. Auto-add graph for described functions (only if no graph already).
  // This is the interceptor for small models that ignore the ```graph``` format
  // and instead describe a function or tell the user to "plot it on Desmos".
  if (!alreadyRich && !result.includes('```graph')) {
    const fns = extractFunctions(result)
    if (fns.length > 0) {
      const spec = {
        title:     fns.length === 1 ? `f(x) = ${fns[0]}` : 'Functions',
        functions: fns.map(fn => ({ fn })),
        xDomain:   [-10, 10],
        // No fixed yDomain — let the renderer auto-scale Y to the function's actual
        // range, otherwise curves like x^2 get clipped to [-10,10] and look wrong.
        grid:      true,
      }
      result += `\n\n\`\`\`graph\n${JSON.stringify(spec)}\n\`\`\``
      // If the model pointed the user at an external grapher, note it's now inline.
      if (EXTERNAL_TOOL_RX.test(result)) {
        result += `\n\n*Rendered inline above — no external graphing tool needed.*`
      }
      upgrades.push(`auto-graph: ${fns.join(', ')}`)
    }
  }

  return { content: result, upgraded: upgrades.length > 0, upgrades }
}
