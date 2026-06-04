/**
 * GitReader.ts
 *
 * Reads git state by shelling out to the system `git` CLI.
 * No npm dependencies. All operations are read-only — nothing mutates the repo.
 */

import { execSync } from 'child_process'

// ── Types ─────────────────────────────────────────────────────────────────────

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
  name:       string
  isCurrent:  boolean
  isRemote:   boolean
  upstream?:  string
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

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, {
      cwd,
      encoding:  'utf8',
      timeout:   8000,
      maxBuffer: 1024 * 1024 * 10,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim()
  } catch {
    return ''
  }
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
// Uses -z (NUL-terminated output) so filenames with spaces are never mangled.
// Format: XY<space>filename<NUL>  —  renames: XY<space>newname<NUL>oldname<NUL>

export function getStatus(rootPath: string): GitStatus | null {
  if (!isGitRepo(rootPath)) return null

  const staged:    FileChange[] = []
  const unstaged:  FileChange[] = []
  const untracked: string[]     = []

  const raw = run('git status --porcelain=v1 -u -z', rootPath)
  if (!raw) return buildCleanStatus(rootPath)

  // Split on NUL — each token is one porcelain entry
  const entries = raw.split('\0').filter(Boolean)
  let i = 0
  while (i < entries.length) {
    const entry = entries[i]
    if (entry.length < 3) { i++; continue }

    const X    = entry[0]   // index (staged) status char
    const Y    = entry[1]   // worktree (unstaged) status char
    const file = entry.slice(3)  // col 0-1 = XY, col 2 = space, col 3+ = filename

    if (X === '?' && Y === '?') {
      untracked.push(file)
      i++; continue
    }

    if ((X === 'R' || X === 'C') && i + 1 < entries.length) {
      // Rename/copy: next NUL-token is the original filename
      const oldFile = entries[i + 1]
      staged.push({ status: parseStatusChar(X), file, oldFile })
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
    ahead  = isNaN(a) ? 0 : a
    behind = isNaN(b) ? 0 : b
  }

  return { branch, upstream, ahead, behind, staged, unstaged, untracked,
    isClean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0 }
}

function buildCleanStatus(rootPath: string): GitStatus {
  const branch = run('git rev-parse --abbrev-ref HEAD', rootPath) || 'HEAD'
  return { branch, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], isClean: true }
}

// ── Log ───────────────────────────────────────────────────────────────────────
// Uses ASCII unit-separator (0x1f) and record-separator (0x1e) instead of NUL bytes.
// NUL bytes in the format string cause Node's execSync to throw — that's why log
// was always returning [].

export function getLog(rootPath: string, limit = 50, branch = ''): Commit[] {
  if (!isGitRepo(rootPath)) return []

  // 0x1f = ASCII Unit Separator, 0x1e = ASCII Record Separator
  // These never appear in commit metadata and are safe to pass through the shell.
  const FS  = '\x1f'
  const RS  = '\x1e'
  const fmt = `%h${FS}%H${FS}%an${FS}%ae${FS}%aI${FS}%D${FS}%s`
  const ref = branch || ''
  const raw = run(`git log --format="${fmt}${RS}" -n ${limit} ${ref}`, rootPath)
  if (!raw) return []

  return raw
    .split(RS)
    .filter(Boolean)
    .map(entry => {
      const parts   = entry.trim().split(FS)
      const hash    = parts[0]?.trim() ?? ''
      if (!hash) return null
      return {
        hash,
        fullHash: parts[1]?.trim() ?? '',
        author:   parts[2]?.trim() ?? '',
        email:    parts[3]?.trim() ?? '',
        date:     parts[4]?.trim() ?? '',
        message:  parts[6]?.trim() ?? '',
        refs:     parts[5] ? parts[5].split(', ').map(r => r.trim()).filter(Boolean) : [],
      } satisfies Commit
    })
    .filter((c): c is Commit => c !== null && c.hash.length > 0)
}

// ── Branches ──────────────────────────────────────────────────────────────────

export function getBranches(rootPath: string): Branch[] {
  if (!isGitRepo(rootPath)) return []
  const branches: Branch[] = []

  const localRaw = run('git branch -vv --format=%(refname:short)|%(objectname:short)|%(upstream:short)|%(HEAD)', rootPath)
  for (const line of localRaw.split('\n').filter(Boolean)) {
    const [name, lastCommit, upstream, head] = line.split('|')
    if (!name) continue
    branches.push({ name: name.trim(), isCurrent: head === '*', isRemote: false, upstream: upstream || undefined, lastCommit: lastCommit || undefined })
  }

  const remoteRaw = run('git branch -r --format=%(refname:short)|%(objectname:short)', rootPath)
  for (const line of remoteRaw.split('\n').filter(Boolean)) {
    const [name, lastCommit] = line.split('|')
    if (!name || name.includes('->')) continue
    branches.push({ name: name.trim(), isCurrent: false, isRemote: true, lastCommit })
  }

  return branches
}

// ── Diff ──────────────────────────────────────────────────────────────────────

export function getDiff(rootPath: string, file?: string, staged = false): FileDiff[] {
  if (!isGitRepo(rootPath)) return []
  const stagedFlag = staged ? '--cached' : ''
  const fileArg    = file   ? `-- "${file}"` : ''
  return parseDiff(run(`git diff ${stagedFlag} --unified=3 ${fileArg}`, rootPath))
}

export function getCommitDiff(rootPath: string, hash: string): FileDiff[] {
  if (!isGitRepo(rootPath)) return []
  return parseDiff(run(`git show ${hash} --unified=3`, rootPath))
}

function parseDiff(raw: string): FileDiff[] {
  if (!raw) return []
  const files: FileDiff[] = []
  let cur: FileDiff | null = null
  let hunk: DiffHunk | null = null
  let ol = 0, nl = 0

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (cur) files.push(cur)
      const m = line.match(/diff --git a\/(.+) b\/(.+)/)
      cur = { file: m ? m[2] : '', status: 'modified', hunks: [], isBinary: false }
      hunk = null; continue
    }
    if (!cur) continue
    if (line.startsWith('Binary files'))     { cur.isBinary = true; continue }
    if (line.startsWith('--- a/'))           { cur.oldFile  = line.slice(6); continue }
    if (line.startsWith('+++ b/'))           { cur.file     = line.slice(6); continue }
    if (line.startsWith('new file'))         { cur.status   = 'added'; continue }
    if (line.startsWith('deleted file'))     { cur.status   = 'deleted'; continue }
    if (line.startsWith('rename from'))      { cur.status   = 'renamed'; continue }
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) { ol = parseInt(m[1]); nl = parseInt(m[2]) }
      hunk = { header: line, lines: [] }
      cur.hunks.push(hunk); continue
    }
    if (!hunk) continue
    if      (line.startsWith('+')) hunk.lines.push({ type: 'added',   content: line.slice(1), newLine: nl++ })
    else if (line.startsWith('-')) hunk.lines.push({ type: 'removed', content: line.slice(1), oldLine: ol++ })
    else if (line.startsWith(' ')) hunk.lines.push({ type: 'context', content: line.slice(1), oldLine: ol++, newLine: nl++ })
  }

  if (cur) files.push(cur)
  return files.filter(f => f.file && f.file !== '/dev/null')
}
