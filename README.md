# LocalForge

> Local-first AI coding agent desktop app — multi-agent orchestration, offline inference, and cloud LLM integration. Runs on your machine, scales to the cloud.

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![Status](https://img.shields.io/badge/status-active%20development-orange.svg)

---

## What is LocalForge?

LocalForge is a purpose-built desktop IDE for AI-assisted development. It combines a VSCode-style UI, local Ollama inference, multi-agent task orchestration, and cloud LLM integration into a single offline-capable desktop app.

**Core design goal:** Users should never feel lost. Every feature mirrors VSCode so the interface is immediately familiar — no learning curve on top of the AI learning curve.

**Core principles:**
- Local-first: everything works offline with Ollama
- Cloud-optional: plug in Gemini, Claude, OpenAI, or Groq per session
- Production-ready: not a demo — agents can write and apply files to disk
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

### Phase 4 — Complete

| Feature | Detail |
|---|---|
| File attach in chat | Paperclip → inject .ts/.py/.md/.json etc into context |
| Agent file write + apply | `write:path` syntax, Apply/Reject cards, deterministic patch IDs, localStorage persist |
| Ollama model management | List, pull, delete models in Local tab |
| Right sidebar (VSCode-style) | Icon buttons → full-screen modals: Knowledge Graph, Project Graph, Agents, API Contracts |
| Export chat | Save as .txt via Tauri dialog |
| Settings split tabs | Local (RAM bar, CPU, Ollama status) / Cloud (per-provider API keys, rate limits) / LLM / Display |
| Rate limit error classifier | Provider-specific actionable messages for 429/quota/auth/OOM/context errors |
| VSCode-style diff editor | Full file side-by-side, inline char-level highlighting, combined minimap, commit diffs |
| Git history drill-down | Commits grouped by day, click commit → files → click file → diff in editor |
| File editor minimap | `ctx.fillText` at 1.7px, syntax colors, auto-scrolling viewport indicator |
| Breakpoint gutter | Hover = faint dot, click = persistent red dot with glow, count in header |
| Permanent file search bar | Always visible in explorer, filters tree in real time |

### Phase 5 — In Progress

| Feature | Status | Detail |
|---|---|---|
| 5A Auto-save | ✅ Done | 800ms debounce after last keystroke, cloud icon status indicator, no Save button |
| 5B Find in Files | ✅ Done | Cmd+Shift+F modal, debounced search, case/whole-word toggles, file filters, match highlights |
| 5C File breadcrumb | ✅ Done | Full path `apps › desktop › src › components › File.tsx` in editor header |
| 5D VSCode terminal | ✅ Done (needs polish) | Right sidebar instance list, colored status dots, +/··· dropdowns, exact Dark+ theme 14px |
| 5E Per-session provider | 🔨 Next | Different API key/model per chat/project |
| 5F Agent Auto-Apply | 📋 Planned | Toggle in settings, no confirm dialog |
| 5G Universal file reading | 📋 Planned | PDF/DOCX/image attach in chat |
| 5H Chart rendering | 📋 Planned | Render charts from agent data output |

### Core Infrastructure
- Tauri 2.0 monorepo (`apps/desktop` + `packages/agent-core`)
- Fastify agent server with full TypeScript
- SQLite session persistence — chats and projects survive restarts
- Ollama client with model fallback chain
- MCP filesystem integration (auto-connects on project open)
- Hardware-aware task scheduler (auto sequential/parallel based on RAM)

### Chat Features
- SSE streaming with Markdown rendering (tables, code blocks, lists, headers)
- File chips clickable in chat — opens preview popup
- Agent file write + apply with fallback parser for non-compliant models
- MCP indicator in project chat title bar
- Project chat grounded in real files: README.md + key configs injected into context
- Auto-generated session titles, per-message copy/edit/regenerate
- Scroll-to-bottom button

### File Editor (`FileEditorPanel`)
- **Auto-save** — 800ms debounced, cloud icon shows Saved/Unsaved/Saving state
- **Full-path breadcrumb** — `apps › desktop › src › components › File.tsx` in header
- **Cmd+F in-file search** — floating find bar, all matches highlighted, current match in orange, Esc to close
- **Syntax highlighting** — TS/TSX/JS/JSX/Python/JSON/CSS/SCSS/HTML/Shell/Rust/Go
- **Minimap** — actual text rendered at 1.7px with syntax colors, auto-scrolling viewport indicator
- **Breakpoint gutter** — hover/click, persistent red dot, count badge
- **Line numbers**, Tab → 2 spaces, Cmd+S for immediate save

### Diff Editor (`DiffEditorPanel`)
- Side-by-side before/after with full file content (not just hunks)
- Inline character-level diff (LCS-based, light bg + dark bg for exact chars)
- Placeholder rows keep columns aligned
- Single combined minimap (left=before red, right=after green, centre divider)
- Commit diff mode: click file in History → parent vs this commit

### Terminal (`TerminalPanel`)
- VSCode-identical layout: PROBLEMS/OUTPUT/DEBUG CONSOLE/TERMINAL/PORTS tabs
- Right sidebar instance list with colored status dots (blue=running, red=error)
- `+` dropdown: New Terminal, bash/zsh, Split Terminal, Configure Settings
- `···` dropdown: Clear Terminal, Scroll to Prev/Next Command, Run Active File, etc.
- Exact VSCode Dark+ 16 ANSI colours, 14px font, Cascadia Code
- Multi-tab: all instances always mounted, visibility via opacity
- Kill button, warning triangle on error instances

### Git Panel (Source Control)
- Single **CHANGES (N)** section — staged (green dot) + unstaged (amber dot), VSCode style
- History tab: commits grouped by day, click → changed files → click file → diff
- Branches tab: local + remote, current branch highlighted
- Auto-reloads every 3 seconds

### Right Sidebar
- **Explorer**: permanent search bar, VSCode right-click context menu (New File/Folder, Rename inline, Copy/Cut/Paste, Duplicate, Delete)
- **Source Control**: git panel (see above)
- **Find in Files**: Cmd+Shift+F, server-side grep, results with line context and match highlights

---

## Known Bugs

See [`docs/KNOWN_BUGS.md`](./docs/KNOWN_BUGS.md).

| Bug | Status |
|---|---|
| Diff view empty for some staged files (`git diff HEAD -- deep/path` returns nothing from server process) | PARKED |
| Terminal panel needs UI polish (instance list sizing, font rendering) | PARKED |

---

## Known Limitations

| Limitation | Detail |
|---|---|
| Small model format compliance | `qwen2.5-coder:1.5b/7b` often ignores `write:path` format. Use ≥14b or cloud for best results. |
| PDF/DOCX file attach | Only plain text and code files supported in chat. PDF/DOCX is Phase 5G. |
| Vision | Image attachments require a cloud provider with vision support. |

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
