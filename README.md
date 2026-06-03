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
- Cloud-optional: plug in Gemini, Claude, or OpenAI for heavier tasks
- Production-ready: not a demo — ships features agents can actually write and apply to disk

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop app | Tauri 2.0 (Rust) + React + TypeScript |
| Agent server | Fastify + TypeScript |
| Persistence | SQLite via better-sqlite3 |
| Local inference | Ollama (OpenAI-compatible API) |
| Cloud inference | OpenAI-compatible (Gemini, Claude, OpenAI, Groq) |
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

### Core infrastructure
- Tauri 2.0 monorepo (apps/desktop + packages/agent-core)
- Fastify agent server with full TypeScript
- SQLite session persistence (chats + projects survive restart)
- Ollama client with model fallback chain
- Hardware-aware task scheduler (auto sequential/parallel)
- MCP filesystem integration

### Cloud LLM Integration
- Unified LLM client routing to Ollama or cloud transparently
- Supported providers: Gemini, OpenAI, Claude, Groq, Custom (OpenAI-compatible)
- Settings page: API key management, temperature, max tokens, system prompt, context length
- Per-chat model selector in the input bar — only shows providers with saved API keys
- Internet connectivity detection — cloud providers auto-disabled when offline

### Desktop UI
- VSCode-style layout: TopBar, LeftBar, ChatPanel, RightSidebar, TerminalPanel
- Chat mode with SSE streaming, Markdown rendering, per-message copy/edit/regenerate
- Auto-generated session titles, timestamps
- Per-session model selector beside the mic button (like Claude)
- Tab strip with auto-evict
- Left sidebar: Chats + Projects history, rename, delete (persists across restarts via localStorage)
- Right sidebar: File Explorer, Git panel, API Contracts, Agents, Knowledge Graph, Project Graph
- Integrated terminal (xterm.js + node-pty, multi-tab)
- Responsive layout (auto-collapse sidebars on resize)

### Intelligence layer
- Knowledge Graph (TS/JS/Python/Rust symbol extractor, conflict detection, agent context injection)
- API Contract Enforcer (fetch/axios calls vs Express/Fastify routes, violation detection)
- Model Advisor (latency/TPS tracking, error log, smart suggestions)

### UX & Polish
- RAM error detection: shows actionable in-chat message when Ollama runs out of memory
- Real internet connectivity via `navigator.onLine` + native events (instant, no external fetch)
- Deleted sessions blacklisted in localStorage — never reappear after restart
- Git panel (status, staged/unstaged, commit log, branch view, inline diff)
- QR preview (LAN IP detection, port picker)
- "Scroll to bottom" button appears when user scrolls up during streaming

---

## Roadmap

### Phase 4 — In Progress 🔥

#### 4B — File Attach
- [ ] Drag-and-drop files into chat (read content into context: .ts, .py, .md, .json, .txt)
- [ ] Image attach for vision-capable models (LLaVA, Gemini Vision, GPT-4o)
- [ ] File preview before send (name, size, type)
- [ ] Context-aware injection into system prompt

#### 4C — Agent File Write + Apply
- [ ] Agents propose file changes with full diff preview
- [ ] Apply / Reject / Edit per file before writing to disk
- [ ] Multi-file patch: agent proposes N files, user reviews batch
- [ ] Write history log with undo

#### 4D — Ollama Model Management UI
- [ ] List installed models with size and quantization
- [ ] Pull new models from within the app (`ollama pull <model>`)
- [ ] Real-time download progress bar
- [ ] Delete models, filter by capability (code/chat/vision)

#### 4E — Right Sidebar Redesign
- [ ] Replace accordion sections with 4 horizontal icon buttons below project name
- [ ] Each icon opens a floating modal (Project Graph, Knowledge Graph, Agents, API Contracts)
- [ ] Modals are resizable and dismissable

#### 4F — Export Chat
- [ ] Export chat as Markdown (.md)
- [ ] Export chat as PDF
- [ ] Copy full conversation to clipboard

#### 4G — Settings: Local vs Cloud Split
- [ ] Separate "Local Models" section (Ollama only) from "Cloud Providers" in Settings
- [ ] Local Models section shows installed models, usage tips, RAM requirements

---

### Phase 5 — Future (Parked)

These are real features but require significant infrastructure or third-party dependencies that are not yet stable enough in this environment:

#### 5A — Math Rendering
- LaTeX equation rendering via KaTeX (remark-math + rehype-katex)
- Requires: CSS loading order fix in Vite/Tauri, font path resolution
- Blocked by: KaTeX CSS not loading correctly in Tauri webview

#### 5B — Web Search / RAG
- `@web` trigger for live data queries
- Blocked by: small local models (qwen2.5-coder) hallucinate party names and facts regardless of retrieved context
- Real fix: use Gemini Flash or GPT-4o-mini for RAG queries — revisit after cloud providers are stable

#### 5C — Graph Visualization
- Draw charts and graphs from data (like Gemini does)
- Requires: chart.js or D3 integration, agent output parsing for structured data

#### 5D — File Output (docx, drive)
- Export responses as Word documents, save to Google Drive
- Requires: docx generation library, OAuth integration

#### 5E — Universal File Reading in Chat
- Accept PDF, DOCX, XLSX, images (PNG, JPG, WEBP), and any text file as chat attachments
- PDF: extract text via pdf-parse or pdfjs-dist, inject into model context
- DOCX: extract text via mammoth.js
- XLSX/CSV: convert to readable table format before injection
- Images: pass as base64 to vision-capable models (Gemini Vision, GPT-4o, LLaVA)
- Currently blocked: Ollama local models (qwen2.5-coder) do not support vision; PDF/DOCX parsing requires additional server-side libraries
- Current state: only plain text files and code files are supported as attachments
- Fix path: add `pdf-parse` + `mammoth` to agent-core, add vision routing for cloud providers, extend file type filter in ChatPanel

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
