import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

function findMonorepoRoot(startDir: string): string {
  let current = startDir
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(current, 'package.json')
    if (fs.existsSync(pkg)) {
      const content = JSON.parse(fs.readFileSync(pkg, 'utf8'))
      if (content.workspaces) return current   // found root (has workspaces field)
    }
    const parent = path.dirname(current)
    if (parent === current) break              // reached filesystem root
    current = parent
  }
  throw new Error('[MCP] Could not find monorepo root (no package.json with workspaces field found)')
}

const MONOREPO_ROOT = process.env.LOCALFORGE_ROOT ?? findMonorepoRoot(__dirname)
const MCP_FS_BIN    = path.join(MONOREPO_ROOT, 'node_modules/@modelcontextprotocol/server-filesystem/dist/index.js')

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

export interface MCPFile {
  path: string
  content: string
}

const clients: Map<string, Client> = new Map()

export async function connectMCP(projectPath: string): Promise<void> {
  if (clients.has(projectPath)) return

  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true })
    console.log(`[MCP] Created project directory: ${projectPath}`)
  }

  if (!fs.existsSync(MCP_FS_BIN)) {
    throw new Error(`[MCP] server-filesystem binary not found at: ${MCP_FS_BIN}`)
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: [MCP_FS_BIN, projectPath]
  })

  const client = new Client(
    { name: 'localforge', version: '0.1.0' },
    { capabilities: {} }
  )

  await client.connect(transport)
  clients.set(projectPath, client)
  console.log(`[MCP] Connected to filesystem at: ${projectPath}`)
}

export async function disconnectMCP(projectPath?: string): Promise<void> {
  if (projectPath) {
    const client = clients.get(projectPath)
    if (client) {
      await client.close()
      clients.delete(projectPath)
    }
  } else {
    for (const [, client] of clients) {
      await client.close()
    }
    clients.clear()
  }
}

function getClient(projectPath: string): Client {
  const client = clients.get(projectPath)
  if (!client) throw new Error(`[MCP] No client for path: ${projectPath}. Call connectMCP first.`)
  return client
}

export async function listFiles(projectPath: string, dirPath: string): Promise<FileEntry[]> {
  const result = await getClient(projectPath).callTool({
    name: 'list_directory',
    arguments: { path: dirPath }
  })
  return parseDirectoryListing(extractText(result.content))
}

export async function readFile(projectPath: string, filePath: string): Promise<string> {
  const result = await getClient(projectPath).callTool({
    name: 'read_file',
    arguments: { path: filePath }
  })
  return extractText(result.content)
}

export async function writeFile(projectPath: string, filePath: string, content: string): Promise<void> {
  await getClient(projectPath).callTool({
    name: 'write_file',
    arguments: { path: filePath, content }
  })
  console.log(`[MCP] Written: ${filePath}`)
}

export async function createDirectory(projectPath: string, dirPath: string): Promise<void> {
  await getClient(projectPath).callTool({
    name: 'create_directory',
    arguments: { path: dirPath }
  })
}

export async function searchFiles(projectPath: string, pattern: string): Promise<string[]> {
  const result = await getClient(projectPath).callTool({
    name: 'search_files',
    arguments: { path: projectPath, pattern }
  })
  return extractText(result.content).split('\n').map(l => l.trim()).filter(Boolean)
}

export async function readMultipleFiles(projectPath: string, filePaths: string[]): Promise<MCPFile[]> {
  const results: MCPFile[] = []
  for (const filePath of filePaths) {
    try {
      results.push({ path: filePath, content: await readFile(projectPath, filePath) })
    } catch (err) {
      console.warn(`[MCP] Could not read ${filePath}:`, err)
    }
  }
  return results
}

export async function getProjectTree(projectPath: string, maxDepth = 3): Promise<string> {
  const lines: string[] = []
  const IGNORE = new Set(['.git', 'node_modules', 'dist', '.next', 'target', '.localforge'])

  async function walk(dirPath: string, depth: number, prefix: string) {
    if (depth > maxDepth) return
    let entries: FileEntry[]
    try { entries = await listFiles(projectPath, dirPath) } catch { return }

    const filtered = entries.filter(e => !IGNORE.has(e.name))
    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i]
      const isLast = i === filtered.length - 1
      lines.push(`${prefix}${isLast ? '└── ' : '├── '}${entry.name}${entry.type === 'directory' ? '/' : ''}`)
      if (entry.type === 'directory') {
        await walk(entry.path, depth + 1, prefix + (isLast ? '    ' : '│   '))
      }
    }
  }

  lines.push(path.basename(projectPath) + '/')
  await walk(projectPath, 1, '')
  return lines.join('\n')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(content: unknown): string {
  if (Array.isArray(content)) {
    return (content as any[])
      .filter(c => c.type === 'text')
      .map(c => c.text as string)
      .join('\n')
  }
  if (typeof content === 'string') return content
  return JSON.stringify(content)
}

function parseDirectoryListing(text: string): FileEntry[] {
  const entries: FileEntry[] = []
  for (const line of text.split('\n').filter(Boolean)) {
    const t = line.trim()
    if (t.startsWith('[DIR]')) {
      const p = t.replace('[DIR]', '').trim()
      entries.push({ name: path.basename(p), path: p, type: 'directory' })
    } else if (t.startsWith('[FILE]')) {
      const p = t.replace('[FILE]', '').trim()
      entries.push({ name: path.basename(p), path: p, type: 'file' })
    }
  }
  return entries
}
