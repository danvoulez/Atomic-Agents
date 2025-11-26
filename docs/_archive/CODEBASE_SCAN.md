# AI Coding Team - Comprehensive Codebase Scan

> **Generated**: November 2025
> **Status**: Ready for Testing Phase

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RUST MACHINERY (crates/)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   logline   │  │   tdln-in   │  │  tdln-out   │  │ tdln-quality│       │
│  │  (Parser)   │  │ (Compiler)  │  │ (Renderer)  │  │  (Gates)    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│  ┌─────────────┐  ┌─────────────┐                                          │
│  │  truthpack  │  │napi-bindings│                                          │
│  │  (Proofs)   │  │  (FFI)      │                                          │
│  └─────────────┘  └─────────────┘                                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ NAPI-RS Bindings
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      TYPESCRIPT ORCHESTRATION (packages/)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ Coordinator │  │   Planner   │  │   Builder   │  │  Reviewer   │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │  Evaluator  │  │   Watcher   │  │  Dashboard  │  │   Worker    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Package Status

### 2.1 packages/agents ✅ COMPLETE

| Module | Status | Description |
|--------|--------|-------------|
| `base.ts` | ✅ | BaseAgent with run loop, cancellation, budget checks |
| `coordinator.ts` | ✅ | Routes work, manages jobs, escalates to human |
| `planner.ts` | ✅ | Analyzes codebase, creates execution plans |
| `builder.ts` | ✅ | Applies patches, runs tests, commits changes |
| `reviewer.ts` | ✅ | Reviews code changes, approves/rejects PRs |
| `evaluator.ts` | ✅ | Post-job scoring for correctness, efficiency, honesty |

**Sub-modules:**
| Module | Status | Description |
|--------|--------|-------------|
| `llm/factory.ts` | ✅ | LLM client factory (OpenAI, Anthropic, Mock) |
| `llm/openai.ts` | ✅ | OpenAI client with tool calling |
| `llm/anthropic.ts` | ✅ | Anthropic client with tool calling |
| `llm/mock.ts` | ✅ | Mock LLM for deterministic testing |
| `tools/` | ✅ | 40+ tools across all agents |
| `conversation/mode.ts` | ✅ | WhatsApp-style async conversation |
| `watcher/insights.ts` | ✅ | Wise Observer pattern detection |
| `notifications/broadcast.ts` | ✅ | TDLN-OUT notification system |
| `tracing/otel.ts` | ✅ | OpenTelemetry integration |
| `reasoning/traces.ts` | ✅ | Structured reasoning capture |
| `context/manager.ts` | ✅ | Context window management |
| `verification/fuzzy.ts` | ✅ | Fuzzy verification for tests |

### 2.2 packages/db ✅ COMPLETE

| Module | Status | Description |
|--------|--------|-------------|
| `index.ts` | ✅ | Main exports |
| `jobs.ts` | ✅ | CRUD for jobs table |
| `events.ts` | ✅ | Event logging and queries |
| `ledger.ts` | ✅ | Append-only ledger system |
| `rbac.ts` | ✅ | Role-Based Access Control |
| `schema.ts` | ✅ | Database schema types |
| `client.ts` | ✅ | PostgreSQL connection pool |

**Ledger Features:**
- Append-only (no UPDATE/DELETE)
- Cross-project knowledge sharing
- Status derived from latest entry
- Full audit trail

### 2.3 packages/worker ✅ COMPLETE

| Module | Status | Description |
|--------|--------|-------------|
| `index.ts` | ✅ | Worker class with job processing |
| `loop.ts` | ✅ | Main polling loop |
| `claim.ts` | ✅ | FOR UPDATE SKIP LOCKED claiming |
| `metrics.ts` | ✅ | Prometheus metrics |

### 2.4 packages/dashboard ✅ COMPLETE

| Feature | Status | Description |
|---------|--------|-------------|
| `/api/jobs` | ✅ | Jobs CRUD API |
| `/api/chat` | ✅ | Async chat API with SSE |
| `/api/chat/stream` | ✅ | SSE streaming endpoint |
| `/chat` | ✅ | Chat UI page |
| Dark mode | ✅ | Full dark/light theme support |
| Real-time updates | ✅ | SSE for job status |

### 2.5 packages/types ✅ COMPLETE

- Tool interface definitions
- Job/Event types
- LogLine types
- Shared schema types

### 2.6 packages/tools ✅ COMPLETE

| Category | Count | Tools |
|----------|-------|-------|
| READ_ONLY | 12 | read_file, search_code, list_files, get_repo_state, semantic_search, web_search, read_lints, find_files, browser_snapshot, browser_screenshot, browser_wait |
| MUTATING | 10 | apply_patch, run_tests, run_lint, commit_changes, create_branch, browser_navigate, browser_click, browser_type, browser_close |
| META | 7 | record_analysis, create_plan, request_human_review, create_result, delegate_to_agent, check_job_status, ask_user |

---

## 3. Rust Crates Status

### 3.1 crates/logline ✅ COMPLETE

- Pest grammar parser
- LogLine AST types
- Validation functions

### 3.2 crates/tdln-in ✅ COMPLETE

| Module | Status | Description |
|--------|--------|-------------|
| `lib.rs` | ✅ | Main entry point |
| `grammar.rs` | ✅ | Grammar loading |
| `normalizer.rs` | ✅ | Text normalization |
| `matcher.rs` | ✅ | Pattern matching |
| `entities.rs` | ✅ | Entity extraction |
| `prover.rs` | ✅ | Proof generation |

### 3.3 crates/tdln-out ✅ COMPLETE

| Module | Status | Description |
|--------|--------|-------------|
| `lib.rs` | ✅ | Main entry point |
| `renderer.rs` | ✅ | JSON → Natural language |
| `templates.rs` | ✅ | Handlebars templates |
| `citations.rs` | ✅ | Citation generation |

### 3.4 crates/tdln-quality ✅ COMPLETE

- Quality gates implementation
- Patch size limits
- Token budget checks

### 3.5 crates/truthpack ✅ COMPLETE

- Merkle tree provenance
- Hash chains
- Proof verification

### 3.6 crates/napi-bindings ✅ COMPLETE

- NAPI-RS bindings for all crates
- TypeScript type generation

---

## 4. Features Summary

### 4.1 Core Agent Flow

```
User Request → TDLN-IN → Coordinator → Planner → Builder → Reviewer → Evaluator → TDLN-OUT → Response
```

### 4.2 Conversation Mode (NEW)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ASYNC CHAT FLOW                                      │
│                                                                              │
│  User Message                                                                │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────┐                                                            │
│  │  POST       │ → Returns immediately with receipt                         │
│  │  /api/chat  │                                                            │
│  └─────────────┘                                                            │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │  BACKGROUND PROCESSING                                       │           │
│  │                                                               │           │
│  │  1. analyzeIntent() → job_request | status | discussion       │           │
│  │  2. generateResponse() or queueJob()                          │           │
│  │  3. Persist to append-only ledger                            │           │
│  │  4. Broadcast via SSE                                        │           │
│  └─────────────────────────────────────────────────────────────┘            │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────┐                                                            │
│  │  SSE Stream │ → Client receives updates                                  │
│  │  /chat/     │    status: thinking → typing → idle                        │
│  │  stream     │    message: {...}                                          │
│  └─────────────┘                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Append-Only Ledger (NEW)

```sql
-- All changes are recorded as new entries (no UPDATE/DELETE)
-- Status is derived from the latest entry

ledger:
  kind: "message" | "event" | "job_status" | "knowledge" | "notification"
  job_id, conversation_id, project_id
  actor_type: "user" | "agent" | "system"
  actor_id: "coordinator" | "planner" | etc.
  summary, data (JSONB)
```

### 4.4 RBAC for Agents (NEW)

| Role | Can Read | Can Append |
|------|----------|------------|
| Coordinator | All | messages, events, job_status |
| Planner | All | analysis, plans |
| Builder | All | patches, events |
| Reviewer | All | reviews |
| Evaluator | All | evaluations |
| Admin | All | All |

### 4.5 Insights Watcher (NEW)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WISE OBSERVER                                        │
│                                                                              │
│  Periodic Analysis:                                                          │
│  - Token spikes across jobs                                                  │
│  - Repeated errors/escalations                                               │
│  - Redundant work detection                                                  │
│  - Success pattern identification                                            │
│  - Budget trajectory warnings                                                │
│  - Knowledge gaps                                                            │
│                                                                              │
│  Outputs:                                                                    │
│  - Insights with severity levels                                            │
│  - Recommendations                                                           │
│  - Proposed global rules                                                    │
│  - Project notes after completion                                           │
│                                                                              │
│  All outputs → TDLN-OUT → Chat notifications                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.6 Unified Notification System (NEW)

All important events flow through TDLN-OUT to the chat:

| Event Type | Example Message |
|------------|-----------------|
| `project_completed` | ✅ Project completed: **MyProject** |
| `job_started` | 🚀 Started working on: Fix login bug |
| `insight_discovered` | 🦉 **Insight**: Token usage spike detected |
| `budget_warning` | ⚠️ **Budget warning**: 80% used |
| `escalation_required` | 🙋 **Needs your attention**: Unclear requirements |

---

## 5. Testing Infrastructure

### 5.1 Test Levels

| Level | Purpose | Status |
|-------|---------|--------|
| L0 | Infrastructure (worker lifecycle) | ✅ 6 tests |
| L1 | Tool tests (individual tools) | ✅ 20+ tests |
| L2 | Agent loop (single job scenarios) | ✅ 6 scenarios |
| L3 | E2E batch (multiple jobs, real queue) | ✅ Configured |
| L4 | Adversarial/Chaos | ✅ Configured |

### 5.2 Test Fixtures

```
testing/fixtures/repos/
├── simple-ts/       # TypeScript project with Jest
├── simple-rust/     # Rust project with cargo
├── broken-tests/    # Project with failing tests
└── large-file/      # Large file for truncation tests
```

### 5.3 Mock LLM

```
testing/mock-llm/
├── server.js        # Express server
├── scenarios/       # Pre-canned responses
└── Dockerfile
```

### 5.4 Docker Compose

```
docker-compose.test.yml   # Full test environment
docker-compose.l3.yml     # L3 batch tests with metrics
```

---

## 6. IDE & Browser Tools (NEW)

### 6.1 IDE-Enhanced Tools

| Tool | Description |
|------|-------------|
| `semantic_search` | Search by meaning, not just text |
| `web_search` | Search internet for docs/solutions |
| `read_lints` | Structured linter diagnostics |
| `find_files` | Glob pattern file search |

### 6.2 Browser Automation Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL |
| `browser_snapshot` | Get accessibility tree |
| `browser_click` | Click elements |
| `browser_type` | Type into inputs |
| `browser_screenshot` | Take screenshots |
| `browser_wait` | Wait for elements/text |
| `browser_close` | Close browser |

---

## 7. Advanced Features (NEW)

### 7.1 Context Window Management

- Conversation summarization
- Token counting (tiktoken)
- Oldest message pruning

### 7.2 Structured Reasoning Traces

```typescript
interface ReasoningStep {
  type: "observation" | "hypothesis" | "plan" | "action" | "reflection";
  content: string;
  confidence: number;
  evidence?: string[];
}
```

### 7.3 Self-Healing Tools

- Automatic retry with exponential backoff
- Parameter adjustment on failure
- Circuit breaker pattern

### 7.4 Fuzzy Verification

- Beyond binary pass/fail
- Semantic similarity matching
- Diff-based verification

### 7.5 OpenTelemetry Integration

- Job tracing
- Tool call spans
- LLM call spans
- Budget usage attributes

---

## 8. Infrastructure

### 8.1 AWS (Terraform)

| Component | Status |
|-----------|--------|
| VPC | ✅ Configured |
| RDS (PostgreSQL) | ✅ Configured |
| ECS (Fargate) | ✅ Configured |
| ECR | ✅ Configured |
| ALB | ✅ Configured |
| Auto Scaling | ✅ Configured |
| CloudWatch | ✅ Configured |
| Secrets Manager | ✅ Configured |

### 8.2 GitHub Actions

| Workflow | Status |
|----------|--------|
| CI (lint, test, build) | ✅ Configured |
| Deploy | ✅ Configured |
| Terraform | ✅ Configured |

---

## 9. Readiness Checklist

### 9.1 Pre-Test Checklist

- [x] All agents implemented
- [x] All tools implemented
- [x] Database schema complete
- [x] LLM clients working
- [x] Conversation mode working
- [x] Append-only ledger working
- [x] RBAC enforced
- [x] Notifications working
- [x] Insights Watcher working
- [x] Docker Compose ready
- [x] Test fixtures ready
- [x] Mock LLM ready

### 9.2 Test Execution Order

1. **L0**: `pnpm test:l0` - Infrastructure
2. **L1**: `pnpm test:l1` - Tools
3. **L2**: `pnpm test:l2` - Agent scenarios
4. **L3**: `docker compose -f docker-compose.l3.yml up` - Batch
5. **L4**: `node testing/l4/runner.js` - Adversarial

---

## 10. Known Gaps

| Area | Gap | Priority |
|------|-----|----------|
| L1 Tests | Missing `run_lint` test | Medium |
| L1 Tests | Missing browser tools tests | Low |
| Grammars | Need more TDLN-IN patterns | Medium |
| Dashboard | Command palette not implemented | Low |

---

## 11. Commands Reference

```bash
# Build all packages
pnpm build

# Run L0 tests (requires Docker PostgreSQL)
pnpm test:l0

# Run L1 tests
pnpm test:l1

# Run L2 scenarios (requires mock LLM)
pnpm test:l2

# Start full test environment
docker compose -f docker-compose.test.yml up -d

# Run with real LLM (set USE_REAL_LLM=true)
USE_REAL_LLM=true pnpm test:l2

# Build NAPI bindings
cd crates/napi-bindings && pnpm napi:build
```

---

*This scan reflects the state of the codebase as of November 2025.*

