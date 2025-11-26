# Atomic Agents Documentation

> An autonomous AI engineering team that can understand, plan, build, review, and evaluate code changes.

## Quick Navigation

| Section | Description |
|---------|-------------|
| [Getting Started](./getting-started/) | Installation, setup, and your first job |
| [Architecture](./architecture/) | System design, TDLN, agents, database |
| [Guides](./guides/) | Development, testing, deployment, monitoring |
| [Reference](./reference/) | API, tools, LogLine, configuration |
| [Concepts](./concepts/) | Philosophy, provenance, budgets |
| [Contributing](./contributing/) | Guidelines, code style, PR process |

---

## What is Atomic Agents?

Atomic Agents is a production-ready system for autonomous code generation and modification. It combines:

- **TDLN (Truth, Determinism, LogLine, NAPI)**: A Rust-based machinery that translates natural language into verifiable, structured actions
- **Multi-Agent Architecture**: Specialized agents (Coordinator, Planner, Builder, Reviewer, Evaluator, Watcher) that collaborate on tasks
- **Append-Only Ledger**: Complete audit trail with provenance tracking
- **Budget System**: Resource limits ensuring predictable costs and safety
- **Async Conversation**: WhatsApp-style chat interface with agents

## Key Features

- **Two Modes**: 
  - `mechanic` - Strict budgets, small changes (20 steps, 50k tokens)
  - `genius` - Exploratory work (100 steps, 200k tokens)
- **Full Observability**: Structured logging, metrics, real-time streaming
- **Safety First**: Policy gates, quality checks, human escalation
- **AWS-Ready**: Terraform infrastructure, ECS deployment, CloudWatch integration

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Dashboard (Next.js)                       │
│   Chat Interface │ Job Monitor │ Metrics │ Notifications        │
└────────────────────────────┬────────────────────────────────────┘
                             │ SSE/REST
┌────────────────────────────┴────────────────────────────────────┐
│                         API Layer                                │
│   /api/chat  │  /api/jobs  │  /api/metrics  │  /api/events      │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                     Worker Pool (TypeScript)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │Coordinator│  │ Planner  │  │ Builder  │  │ Reviewer │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│  ┌──────────┐  ┌──────────┐                                     │
│  │Evaluator │  │ Watcher  │   ← Agents with specialized roles   │
│  └──────────┘  └──────────┘                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                      TDLN Machinery (Rust)                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │ tdln-in │  │tdln-out │  │ policy  │  │ quality │            │
│  │ (parse) │  │(render) │  │ (gates) │  │ (check) │            │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                          │
│  │truthpack│  │ logline │  │registry │   ← Rust crates          │
│  │(provn.) │  │(parser) │  │(schemas)│                          │
│  └─────────┘  └─────────┘  └─────────┘                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                     PostgreSQL Database                          │
│   jobs │ events │ ledger │ conversations │ messages             │
│                     (append-only ledger)                         │
└─────────────────────────────────────────────────────────────────┘
```

## Documentation Structure

```
docs/
├── README.md                 ← You are here
├── getting-started/
│   ├── quickstart.md         # 5-minute setup
│   ├── installation.md       # Full installation
│   ├── configuration.md      # Environment & config
│   └── first-job.md          # Your first job
├── architecture/
│   ├── overview.md           # System architecture
│   ├── tdln.md               # TDLN machinery
│   ├── agents.md             # Agent system
│   ├── database.md           # Schema & ledger
│   └── dashboard.md          # Frontend
├── guides/
│   ├── development.md        # Local development
│   ├── testing.md            # Testing strategy
│   ├── deployment.md         # AWS deployment
│   ├── monitoring.md         # Observability
│   └── security.md           # Security
├── reference/
│   ├── api.md                # API reference
│   ├── tools.md              # Tool catalog
│   ├── logline.md            # LogLine spec
│   ├── grammars.md           # Grammar reference
│   └── config.md             # Configuration
├── concepts/
│   ├── philosophy.md         # Goals & principles
│   ├── truthpack.md          # Provenance
│   ├── budgets.md            # Budget system
│   └── conversation.md       # Async chat
└── contributing/
    ├── guidelines.md         # How to contribute
    ├── code-style.md         # Code standards
    └── pr-process.md         # PR workflow
```

## Quick Links

- **[5-Minute Quickstart →](./getting-started/quickstart.md)**
- **[Architecture Overview →](./architecture/overview.md)**
- **[API Reference →](./reference/api.md)**
- **[Testing Guide →](./guides/testing.md)**

## Project Status

| Component | Status | Test Coverage |
|-----------|--------|---------------|
| TDLN Machinery | ✅ Complete | Rust unit tests |
| Agent System | ✅ Complete | L0, L1, L2 tests |
| Database/Ledger | ✅ Complete | L0 tests |
| Dashboard | ✅ Complete | Manual testing |
| AWS Infrastructure | ✅ Complete | Terraform |
| CI/CD | ✅ Complete | GitHub Actions |

## License

MIT License - See [LICENSE](../LICENSE) for details.

