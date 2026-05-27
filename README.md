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
- At least one model pulled: `ollama pull qwen3.5:8b` (recommended) or `ollama pull llama4`
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

# Start the agent server + desktop app together
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
│   │       ├── orchestrator/ # TaskQueue, AgentSession, Orchestrator
│   │       ├── persistence/  # Database, TaskLog, Checkpointer
│   │       ├── mcp/          # MCP filesystem + git client
│   │       ├── ollama/       # Ollama API wrapper
│   │       ├── rag/          # Internet RAG pipeline
│   │       └── advisor/      # Model update checker
│   └── shared/               # Shared types and utilities
└── docs/                     # Architecture and research notes
```

---

## Roadmap

- [x] Project scaffold and monorepo setup
- [ ] Agent core: TaskQueue + write-ahead log
- [ ] Ollama client with model fallback
- [ ] MCP filesystem integration
- [ ] Crash recovery: checksum verifier
- [ ] React UI: chat + file tree + agent status
- [ ] Active project switcher sidebar
- [ ] Integrated terminal (xterm.js)
- [ ] Hardware-aware scheduler
- [ ] Internet RAG pipeline
- [ ] Model advisor
- [ ] Knowledge graph
- [ ] API contract enforcer
- [ ] Preview on device (QR code)

---

## Contributing

LocalForge is in active early development. Contributions, issues, and feature requests are welcome.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
