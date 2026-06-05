# Known Bugs

## 1. Diff view shows empty for certain staged/modified files

**Status:** PARKED — to fix later  
**Symptom:** Clicking `ChatPanel.tsx` (or similar large files) in the git status panel shows "No changes" even though changes clearly exist.

**Root cause confirmed via curl:**
```bash
# Returns full 53KB content ✅
GET /git/direct/file-at-head?...&file=apps/desktop/src/components/ChatPanel.tsx&staged=true

# Returns {"diffs":[]} ❌
GET /git/direct/diff?...&file=apps/desktop/src/components/ChatPanel.tsx&staged=all
```

`git diff HEAD -- apps/desktop/src/components/ChatPanel.tsx` returns empty from the server process even though the same command in terminal shows changes. The server is running with the correct `cwd: rootPath` but something in the child process environment causes `git diff` to silently return nothing for deep nested paths.

**What was tried (all failed):**
- `staged=true` → `git diff --cached` (empty — index == HEAD for this file)
- `staged=false` → `git diff` (empty)
- `staged=all` → `git diff HEAD` (empty)
- Fallback: if staged diff empty, retry with opposite flag (empty either way)
- `execFileSync` with array args instead of `execSync` (same result)
- `:0:filepath` ref for staged content (content fetch works, diff still empty)

**To investigate later:**
1. Add a `/git/direct/debug?file=...` endpoint that prints exact stdout + stderr of the git command
2. Check if `GIT_DIR` or `GIT_WORK_TREE` env vars interfere with the server's child process
3. Try `execFileSync('git', ['-C', rootPath, 'diff', 'HEAD', '--', file])` — the `-C` flag sets cwd inside git itself rather than via the shell
4. Check if the issue is path-specific (only files in `apps/desktop/src/components/` or all nested files)
5. Compare: does `git diff HEAD` (no file arg) return results? If yes, the `--` file arg is the issue

---
