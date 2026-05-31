/**
 * SymbolExtractor.ts
 *
 * Extracts symbols from source files using regex patterns.
 * No AST dependency — works with any Node.js version, offline.
 *
 * Supported languages: TypeScript, JavaScript, Python, Rust
 * Supported symbols: functions, classes, interfaces, types, enums,
 *                    exported constants, React components
 */

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'component'   // React functional component (PascalCase function/const)
  | 'route'       // Express/Fastify route handler

export interface ExtractedSymbol {
  name:     string
  kind:     SymbolKind
  line:     number
  exported: boolean
  file:     string
}

// ── Language-specific patterns ────────────────────────────────────────────────

const TS_JS_PATTERNS: Array<{ re: RegExp; kind: SymbolKind; exported: boolean }> = [
  // export default function Foo / export function foo
  { re: /^export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/m, kind: 'function', exported: true },
  // export const Foo = () => / export const foo = function
  { re: /^export\s+(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/m, kind: 'function', exported: true },
  // export class Foo
  { re: /^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/m, kind: 'class', exported: true },
  // export interface Foo
  { re: /^export\s+interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/m, kind: 'interface', exported: true },
  // export type Foo =
  { re: /^export\s+type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*=/m, kind: 'type', exported: true },
  // export enum Foo
  { re: /^export\s+enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/m, kind: 'enum', exported: true },
  // export const FOO = (non-function)
  { re: /^export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?\s*=\s*(?!(?:async\s+)?(?:\(|[A-Za-z_$][A-Za-z0-9_$]*\s*=>))/m, kind: 'constant', exported: true },
  // non-exported function foo
  { re: /^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/m, kind: 'function', exported: false },
  // non-exported class Foo
  { re: /^(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/m, kind: 'class', exported: false },
  // Express/Fastify route: app.get('/path', ...) or router.post
  { re: /(?:app|router|server)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/m, kind: 'route', exported: false },
]

const PYTHON_PATTERNS: Array<{ re: RegExp; kind: SymbolKind; exported: boolean }> = [
  { re: /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/m, kind: 'function', exported: false },
  { re: /^class\s+([A-Za-z_][A-Za-z0-9_]*)/m,             kind: 'class',    exported: false },
]

const RUST_PATTERNS: Array<{ re: RegExp; kind: SymbolKind; exported: boolean }> = [
  { re: /^pub(?:\s+(?:async\s+)?fn|\s+fn)\s+([A-Za-z_][A-Za-z0-9_]*)/m, kind: 'function', exported: true },
  { re: /^(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/m,                  kind: 'function', exported: false },
  { re: /^pub\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)/m,                      kind: 'class',    exported: true },
  { re: /^pub\s+enum\s+([A-Za-z_][A-Za-z0-9_]*)/m,                        kind: 'enum',     exported: true },
  { re: /^pub\s+trait\s+([A-Za-z_][A-Za-z0-9_]*)/m,                       kind: 'interface',exported: true },
]

function getLang(filePath: string): 'ts' | 'py' | 'rs' | null {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (['ts','tsx','js','jsx'].includes(ext ?? '')) return 'ts'
  if (ext === 'py') return 'py'
  if (ext === 'rs') return 'rs'
  return null
}

export function extractSymbols(filePath: string, source: string): ExtractedSymbol[] {
  const lang = getLang(filePath)
  if (!lang) return []

  const symbols: ExtractedSymbol[] = []
  const lines = source.split('\n')

  // Helper: find 1-based line number of a match
  function lineOf(idx: number): number {
    return source.slice(0, idx).split('\n').length
  }

  const patterns = lang === 'ts' ? TS_JS_PATTERNS
    : lang === 'py' ? PYTHON_PATTERNS
    : RUST_PATTERNS

  if (lang === 'ts') {
    // Process line by line for TS/JS to get accurate line numbers
    lines.forEach((line, i) => {
      const trimmed = line.trim()
      for (const { re, kind, exported } of TS_JS_PATTERNS) {
        // Make pattern work on single line
        const lineRe = new RegExp(re.source.replace(/\^/g, '').replace(/\/m/g, ''))
        const m = trimmed.match(lineRe)
        if (m) {
          let name = m[1]
          // For routes, combine method + path
          if (kind === 'route' && m[2]) name = `${m[1].toUpperCase()} ${m[2]}`

          // Detect React components: exported PascalCase function/const → component
          const effectiveKind: SymbolKind =
            (kind === 'function' || kind === 'constant') &&
            exported &&
            /^[A-Z]/.test(name)
              ? 'component'
              : kind

          // Avoid duplicates on the same line
          if (!symbols.find(s => s.name === name && s.line === i + 1)) {
            symbols.push({ name, kind: effectiveKind, line: i + 1, exported, file: filePath })
          }
          break  // only first match per line
        }
      }
    })
  } else {
    // For Python and Rust, use regex on whole source
    for (const { re, kind, exported } of patterns) {
      const global = new RegExp(re.source, 'gm')
      let m: RegExpExecArray | null
      while ((m = global.exec(source)) !== null) {
        symbols.push({ name: m[1], kind, line: lineOf(m.index), exported, file: filePath })
      }
    }
  }

  // Deduplicate by name+line
  const seen = new Set<string>()
  return symbols.filter(s => {
    const key = `${s.name}:${s.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
