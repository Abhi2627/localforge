# LocalForge

> Local-first AI coding agent desktop app — multi-agent orchestration, offline inference, and cloud LLM integration. Runs on your machine, scales to the cloud.

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![Status](https://img.shields.io/badge/status-active%20development-orange.svg)

---

## What is LocalForge?

LocalForge is a purpose-built desktop IDE for AI-assisted development. It combines a VSCode-style UI, local Ollama inference, multi-agent task orchestration, and cloud LLM integration into a single offline-capable desktop app.

**Core principles:**
- Local-first: everything works offline with Ollama
- Cloud-optional: plug in Gemini, Claude, OpenAI, or Groq for heavier tasks
- Production-ready: not a demo — ships features agents can actually write and apply to disk

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop app | Tauri 2.0 (Rust) + React + TypeScript |
| Agent server | Fastify + TypeScript |
| Persistence | SQLite via better-sqlite3 |
| Local inference | Ollama (OpenAI-compatible API) |
| Cloud inference | Gemini, Claude, OpenAI, Groq (OpenAI-compatible) |
| Terminal | xterm.js + node-pty |
| MCP | @modelcontextprotocol/sdk |

---

## Getting Started

```bash
git clone https://github.com/Abhi2627/localforge.git
cd localforge
npm install

# Terminal 1 — agent server
cd packages/agent-core && npm run dev

# Terminal 2 — desktop UI
cd apps/desktop && npm run dev
# Open http://localhost:1420
```

**Prerequisites:** Node.js 20+. For local inference: Ollama with at least one model pulled.

**Low RAM?** Pull a smaller model: `ollama pull qwen2.5-coder:1.5b` (1.1 GB, works on 8 GB RAM).

---

## What's Built ✅

### Core Infrastructure
- Tauri 2.0 monorepo (`apps/desktop` + `packages/agent-core`)
- Fastify agent server with full TypeScript
- SQLite session persistence — chats and projects survive restarts
- Ollama client with model fallback chain
- MCP filesystem integration (auto-connects on project open)
- Hardware-aware task scheduler (auto sequential/parallel based on RAM)

### Cloud LLM Integration
- Unified LLM client routing to Ollama or cloud providers transparently
- Supported providers: Gemini Flash, OpenAI GPT-4o, Claude, Groq (free tier), Custom (OpenAI-compatible)
- Settings: API key management, temperature, max tokens, system prompt, context length
- Per-chat model selector in the input bar — only shows providers with saved API keys
- Internet connectivity detection — cloud providers auto-disabled when offline

### Chat Features
- SSE streaming with Markdown rendering (tables, code blocks, lists, headers)
- File attach: click paperclip to inject `.ts`, `.py`, `.md`, `.json`, `.txt` etc. into context
- File chips clickable in chat — opens preview popup (name, size, scrollable content)
- Agent file write + apply: model proposes files using `write:path` syntax, rendered as Apply/Reject cards
  - Deterministic patch IDs — applied state persists across page reloads (localStorage)
  - Fallback parser: detects plain code blocks when model ignores the `write:` format
  - Diff preview with expand chevron before applying
- MCP indicator in project chat title bar (green = connected, blinking red = connecting)
- Project chat grounded in real files: README.md + key config files injected into every message context
- Auto-generated session titles, per-message copy/edit/regenerate
- Export chat as `.txt` (plain text, opens on any OS) via Tauri save dialog with toast notifications
- Scroll-to-bottom button (appears when user scrolls up mid-stream, sits above input bar)

### Right Sidebar (VSCode-style)
- **Row 1:** Project title div (folder name, loading spinner)
- **Row 2:** 4 horizontal icon buttons — each opens a full-screen modal window:
  - **Knowledge Graph** (Network icon): symbol browser with search, kind filter, conflict detection
  - **Project Graph** (Layout icon): interactive component dependency graph
  - **Agents** (Bot icon): agent list with status, running indicator dot, add agent
  - **API Contracts** (Branch icon): frontend call vs backend route matching, violation detection
- **File Explorer:** collapsible, takes full space when only section open, 50/50 split when both open
  - Full VSCode-style file management via right-click context menu:
    - New File, New Folder (inline input, Enter to confirm, Escape to cancel)
    - Rename (inline input replaces filename in-place)
    - Copy, Cut, Paste (clipboard strip shown above tree with ✂/⎘ indicator)
    - Duplicate (auto-increments `_copy`, `_copy1` to avoid conflicts)
    - Copy Path, Copy Relative Path
    - Delete (confirmation dialog, immediately removes from tree)
  - Files applied via chat Apply button appear in tree immediately (CustomEvent bridge)
  - Files deleted from tree are immediately hidden (local `deletedPaths` set, no store rescan needed)
  - File search via magnifier button
- **Source Control:** collapsible git panel
  - Auto-reloads every 3s (no manual refresh button) — detects `git commit`, `git push`, `git add`
  - Staged / Unstaged / Untracked sections with status badges (M/A/D/R)
  - Commit log with relative timestamps, author, ref badges
  - Branch list (local + remote)
  - Click any changed file → opens **side-by-side diff view** in the main editor area
- **Collapsed strip:** 6 icons when sidebar is narrow — 4 open modals directly, 2 expand the sidebar

### Main Editor Area
- `FileEditorPanel`: syntax-highlighted code editor (token-based, no Monaco dependency)
  - Line numbers, copy button, Cmd+S to save, Tab → 2 spaces
  - Supported languages: TS, TSX, JS, JSX, Python, JSON, CSS, SCSS, HTML, Shell, Rust, Go
- `DiffEditorPanel`: VSCode-style side-by-side diff viewer (opens when git file is clicked)
  - Left column = before (red removed lines), Right column = after (green added lines)
  - Both columns scroll in sync, line number gutters, `+`/`-` markers
  - Hunk headers with purple accent, staged/unstaged badge, `+N -N` change count
  - File navigator for multi-file diffs
- File tabs above editor — Chat tab always visible, open files listed with × to close

### Left Bar
- Chats section (collapsible, New Chat button)
- Projects section (collapsible, Open Project button)
- Extensions placeholder
- Collapsed state: all icons expand the sidebar on click with accent hover effect
- Per-session rename and delete with timestamps in context menu
- Deleted sessions blacklisted in localStorage — never reappear after restart

### Welcome Screen
- Vertically centred greeting with username (`Welcome onboard, {name}`)
- New Chat + New Project buttons
- 3 rows of horizontally auto-scrolling feature cards with edge fade masks
- Left bar starts collapsed on launch for full-width welcome view

### Intelligence Layer
- Knowledge Graph: TS/JS/Python/Rust symbol extractor, conflict detection, agent context injection
- API Contract Enforcer: fetch/axios calls vs Express/Fastify routes, violation detection
- Model Advisor: latency/TPS tracking, error log, smart suggestions

### Server File Management API
- `POST /project/file` — create or overwrite a file
- `DELETE /project/file?path=...` — delete file or folder (recursive)
- `POST /project/file/move` — rename or move
- `POST /project/file/copy` — copy file/folder recursively
- `POST /project/folder` — create new folder
- `GET /project/file/exists` — check path existence (used for duplicate naming)
- `GET /mcp/status?path=...` — check MCP connection status
- `POST /mcp/connect` — connect MCP to a project path

### UX & Polish
- RAM error detection: shows actionable in-chat message when Ollama runs out of memory
- Toast notification system: slide-up pill for export status (info/success/error)
- Cut items shown at 40% opacity while on clipboard
- Clipboard indicator strip above file tree with ✂/⎘ and × to clear

---

## Roadmap

### Phase 4 — Completed ✅

| Feature | Status |
|---|---|
| 4B File Attach | ✅ Done |
| 4C Agent file write + apply (with fallback parser) | ✅ Done |
| 4D Ollama model management (in Settings) | ✅ Done |
| 4E Right sidebar redesign (icon buttons + modals) | ✅ Done |
| 4F Export chat as .txt | ✅ Done |
| 4G Settings local/cloud split | ⬜ Pending (new features to add — planned next) |

---

### Phase 5 — Future

#### 5A — Math Rendering
- LaTeX equation rendering via KaTeX (remark-math + rehype-katex)
- Blocked by: KaTeX CSS not loading correctly in Tauri webview; font path resolution issues

#### 5B — Web Search / RAG
- `@web` trigger for live data queries (infrastructure partially built)
- Blocked by: small local models hallucinate regardless of retrieved context
- Fix: use Gemini Flash or GPT-4o-mini for RAG — revisit when cloud providers are stable

#### 5C — Graph Visualization
- Draw charts and graphs from data (chart.js or D3)
- Requires: agent output parsing for structured data

#### 5D — File Output (docx, drive)
- Export responses as Word documents, save to Google Drive
- Requires: docx generation library, OAuth integration

#### 5E — Universal File Reading in Chat
- Accept PDF, DOCX, XLSX, images as chat attachments
- PDF → text via `pdf-parse` / `pdfjs-dist`; DOCX → `mammoth.js`; images → base64 for vision models
- Blocked by: Ollama local models do not support vision; PDF/DOCX parsing requires server-side libraries
- Fix: add `pdf-parse` + `mammoth` to agent-core, add vision routing for cloud providers

#### 5F — Agent Direct-Action Mode (no explanatory prose)
- Small local models (qwen2.5-coder 1.5b/7b) write step-by-step instructions alongside `write:` blocks
- Desired: model outputs ONLY the write block + one-line summary
- Fix path:
  - (a) Use a larger model (≥14b parameters) that reliably follows strict system prompt rules
  - (b) Post-processing: if a `write:` block is present, hide surrounding prose in the UI
  - (c) Fine-tune a small model on agent-action-only datasets
- Blocked by: small local models ignoring system prompt formatting constraints

#### 5G — Agent Auto-Apply Mode
- Option in Settings to auto-apply all `write:` blocks without user confirmation
- Per-session toggle + global default
- Should have a "Review mode" option to show a summary of what was applied

#### 5H — Full-File Diff View
- Currently: diff shows only changed hunks (git unified diff format, ~3 context lines each side)
- Desired: show the complete file on both sides, with changed lines highlighted inline (like Monaco)
- Fix: load full file content separately, apply diff decorations client-side
- Blocked by: no Monaco editor embedded; requires building a custom line-diffing engine or integrating Monaco

---

## Known Limitations

| Limitation | Detail |
|---|---|
| Small model format compliance | `qwen2.5-coder:1.5b/7b` often ignores the `write:path` format and writes instructions instead. The fallback parser handles most cases but is not 100% reliable. Use a ≥14b model or a cloud provider for best results. |
| Git diff shows partial file | The diff view shows only changed regions (standard unified diff format). Full-file side-by-side diff requires Monaco or a custom diffing engine (Phase 5H). |
| PDF/DOCX not supported in file attach | Only plain text and code files can be attached to chat. PDF/DOCX support is Phase 5E. |
| Vision not supported for local models | Image attachments are parsed as filenames only for Ollama models. Vision support requires a cloud provider. |

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
