# LocalForge — Bug Audit

> **Resolution status (all items below are now fixed in code):**
> C1 — agent server bound to loopback only (mobile preview is unaffected; it targets the user's own dev-server port, not :3001).
> H1 — SSE readers buffer partial lines (`useApi`, `CloudClient`, `OllamaClient`). H2 — Ollama decodes with `{stream:true}`.
> H3 — auto-visualize now sends a `replace` event with the full upgraded content; client `replaceStream` re-renders. H4 — `closeProject` disconnects only its own MCP client. H5 — `${provider}` strings fixed.
> M1 — closing a background tab no longer resets the screen. M2 — auto-apply skipped in chat sessions. M3 — agent writes confined to project root. M4 — TaskQueue drains correctly. M5 — `test-api` PUT is a true partial update.
> L1 — title generation trigger relaxed. L2 — CloudClient `done` flag. L3 — git commands run with a cleaned env (`cleanGitEnv`, strips `GIT_DIR`/`GIT_WORK_TREE`/etc.) plus a client fallback that synthesizes the diff from HEAD-vs-current content when git returns empty. L4 — verified not a real double-send after H3. L5 — dead `cloudChat` indirection removed.
> Plus a new feature: a DeepSeek-style chat scroll rail (`ChatNavRail`).
> Verified by `tsc --noEmit` (clean) on both `agent-core` and `desktop`.

---


Review of the real source (excluding `node_modules` / build artifacts): `packages/agent-core/src`, `apps/desktop/src`, `apps/desktop/src-tauri`, and `test-api`. Findings are ordered by severity. File:line references point at the responsible code.

---

## Critical

### C1. Agent server is an unauthenticated remote shell + arbitrary filesystem API on `0.0.0.0`
`packages/agent-core/src/index.ts`

The server binds to all interfaces (`host: '0.0.0.0'`, line 1019) with fully permissive CORS (`origin: () => cb(null, true)`, line 368) and **no authentication on any route**. Exposed to anyone on the LAN:

- `GET/POST/DELETE /project/file`, `/project/file/move`, `/project/file/copy`, `/project/folder` (lines 602–671) take **absolute paths with no validation** → read/write/delete any file on the user's machine.
- `GET /terminal` websocket (line 389) spawns a real PTY shell (`pty.spawn(DEFAULT_SHELL, …)`) → arbitrary command execution.
- `/project/file/extract` reads any file; `/git/direct/*` runs git against any path.

The README markets LAN sharing (QR preview), so the bind is intentional — but the missing auth + unrestricted FS/terminal access is a serious hole. At minimum bind to `127.0.0.1` by default, and require a token (or opt-in) before exposing on the LAN.

---

## High

### H1. SSE stream parser drops chunks — no buffering of partial lines across reads
`apps/desktop/src/hooks/useApi.ts:90-102`, `packages/agent-core/src/cloud/CloudClient.ts:102-119`, `packages/agent-core/src/ollama/OllamaClient.ts:74-93`

All three SSE readers do:
```ts
const lines = decoder.decode(value, { stream: true }).split('\n').filter(l => l.startsWith('data: '))
```
Each `reader.read()` returns an arbitrary byte boundary. When a `data: {…}` line is split across two reads, the first half fails `JSON.parse` (silently swallowed by the empty `catch {}`) and the second half doesn't start with `data: ` so it's filtered out entirely — that token is **lost**. This produces intermittent dropped/garbled characters during streaming.

Fix: keep a `buffer` string across reads, append decoded text, split on `\n`, and retain the trailing incomplete segment for the next iteration. Only parse complete lines.

### H2. `OllamaClient` decodes stream without `{ stream: true }` → corrupted multi-byte characters
`packages/agent-core/src/ollama/OllamaClient.ts:78`

```ts
const lines = decoder.decode(value).split('\n')…   // missing { stream: true }
```
`CloudClient` (line 105) and the client (`useApi.ts:93`) correctly pass `{ stream: true }`; Ollama does not. A UTF‑8 character split across a chunk boundary is decoded as a replacement char (�). Emoji/accented output from local models gets mangled.

### H3. Auto-visualize streams the wrong text and never shows the chart live
`packages/agent-core/src/index.ts:874-879` and `916-917`; `packages/agent-core/src/visualization/AutoVisualizer.ts:14-41`

After streaming, the code computes the upgrade delta as:
```ts
const extra = viz.content.slice(full.length)
if (extra.trim()) send({ chunk: extra })
```
This assumes `autoVisualize` only **appends**. But `upgradeTable` inserts the ```` ```chart ```` block *in the middle* (right after the table). So `viz.content` is not prefixed by `full`, and `slice(full.length)` returns the **trailing prose duplicated**, while the chart block is never streamed. (Verified: for a sample message the client receives `"That concludes the analysis."` again instead of the chart.) The persisted message (`viz.content`) is correct, so the chart only appears after a reload, and the live view shows duplicated text. The graph upgrade (line 96, `result += …`) is append-only and works.

Fix: don't diff by length. Either send a dedicated event with the full upgraded content (replace the rendered message), or compute upgrades up front.

### H4. Closing one project tears down MCP for all open projects
`packages/agent-core/src/orchestrator/Orchestrator.ts:146`

`MCPClient` keeps a per-path `Map<string, Client>` (`MCPClient.ts:55`) and `disconnectMCP(projectPath?)` disconnects only that path when given an argument. But `closeProject` calls `disconnectMCP()` **with no argument** (line 146), whose else-branch closes and clears **every** client. Closing project A drops the filesystem connection for project B too.

Fix: `await disconnectMCP(project.rootPath)` (the `Project` doesn't currently store rootPath in `closeProject`'s scope — fetch it before `this.projects.delete`).

### H5. `${provider}` printed literally to users in error messages
`packages/agent-core/src/index.ts:255` and `:266`

These lines are inside single-quoted array elements, so the placeholder is never interpolated:
```ts
'**Fix:** Go to **Settings → Cloud** → ${provider} → enter a new API key.'   // line 255
'**Fix:** Go to **Settings → Cloud** → ${provider} → select a different model.' // line 266
```
(Verified: the rendered "Invalid API key" message contains the literal text `${provider}`.) Other lines in the same function correctly use backticks. Fix: change both to template literals (backticks).

---

## Medium

### M1. Closing any background tab kicks the user back to the welcome screen
`apps/desktop/src/store/appStore.ts:154-161`

`closeSession` unconditionally sets `activeSessionId: null, screen: 'welcome'`, even when the closed session is **not** the active one. Closing a non-focused tab deactivates the current chat. Fix: only reset `activeSessionId`/`screen` when `id === activeSessionId`.

### M2. Auto-Apply spams native save dialogs in non-project chats
`apps/desktop/src/components/ChatPanel.tsx:419-461`

With Auto-Apply on, the mount effect calls `handleApply` for every proposed patch. In a chat session (`!rootPath`), `handleApply` opens a native Save dialog per patch (line 433). So an assistant reply proposing several files triggers a burst of unprompted save dialogs. Auto-apply should be a no-op (or batch) when there's no project root.

### M3. Agents can write outside the project when `allowedPaths` is empty
`packages/agent-core/src/orchestrator/AgentSession.ts:181-211`; `index.ts:986`

`isPathAllowed` returns `true` whenever `allowedPaths.length === 0` (line 209), and `processResponse` honors absolute paths from the model (`path.isAbsolute(rawPath) ? rawPath : …`, line 181). The `/orchestrate` endpoint creates agents with `allowedPaths: []` (line 986), so an LLM that emits `FILE_WRITTEN: /etc/…` (or any absolute path) is unsandboxed. Fix: default-deny outside `projectPath`, and reject absolute paths that escape the root.

### M4. `TaskQueue` can strand a task enqueued during the final drain
`packages/agent-core/src/orchestrator/TaskQueue.ts:34-68`

`process()` early-returns if `isProcessing`. If a task is `enqueue`d while the outer loop is awaiting the final `Promise.all(running)` (lines 61–63), the new task sits in `queue` but nothing re-invokes `process()` after `isProcessing` flips to `false` — it only runs on the *next* enqueue. Re-check `this.queue.length` after the final await, or loop until both queue and running are empty.

### M5. `test-api` PUT silently un-completes todos when `completed` is omitted
`test-api/src/index.js:38-41, 96-103`

`TodoSchema` has `completed: z.boolean().optional().default(false)`. The PUT handler uses the same schema, so a client updating only the `title` gets `completed` defaulted to `false` and the row is marked incomplete. A partial-update schema (or separate Patch schema) is needed. (This is the sample app, but it's a genuine logic bug.)

---

## Low / Notes

- **L1. Title generation depends on an exact string** — `ChatPanel.tsx:913` only generates a title when `live?.title === 'New chat'`. If sessions are created with any other placeholder, titles never auto-generate.
- **L2. `CloudClient` only marks done on `finish_reason === 'stop'`** (`CloudClient.ts:114`) — other terminal reasons (`length`, `content_filter`, `tool_calls`) won't set `done`. Harmless here since the loop ends on stream close, but the `done` flag is unreliable.
- **L3. Known parked git-diff bug** (`docs/KNOWN_BUGS.md`): worth re-testing now that `getDiff` uses `runFile`/`execFileSync` with `--`. The most likely culprit per the notes is the `-z` porcelain status parser (`GitReader.ts:101-118`) mislabeling a file as staged when index==HEAD, so the UI requests `--cached` (empty). Try the suggested `git -C <root> diff HEAD -- <file>` and compare with/without the `--` path arg.
- **L4. `@web` RAG facts double-counted** — `index.ts:909` streams `rag.extractedFacts` to the client AND seeds `full` with it (line 914); combined with H3's length-diff this compounds. Verify the persisted vs. streamed content match.
- **L5. `AgentSession` dead indirection** — `const { cloudChat: cc } = { cloudChat }` (`AgentSession.ts:37`) is a no-op wrapper; harmless but confusing.

---

## Verified programmatically
- H5 (`${provider}` literal) — reproduced; rendered message contains literal `${provider}`.
- H3 (autoVisualize slice) — reproduced; streamed "extra" is duplicated trailing prose, chart block absent.

## Not exhaustively reviewed
`KnowledgeGraph`, `ContractEnforcer/Extractor`, `SymbolExtractor`, `ProjectScanner`, `Checkpointer`, `TaskLog`, `Journal`, `Database`, `ModelMetrics`, `SystemProfiler`, and several large UI components (`GitPanel`, `DiffEditorPanel`, `FileEditorPanel`, `SettingsModal`, `RightSidebar`) were read only partially or skimmed. The patterns above (esp. the SSE buffering and length-diff streaming) likely recur and are worth a targeted pass.
