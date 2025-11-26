# AI Coding Team - Remaining Work to Match plan.md

> Generated: 2025-11-26
> Status: Post-restructuring (TDLN-Pure → crates/)

## ✅ Completed

- [x] Project structure matches plan (monorepo with `packages/` + `crates/`)
- [x] Root `Cargo.toml` workspace with all 11 Rust crates
- [x] `packages/machinery` wired to NAPI bindings with JS fallbacks
- [x] TypeScript types package (`@ai-coding-team/types`)
- [x] Worker loop with job claiming, heartbeats, stale recovery
- [x] Dashboard Chat component with SSE support
- [x] Database migrations for core tables (jobs, events, messages)
- [x] Rust crates compile successfully

---

## 🔴 Critical Path (Must Have)

### 1. Build & Deploy NAPI Bindings
```bash
# Currently missing: compiled .node files
pnpm napi:build  # Needs @napi-rs/cli installed
```
**Files:** `crates/napi-bindings/`
**Effort:** 1 day

### 2. Complete Database Schema
**Missing columns in `jobs` table:**
- `trace_id UUID NOT NULL`
- `agent_type VARCHAR(20) NOT NULL`
- `repo_path TEXT NOT NULL`
- `assigned_to VARCHAR(50)`
- `cancel_requested_at TIMESTAMPTZ`
- `logline_span TEXT`
- `span_hash VARCHAR(64)`
- `parent_job_id UUID REFERENCES jobs(id)`
- `proof_ref UUID`
- `created_by VARCHAR(50) NOT NULL`

**Missing columns in `events` table:**
- `trace_id UUID NOT NULL`
- `tool_name VARCHAR(50)`
- `params JSONB`
- `result JSONB`
- `duration_ms INTEGER`
- `tokens_used INTEGER`
- `cost_cents INTEGER`
- `span_hash VARCHAR(64)`

**Missing table:**
```sql
CREATE TABLE evaluations (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id),
  correctness REAL,
  efficiency REAL,
  honesty REAL,
  safety REAL,
  flags JSONB,
  feedback TEXT,
  evaluated_by VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Files:** `packages/db/migrations/008_complete_schema.sql`
**Effort:** 2-3 hours

### 3. Implement Agent LLM Integration
**Current state:** Agents are stubs with no LLM calls.

**Need to implement in `packages/agents/src/base.ts`:**
- LLM client injection (OpenAI/Anthropic SDK)
- Full `run(job)` execution loop
- System prompt generation with "Untrusted Brain Contract"
- Tool dispatch with budget tracking
- Output summarization before feeding back to LLM

**Files:** 
- `packages/agents/src/base.ts` - Full implementation
- `packages/agents/prompts/contracts.ts` - Untrusted brain contract
- `packages/agents/prompts/system.ts` - System prompt builder

**Effort:** 3-5 days

### 4. Implement Coordinator Routing
**Current state:** Echo tool placeholder only.

**Need to implement:**
- TDLN-IN translation call
- Intent → agent routing (bug_fix → planner, feature → planner, etc.)
- Job creation with proper schema
- TDLN-OUT rendering for responses

**Files:** `packages/agents/src/coordinator.ts`
**Effort:** 2-3 days

### 5. Implement Planner Agent
**Need:**
- Analysis workflow (read_file, search_code, list_files)
- `record_analysis` tool integration
- `create_plan` with LogLine PLAN span

**Files:** `packages/agents/src/planner.ts`
**Effort:** 2-3 days

### 6. Implement Builder Agent
**Need:**
- Plan execution loop
- Branch creation
- Patch application with constraint checking
- Test/lint execution
- Commit creation
- RESULT span generation

**Files:** `packages/agents/src/builder.ts`
**Effort:** 3-4 days

---

## 🟡 Important (Should Have)

### 7. Complete Tool Implementations
**Current:** Most tools are stubs returning success.

| Tool | File | Status |
|------|------|--------|
| `read_file` | `read/read_file.ts` | ✅ Basic impl |
| `search_code` | `read/search_code.ts` | ⚠️ Stub |
| `list_files` | `read/list_files.ts` | ⚠️ Stub |
| `get_repo_state` | `read/get_repo_state.ts` | ⚠️ Stub |
| `create_branch` | `write/create_branch.ts` | ⚠️ Stub |
| `apply_patch` | `write/apply_patch.ts` | ⚠️ Stub |
| `run_tests` | `write/run_tests.ts` | ⚠️ Stub |
| `run_lint` | `write/run_lint.ts` | ⚠️ Stub |
| `commit_changes` | `write/commit_changes.ts` | ⚠️ Stub |
| `record_analysis` | `meta/record_analysis.ts` | ⚠️ Stub |
| `create_plan` | `meta/create_plan.ts` | ⚠️ Stub |
| `create_result` | `meta/create_result.ts` | ⚠️ Stub |
| `request_human_review` | `meta/request_human_review.ts` | ⚠️ Stub |

**Effort:** 4-5 days total

### 8. Reviewer Agent
**Need:**
- Diff review logic
- Approval/rejection flow
- Feedback generation

**Files:** `packages/agents/src/reviewer.ts`
**Effort:** 1-2 days

### 9. Evaluator Agent
**Need:**
- Post-run job analysis
- Correctness/efficiency/honesty/safety scoring
- Hallucination detection
- `record_evaluation` implementation

**Files:** `packages/agents/src/evaluator.ts`
**Effort:** 1-2 days

### 10. Expand Grammars
**Current:** Minimal patterns.

**Need to add per plan.md:**
- Full intent rules with priority ordering
- Entity extraction (code_reference, phrase)
- Mode overrides
- ABSTAIN handling with clarifications

**Files:** 
- `grammars/coding-intents.yaml`
- `grammars/response-templates.yaml`

**Effort:** 1-2 days

---

## 🟢 Nice to Have (Could Have)

### 11. Rust TDLN-IN Enhancements
**Files:** `crates/tdln-in/src/`
- Implement full grammar matching in Rust
- Entity extraction
- Confidence scoring

**Effort:** 3-5 days

### 12. Rust TDLN-OUT Enhancements
**Files:** `crates/tdln-out/src/`
- Full template rendering with Handlebars
- Citation attachment
- TruthPack generation

**Effort:** 2-3 days

### 13. API Handlers
**Files:** `crates/tdln-api/src/handlers.rs`
- Implement /v1/compile with real logic
- Implement /v1/verify
- Add metrics and tracing

**Effort:** 2-3 days

### 14. Infrastructure
**Files:** `infra/*.tf`
- Complete Terraform modules (currently placeholders)
- ECS task definitions
- RDS configuration
- CloudWatch dashboards

**Effort:** 3-5 days

### 15. CI/CD
**Missing:** `.github/workflows/`
- `ci.yml` - Build, test, lint
- `deploy.yml` - ECR push, ECS deploy

**Effort:** 1-2 days

### 16. Dashboard Enhancements
**Current:** Basic chat and job list.

**Need:**
- EventTimeline implementation
- Metrics panel
- Job detail view
- Admin controls

**Files:** `packages/dashboard/src/components/`
**Effort:** 2-3 days

---

## 📊 Summary by Effort

| Priority | Items | Total Effort |
|----------|-------|--------------|
| 🔴 Critical | 1-6 | ~15-20 days |
| 🟡 Important | 7-10 | ~8-12 days |
| 🟢 Nice to Have | 11-16 | ~14-21 days |

**Estimated Total:** 37-53 person-days to full plan.md parity

---

## 🏃 Recommended Sprint Plan

### Sprint 1 (Week 1-2): Foundation
- [ ] Build NAPI bindings
- [ ] Complete database schema
- [ ] Implement base agent with LLM integration
- [ ] Implement coordinator routing

### Sprint 2 (Week 2-3): Core Agents
- [ ] Implement planner agent
- [ ] Implement builder agent
- [ ] Complete read tools

### Sprint 3 (Week 3-4): Write Path
- [ ] Complete write tools
- [ ] Implement reviewer
- [ ] Implement evaluator

### Sprint 4 (Week 4-5): Polish
- [ ] Expand grammars
- [ ] Dashboard enhancements
- [ ] Infrastructure deployment
- [ ] CI/CD pipelines

