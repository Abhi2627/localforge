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
const FUNCTION_RX = /(?:^|\s)(?:f|g|h|y)\s*\(x\)\s*=\s*([^\n,;.\\\[\]()]+)/gim

function extractFunctions(content: string): string[] {
  // Skip if content already has graph blocks or is heavily mathematical (\[ blocks)
  if (content.includes('```graph') || content.includes('```chart')) return []
  // Only extract if the function appears in plain prose (not inside math blocks)
  // Count math blocks — if response has many \[...\] blocks it's already math-rich
  const mathBlockCount = (content.match(/\\\[/g) ?? []).length
  if (mathBlockCount > 2) return []  // already math-rich, don't add graph
  const fns: string[] = []
  let m: RegExpExecArray | null
  while ((m = FUNCTION_RX.exec(content)) !== null) {
    const expr = m[1].trim()
      .replace(/\\\(/g, '').replace(/\\\)/g, '')  // strip inline math wrappers
      .trim()
    // Must look like a real math expression with x and operators
    if (/\bx\b/.test(expr) && /[\^+\-*/]/.test(expr) && expr.length < 60
        && !expr.includes('write') && !expr.includes('return')
        && !expr.startsWith('=')) {
      fns.push(expr)
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

  // 2. Auto-add graph for described functions (only if no graph already)
  if (!alreadyRich && !result.includes('```graph')) {
    const fns = extractFunctions(result)
    if (fns.length > 0) {
      const spec = {
        title:     fns.length === 1 ? `f(x) = ${fns[0]}` : 'Functions',
        functions: fns.map(fn => ({ fn })),
        xDomain:   [-10, 10],
        yDomain:   [-10, 10],
        grid:      true,
      }
      result += `\n\n\`\`\`graph\n${JSON.stringify(spec)}\n\`\`\``
      upgrades.push(`auto-graph: ${fns.join(', ')}`)
    }
  }

  return { content: result, upgraded: upgrades.length > 0, upgrades }
}
