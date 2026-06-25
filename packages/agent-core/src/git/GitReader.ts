import { execSync, execFileSync } from 'child_process'

export interface GitStatus {
  branch:    string
  upstream?: string
  ahead:     number
  behind:    number
  staged:    FileChange[]
  unstaged:  FileChange[]
  untracked: string[]
  isClean:   boolean
}

export interface FileChange {
  status:   'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unmerged'
  file:     string
  oldFile?: string
}

export interface Commit {
  hash:     string
  fullHash: string
  author:   string
  email:    string
  date:     string
  message:  string
  refs:     string[]
}

export interface Branch {
  name:        string
  isCurrent:   boolean
  isRemote:    boolean
  upstream?:   string
  lastCommit?: string
}

export interface DiffLine {
  type:     'context' | 'added' | 'removed'
  content:  string
  oldLine?: number
  newLine?: number
}

export interface DiffHunk {
  header: string
  lines:  DiffLine[]
}

export interface FileDiff {
  file:     string
  oldFile?: string
  status:   string
  hunks:    DiffHunk[]
  isBinary: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Strip inherited git-location env vars. If the server process inherits GIT_DIR /
// GIT_WORK_TREE / GIT_INDEX_FILE etc. (e.g. launched from a git hook, GUI, or an
// editor's integrated terminal), every git command is silently redirected away
// from the project repo — which returns empty diffs for files that clearly have
// changes. This is the root cause of the long-standing "diff view empty for
// staged files" bug. Building a clean env makes git resolve the repo from `cwd`.
export function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  delete env.GIT_OBJECT_DIRECTORY
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES
  delete env.GIT_COMMON_DIR
  delete env.GIT_PREFIX
  delete env.GIT_CEILING_DIRECTORIES
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, {
      cwd, encoding: 'utf8', timeout: 8000, maxBuffer: 1024 * 1024 * 10,
      env: cleanGitEnv(),
    }).trim()
  } catch { return '' }
}

// execFileSync avoids /bin/sh so %(…) git format strings are never mangled.
// `-C cwd` also forces git to resolve the repo from the project dir explicitly.
function runFile(args: string[], cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 * 20,
      env: cleanGitEnv(),
    }).trim()
  } catch { return '' }
}

export function isGitRepo(rootPath: string): boolean {
  return run('git rev-parse --is-inside-work-tree', rootPath) === 'true'
}

function parseStatusChar(char: string): FileChange['status'] {
  switch (char) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'U': return 'unmerged'
    default:  return 'modified'
  }
}

// ── Status ────────────────────────────────────────────────────────────────────

export function getStatus(rootPath: string): GitStatus | null {
  if (!isGitRepo(rootPath)) return null

  const staged: FileChange[] = [], unstaged: FileChange[] = [], untracked: string[] = []
  const raw = run('git status --porcelain=v1 -u -z', rootPath)
  if (!raw) return buildCleanStatus(rootPath)

  const entries = raw.split('\0').filter(Boolean)
  let i = 0
  while (i < entries.length) {
    const entry = entries[i]
    if (entry.length < 3) { i++; continue }
    const X = entry[0], Y = entry[1], file = entry.slice(3)
    if (X === '?' && Y === '?') { untracked.push(file); i++; continue }
    if ((X === 'R' || X === 'C') && i + 1 < entries.length) {
      staged.push({ status: parseStatusChar(X), file, oldFile: entries[i + 1] })
      i += 2; continue
    }
    if (X !== ' ' && X !== '?') staged.push({ status: parseStatusChar(X), file })
    if (Y !== ' ' && Y !== '?') unstaged.push({ status: parseStatusChar(Y), file })
    i++
  }

  const branch   = run('git rev-parse --abbrev-ref HEAD', rootPath) || 'HEAD'
  const tracking = run('git rev-parse --abbrev-ref --symbolic-full-name @{u}', rootPath)
  let upstream: string | undefined, ahead = 0, behind = 0

  if (tracking && !tracking.includes('fatal')) {
    upstream = tracking
    const ab = run(`git rev-list --left-right --count HEAD...${tracking}`, rootPath)
    const [a, b] = ab.split('\t').map(Number)
    ahead = isNaN(a) ? 0 : a; behind = isNaN(b) ? 0 : b
  }

  return { branch, upstream, ahead, behind, staged, unstaged, untracked,
    isClean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0 }
}

function buildCleanStatus(rootPath: string): GitStatus {
  const branch = run('git rev-parse --abbrev-ref HEAD', rootPath) || 'HEAD'
  return { branch, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], isClean: true }
}

// ── Log ───────────────────────────────────────────────────────────────────────

export function getLog(rootPath: string, limit = 50, branch = ''): Commit[] {
  if (!isGitRepo(rootPath)) return []
  const FS = '\x1f', RS = '\x1e'
  const fmt = `%h${FS}%H${FS}%an${FS}%ae${FS}%aI${FS}%D${FS}%s`
  const raw = run(`git log --format="${fmt}${RS}" -n ${limit} ${branch || ''}`, rootPath)
  if (!raw) return []

  return raw.split(RS).filter(Boolean).map(entry => {
    const parts = entry.trim().split(FS)
    const hash  = parts[0]?.trim() ?? ''
    if (!hash) return null
    return {
      hash, fullHash: parts[1]?.trim() ?? '', author: parts[2]?.trim() ?? '',
      email: parts[3]?.trim() ?? '', date: parts[4]?.trim() ?? '',
      message: parts[6]?.trim() ?? '',
      refs: parts[5] ? parts[5].split(', ').map(r => r.trim()).filter(Boolean) : [],
    } satisfies Commit
  }).filter((c): c is Commit => c !== null && c.hash.length > 0)
}

// ── Branches ─────────────────────────────────────────────────────────────────
// Use runFile (execFileSync) for format strings — avoids /bin/sh mangling %(...) 

export function getBranches(rootPath: string): Branch[] {
  if (!isGitRepo(rootPath)) return []
  const branches: Branch[] = []

  const localRaw = runFile(
    ['branch', '-vv', '--format=%(refname:short)|%(objectname:short)|%(upstream:short)|%(HEAD)'],
    rootPath
  )
  for (const line of localRaw.split('\n').filter(Boolean)) {
    const [name, lastCommit, upstream, head] = line.split('|')
    if (!name) continue
    branches.push({
      name: name.trim(), isCurrent: head?.trim() === '*', isRemote: false,
      upstream: upstream?.trim() || undefined, lastCommit: lastCommit?.trim() || undefined,
    })
  }

  const remoteRaw = runFile(
    ['branch', '-r', '--format=%(refname:short)|%(objectname:short)'],
    rootPath
  )
  for (const line of remoteRaw.split('\n').filter(Boolean)) {
    const [name, lastCommit] = line.split('|')
    if (!name || name.includes('->')) continue
    branches.push({ name: name.trim(), isCurrent: false, isRemote: true, lastCommit: lastCommit?.trim() })
  }

  return branches
}

// ── Diff ──────────────────────────────────────────────────────────────────────

export function getDiff(rootPath: string, file?: string, staged = false): FileDiff[] {
  if (!isGitRepo(rootPath)) return []
  const args = ['diff', '--unified=3']
  if (staged) args.push('--cached')
  if (file)   args.push('--', file)
  return parseDiff(runFile(args, rootPath))
}

export function getDiffAll(rootPath: string, file?: string): FileDiff[] {
  if (!isGitRepo(rootPath)) return []
  const args = ['diff', 'HEAD', '--unified=3']
  if (file) args.push('--', file)
  const result = parseDiff(runFile(args, rootPath))
  if (result.length === 0) return getDiff(rootPath, file, false)
  return result
}

export function getCombinedDiff(rootPath: string, file?: string): FileDiff[] {
  if (!isGitRepo(rootPath)) return []
  const args = ['diff', 'HEAD', '--unified=3']
  if (file) args.push('--', file)
  return parseDiff(runFile(args, rootPath))
}

export function getCommitDiff(rootPath: string, hash: string): FileDiff[] {
  if (!isGitRepo(rootPath)) return []
  return parseDiff(runFile(['show', hash, '--unified=3'], rootPath))
}

function parseDiff(raw: string): FileDiff[] {
  if (!raw) return []
  const files: FileDiff[] = []
  let cur: FileDiff | null = null, hunk: DiffHunk | null = null, ol = 0, nl = 0

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (cur) files.push(cur)
      const m = line.match(/diff --git a\/(.+) b\/(.+)/)
      cur = { file: m ? m[2] : '', status: 'modified', hunks: [], isBinary: false }
      hunk = null; continue
    }
    if (!cur) continue
    if (line.startsWith('Binary files'))  { cur.isBinary = true; continue }
    if (line.startsWith('--- a/'))        { cur.oldFile  = line.slice(6); continue }
    if (line.startsWith('+++ b/'))        { cur.file     = line.slice(6); continue }
    if (line.startsWith('new file'))      { cur.status   = 'added'; continue }
    if (line.startsWith('deleted file'))  { cur.status   = 'deleted'; continue }
    if (line.startsWith('rename from'))   { cur.status   = 'renamed'; continue }
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) { ol = parseInt(m[1]); nl = parseInt(m[2]) }
      hunk = { header: line, lines: [] }; cur.hunks.push(hunk); continue
    }
    if (!hunk) continue
    if      (line.startsWith('+')) hunk.lines.push({ type: 'added',   content: line.slice(1), newLine: nl++ })
    else if (line.startsWith('-')) hunk.lines.push({ type: 'removed', content: line.slice(1), oldLine: ol++ })
    else if (line.startsWith(' ')) hunk.lines.push({ type: 'context', content: line.slice(1), oldLine: ol++, newLine: nl++ })
  }

  if (cur) files.push(cur)
  return files.filter(f => f.file && f.file !== '/dev/null')
}
