# LocalForge

> Local-first AI coding agent desktop app — multi-agent orchestration, offline inference, and cloud LLM integration. Runs on your machine, scales to the cloud.

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![Status](https://img.shields.io/badge/status-active%20development-orange.svg)

---

## What is LocalForge?

LocalForge is a purpose-built desktop IDE for AI-assisted development. It combines a VSCode-style UI, local Ollama inference, multi-agent task orchestration, and cloud LLM integration into a single offline-capable desktop app.

**Core design goal:** Users should never feel lost. Every feature is modelled after VSCode so the interface is immediately familiar — no learning curve on top of the AI learning curve.

**Core principles:**
- Local-first: everything works offline with Ollama
- Cloud-optional: plug in Gemini, Claude, OpenAI, or Groq for heavier tasks
- Production-ready: not a demo — ships features agents can actually write and apply to disk
- Familiar: VSCode-style UI, keybindings, git panel, diff view, minimap, terminal

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
- **Settings — Local tab:** System info panel (platform, CPU, RAM bar green/amber/red, Ollama version + status dot)
- **Settings — Cloud tab:** Per-provider rate limit info (e.g. "Groq free: 30 RPM / 6K TPM"), API key save/test/delete, model selector
- **Ollama removed from cloud providers** — lives only in Local tab
- Per-chat model selector in the input bar — only shows providers with saved API keys
- Internet connectivity detection — cloud providers auto-disabled when offline
- **Rate limit / quota error classifier** — when any provider returns 429, quota exceeded, invalid key, OOM, or context-length errors, the model sends a provider-specific actionable message in chat with exact limits and immediate fix options

### Chat Features
- SSE streaming with Markdown rendering (tables, code blocks, lists, headers)
- File attach: click paperclip to inject `.ts`, `.py`, `.md`, `.json`, `.txt` etc. into context
- File chips clickable in chat — opens preview popup (name, size, scrollable content)
- Agent file write + apply: model proposes files using `write:path` syntax, rendered as Apply/Reject cards
  - Deterministic patch IDs — applied state persists across page reloads (localStorage)
  - Fallback parser: detects plain code blocks when model ignores the `write:` format
  - Applied files appear in file tree immediately via `localforge:file-applied` CustomEvent
- MCP indicator in project chat title bar (green = connected, blinking red = connecting)
- Project chat grounded in real files: README.md + key config files injected into every message context
- Auto-generated session titles, per-message copy/edit/regenerate
- Export chat as `.txt` via Tauri save dialog with toast notifications
- Scroll-to-bottom button (appears when user scrolls up mid-stream)

### Right Sidebar (VSCode-style)
- **Row 1:** Project title, loading spinner
- **Row 2:** 4 icon buttons → full-screen modals: Knowledge Graph, Project Graph, Agents, API Contracts
- **File Explorer:**
  - **Permanent search bar** — always visible at top, clear button, filters tree in real time
  - Full VSCode-style right-click context menu: New File, New Folder, Rename (inline), Copy, Cut, Paste, Duplicate, Copy Path, Copy Rel. Path, Delete
  - Clipboard strip above tree (✂/⎘ indicator, × to clear, cut items at 40% opacity)
  - Files from chat Apply appear immediately; deleted files vanish immediately (no rescan)
- **Source Control (Git panel):**
  - Single **CHANGES (N)** section — staged (green dot) + unstaged (amber dot) merged, just like VSCode
  - Untracked files in separate section below
  - **History tab** — all commits grouped by day (sticky headers), load-more button (100 at a time), click commit → expands to show changed files, click file → opens diff in main editor
  - **Branches tab** — local + remote, current branch highlighted
  - Branch bar with ↑ahead / ↓behind indicators, spinning loader on auto-reload
  - Auto-reloads every 3 seconds
- **Collapsed strip:** 6 icons — 4 open modals directly, 2 expand the sidebar

### Main Editor Area — File Editor
- `FileEditorPanel`: syntax-highlighted code editor
  - **Auto-save** — debounced 800ms after last keystroke, no manual save needed
  - **Breakpoint gutter** — 16px strip left of line numbers; hover = faint red dot, click = persistent red dot with glow; breakpoint count shown in header
  - **Line numbers** — bright `#858585`, red for breakpointed lines
  - **Minimap** — right side, renders actual tiny text (`ctx.fillText` at 1.7px monospace) with syntax colours (comments=green, keywords=blue, types=teal, strings=orange, JSX=gold); viewport indicator auto-scrolls as you scroll the file
  - **File breadcrumb** — full path shown in header
  - Cmd+S to save manually, Tab → 2 spaces, language detection from extension
  - Supported: TS, TSX, JS, JSX, Python, JSON, CSS, SCSS, HTML, Shell, Rust, Go

### Main Editor Area — Diff Editor
- `DiffEditorPanel`: VSCode-style side-by-side diff
  - **Full file shown** — loads HEAD/index content + working tree, overlays diff highlights on complete file (not just hunks)
  - **Left column** = before (red background, `-` marker, red line numbers)
  - **Right column** = after (green background, `+` marker, green line numbers)
  - **Inline character-level highlighting** — LCS-based char diff; whole changed line = light bg, exact changed chars = darker bg
  - **Grey placeholder rows** — added lines get empty placeholders in left column so columns stay aligned
  - **Single combined minimap** on far right — left half=before (red), right half=after (green), centre divider; auto-scrolls with viewport
  - Both columns scroll in sync via `data-scroll-col` + `onScroll` sync
  - Commit diff mode: click file in History → shows before (parent commit) vs after (this commit)
  - Staged/unstaged/commit mode badge, `+N -N` change count in header

### Terminal
- Integrated terminal via xterm.js + node-pty
- Shell auto-detection (zsh/bash/sh, respects `$SHELL` and `/etc/passwd`)
- Full colour support (truecolor), 120×30 default size
- Horizontal terminal tabs

### Left Bar
- Chats / Projects sections (collapsible), New Chat / Open Project buttons
- Collapsed state: icons expand sidebar on click with accent hover
- Per-session rename, delete with timestamps
- Deleted sessions blacklisted in localStorage

### Welcome Screen
- Vertically centred greeting with username
- Auto-scrolling feature cards with edge fade masks

### Intelligence Layer
- Knowledge Graph: TS/JS/Python/Rust symbol extractor, conflict detection, agent context injection
- API Contract Enforcer: frontend fetch calls vs backend routes, violation detection
- Model Advisor: latency/TPS tracking, error log, model suggestions

### Server APIs
- Full file management: create, read, write, delete, move, copy, folder create, exists check
- Git: status, log, branches, diff (staged/unstaged/HEAD), commit diff, file-at-HEAD, file-at-commit
- System info: RAM, CPU, platform, Ollama status
- MCP: connect, status
- Settings: provider config, API keys (save/delete/validate), LLM defaults, appearance

---

## Roadmap

### Phase 4 — Status

| Feature | Status |
|---|---|
| 4B File Attach in chat | ✅ Done |
| 4C Agent file write + apply (deterministic IDs, localStorage persist) | ✅ Done |
| 4D Ollama model management | ✅ Done |
| 4E Right sidebar (icon buttons + modals) | ✅ Done |
| 4F Export chat as .txt | ✅ Done |
| 4G Settings split (Local/Cloud/LLM/Display) + rate limit classifier | ✅ Done |
| 4H VSCode-style diff editor (full file, inline char diff, combined minimap) | ✅ Done |
| 4I Git history with commit drill-down | ✅ Done |
| 4J File editor minimap (actual text rendering, syntax colors) | ✅ Done |
| 4K Breakpoint gutter | ✅ Done |
| 4L Permanent file search bar | ✅ Done |

### Phase 5 — In Progress / Planned

| Feature | Status |
|---|---|
| 5A Auto-save (debounced, no manual save) | 🔨 Next |
| 5B Find in Files (Cmd+Shift+F, search across project) | 🔨 Next |
| 5C File breadcrumb (full path, clickable segments) | 🔨 Next |
| 5D VSCode-style terminal (tabs, theme, font, colours) | 🔨 Next |
| 5E Per-session provider/model selection (different API keys per chat) | 🔨 Next |
| 5F Agent Auto-Apply mode (toggle in settings, no confirm dialog) | 📋 Planned |
| 5G Universal file reading in chat (PDF, DOCX, images) | 📋 Planned |
| 5H Chart/graph rendering from agent data output | 📋 Planned |
| 5I Math rendering (KaTeX) | 📋 Planned |

---

## Known Bugs

See [`docs/KNOWN_BUGS.md`](./docs/KNOWN_BUGS.md) for detailed investigation notes.

| Bug | Status |
|---|---|
| Diff view empty for some staged files (`git diff HEAD -- deep/path/file` returns nothing from server process) | PARKED — needs debug endpoint to diagnose |

---

## Known Limitations

| Limitation | Detail |
|---|---|
| Small model format compliance | `qwen2.5-coder:1.5b/7b` often ignores the `write:path` format. Fallback parser handles most cases. Use ≥14b or cloud for best results. |
| Diff view for staged files | Some staged files show empty diff due to a server-side git process issue. See Known Bugs. |
| PDF/DOCX file attach | Only plain text and code files supported in chat. PDF/DOCX is Phase 5G. |
| Vision not supported for local models | Image attachments require a cloud provider with vision support. |

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
