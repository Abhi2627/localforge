# LocalForge

> Local-first AI coding agent desktop app — offline inference, multi-agent orchestration, and cloud LLM integration. Runs on your machine, scales to the cloud.

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![Status](https://img.shields.io/badge/status-active%20development-orange.svg)

---

## What is LocalForge?

LocalForge is a purpose-built desktop IDE for AI-assisted development. It combines a VSCode-style UI, local Ollama inference, and cloud LLM integration into a single offline-capable desktop app.

**Core principles:**
- Local-first: everything works offline with Ollama
- Cloud-optional: plug in Gemini, Claude, OpenAI, or Groq per session
- Production-ready: agents write and apply real files to disk
- Familiar: VSCode-style UI, keybindings, git panel, diff view, minimap, terminal

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop app | Tauri 2.0 (Rust) + React + TypeScript |
| Agent server | Fastify + TypeScript |
| Persistence | SQLite via better-sqlite3 |
| Local inference | Ollama (OpenAI-compatible API) |
| Cloud inference | Gemini, Claude, OpenAI, Groq |
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

**First launch:** If no model is installed and no API key is configured, the app shows a **Setup Gate** — pull an Ollama model or add a cloud API key before entering.

**Low RAM?** `ollama pull qwen2.5-coder:1.5b` — 1.1 GB, works on 8 GB RAM.

---

## What's Built ✅

### Phase 4 — Complete

| Feature | Detail |
|---|---|
| File attach in chat | Paperclip → inject .ts/.py/.md/.json etc into context |
| Agent file write + apply | `write:path` syntax, Apply/Reject cards, deterministic patch IDs |
| Ollama model management | List, pull, delete models; system RAM bar, CPU info, Ollama status |
| Right sidebar | Knowledge Graph, Project Graph, Agents, API Contracts modals |
| Export chat | Save as .txt via Tauri dialog |
| Settings | Local / Cloud / LLM / Display tabs |
| Rate limit classifier | Provider-specific actionable messages for 429/quota/auth/OOM errors |
| VSCode-style diff editor | Full file side-by-side, inline char-level highlighting, combined minimap |
| Git history drill-down | Commits grouped by day → files → diff in editor |
| File editor minimap | Actual text rendered at 1.7px with syntax colors |
| Breakpoint gutter | Hover/click, persistent red dot, count badge |

### Phase 5 — Complete

| Feature | Status | Detail |
|---|---|---|
| 5A Auto-save | ✅ Done | 800ms debounce, cloud icon status (Saved/Unsaved/Saving), no Save button |
| 5B Find in Files | ✅ Done | Cmd+Shift+F, debounced server-side grep, case/whole-word, file filters, match highlights |
| 5C File breadcrumb | ✅ Done | Full path `apps › desktop › src › components › File.tsx` in editor header |
| 5D VSCode terminal | ✅ Done | PROBLEMS/OUTPUT/DEBUG/TERMINAL/PORTS tabs, right sidebar instance list, status dots, dropdowns |
| 5E Per-session provider | ✅ Done | Each chat independently remembers its own Ollama/Gemini/Groq/Claude selection |
| 5F Agent Auto-Apply | ✅ Done | Toggle in Settings → LLM, writes patches to disk immediately, Applied badge still shown |
| 5G Universal file reading | ✅ Done | PDF (pdf-parse), DOCX (mammoth), images — attachable in chat via paperclip |
| 5H Chart rendering | ✅ Done | ` ```chart ` blocks render as Line/Bar/Pie/Area charts (Recharts, dark VSCode theme) |
| 5I Math rendering | ✅ Done | KaTeX — `\[...\]` block, `\(...\)` inline, `$$...$$`, ` ```math ` all supported |

### Setup Gate (First Launch)
- Blocks entry when no model and no API key configured
- **Local tab**: Ollama status, installed models, pull recommended models with live progress
- **Cloud tab**: API keys for Gemini/Groq (free tier) or OpenAI/Claude
- Auto-proceeds when setup is complete

### Chat
- SSE streaming with full Markdown rendering
- **Math rendering** — LaTeX via KaTeX: `\[...\]` block, `\(...\)` inline, `$$`, ` ```math `
  - Block math has "Copy source" button (copies raw LaTeX, not rendered DOM)
  - Message copy preserves raw markdown + LaTeX intact
- **Chart rendering** — ` ```chart ` blocks: Line, Bar, Pie, Area via Recharts
- **Interactive graph renderer** — ` ```graph ` blocks: Canvas-based plotter with zoom/pan, crosshair tooltip, real-time parameter sliders (Desmos-like) — *note: local models may not use this automatically; cloud models do*
- **Clickable links** — every URL/link shows confirmation dialog before opening in default browser; copy icon beside each link
- **Code blocks** — language label + Copy button (like Claude.ai)
- File chips, agent file write + apply, Auto-Apply mode
- Per-session provider + effort levels (Low/Med/High/Max) + Thinking toggle (Claude)
- MCP indicator, project context injection, per-message copy/edit/regenerate

### File Editor
- **Auto-save** 800ms debounce, cloud icon status
- **Full-path breadcrumb** in header
- **Cmd+F in-file search** — floating find bar, all matches highlighted, current in orange, Esc to close, no keystroke leaks
- Syntax highlighting: TS/TSX/JS/JSX/Python/JSON/CSS/SCSS/HTML/Shell/Rust/Go
- **Minimap** — 1.7px text rendering with syntax colors, auto-scrolling viewport
- Breakpoint gutter, line numbers, Tab → 2 spaces, Cmd+S immediate save

### Diff Editor
- Side-by-side before/after, full file content
- Inline char-level diff (LCS-based), placeholder rows keep columns aligned
- Combined minimap (left=red before, right=green after)
- **Syntax-highlighted diff** — not plain white text
- **Auto-refresh every 3s** — diff clears automatically after git push

### Terminal
- PROBLEMS / OUTPUT / DEBUG CONSOLE / TERMINAL / PORTS panel tabs
- **Right sidebar** — terminal instance list, colored dots (blue=running, red=error)
- `+` dropdown: New Terminal, bash/zsh, Configure Settings
- `···` dropdown: Clear Terminal, Scroll Prev/Next Command, Run Active File, etc.
- Exact VSCode Dark+ 16 ANSI colours, 14px Cascadia Code font
- Multi-tab: all instances always mounted (opacity switching)

### Git Panel
- CHANGES section — staged (green dot) + unstaged (amber dot)
- History: commits grouped by day → files → diff
- Branches tab, auto-reloads every 3 seconds

### Settings
- **Local tab**: RAM bar, CPU, platform, Ollama version + status
- **Cloud tab**: per-provider API key save/test/delete, FREE TIER badges
- **LLM tab**: temperature, max tokens, context length, system prompt, **Auto-Apply toggle**
- **Display tab**: font size slider

---

## Multi-Agent System (Built, Pending Full Test)

The multi-agent orchestration pipeline is implemented but not yet fully tested end-to-end. Full testing is planned when the application is feature-complete — target test: ask the app to build an entire application (video meet app, full-stack website) from scratch using multiple agents in parallel, completely offline.

**Architecture:** Orchestrator → multiple AgentSessions per project → TaskQueue (auto sequential/parallel based on RAM) → file writes via `localforge:file-applied` events → Knowledge Graph + API Contract Enforcer for inter-agent context.

---

## Known Bugs (Parked)

| Bug | Status |
|---|---|
| Diff view empty for some staged files | PARKED |
| Terminal panel UI polish (instance sizing, font rendering) | PARKED |
| Graph blocks: local models (qwen2.5-coder) ignore `graph` format and suggest Desmos instead — cloud models work correctly | PARKED — needs post-processing interceptor |

---

## Known Limitations

| Limitation | Detail |
|---|---|
| Small model hallucination | Coding-focused models have weak general knowledge — use cloud for non-code queries |
| Small model format compliance | `qwen2.5-coder:1.5b/7b` often ignores `write:path` and `graph` formats — use ≥14b or cloud |
| Vision | Image attachments require a cloud provider with vision support |

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
