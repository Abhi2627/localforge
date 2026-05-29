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

### Core infrastructure
- [x] Project scaffold and monorepo setup
- [x] Agent core: TaskQueue + write-ahead log
- [x] Ollama client with model fallback chain
- [x] MCP filesystem integration
- [x] Crash recovery: 3-layer checksum verifier
- [x] Hardware-aware scheduler (auto parallel/sequential)
- [x] Session persistence (SQLite — chats + projects survive restart)

### Desktop UI
- [x] Welcome screen with animated feature showcase
- [x] Personalised greeting with username (Account modal)
- [x] Chat mode with SSE streaming responses
- [x] Markdown rendering (headers, code blocks, tables, lists)
- [x] Message timestamps, copy, edit, reload
- [x] Auto-generated chat titles (markdown-stripped)
- [x] Tab strip (recent sessions, fixed order, dismiss without delete)
- [x] Left sidebar: Chats + Projects history, rename, delete
- [x] Responsive layout (auto-collapse sidebars on resize)
- [x] Right sidebar (project sessions only)
- [x] Auto project onboarding (file scan + AI summary)
- [x] Native folder picker (Tauri dialog plugin)

### Phase 1 — Core coding workflow ✅
- [x] Agent creation UI (5 roles: Fullstack, Frontend, Backend, Test, Review)
- [x] Integrated terminal (xterm.js + node-pty PTY — project sessions only)
- [x] Project flow graph (SVG auto-generated, colour-coded by file type)

### Phase 2 — Intelligence layer
- [ ] Internet RAG pipeline (live web context injection)
- [ ] Model advisor (failure tracker + Ollama registry checker)
- [ ] Knowledge graph (cross-agent symbol tracker)
- [ ] API contract enforcer (FE/BE interface mismatch detection)

### Phase 3 — Polish
- [ ] Preview on device (QR code dev server)
- [ ] Git structure panel (commit history, branch view)

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
