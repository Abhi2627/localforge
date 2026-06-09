# LocalForge

> Local-first AI coding agent desktop app — offline inference, multi-agent orchestration, and cloud LLM integration. Runs on your machine, scales to the cloud.

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![Status](https://img.shields.io/badge/status-active%20development-orange.svg)

---

## What is LocalForge?

LocalForge is a purpose-built desktop IDE for AI-assisted development. It combines a VSCode-style UI, local Ollama inference, and cloud LLM integration into a single offline-capable desktop app. The goal is to let a developer say "build me a full-stack video meet app" and have the agent write every file, resolve dependencies, and apply changes to disk — without touching the browser.

**Core design goal:** Users should never feel lost. Every feature mirrors VSCode so the interface is immediately familiar — no learning curve on top of the AI learning curve.

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
| Agent file write + apply | `write:path` syntax, Apply/Reject cards, deterministic patch IDs, localStorage persist |
| Ollama model management | List, pull, delete models; system RAM bar, CPU info, Ollama status |
| Right sidebar | Icon buttons → Knowledge Graph, Project Graph, Agents, API Contracts modals |
| Export chat | Save as .txt via Tauri dialog |
| Settings | Local tab (system info) / Cloud tab (API keys, rate limits) / LLM tab / Display tab |
| Rate limit classifier | Provider-specific actionable messages for 429/quota/auth/OOM/context errors |
| VSCode-style diff editor | Full file side-by-side, inline character-level highlighting, combined minimap, commit diffs |
| Git history drill-down | Commits grouped by day, click commit → files → click file → diff in editor |
| File editor minimap | `ctx.fillText` 1.7px actual text rendering, syntax colors, auto-scrolling viewport |
| Breakpoint gutter | Hover = faint dot, click = persistent red dot with glow, count badge in header |
| Permanent file search | Always visible in Explorer, filters file tree in real time |

### Phase 5 — Complete / In Progress

| Feature | Status | Detail |
|---|---|---|
| 5A Auto-save | ✅ Done | 800ms debounce, cloud icon shows Saved/Unsaved/Saving, no Save button |
| 5B Find in Files | ✅ Done | Cmd+Shift+F, debounced server-side grep, case/whole-word toggles, file filters, match highlights |
| 5C File breadcrumb | ✅ Done | Full path `apps › desktop › src › components › File.tsx` in editor header |
| 5D VSCode terminal | ✅ Done | PROBLEMS/OUTPUT/DEBUG CONSOLE/TERMINAL/PORTS tabs, right sidebar instance list, colored status dots, +/··· dropdowns, exact Dark+ theme 14px |
| 5E Per-session provider | ✅ Done | Each chat/project independently remembers its own Ollama/Gemini/Groq/Claude selection |
| 5F Agent Auto-Apply | ✅ Done | Toggle in Settings → LLM, writes patches to disk immediately, Applied badge still shown |
| 5G Universal file reading | ✅ Done | PDF (pdf-parse server extraction), DOCX (mammoth), images — all attachable in chat via paperclip |
| 5H Chart rendering | ✅ Done | ` ```chart ` blocks render as Line/Bar/Pie/Area charts using Recharts, dark VSCode theme |
| 5I Math rendering (KaTeX) | 🔨 Next | Inline and block math expressions in chat |

### Setup Gate
- On first launch with no model and no API key → dedicated setup screen (not welcome screen)
- **Local tab**: shows Ollama status, installed models, pull recommended models with live progress
- **Cloud tab**: add API keys for Gemini/Groq (free tier) or OpenAI/Claude
- Auto-proceeds when setup is complete; accessible anytime via Settings

### Chat
- SSE streaming with Markdown rendering (tables, code blocks, lists, headers)
- File chips clickable in chat — opens preview popup
- Agent file write + apply with fallback parser for non-compliant models
- **Auto-Apply mode** — patches written to disk immediately, no confirm needed
- MCP indicator (green = connected, blinking = connecting)
- Project chats grounded in real files (README + configs injected into every request)
- Per-message copy / edit / regenerate
- **Per-session provider** — model selector in input bar, each chat remembers its own provider
- **Effort levels** — Low / Med / High / Max chips in model selector, Thinking toggle for Claude
- Scroll-to-bottom button, export chat as .txt

### File Editor
- **Auto-save** 800ms debounce, cloud icon status
- **Full-path breadcrumb** in header
- **Cmd+F in-file search** — floating find bar, all matches highlighted in yellow, current in orange, Esc to close, no keystroke leaks into editor
- Syntax highlighting: TS/TSX/JS/JSX/Python/JSON/CSS/SCSS/HTML/Shell/Rust/Go
- **Minimap** — actual text rendered at 1.7px with syntax colors, auto-scrolling viewport indicator
- Breakpoint gutter — hover/click, persistent red dot, count badge
- Line numbers, Tab → 2 spaces, Cmd+S for immediate save

### Diff Editor
- Side-by-side before/after with full file content
- Inline character-level diff (LCS-based, light bg + dark bg for exact chars)
- Placeholder rows keep columns aligned
- Single combined minimap (left=before red, right=after green)
- Commit diff mode: click file in History → parent vs this commit

### Terminal
- PROBLEMS / OUTPUT / DEBUG CONSOLE / TERMINAL / PORTS panel tabs
- **Right sidebar** — terminal instance list, colored dots (blue=running, red=error)
- `+` dropdown: New Terminal, bash/zsh options, Configure Settings
- `···` dropdown: Clear Terminal, Scroll to Prev/Next Command, Run Active File, etc.
- Exact VSCode Dark+ 16 ANSI colours, 14px Cascadia Code font
- Multi-tab: all instances always mounted (opacity switching, no re-spawn)
- Kill button, warning triangle on error instances

### Git Panel (Source Control)
- Single **CHANGES (N)** section — staged (green dot) + unstaged (amber dot), VSCode style
- History tab: commits grouped by day, click → files → click file → opens diff
- Branches tab: local + remote, current branch highlighted
- Auto-reloads every 3 seconds

### Settings
- **Local tab**: RAM bar (green/amber/red), CPU, platform, Ollama version + status dot
- **Cloud tab**: per-provider API key save/test/delete, model selector, rate limit info, FREE TIER badges
- **LLM tab**: temperature slider, max tokens, context length, custom system prompt, **Auto-Apply toggle**
- **Display tab**: font size slider

---

## Multi-Agent System (Built, Pending Full Test)

The multi-agent orchestration pipeline is implemented but not yet fully tested end-to-end. Full testing is planned when the application is feature-complete — the target test is asking the app to build an entire application (e.g. a video meet app, full-stack website) from scratch using multiple agents working in parallel, completely offline.

**Architecture:**
- `Orchestrator` manages multiple agent sessions per project
- Each agent has a `role`, `allowedPaths`, and independent instruction queue
- `TaskQueue` auto-detects sequential vs parallel execution based on available RAM
- Agents communicate file writes via `localforge:file-applied` events
- Knowledge Graph + API Contract Enforcer provide inter-agent context

---

## Known Bugs (Parked)

See [`docs/KNOWN_BUGS.md`](./docs/KNOWN_BUGS.md) for investigation notes.

| Bug | Status |
|---|---|
| Diff view empty for some staged files (`git diff HEAD -- deep/path` returns nothing from server process) | PARKED |
| Terminal panel UI needs polish (instance list sizing, font rendering on some systems) | PARKED |

---

## Known Limitations

| Limitation | Detail |
|---|---|
| Small model hallucination | Coding-focused models (qwen2.5-coder) have weak general knowledge — use cloud for non-code queries |
| Small model format compliance | `qwen2.5-coder:1.5b/7b` often ignores `write:path` format. Use ≥14b or cloud for best agent results |
| PDF/DOCX file attach | Only plain text and code files supported in chat. PDF/DOCX is Phase 5G |
| Vision | Image attachments require a cloud provider with vision support |

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
