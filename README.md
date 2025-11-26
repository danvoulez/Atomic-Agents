# Atomic Agents

> An autonomous AI engineering team that can understand, plan, build, review, and evaluate code changes.

[![CI](https://github.com/danvoulez/Atomic-Agents/actions/workflows/ci.yml/badge.svg)](https://github.com/danvoulez/Atomic-Agents/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/danvoulez/Atomic-Agents/pulls)

## Overview

AI Coding Team is a production-ready system for autonomous code generation and modification. It combines:

- **TDLN (Truth, Determinism, LogLine, NAPI)**: Rust machinery for verifiable AI actions
- **Multi-Agent Architecture**: Specialized agents that collaborate on tasks
- **Append-Only Ledger**: Complete audit trail with provenance tracking
- **Budget System**: Resource limits ensuring predictable costs and safety

## Quick Start

```bash
# Install dependencies
pnpm install

# Start PostgreSQL
docker compose up -d postgres

# Apply migrations
DATABASE_URL=postgres://postgres:devpassword@localhost:55432/ai_coding_team \
  pnpm --filter @ai-coding-team/db migrate

# Build packages
pnpm build

# Start dashboard
pnpm --filter @ai-coding-team/dashboard dev
```

**→ [Full Quickstart Guide](docs/getting-started/quickstart.md)**

## Documentation

| Section | Description |
|---------|-------------|
| **[Getting Started](docs/getting-started/)** | Installation, setup, first job |
| **[Architecture](docs/architecture/)** | System design, agents, database |
| **[Guides](docs/guides/)** | Development, testing, deployment |
| **[Reference](docs/reference/)** | API, tools, configuration |
| **[Concepts](docs/concepts/)** | Philosophy, budgets, provenance |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Dashboard (Next.js)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                        Worker Pool                               │
│  Coordinator → Planner → Builder → Reviewer → Evaluator         │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                     TDLN Machinery (Rust)                        │
│    tdln-in → policy → quality → tdln-out → truthpack            │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                     PostgreSQL (Ledger)                          │
└─────────────────────────────────────────────────────────────────┘
```

## Key Features

### Two Operating Modes

| Mode | Steps | Tokens | Use Case |
|------|-------|--------|----------|
| **mechanic** | 20 | 50k | Bug fixes, small changes |
| **genius** | 100 | 200k | Features, refactoring |

### Specialized Agents

- **Coordinator**: Routes requests, manages chat
- **Planner**: Analyzes code, creates plans
- **Builder**: Writes code, runs tests
- **Reviewer**: Reviews changes
- **Evaluator**: Scores quality
- **Watcher**: Detects patterns

### Safety Features

- Budget limits (steps, tokens, time)
- Policy gates and quality checks
- Human escalation
- Append-only audit trail

## Project Structure

```
ai-coding-team/
├── crates/                 # Rust TDLN machinery
│   ├── tdln-in/           # Input processing
│   ├── tdln-out/          # Output rendering
│   ├── tdln-policy/       # Policy enforcement
│   └── ...
├── packages/               # TypeScript packages
│   ├── agents/            # Agent implementations
│   ├── dashboard/         # Next.js UI
│   ├── db/                # Database layer
│   ├── tools/             # Agent tools
│   └── worker/            # Job processor
├── docs/                   # Documentation
├── grammars/              # TDLN grammars
├── infra/                 # Terraform
├── testing/               # Test infrastructure
└── docker-compose.yml     # Local development
```

## Development

```bash
# Run tests
pnpm test

# Run specific test level
pnpm test:l0  # Infrastructure
pnpm test:l1  # Tools
pnpm test:l2  # Agent loops

# Build Rust machinery
cargo build --release

# Start all services
docker compose up -d
```

## Configuration

```bash
# Required
DATABASE_URL=postgres://user:pass@host:5432/db
OPENAI_API_KEY=sk-...  # or ANTHROPIC_API_KEY

# Optional
WORKER_MODE=mechanic
LOG_LEVEL=info
```

**→ [Configuration Reference](docs/getting-started/configuration.md)**

## API Example

```bash
# Create a job
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Add error handling to the login function",
    "mode": "mechanic",
    "repoPath": "/path/to/repo"
  }'

# Stream events
curl http://localhost:3000/api/jobs/{id}/stream
```

**→ [API Reference](docs/reference/api.md)**

## Test Status

| Level | Tests | Status |
|-------|-------|--------|
| L0 - Infrastructure | 35 | ✅ Pass |
| L1 - Tools | 89 | ✅ Pass |
| L2 - Agent Loops | 6 | ✅ Pass |
| L3 - E2E | - | Weekly |
| L4 - Chaos | - | On demand |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests (`pnpm test`)
5. Submit a pull request

**→ [Contributing Guidelines](docs/contributing/guidelines.md)**

## License

MIT License - See [LICENSE](LICENSE) for details.

---

**[📚 Full Documentation](docs/README.md)** | **[🚀 Quickstart](docs/getting-started/quickstart.md)** | **[📖 API Reference](docs/reference/api.md)**

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/danvoulez">@danvoulez</a>
</p>
