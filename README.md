# LocalForge

> Local-first AI coding agent with multi-agent orchestration, crash recovery, and MCP filesystem access — runs entirely on your machine.

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![Status](https://img.shields.io/badge/status-active%20development-orange.svg)

---

## What is LocalForge?

LocalForge turns locally installed LLMs — Qwen, Llama, Gemma, and others via Ollama — into a full agentic coding assistant. It provides a purpose-built desktop UI, MCP-powered filesystem and git access, hardware-aware multi-agent orchestration, write-ahead crash recovery, and optional internet-augmented RAG.

**No subscription. No cloud. No data leaves your machine.**

---

## Why LocalForge?

| Problem | How LocalForge solves it |
|---|---|
| Local LLMs are trapped in terminals | Purpose-built chat UI with live file tree and agent status |
| No multi-agent coding tool for local models | Hardware-aware orchestrator runs FE/BE/Test agents in parallel or sequentially |
| Crash mid-task = lost work and hallucinated restarts | Write-ahead log + filesystem checksum recovery, resumes from exact last task |
| Local models go stale on recent knowledge | Auto-triggered RAG from live web search, no retraining needed |
| No model health visibility | Tracks failures, checks Ollama registry, recommends upgrades |

---

## Features

- **Multi-agent orchestration** — assign Frontend, Backend, and Test agents to a project, each with scoped file access and a tailored system prompt
- **Hardware-aware scheduling** — auto-detects RAM and GPU, runs agents in parallel on powerful systems and sequentially on constrained ones. User-overridable.
- **Crash recovery** — every task is logged before execution. On restart, the app verifies disk state via checksum and resumes from the exact pending task — no re-prompting, no hallucination
- **Active project switcher** — right sidebar shows all live project threads as one-tap pills. Switch instantly between concurrent projects
- **Integrated terminal** — collapsible terminal panel inside the app powered by xterm.js
- **MCP filesystem + git** — agents read, write, and commit files via the Model Context Protocol
- **Internet RAG** — when the model hits its knowledge boundary, the app fetches live web context and injects it automatically
- **Model advisor** — monitors failure patterns and checks the Ollama registry for better models
- **Preview on device** — generates a QR code for mobile/tablet browser preview of built apps
- **Knowledge graph** — tracks every function and interface written to prevent cross-agent drift
- **API contract enforcer** — detects frontend/backend interface mismatches before they compound
- **Session persistence** — all chats and projects saved to local SQLite, history survives restarts
- **Auto project onboarding** — opening an existing project auto-scans all files and generates a technical summary for agents

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop app | Tauri 2.0 (Rust) + React + TypeScript |
| Agent server | Fastify + TypeScript |
| Persistence | SQLite via better-sqlite3 |
| MCP | @modelcontextprotocol/sdk |
| Local inference | Ollama (OpenAI-compatible API) |
| Terminal | xterm.js |
| Hardware detection | systeminformation |
| Internet RAG | DuckDuckGo + @mozilla/readability |

---

## Prerequisites

- [Ollama](https://ollama.ai) installed and running
- At least one model pulled: `ollama pull qwen2.5-coder` (recommended)
- Node.js 20+
- Rust (for Tauri): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/Abhi2627/localforge.git
cd localforge

# Install dependencies
npm install

# Start agent server
npm run dev:agent

# Start desktop UI (browser)
npm run dev:desktop

# Or start both together
npm run dev
```

---

## Project Structure

```
localforge/
├── apps/
│   └── desktop/              # Tauri desktop app (React + TypeScript)
│       ├── src/              # React UI
│       └── src-tauri/        # Rust backend
├── packages/
│   ├── agent-core/           # Fastify agent server
│   │   └── src/
│   │       ├── orchestrator/ # TaskQueue, AgentSession, Orchestrator, SystemProfiler
│   │       ├── persistence/  # Database, TaskLog, Checkpointer, Journal, SessionStore
│   │       ├── mcp/          # MCP filesystem client, ProjectScanner
│   │       ├── ollama/       # OllamaClient, ModelManager
│   │       ├── rag/          # Internet RAG pipeline (coming soon)
│   │       └── advisor/      # Model update checker (coming soon)
│   └── shared/               # Shared types and utilities
└── docs/                     # Architecture and research notes
```

---

## Roadmap

- [x] Project scaffold and monorepo setup
- [x] Agent core: TaskQueue + write-ahead log
- [x] Ollama client with model fallback
- [x] MCP filesystem integration
- [x] Crash recovery: checksum verifier
- [x] React UI: chat + file tree + agent status
- [x] Active project switcher sidebar
- [x] Hardware-aware scheduler (auto parallel/sequential)
- [x] Session persistence (SQLite — chats + projects survive restart)
- [x] Auto project onboarding (file scan + model-generated summary)
- [x] Native folder picker (Tauri dialog plugin)
- [x] Chat mode (conversational, no MCP, local model only)
- [x] Tab strip (recent sessions, 24h window)
- [x] Right sidebar project-only (hidden for chat sessions)
- [ ] Integrated terminal (xterm.js)
- [ ] Internet RAG pipeline
- [ ] Model advisor (failure tracker + Ollama registry checker)
- [ ] Knowledge graph (cross-agent symbol tracker)
- [ ] API contract enforcer (FE/BE interface mismatch detection)
- [ ] Preview on device (QR code dev server)
- [ ] Agent creation UI inside project session

---

## Contributing

LocalForge is in active early development. Contributions, issues, and feature requests are welcome.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
