# Architecture Overview

A comprehensive guide to the AI Coding Team system architecture.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              USER LAYER                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Browser   │  │     CLI     │  │     API     │  │   Webhook   │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
└─────────┼────────────────┼────────────────┼────────────────┼───────────┘
          │                │                │                │
          └────────────────┴────────┬───────┴────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────┐
│                              PRESENTATION                                │
│  ┌────────────────────────────────┴───────────────────────────────────┐ │
│  │                      Dashboard (Next.js)                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │ │
│  │  │   Chat   │  │   Jobs   │  │ Metrics  │  │  Notifications   │   │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘   │ │
│  └────────────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │ REST / SSE
┌───────────────────────────────────┼─────────────────────────────────────┐
│                                API LAYER                                 │
│  ┌────────────────────────────────┴───────────────────────────────────┐ │
│  │  /api/chat    /api/jobs    /api/metrics    /api/events            │ │
│  │  Rate Limiting │ CORS │ Request Validation │ Error Handling        │ │
│  └────────────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────┐
│                            ORCHESTRATION                                 │
│  ┌────────────────────────────────┴───────────────────────────────────┐ │
│  │                        Worker Pool                                  │ │
│  │  ┌─────────────────────────────────────────────────────────────┐   │ │
│  │  │                      Agent System                            │   │ │
│  │  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────┐ │   │ │
│  │  │  │Coordinator│  │  Planner  │  │  Builder  │  │ Reviewer │ │   │ │
│  │  │  └───────────┘  └───────────┘  └───────────┘  └──────────┘ │   │ │
│  │  │  ┌───────────┐  ┌───────────┐                               │   │ │
│  │  │  │ Evaluator │  │  Watcher  │                               │   │ │
│  │  │  └───────────┘  └───────────┘                               │   │ │
│  │  └─────────────────────────────────────────────────────────────┘   │ │
│  │  ┌─────────────────────────────────────────────────────────────┐   │ │
│  │  │                      Tool System                             │   │ │
│  │  │  READ: read_file, search_code, list_files, get_repo_state   │   │ │
│  │  │  WRITE: apply_patch, run_tests, run_lint, commit_changes    │   │ │
│  │  │  META: record_analysis, create_plan, request_human_review   │   │ │
│  │  │  IDE: semantic_search, find_files, web_search, read_lints   │   │ │
│  │  └─────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────┐
│                          TDLN MACHINERY                                  │
│  ┌────────────────────────────────┴───────────────────────────────────┐ │
│  │                         TDLN Pipeline                               │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │ │
│  │  │ tdln-in │→ │ policy  │→ │ quality │→ │tdln-out │→ │truthpack│  │ │
│  │  │ (parse) │  │ (gate)  │  │ (check) │  │(render) │  │(provn.) │  │ │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                             │ │
│  │  │ logline │  │ stages  │  │registry │  ← Supporting crates        │ │
│  │  │(parser) │  │(config) │  │(schemas)│                             │ │
│  │  └─────────┘  └─────────┘  └─────────┘                             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────┐
│                           DATA LAYER                                     │
│  ┌────────────────────────────────┴───────────────────────────────────┐ │
│  │                        PostgreSQL                                   │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │ │
│  │  │  jobs   │  │ events  │  │ ledger  │  │messages │  │  evals  │  │ │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  │ │
│  │                    ↑ Append-Only Ledger ↑                          │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Dashboard (Presentation Layer)

The Next.js frontend provides:
- **Chat Interface**: WhatsApp-style async conversation with agents
- **Job Monitor**: Real-time job status and events
- **Metrics Dashboard**: System health and performance
- **Notification Board**: Unified alerts and insights

**Key Files**: `packages/dashboard/`

### 2. API Layer

RESTful API with Server-Sent Events (SSE) for real-time updates:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jobs` | GET/POST | List and create jobs |
| `/api/jobs/[id]` | GET | Get job details |
| `/api/jobs/[id]/cancel` | POST | Cancel a job |
| `/api/jobs/[id]/stream` | GET (SSE) | Stream job events |
| `/api/chat` | POST | Send chat message |
| `/api/chat/stream` | GET (SSE) | Stream responses |
| `/api/metrics` | GET | Get metrics |
| `/api/metrics/stream` | GET (SSE) | Stream metrics |
| `/api/events` | GET | Get events |
| `/api/messages` | GET/POST | Conversation messages |

### 3. Worker Pool (Orchestration)

Workers poll the database for jobs and process them:

```typescript
// Job claiming with SKIP LOCKED
SELECT * FROM jobs WHERE status = 'queued' AND mode = $1
ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;

// Update to running
UPDATE jobs SET status = 'running', started_at = NOW()...
```

**Key Features**:
- PostgreSQL-based job queue (no Redis needed)
- Heartbeat monitoring
- Stale job detection and requeueing
- Graceful shutdown

### 4. Agent System

Six specialized agents collaborate on tasks:

| Agent | Role | Tools |
|-------|------|-------|
| **Coordinator** | Routes requests, manages chat | delegate, ask_user, format_response |
| **Planner** | Analyzes code, creates plans | read_file, search_code, create_plan |
| **Builder** | Writes and tests code | apply_patch, run_tests, commit_changes |
| **Reviewer** | Reviews changes | read_file, create_review |
| **Evaluator** | Scores job quality | analyze_job, create_evaluation |
| **Watcher** | Detects patterns | query_ledger, create_insight |

### 5. TDLN Machinery (Rust)

The Truth, Determinism, LogLine, NAPI system provides:

- **tdln-in**: Parse natural language → structured intent
- **tdln-policy**: Enforce rules and limits
- **tdln-quality**: Check output quality
- **tdln-out**: Render structured → natural language
- **tdln-truthpack**: Track provenance
- **logline**: Parse LogLine language

### 6. Data Layer (PostgreSQL)

#### Tables

| Table | Purpose |
|-------|---------|
| `jobs` | Job definitions and status |
| `events` | Tool calls, results, errors |
| `ledger` | Append-only audit trail |
| `conversations` | Chat sessions |
| `messages` | Chat messages |
| `evaluations` | Job quality scores |

#### Append-Only Ledger

All changes are recorded in the ledger:
- No UPDATE or DELETE operations
- Status derived from latest entry
- Full audit trail
- Cross-project knowledge

## Data Flow

### 1. Job Creation Flow

```
User Input
    │
    ▼
┌─────────────────┐
│ TDLN-IN Parse   │ ← Natural language → LogLine
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Policy Check    │ ← Validate against rules
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Insert Job      │ ← Store in database
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Append to       │ ← Audit trail
│ Ledger          │
└─────────────────┘
```

### 2. Job Processing Flow

```
Worker Claims Job
    │
    ▼
┌─────────────────┐
│ Create Agent    │ ← Coordinator starts
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Agent Loop      │────▶│ Tool Execution  │
│ (LLM calls)     │◀────│ (read, write)   │
└────────┬────────┘     └─────────────────┘
         │
         │ Budget check, cancel check
         ▼
┌─────────────────┐
│ Quality Gate    │ ← Validate changes
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ TDLN-OUT Render │ ← Generate response
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Update Status   │ ← succeeded/failed
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create TruthPack│ ← Provenance record
└─────────────────┘
```

### 3. Real-Time Updates Flow

```
Client (SSE)                Server                  Database
    │                         │                         │
    │──── GET /stream ───────▶│                         │
    │                         │                         │
    │                         │◀── LISTEN events ───────│
    │                         │                         │
    │◀── event: snapshot ─────│                         │
    │                         │                         │
    │        ...              │        ...              │
    │                         │                         │
    │                         │◀── NOTIFY event ────────│
    │◀── event: update ───────│                         │
    │                         │                         │
```

## Technology Stack

### Backend
- **Runtime**: Node.js 20
- **Language**: TypeScript 5
- **Build**: Turbo, pnpm workspaces
- **Rust**: NAPI-RS for native bindings

### Frontend
- **Framework**: Next.js 14
- **Styling**: Tailwind CSS
- **State**: React hooks

### Database
- **Primary**: PostgreSQL 15
- **Features**: SKIP LOCKED, LISTEN/NOTIFY, JSONB

### Infrastructure
- **Container**: Docker
- **IaC**: Terraform
- **Cloud**: AWS (ECS, RDS, ALB)
- **CI/CD**: GitHub Actions

## Scaling Considerations

### Horizontal Scaling

Workers scale horizontally:
```yaml
# docker-compose
services:
  worker:
    deploy:
      replicas: 10  # Scale workers
```

### Database Performance

- Index on `(status, mode, created_at)` for job claiming
- SKIP LOCKED prevents contention
- LISTEN/NOTIFY for real-time without polling

### Cost Control

Budgets limit resource usage:
- Token limits per job
- Step limits per job
- Time limits per job
- Automatic escalation when exceeded

## Security Model

### Agent Permissions

Agents have Role-Based Access Control (RBAC):
- Read-only access to ledger
- Append-only writes (no DELETE/UPDATE)
- Scoped to their job/conversation

### Tool Safety

Tools categorized by risk:
- `safe`: read_file, search_code
- `reversible`: apply_patch, commit_changes
- `dangerous`: None by default

### Quality Gates

All changes must pass:
- Patch size limits (mechanic mode)
- Test execution
- Lint validation
- Human review (for risky changes)

## Related Documentation

- [TDLN Deep Dive](./tdln.md)
- [Agent System](./agents.md)
- [Database Schema](./database.md)
- [API Reference](../reference/api.md)

