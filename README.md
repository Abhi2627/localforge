# LocalForge

> Local-first AI coding agent with multi-agent orchestration, crash recovery, and MCP filesystem access — runs entirely on your machine.

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![Status](https://img.shields.io/badge/status-active%20development-orange.svg)

---

## What is LocalForge?

LocalForge turns locally installed LLMs into a full agentic coding assistant. Purpose-built desktop UI, MCP-powered filesystem access, hardware-aware multi-agent orchestration, write-ahead crash recovery, and optional internet-augmented RAG.

**No subscription. No cloud. No data leaves your machine.**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop app | Tauri 2.0 (Rust) + React + TypeScript |
| Agent server | Fastify + TypeScript |
| Persistence | SQLite via better-sqlite3 |
| MCP | @modelcontextprotocol/sdk |
| Local inference | Ollama (OpenAI-compatible API) |
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

**Prerequisites:** Ollama running with at least one model pulled (`ollama pull qwen2.5-coder`), Node.js 20+.

---

## Roadmap

### Core infrastructure ✅
- [x] Project scaffold and monorepo setup
- [x] Agent core: TaskQueue + write-ahead log
- [x] Ollama client with model fallback chain
- [x] MCP filesystem integration
- [x] Crash recovery: 3-layer checksum verifier
- [x] Hardware-aware scheduler (auto parallel/sequential)
- [x] Session persistence (SQLite — chats + projects survive restart)

### Desktop UI ✅
- [x] Welcome screen with animated feature showcase
- [x] Personalised greeting with username (Account modal)
- [x] Chat mode with SSE streaming responses
- [x] Markdown rendering (headers, code blocks, tables, lists)
- [x] Message timestamps, copy, edit, reload
- [x] Auto-generated chat titles (markdown-stripped)
- [x] Tab strip (recent sessions, auto-evict oldest, dismiss without delete)
- [x] Left sidebar: Chats + Projects history, rename, delete, metadata
- [x] Responsive layout (auto-collapse sidebars on resize)
- [x] Right sidebar (project sessions only)
- [x] Auto project onboarding (file scan + AI summary)
- [x] Native folder picker (Tauri dialog plugin)
- [x] VSCode-style terminal panel (xterm.js, multi-tab, PTY)
- [x] Project flow graph (SVG, colour-coded, zoom/pan, fullscreen)

### Phase 1 — Core coding workflow ✅
- [x] Agent creation UI (5 roles: Fullstack, Frontend, Backend, Test, Review)
- [x] Integrated terminal (node-pty PTY, multi-tab, Output/Problems/Debug/Ports panels)
- [x] Project flow graph (radial layout, auto-fit, reset view)

### Phase 2 — Intelligence layer (in progress)
- [x] Internet RAG pipeline (DuckDuckGo, automatic heuristic trigger, source citations)
- [x] Model Advisor (latency tracking, token speed, error log, smart suggestions, TopBar chip)
- [ ] Knowledge graph (cross-agent symbol tracker — functions, classes, types across files)
- [ ] API contract enforcer (FE/BE interface mismatch detection)

### Phase 3 — Polish
- [ ] Git structure panel (commit history, branch view, diff viewer)
- [ ] Preview on device (QR code dev server)

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
