# LocalForge

> Local-first AI coding agent desktop app — multi-agent orchestration, offline inference, and now cloud LLM integration. Runs on your machine, scales to the cloud.

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
| MCP | @modelcontextprotocol/sdk |
| Local inference | Ollama (OpenAI-compatible API) |
| Cloud inference | OpenAI API-compatible (Gemini, Claude, OpenAI, Groq) |
| Terminal | xterm.js + node-pty |
| Hardware detection | systeminformation |

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

**Prerequisites:** Node.js 20+. For local inference: Ollama with at least one model pulled (`ollama pull qwen2.5-coder`).

---

## What's Built ✅

### Core infrastructure
- Project scaffold, monorepo setup
- Agent core: TaskQueue + write-ahead log + crash recovery
- Ollama client with model fallback chain
- MCP filesystem integration
- Hardware-aware scheduler (auto parallel/sequential)
- Session persistence (SQLite — chats + projects survive restart)

### Desktop UI
- VSCode-style layout: TopBar, LeftBar, TabStrip, ChatPanel, RightSidebar, TerminalPanel
- Chat mode with SSE streaming responses and Markdown rendering
- Auto-generated session titles, timestamps, copy/edit/reload per message
- Tab strip with auto-evict and dismiss
- Left sidebar: Chats + Projects history, rename, delete
- Right sidebar: Explorer, Git panel, API Contracts, Agents, Knowledge Graph, Project Graph
- Auto project onboarding (file scan + AI summary)
- Native folder picker (Tauri dialog plugin)
- Integrated terminal (xterm.js + node-pty PTY, multi-tab)
- Project flow graph (SVG, zoom/pan, fullscreen)
- Responsive layout (auto-collapse sidebars on resize)

### Intelligence layer
- Internet RAG pipeline (DuckDuckGo, `@web` prefix trigger, source pills)
- Model Advisor (latency/TPS tracking, error log, smart suggestions, TopBar chip)
- Knowledge Graph (TS/JS/Python/Rust symbol extractor, conflict detection, agent context injection)
- API Contract Enforcer (fetch/axios/SWR calls vs Express/Fastify/FastAPI routes, violation detection)

### Polish
- Git panel (status/staged/unstaged, commit log, branch view, inline diff viewer)
- QR preview (LAN IP detection, port picker, canvas QR code)

---

## Roadmap — Phase 4: Level Up

### 4A — Cloud LLM Integration 🔥
- [ ] Provider settings page (API key management for Gemini, Claude, OpenAI, Groq, custom OpenAI-compatible)
- [ ] Per-session model selector: choose Ollama model OR cloud provider per chat
- [ ] Unified LLM client that routes to Ollama or cloud transparently
- [ ] Streaming support for all cloud providers
- [ ] Fallback chain: cloud → Ollama if API key missing or rate-limited
- [ ] Token usage display per response (cloud only)

### 4B — File Attach & Multimodal Input
- [ ] Attach files to chat (read content into context: .ts, .py, .md, .json, .txt)
- [ ] Attach images (vision-capable models: LLaVA, Gemini Vision, GPT-4o)
- [ ] Drag-and-drop file attach in input area
- [ ] File preview before send (show name, size, type)
- [ ] Context-aware attachment: auto-inject file content into system prompt

### 4C — Agent File Write + Apply
- [ ] Agents can write files to disk autonomously (with confirmation modal)
- [ ] Diff preview before applying: show what the agent wants to change
- [ ] Apply / Reject / Edit per file change
- [ ] Multi-file patch: agent proposes changes to N files, user reviews batch
- [ ] Write history: log of all agent-applied changes with undo

### 4D — Ollama Model Management UI
- [ ] List installed models with size, quantization, and last used
- [ ] Pull new models from within the app (`ollama pull <model>`)
- [ ] Download progress bar (streaming pull progress)
- [ ] Delete models from within the app
- [ ] Model tags and search (filter by code/chat/vision/reasoning)

### 4E — Settings Page
- [ ] Model defaults (temperature, top-p, context length, system prompt)
- [ ] Execution mode (sequential / parallel, max parallel agents)
- [ ] Appearance (font size, theme, sidebar widths)
- [ ] API keys (Gemini, Claude, OpenAI, Groq)
- [ ] Keyboard shortcuts reference
- [ ] Data: clear sessions, export all chats, reset knowledge graph

### 4F — Export & Sharing
- [ ] Export single chat as Markdown (.md)
- [ ] Export single chat as PDF
- [ ] Export project session (chat + agent log + file changes) as ZIP
- [ ] Copy formatted conversation to clipboard

### 4G — RAG Quality (model-agnostic)
- [ ] Use cloud LLM (Gemini Flash / Claude Haiku) for factual @web queries — solves hallucination permanently
- [ ] Brave Search API as alternative to DuckDuckGo (more reliable, rate-limited free tier)
- [ ] Source citation inline in responses (not just as pills)

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
