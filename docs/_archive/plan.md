# AI Coding Team - Complete Implementation Guide

> **Version**: 1.2 | **Last Updated**: November 2025
> **Architecture**: Rust machinery + TypeScript orchestration

> **Update (Recommendations 2025-11-26)**  
> - Prefer Postgres `FOR UPDATE SKIP LOCKED` for job claiming (no Redis locks).  
> - Adopt SSE/WebSockets for dashboard updates to avoid 1s polling lag.  
> - Freeze TDLN grammar shape; accept dynamic JSON params and validate with Zod in TS.  
> - Add `cancelling` status + cooperative cancellation checks in workers/agents.  
> - Prune/summarize tool outputs before feeding them back to the LLM; keep full payloads only in the database.

## Part 1: Foundation Principles

### 1.1 The Four Pillars (from ambient.md)

#### AMBIENT - The Habitat
The ambient is NOT the agent. It's the **place** where the agent lives.

**Requirements:**
- **Never sleeps on its own** - One runtime (EC2/ECS/Lambda) that is always supervised
- **Supervised** - Something above it restarts crashed processes (systemd, ECS service)
- **Narrow responsibility** - It ONLY:
  1. Pulls work from Source of Truth
  2. Runs tools
  3. Writes results back
- **Elastic but watchful** - Can scale down (even to zero in lower envs) only when there are no queued/running jobs; must auto-wake immediately when backlog appears; never shut down with in-flight work.

**Implementation:**
```
AWS ECS Fargate Cluster
├── mechanic-worker (small model, strict limits)
│   ├── Polls jobs WHERE mode='mechanic' AND status='queued'
│   ├── Max 20 tool calls per job
│   ├── Max 60 seconds per job
│   └── Auto-scales 0-10 based on queue depth
│
└── genius-worker (large model, loose limits)
    ├── Polls jobs WHERE mode='genius' AND status='queued'
    ├── Max 100 tool calls per job
    ├── Max 300 seconds per job
    └── Auto-scales 0-3 based on queue depth
```

#### SOURCE OF TRUTH - What's Real
The **only place** the agent is allowed to believe.

**Requirements:**
- **Authoritative** - "If it's not here, it doesn't exist" for the agent
- **Auditable** - Every important decision recorded as a row/span
- **Simple schemas** - Small, boring schemas the model can reason about
- **No hidden truth** - If it's only in LLM's head, it's a suggestion, not truth

**Implementation:**
```sql
-- Every record has provenance
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,                    -- Groups all events for one user request
  
  -- Content
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('mechanic', 'genius')),
  agent_type VARCHAR(20) NOT NULL,
  goal TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  
  -- State
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'cancelling', 'waiting_human', 'succeeded', 'failed', 'aborted')),
  assigned_to VARCHAR(50),                   -- Worker ID that picked this up
  cancel_requested_at TIMESTAMPTZ,
  
  -- LogLine
  logline_span TEXT NOT NULL,                -- The actual LogLine span
  span_hash VARCHAR(64) NOT NULL,            -- SHA256 of logline_span
  
  -- Hierarchy
  parent_job_id UUID REFERENCES jobs(id),
  conversation_id UUID REFERENCES conversations(id),
  
  -- Budget
  step_cap INTEGER NOT NULL DEFAULT 20,
  steps_used INTEGER NOT NULL DEFAULT 0,
  token_cap INTEGER DEFAULT 100000,
  tokens_used INTEGER DEFAULT 0,
  cost_cap_cents INTEGER DEFAULT 10,
  cost_used_cents INTEGER DEFAULT 0,
  
  -- Provenance
  created_by VARCHAR(50) NOT NULL,           -- "coordinator", "api", "human"
  proof_ref UUID REFERENCES truth_packs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  
  -- Indexes
  CONSTRAINT valid_budget CHECK (steps_used <= step_cap)
);

CREATE INDEX idx_jobs_queue ON jobs(mode, status, created_at) WHERE status = 'queued';
CREATE INDEX idx_jobs_trace ON jobs(trace_id);
```

#### TOOLS - The Muscles
Tools are the **only way** the agent touches the world.

**Requirements:**
- **Deterministic/Idempotent** - Same input → same effect, or "already done"
- **No sneaky side effects** - All effects go via Source of Truth
- **Limited power** - Small, well-defined jobs; agent composes them
- **LLM never calls DB/APIs directly** - Only through tools

**Tool Contract:**
```typescript
interface Tool<TParams, TResult> {
  // Identity
  name: string;
  description: string;
  category: 'READ_ONLY' | 'MUTATING' | 'META';
  
  // Schema
  paramsSchema: z.ZodSchema<TParams>;
  resultSchema: z.ZodSchema<TResult>;
  
  // Execution
  execute(params: TParams, ctx: ToolContext): Promise<ToolResult<TResult>>;
  
  // Optional
  idempotencyKey?: (params: TParams) => string;
  costHint?: 'cheap' | 'moderate' | 'expensive';
  riskHint?: 'safe' | 'reversible' | 'irreversible';
}

interface ToolContext {
  jobId: string;
  traceId: string;
  repoPath: string;
  mode: 'mechanic' | 'genius';
  budget: { stepsRemaining: number; tokensRemaining: number };
  logEvent: (event: EventInput) => Promise<string>;  // Returns event_id
}

interface ToolResult<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; recoverable: boolean };
  
  // Provenance - every result points back to truth
  eventId: string;
  spanId?: string;
  hash?: string;
}
```

#### SURVEILLANCE - Eyes + Judgment
**Requirements:**
- **Structured logs per run** - One trace_id, see inputs/tools/outputs/decision
- **Health & liveness** - Is process up? Is it consuming jobs?
- **Basic metrics** - Success/fail counts, latencies, costs
- **Evaluator** - Post-run scoring for correctness, efficiency, honesty

**Implementation:**
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  trace_id UUID NOT NULL,
  
  -- Event type
  kind VARCHAR(30) NOT NULL CHECK (kind IN (
    'tool_call', 'tool_result', 
    'analysis', 'plan', 'decision',
    'error', 'escalation',
    'evaluation'  -- Post-run scoring
  )),
  
  -- Content
  tool_name VARCHAR(50),
  params JSONB,
  result JSONB,
  summary TEXT,                              -- Human-readable
  
  -- Metrics
  duration_ms INTEGER,
  tokens_used INTEGER,
  cost_cents INTEGER,
  
  -- Provenance
  span_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_job ON events(job_id, created_at);
CREATE INDEX idx_events_trace ON events(trace_id, created_at);

-- Evaluations table (separate for analysis)
CREATE TABLE evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  
  -- Scores (0.0 to 1.0)
  correctness REAL,      -- Did output match intent?
  efficiency REAL,       -- Tool calls vs minimum needed
  honesty REAL,          -- Any unsupported claims?
  safety REAL,           -- Respected all constraints?
  
  -- Details
  flags JSONB,           -- ["hallucination", "over_tool_use", etc.]
  feedback TEXT,         -- Specific improvement suggestions
  
  evaluated_by VARCHAR(50),  -- "auto", "human", "llm-critic"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Part 2: TDLN Integration

### 2.0 Hybrid Architecture: Rust + TypeScript

We strictly separate **Machinery** (deterministic, verifiable, heavy) from **Orchestration** (IO-bound, API integrations, UI).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RUST MACHINERY (Crates)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   logline   │  │   tdln-in   │  │  tdln-out   │  │ tdln-proofs │       │
│  │  (Parser)   │  │ (Compiler)  │  │ (Renderer)  │  │  (Merkle)   │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ NAPI-RS / Neon Bindings
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TYPESCRIPT ORCHESTRATION                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ Coordinator │  │   Planner   │  │   Builder   │  │  Reviewer   │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                              │                                              │
│                    ┌─────────┴─────────┐                                   │
│                    │   Tool Executors  │                                   │
│                    └───────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why Rust for Machinery?**
- **Correctness**: Parsing and proof generation must be absolutely correct.
- **Performance**: High-throughput log processing.
- **Verifiability**: Type-safe guarantees for TDLN proofs.

**Why TypeScript for Agents?**
- **Ecosystem**: Best SDKs for AWS, GitHub, OpenAI, etc.
- **Flexibility**: JSON handling and dynamic tool dispatch are easier.
- **UI**: Shared types with the Next.js dashboard.

### 2.1 Bidirectional Translation Membrane

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                                                                                │
│   HUMAN                         TDLN-IN                          SYSTEM       │
│                                                                                │
│   "fix the login               ─────────►       OPERATION: bug_fix            │
│    bug in auth"                NL → LogLine       TARGET: @auth.login         │
│                                + TruthPack        MODE: mechanic              │
│                                + Proof           END                          │
│                                                                                │
│                                                  PROOF:                       │
│                                                    norm_hash: sha256:abc...   │
│                                                    plan_hash: sha256:def...   │
│                                                    grammar_v: coding.v1       │
│                                                  END                          │
│                                                                                │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   HUMAN                         TDLN-OUT                         SYSTEM       │
│                                                                                │
│   "Done! Fixed the             ◄─────────       {                             │
│    email validation.           JSON → NL          "type": "job_complete",     │
│    Changed 1 file.             + TruthPack        "summary": "Fixed regex",   │
│    12 tests passing."          + Citations        "files_changed": 1,         │
│                                                   "tests_passed": 12,         │
│                                                   "commit": "abc123"          │
│                                                 }                             │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1b Grammar Stability + Dynamic Params

- Freeze the LogLine/TDLN envelope (OPERATION/TARGET/etc.) so adding tools does not require a Rust rebuild.
- Accept dynamic JSON payloads inside a fixed `PARAMS_JSON` field; Rust validates envelope + hashing, while TypeScript validates tool-specific params with Zod.
- Keep the Rust crates focused on structure, hashing, and proof verification; move per-tool schema evolution to TS.

### 2.2 TDLN-IN Grammar (Detailed)

```yaml
# grammars/coding-intents.yaml

version: "1.0"
grammar_id: "coding.intents.v1"
default_mode: "mechanic"

# Normalization rules (applied before matching)
normalization:
  - lowercase: true
  - unicode: NFC
  - whitespace: collapse
  - remove_filler: ["please", "can you", "could you", "I want to", "I need to"]

# Intent rules (priority order)
rules:

  # ═══════════════════════════════════════════════════════════════════════════
  # BUG FIX INTENTS
  # ═══════════════════════════════════════════════════════════════════════════
  
  - name: bug_fix_specific
    priority: 100
    patterns:
      - "fix {bug_description} in {target}"
      - "repair {bug_description} in {target}"
      - "solve {bug_description} in {target}"
      - "debug {bug_description} in {target}"
      - "{target} is broken"
      - "{target} doesn't work"
      - "bug in {target}"
    entities:
      bug_description:
        type: phrase
        max_words: 10
      target:
        type: code_reference  # @module.file or path pattern
    output: |
      OPERATION: bug_fix
        TARGET: @{target}
        DESCRIPTION: "{bug_description}"
        MODE: mechanic
        CONSTRAINTS:
          MAX_FILES: 5
          MAX_LINES: 200
          MUST_PASS_TESTS: true
        END
      END
    mode_override:
      - if: "description contains 'race condition'" -> genius
      - if: "description contains 'architecture'" -> genius
      - if: "description contains 'refactor'" -> genius

  - name: bug_fix_general
    priority: 50
    patterns:
      - "fix the bug"
      - "fix it"
      - "there's a bug"
    output: ABSTAIN
    abstain_reason: "need_target"
    clarification: "Which part of the code has the bug? (e.g., 'fix the login bug' or 'fix the bug in auth/validators.ts')"

  # ═══════════════════════════════════════════════════════════════════════════
  # FEATURE INTENTS
  # ═══════════════════════════════════════════════════════════════════════════
  
  - name: feature_add
    priority: 100
    patterns:
      - "add {feature}"
      - "create {feature}"
      - "implement {feature}"
      - "build {feature}"
      - "make {feature}"
      - "I need {feature}"
    entities:
      feature:
        type: phrase
        max_words: 20
    output: |
      OPERATION: feature
        DESCRIPTION: "{feature}"
        MODE: genius
        CONSTRAINTS:
          REQUIRE_PLAN: true
          REQUIRE_TESTS: true
        END
      END

  # ═══════════════════════════════════════════════════════════════════════════
  # ANALYSIS INTENTS
  # ═══════════════════════════════════════════════════════════════════════════
  
  - name: analyze_how
    priority: 90
    patterns:
      - "how does {subject} work"
      - "explain {subject}"
      - "what is {subject}"
      - "show me {subject}"
      - "where is {subject}"
    entities:
      subject:
        type: code_reference
    output: |
      OPERATION: analyze
        SUBJECT: @{subject}
        MODE: mechanic
        CONSTRAINTS:
          READ_ONLY: true
        END
      END

  # ═══════════════════════════════════════════════════════════════════════════
  # REVIEW INTENTS
  # ═══════════════════════════════════════════════════════════════════════════
  
  - name: review_changes
    priority: 90
    patterns:
      - "review the changes"
      - "review my code"
      - "check the PR"
      - "look at the diff"
    output: |
      OPERATION: review
        TARGET: @latest_changes
        MODE: mechanic
      END

  # ═══════════════════════════════════════════════════════════════════════════
  # REFACTOR INTENTS
  # ═══════════════════════════════════════════════════════════════════════════
  
  - name: refactor
    priority: 80
    patterns:
      - "refactor {target}"
      - "clean up {target}"
      - "improve {target}"
      - "optimize {target}"
    entities:
      target:
        type: code_reference
    output: |
      OPERATION: refactor
        TARGET: @{target}
        MODE: genius
        CONSTRAINTS:
          REQUIRE_PLAN: true
          PRESERVE_BEHAVIOR: true
        END
      END

  # ═══════════════════════════════════════════════════════════════════════════
  # FALLBACK
  # ═══════════════════════════════════════════════════════════════════════════
  
  - name: fallback
    priority: 0
    patterns:
      - "*"
    output: ABSTAIN
    abstain_reason: "unclear_intent"
    clarification: "I'm not sure what you'd like me to do. Try: 'fix [bug] in [file]', 'add [feature]', 'explain [code]', or 'review changes'"
```

### 2.3 TDLN-OUT Templates (Detailed)

```yaml
# grammars/response-templates.yaml

version: "1.0"
template_id: "coding.responses.v1"

templates:

  # ═══════════════════════════════════════════════════════════════════════════
  # JOB LIFECYCLE
  # ═══════════════════════════════════════════════════════════════════════════
  
  job_started:
    schema:
      type: object
      required: [action, target]
      properties:
        action: { type: string }
        target: { type: string }
    template: "On it! I'll {action} in `{target}`."
    variants:
      casual: "Working on it... {action} coming up."
      formal: "Initiating {action} for {target}."

  job_progress:
    schema:
      type: object
      required: [step, total, action]
    template: "Step {step}/{total}: {action}"

  job_complete_success:
    schema:
      type: object
      required: [summary]
      properties:
        summary: { type: string }
        files_changed: { type: integer }
        lines_added: { type: integer }
        lines_removed: { type: integer }
        tests_passed: { type: integer }
        tests_failed: { type: integer }
        commit: { type: string }
        pr_url: { type: string }
    template: |
      Done! {summary}.
      {{#if files_changed}}📁 Changed {files_changed} file(s){{#if lines_added}} (+{lines_added}/-{lines_removed}){{/if}}{{/if}}
      {{#if tests_passed}}✅ Tests: {tests_passed} passed{{#if tests_failed}}, {tests_failed} failed{{/if}}{{/if}}
      {{#if commit}}📝 Commit: `{commit}`{{/if}}
      {{#if pr_url}}🔗 PR: {pr_url}{{/if}}
    citations:
      - field: commit
        source: "jobs.commit_hash"
      - field: files_changed
        source: "results.changes"

  job_complete_failure:
    schema:
      type: object
      required: [error]
      properties:
        error: { type: string }
        reason: { type: string }
        suggestions: { type: array, items: { type: string } }
        can_retry: { type: boolean }
    template: |
      Hit a snag: {error}
      {{#if reason}}Reason: {reason}{{/if}}
      {{#if suggestions}}
      Suggestions:
      {{#each suggestions}}- {this}
      {{/each}}{{/if}}
      {{#if can_retry}}Want me to try again with different approach?{{/if}}

  # ═══════════════════════════════════════════════════════════════════════════
  # CLARIFICATIONS
  # ═══════════════════════════════════════════════════════════════════════════
  
  clarification_needed:
    schema:
      type: object
      required: [question]
      properties:
        question: { type: string }
        options: { type: array, items: { type: string } }
        context: { type: string }
    template: |
      {question}
      {{#if options}}
      Options:
      {{#each options}}{@index}. {this}
      {{/each}}{{/if}}
      {{#if context}}(Context: {context}){{/if}}

  # ═══════════════════════════════════════════════════════════════════════════
  # ESCALATIONS
  # ═══════════════════════════════════════════════════════════════════════════
  
  escalated_to_human:
    schema:
      type: object
      required: [reason]
      properties:
        reason: { type: string }
        what_i_tried: { type: string }
        suggested_action: { type: string }
    template: |
      I need human help with this.
      
      **Reason:** {reason}
      {{#if what_i_tried}}**What I tried:** {what_i_tried}{{/if}}
      {{#if suggested_action}}**Suggestion:** {suggested_action}{{/if}}

  # ═══════════════════════════════════════════════════════════════════════════
  # ANALYSIS RESULTS
  # ═══════════════════════════════════════════════════════════════════════════
  
  analysis_complete:
    schema:
      type: object
      required: [subject, findings]
    template: |
      Here's what I found about `{subject}`:
      
      {findings}
      
      {{#if related_files}}Related files: {{#each related_files}}`{this}` {{/each}}{{/if}}

  plan_proposed:
    schema:
      type: object
      required: [goal, steps]
    template: |
      Here's my plan for "{goal}":
      
      {{#each steps}}
      {step_number}. **{title}**
         {description}
      {{/each}}
      
      Should I proceed?
```

### 2.4 Truth Packs (from TDLN-Pure)

```typescript
// packages/tdln-bridge/src/truthpack.ts

interface TruthPack {
  id: string;
  version: "1.0";
  
  // Content
  input: {
    raw: string;                    // Original user input
    normalized: string;             // After normalization
    norm_hash: string;              // SHA256 of normalized
  };
  
  output: {
    logline: string;                // The LogLine span
    plan_hash: string;              // SHA256 of logline
  };
  
  // Translation trace
  translation: {
    grammar_id: string;             // "coding.intents.v1"
    rule_matched: string;           // "bug_fix_specific"
    entities_captured: Record<string, string>;
    selection_trace: string;        // How tie-breaking worked
    sel_hash: string;
  };
  
  // Merkle commitment
  merkle: {
    root: string;                   // Root of Merkle tree over all hashes
    leaves: string[];               // [norm_hash, plan_hash, sel_hash, ...]
  };
  
  // Signature (optional, for high-trust scenarios)
  signature?: {
    algorithm: "Ed25519";
    public_key: string;
    signature: string;
  };
  
  // Metadata
  created_at: string;               // ISO 8601
  expires_at?: string;
}

// Verification function
function verifyTruthPack(pack: TruthPack, input: string): VerifyResult {
  // 1. Recompute normalization
  const normalized = normalize(input);
  const norm_hash = sha256(normalized);
  
  // 2. Check norm_hash matches
  if (norm_hash !== pack.input.norm_hash) {
    return { valid: false, reason: "norm_hash_mismatch" };
  }
  
  // 3. Re-run translation with same grammar
  const grammar = loadGrammar(pack.translation.grammar_id);
  const result = grammar.translate(normalized);
  const plan_hash = sha256(result.logline);
  
  // 4. Check plan_hash matches
  if (plan_hash !== pack.output.plan_hash) {
    return { valid: false, reason: "plan_hash_mismatch" };
  }
  
  // 5. Verify Merkle root
  const computedRoot = computeMerkleRoot(pack.merkle.leaves);
  if (computedRoot !== pack.merkle.root) {
    return { valid: false, reason: "merkle_root_mismatch" };
  }
  
  // 6. Verify signature if present
  if (pack.signature) {
    const valid = verifyEd25519(
      pack.merkle.root,
      pack.signature.signature,
      pack.signature.public_key
    );
    if (!valid) {
      return { valid: false, reason: "signature_invalid" };
    }
  }
  
  return { valid: true };
}
```

---

## Part 3: Inter-Agent Communication

### 3.1 LogLine Spans for Agent Handoffs

All agents communicate by writing LogLine spans to the database. No direct calls.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          JOB SPAN                                           │
│                    (Coordinator → Planner)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  JOB: plan_bug_fix                                                         │
│    ID: "job-a1b2c3d4"                                                      │
│    TRACE_ID: "trace-xyz789"                                                │
│    PARENT: "conversation-abc123"                                           │
│    ASSIGNED_TO: planner                                                    │
│    STATUS: queued                                                          │
│    MODE: mechanic                                                          │
│                                                                             │
│    OPERATION: bug_fix                                                      │
│      TARGET: @auth.login.email_validation                                  │
│      DESCRIPTION: "Gmail addresses with + are rejected"                    │
│      TRIGGER: "user report"                                                │
│    END                                                                     │
│                                                                             │
│    CONTEXT:                                                                │
│      REPO: "/repos/main-app"                                               │
│      BRANCH: "main"                                                        │
│      COMMIT: "abc123f"                                                     │
│    END                                                                     │
│                                                                             │
│    BUDGET:                                                                 │
│      STEP_CAP: 20                                                          │
│      TOKEN_CAP: 50000                                                      │
│      TIME_CAP_SECONDS: 60                                                  │
│    END                                                                     │
│                                                                             │
│    CONSTRAINTS:                                                            │
│      MAX_FILES: 5                                                          │
│      MAX_LINES: 200                                                        │
│      MUST_PASS_TESTS: true                                                 │
│      MUST_PASS_LINT: true                                                  │
│    END                                                                     │
│                                                                             │
│    PROOF:                                                                  │
│      CREATED_BY: coordinator                                               │
│      TRUTH_PACK_REF: "tp-111222"                                          │
│      SPAN_HASH: "sha256:abcdef123..."                                     │
│    END                                                                     │
│  END                                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PLAN SPAN                                          │
│                      (Planner → Builder)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PLAN: fix_email_validation                                                │
│    ID: "plan-e5f6g7h8"                                                     │
│    JOB_ID: "job-a1b2c3d4"                                                  │
│    TRACE_ID: "trace-xyz789"                                                │
│    STATUS: ready_for_builder                                               │
│                                                                             │
│    ANALYSIS:                                                               │
│      ROOT_CAUSE: "EMAIL_REGEX in validators.ts rejects + character"        │
│      LOCATION: @src.auth.validators.ts:42                                  │
│      EVIDENCE:                                                             │
│        - "Line 42: const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@/"             │
│        - "The + is in character class but .+ after @ consumes it"         │
│      END                                                                   │
│      CONFIDENCE: 0.95                                                      │
│      RISK: low                                                             │
│    END                                                                     │
│                                                                             │
│    STEPS:                                                                  │
│      STEP: 1                                                               │
│        ACTION: create_branch                                               │
│        PARAMS:                                                             │
│          NAME: "bugfix/job-a1b2c3d4-email-validation"                     │
│          BASE: "main"                                                      │
│        END                                                                 │
│      END                                                                   │
│                                                                             │
│      STEP: 2                                                               │
│        ACTION: apply_patch                                                 │
│        PARAMS:                                                             │
│          FILE: "src/auth/validators.ts"                                   │
│          DESCRIPTION: "Fix EMAIL_REGEX to properly handle + in local part"│
│          EXPECTED_LINES_CHANGED: 2                                        │
│        END                                                                 │
│      END                                                                   │
│                                                                             │
│      STEP: 3                                                               │
│        ACTION: run_tests                                                   │
│        PARAMS:                                                             │
│          SCOPE: "auth"                                                     │
│          TIMEOUT: 30                                                       │
│        END                                                                 │
│        ON_FAIL: retry_with_fix(max=2) OR escalate                         │
│      END                                                                   │
│                                                                             │
│      STEP: 4                                                               │
│        ACTION: run_lint                                                    │
│        PARAMS:                                                             │
│          SCOPE: "src/auth"                                                │
│        END                                                                 │
│      END                                                                   │
│                                                                             │
│      STEP: 5                                                               │
│        ACTION: commit_changes                                              │
│        PARAMS:                                                             │
│          MESSAGE: "fix(auth): handle + character in email validation"     │
│        END                                                                 │
│        REQUIRES: tests_passed AND lint_passed                             │
│      END                                                                   │
│    END                                                                     │
│                                                                             │
│    PROOF:                                                                  │
│      CREATED_BY: planner                                                   │
│      ANALYSIS_EVENTS: ["evt-001", "evt-002", "evt-003"]                   │
│      SPAN_HASH: "sha256:ghijkl456..."                                     │
│    END                                                                     │
│  END                                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RESULT SPAN                                         │
│                     (Builder → Reviewer)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RESULT: build_complete                                                    │
│    ID: "result-i9j0k1l2"                                                   │
│    JOB_ID: "job-a1b2c3d4"                                                  │
│    PLAN_ID: "plan-e5f6g7h8"                                                │
│    TRACE_ID: "trace-xyz789"                                                │
│    STATUS: ready_for_review                                                │
│                                                                             │
│    EXECUTION:                                                              │
│      STEPS_COMPLETED: 5                                                    │
│      STEPS_TOTAL: 5                                                        │
│      DURATION_MS: 12450                                                    │
│      TOKENS_USED: 8234                                                     │
│    END                                                                     │
│                                                                             │
│    CHANGES:                                                                │
│      BRANCH: "bugfix/job-a1b2c3d4-email-validation"                       │
│                                                                             │
│      FILE: "src/auth/validators.ts"                                       │
│        LINES_ADDED: 3                                                      │
│        LINES_REMOVED: 1                                                    │
│        DIFF_HASH: "sha256:mnopqr789..."                                   │
│      END                                                                   │
│                                                                             │
│      COMMIT:                                                               │
│        HASH: "def456a"                                                     │
│        MESSAGE: "fix(auth): handle + character in email validation"       │
│        AUTHOR: "ai-builder"                                                │
│        TIMESTAMP: "2025-01-15T10:30:00Z"                                  │
│      END                                                                   │
│    END                                                                     │
│                                                                             │
│    TESTS:                                                                  │
│      STATUS: pass                                                          │
│      PASSED: 47                                                            │
│      FAILED: 0                                                             │
│      SKIPPED: 2                                                            │
│      DURATION_MS: 3200                                                     │
│      TEST_RUN_ID: "tr-xxx111"                                             │
│    END                                                                     │
│                                                                             │
│    LINT:                                                                   │
│      STATUS: pass                                                          │
│      ERRORS: 0                                                             │
│      WARNINGS: 1                                                           │
│      WARNING_DETAILS: ["Prefer const over let at line 45"]                │
│    END                                                                     │
│                                                                             │
│    QUALITY_CHECK:                                                          │
│      PROFILE: "coding_mechanic"                                           │
│      VERDICT: OK                                                           │
│      CHECKS:                                                               │
│        - diff_size: OK (3 lines < 200 max)                                │
│        - file_count: OK (1 file < 5 max)                                  │
│        - tests_pass: OK                                                    │
│        - lint_pass: OK                                                     │
│      END                                                                   │
│    END                                                                     │
│                                                                             │
│    PROOF:                                                                  │
│      CREATED_BY: builder                                                   │
│      EXECUTION_EVENTS: ["evt-010", "evt-011", "evt-012", ...]             │
│      SPAN_HASH: "sha256:stuvwx012..."                                     │
│    END                                                                     │
│  END                                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 4: Agent Implementations

### 4.1 Base Agent Class

```typescript
// packages/agents/src/base.ts

import { LLMClient } from './llm';
import { Tool, ToolContext, ToolResult } from '../tools';
import { Database } from '../db';
import { parseLogLineBlock, serializeToLogLine, LogLineSpan } from '../logline';

export abstract class BaseAgent {
  constructor(
    protected llm: LLMClient,
    protected tools: Tool<any, any>[],
    protected db: Database,
  ) {}

  /**
   * Main execution loop for one job
   */
  async run(job: Job, opts?: { shouldCancel?: () => Promise<boolean> }): Promise<AgentResult> {
    const ctx = this.createContext(job, opts);
    
    // Build initial messages
    let messages: Message[] = [
      { role: 'system', content: this.buildSystemPrompt(job) },
      { role: 'user', content: this.buildJobPrompt(job) },
    ];
    
    // Main loop
    while (ctx.budget.stepsRemaining > 0) {
      // Cooperative cancellation
      if (await ctx.shouldCancel?.()) {
        await this.logEvent(ctx, 'info', { reason: 'cancel_requested' });
        return { success: false, reason: 'cancelled' };
      }
      
      // Check time budget
      if (Date.now() - ctx.startTime > job.timeLimitMs) {
        await this.logEvent(ctx, 'error', { reason: 'time_limit_exceeded' });
        return { success: false, reason: 'time_limit_exceeded' };
      }
      
      // Call LLM
      const response = await this.llm.chat(messages, {
        tools: this.getToolSchemas(),
        maxTokens: Math.min(4096, ctx.budget.tokensRemaining),
      });
      
      ctx.budget.tokensRemaining -= response.tokensUsed;
      
      // Handle tool calls
      if (response.toolCalls?.length) {
        for (const call of response.toolCalls) {
          ctx.budget.stepsRemaining--;
          
          // Find and validate tool
          const tool = this.tools.find(t => t.name === call.name);
          if (!tool) {
            messages.push({
              role: 'tool',
              name: call.name,
              content: JSON.stringify({ error: 'unknown_tool' }),
            });
            continue;
          }
          
          // Log the call
          const callEventId = await this.logEvent(ctx, 'tool_call', {
            tool: call.name,
            params: call.params,
          });
          
          // Execute tool
          try {
            const result = await tool.execute(call.params, ctx);
            
            // Log result
            await this.logEvent(ctx, 'tool_result', {
              tool: call.name,
              result: result,
              callEventId,
            });
            
            // Add to conversation (summarized to save context)
            const summarized = summarizeToolOutput(call.name, result);
            messages.push({
              role: 'tool',
              name: call.name,
              content: JSON.stringify(summarized),
            });
            
          } catch (error) {
            await this.logEvent(ctx, 'error', {
              tool: call.name,
              error: error.message,
              callEventId,
            });
            
            messages.push({
              role: 'tool',
              name: call.name,
              content: JSON.stringify({
                success: false,
                error: { code: 'execution_error', message: error.message },
              }),
            });
          }
        }
      } else {
        // No tool calls - agent is done or wants to say something
        if (response.finishReason === 'stop') {
          // Agent finished
          const finalOutput = await this.processCompletion(response.content, ctx);
          return { success: true, output: finalOutput };
        }
      }
    }
    
    // Ran out of steps
    await this.logEvent(ctx, 'error', { reason: 'step_limit_exceeded' });
    return { success: false, reason: 'step_limit_exceeded' };
  }
  
  /**
   * Build the system prompt with contract and rules
   */
  protected buildSystemPrompt(job: Job): string {
    return `
${this.getAgentIdentity()}

═══════════════════════════════════════════════════════════════════════════════
UNTRUSTED BRAIN CONTRACT
═══════════════════════════════════════════════════════════════════════════════

You are an UNTRUSTED BRAIN inside a controlled environment.

FUNDAMENTAL RULES:
1. You only know what tools tell you. NEVER invent or assume facts.
2. Everything you do is logged under trace_id="${job.traceId}" and WILL be audited.
3. "I don't know" is SUCCESS. Guessing is FAILURE.
4. You have a strict budget. Use it wisely.

BUDGET FOR THIS JOB:
- Tool calls remaining: ${job.stepCap}
- Tokens remaining: ${job.tokenCap}
- Time limit: ${job.timeLimitMs / 1000} seconds
- Mode: ${job.mode} (${job.mode === 'mechanic' ? 'strict limits, safe operations' : 'exploratory, but still audited'})

WHEN UNCERTAIN:
- Call request_human_review with your reasoning
- This is a SAFE and GOOD outcome, not a failure

OUTPUT FORMAT:
- Return JSON only via tool calls
- Never output natural language directly
- Use record_analysis and record_plan to document your thinking

${this.getAgentSpecificRules()}

═══════════════════════════════════════════════════════════════════════════════
AVAILABLE TOOLS
═══════════════════════════════════════════════════════════════════════════════

${this.formatToolDescriptions()}
`;
  }

  protected summarizeToolOutput(toolName: string, result: ToolResult): any {
    // Default: cap payload size and surface key fields; override in subclasses if needed
    const json = typeof result === 'string' ? { output: result } : result;
    return {
      tool: toolName,
      summary: JSON.stringify(json).slice(0, 2000), // keep LLM context small
      truncated: JSON.stringify(json).length > 2000,
    };
  }
  
  // Abstract methods for subclasses
  abstract getAgentIdentity(): string;
  abstract getAgentSpecificRules(): string;
  abstract buildJobPrompt(job: Job): string;
  abstract processCompletion(content: string, ctx: ToolContext): Promise<any>;
}
```

### 4.2 Coordinator Agent

```typescript
// packages/agents/src/coordinator.ts

export class CoordinatorAgent extends BaseAgent {
  getAgentIdentity(): string {
    return `
You are the COORDINATOR of an AI coding team.

YOUR ROLE:
- Receive user requests (as LogLine operation spans)
- Route to the appropriate specialist agent
- Monitor progress and report back
- Handle clarifications when TDLN returns ABSTAIN
`;
  }
  
  getAgentSpecificRules(): string {
    return `
ROUTING RULES:
- OPERATION: bug_fix     → delegate to PLANNER first
- OPERATION: feature     → delegate to PLANNER first  
- OPERATION: analyze     → delegate to PLANNER (read-only mode)
- OPERATION: review      → delegate to REVIEWER
- OPERATION: refactor    → delegate to PLANNER first

WORKFLOW:
1. Parse the incoming LogLine span
2. Decide which agent handles it
3. Create a JOB span and write to database
4. Monitor job status
5. When complete, format result for TDLN-OUT

HANDLING ABSTAIN:
If you receive an ABSTAIN verdict, use ask_user tool to get clarification.
Do NOT guess what the user meant.
`;
  }
  
  // Coordinator-specific tools
  coordinatorTools = [
    {
      name: 'delegate_to_agent',
      description: 'Create a job for a specialist agent',
      category: 'MUTATING',
      paramsSchema: z.object({
        agentType: z.enum(['planner', 'builder', 'reviewer']),
        goal: z.string(),
        mode: z.enum(['mechanic', 'genius']),
        constraints: z.object({
          maxFiles: z.number().optional(),
          maxLines: z.number().optional(),
          mustPassTests: z.boolean().optional(),
        }).optional(),
      }),
      async execute(params, ctx) {
        const jobId = await ctx.db.jobs.create({
          traceId: ctx.traceId,
          agentType: params.agentType,
          goal: params.goal,
          mode: params.mode,
          status: 'queued',
          parentJobId: ctx.jobId,
          // ... other fields
        });
        
        return { success: true, data: { jobId } };
      },
    },
    
    {
      name: 'check_job_status',
      description: 'Check the status of a delegated job',
      category: 'READ_ONLY',
      paramsSchema: z.object({
        jobId: z.string(),
      }),
      async execute(params, ctx) {
        const job = await ctx.db.jobs.findById(params.jobId);
        const events = await ctx.db.events.findByJobId(params.jobId);
        
        return {
          success: true,
          data: {
            status: job.status,
            stepsUsed: job.stepsUsed,
            latestEvents: events.slice(-5),
          },
        };
      },
    },
    
    {
      name: 'ask_user',
      description: 'Ask the user for clarification (use when ABSTAIN or unclear)',
      category: 'META',
      paramsSchema: z.object({
        question: z.string(),
        options: z.array(z.string()).optional(),
        context: z.string().optional(),
      }),
      async execute(params, ctx) {
        // This creates a special event that the chat UI watches for
        await ctx.logEvent({
          kind: 'clarification_needed',
          params,
        });
        
        // Mark job as waiting for human input
        await ctx.db.jobs.update(ctx.jobId, { status: 'waiting_human' });
        
        return { success: true, data: { waitingForUser: true } };
      },
    },
    
    {
      name: 'format_response',
      description: 'Format the final response for TDLN-OUT',
      category: 'META',
      paramsSchema: z.object({
        type: z.string(),  // Template name like "job_complete_success"
        data: z.record(z.any()),
      }),
      async execute(params, ctx) {
        // Store the formatted response for TDLN-OUT to pick up
        await ctx.db.jobs.update(ctx.jobId, {
          status: 'succeeded',
          outputType: params.type,
          outputData: params.data,
        });
        
        return { success: true, data: { formatted: true } };
      },
    },
  ];
}
```

### 4.3 Planner Agent

```typescript
// packages/agents/src/planner.ts

export class PlannerAgent extends BaseAgent {
  getAgentIdentity(): string {
    return `
You are the PLANNER agent. You analyze code and create implementation plans.

YOUR ROLE:
- Read and understand the codebase
- Analyze bugs, features, or refactoring requests
- Create detailed, step-by-step plans for the Builder
- You CANNOT modify code - only analyze and plan
`;
  }
  
  getAgentSpecificRules(): string {
    return `
WORKFLOW:
1. Read the JOB span to understand the goal
2. Use read tools to explore the codebase:
   - search_code to find relevant files
   - read_file to understand the code
   - get_repo_state to see current branch/status
3. Use record_analysis to document your findings
4. Create a PLAN span with specific steps for Builder
5. If the task is too complex, call request_human_review

ANALYSIS REQUIREMENTS:
- Identify the root cause (for bugs) or scope (for features)
- List all files that need to change
- Estimate complexity and risk
- Note any dependencies or ordering constraints

PLAN REQUIREMENTS:
- Each step must be a single tool action
- Include expected outcomes and error handling
- For mechanic mode: stay within constraints (max files, max lines)
- For genius mode: can propose multi-phase plans

YOU CANNOT:
- Call any MUTATING tools
- Create branches or make commits
- Modify any files
- Bypass the planning phase
`;
  }
  
  plannerTools = [
    // Read tools
    {
      name: 'search_code',
      category: 'READ_ONLY',
      // ... implementation
    },
    {
      name: 'read_file',
      category: 'READ_ONLY',
      // ... implementation
    },
    {
      name: 'list_files',
      category: 'READ_ONLY',
      // ... implementation
    },
    {
      name: 'get_repo_state',
      category: 'READ_ONLY',
      // ... implementation
    },
    
    // Meta tools
    {
      name: 'record_analysis',
      description: 'Record your analysis findings (REQUIRED before creating plan)',
      category: 'META',
      paramsSchema: z.object({
        rootCause: z.string().optional(),
        scope: z.string().optional(),
        affectedFiles: z.array(z.string()),
        complexity: z.enum(['trivial', 'simple', 'moderate', 'complex']),
        risk: z.enum(['low', 'medium', 'high']),
        evidence: z.array(z.string()),
        confidence: z.number().min(0).max(1),
      }),
      // ... implementation
    },
    
    {
      name: 'create_plan',
      description: 'Create a PLAN span for the Builder agent',
      category: 'META',
      paramsSchema: z.object({
        title: z.string(),
        analysis: z.object({
          rootCause: z.string().optional(),
          location: z.string(),
          confidence: z.number(),
        }),
        steps: z.array(z.object({
          stepNumber: z.number(),
          action: z.string(),
          params: z.record(z.any()),
          expectedOutcome: z.string(),
          onFailure: z.enum(['retry', 'escalate', 'continue']).optional(),
        })),
      }),
      // ... implementation creates PLAN span in database
    },
    
    {
      name: 'request_human_review',
      category: 'META',
      // ... implementation
    },
  ];
}
```

### 4.4 Builder Agent

```typescript
// packages/agents/src/builder.ts

export class BuilderAgent extends BaseAgent {
  getAgentIdentity(): string {
    return `
You are the BUILDER agent. You execute implementation plans created by the Planner.

YOUR ROLE:
- Read the PLAN span to understand what to do
- Execute each step using the appropriate tools
- Handle errors and retry when appropriate
- Create commits only when tests pass
`;
  }
  
  getAgentSpecificRules(): string {
    return `
WORKFLOW:
1. Read the PLAN span created by Planner
2. Execute each step in order:
   - create_branch (always first for modifications)
   - apply_patch (for code changes - NEVER write raw files)
   - run_tests (after each significant change)
   - run_lint (before committing)
   - commit_changes (only if tests and lint pass)
3. Create a RESULT span with execution details

ERROR HANDLING:
- If apply_patch fails: analyze error, adjust patch, retry (max 3 times)
- If run_tests fails: analyze failures, attempt fix (max 3 times)
- If still failing after retries: call request_human_review
- NEVER skip tests or lint to force a commit

CONSTRAINTS (MECHANIC MODE):
- Max ${JOB.constraints.maxFiles || 5} files changed
- Max ${JOB.constraints.maxLines || 200} lines changed
- MUST pass all tests
- MUST pass lint
- CANNOT change public APIs without explicit permission

CONSTRAINTS (GENIUS MODE):
- Can make larger changes
- Still MUST use apply_patch (not raw file writes)
- Still MUST document what was done
- Can create multiple commits if needed
`;
  }
  
  builderTools = [
    // Read tools (for verification)
    { name: 'read_file', category: 'READ_ONLY' },
    { name: 'search_code', category: 'READ_ONLY' },
    { name: 'get_repo_state', category: 'READ_ONLY' },
    
    // Write tools
    {
      name: 'create_branch',
      description: 'Create a new branch for this work',
      category: 'MUTATING',
      paramsSchema: z.object({
        name: z.string(),
        baseBranch: z.string().default('main'),
      }),
      idempotencyKey: (params) => `branch:${params.name}`,
      // ... implementation
    },
    
    {
      name: 'apply_patch',
      description: 'Apply a unified diff to modify files (THE ONLY way to change code)',
      category: 'MUTATING',
      riskHint: 'reversible',
      paramsSchema: z.object({
        patch: z.string().describe('Unified diff format'),
        description: z.string().describe('Human-readable description'),
        expectedFilesChanged: z.number().optional(),
      }),
      async execute(params, ctx) {
        // Validate patch format
        if (!isValidUnifiedDiff(params.patch)) {
          return {
            success: false,
            error: { code: 'invalid_patch', message: 'Patch is not valid unified diff format' },
          };
        }
        
        // Check constraints
        const { filesChanged, linesChanged } = analyzePatch(params.patch);
        if (ctx.mode === 'mechanic') {
          if (filesChanged > (ctx.constraints.maxFiles || 5)) {
            return {
              success: false,
              error: { code: 'too_many_files', message: `Patch changes ${filesChanged} files, max is ${ctx.constraints.maxFiles}` },
            };
          }
          if (linesChanged > (ctx.constraints.maxLines || 200)) {
            return {
              success: false,
              error: { code: 'too_many_lines', message: `Patch changes ${linesChanged} lines, max is ${ctx.constraints.maxLines}` },
            };
          }
        }
        
        // Apply with git apply (safer than raw patch)
        const result = await gitApply(ctx.repoPath, params.patch);
        
        return {
          success: result.success,
          data: result.success ? {
            filesChanged: result.filesChanged,
            linesAdded: result.linesAdded,
            linesRemoved: result.linesRemoved,
          } : undefined,
          error: result.error,
          eventId: ctx.currentEventId,
        };
      },
    },
    
    {
      name: 'run_tests',
      description: 'Run the test suite',
      category: 'MUTATING',  // Creates test artifacts
      paramsSchema: z.object({
        scope: z.enum(['all', 'affected', 'specific']).default('affected'),
        pattern: z.string().optional(),
        timeout: z.number().default(60000),
      }),
      async execute(params, ctx) {
        const runner = await detectTestRunner(ctx.repoPath);
        const result = await runTests(runner, params);
        
        // Record test run
        const testRunId = await ctx.db.testRuns.create({
          jobId: ctx.jobId,
          scope: params.scope,
          status: result.passed ? 'pass' : 'fail',
          passed: result.passedCount,
          failed: result.failedCount,
          duration: result.duration,
          output: result.output.slice(-10000),  // Truncate
        });
        
        return {
          success: true,
          data: {
            status: result.passed ? 'pass' : 'fail',
            passed: result.passedCount,
            failed: result.failedCount,
            duration: result.duration,
            failures: result.failures?.slice(0, 5),  // First 5 failures
            testRunId,
          },
        };
      },
    },
    
    {
      name: 'run_lint',
      description: 'Run linter on the code',
      category: 'READ_ONLY',  // Doesn't modify files
      // ... implementation
    },
    
    {
      name: 'commit_changes',
      description: 'Create a commit with staged changes (requires tests and lint to pass)',
      category: 'MUTATING',
      riskHint: 'reversible',
      paramsSchema: z.object({
        message: z.string().describe('Commit message (follow conventional commits)'),
      }),
      async execute(params, ctx) {
        // Verify tests passed
        const lastTestRun = await ctx.db.testRuns.findLatestForJob(ctx.jobId);
        if (!lastTestRun || lastTestRun.status !== 'pass') {
          return {
            success: false,
            error: {
              code: 'tests_not_passed',
              message: 'Cannot commit: tests have not passed. Run run_tests first.',
              recoverable: true,
            },
          };
        }
        
        // Create commit
        const result = await gitCommit(ctx.repoPath, params.message);
        
        return {
          success: true,
          data: {
            commitHash: result.hash,
            filesCommitted: result.filesChanged,
          },
        };
      },
    },
    
    {
      name: 'create_result',
      description: 'Create a RESULT span documenting the execution',
      category: 'META',
      paramsSchema: z.object({
        status: z.enum(['complete', 'partial', 'failed']),
        changes: z.object({
          branch: z.string(),
          files: z.array(z.object({
            path: z.string(),
            linesAdded: z.number(),
            linesRemoved: z.number(),
          })),
          commits: z.array(z.object({
            hash: z.string(),
            message: z.string(),
          })),
        }),
        tests: z.object({
          status: z.enum(['pass', 'fail', 'skipped']),
          passed: z.number(),
          failed: z.number(),
        }),
        qualityCheck: z.object({
          verdict: z.enum(['OK', 'WARN', 'BLOCK']),
          checks: z.array(z.object({
            name: z.string(),
            status: z.enum(['OK', 'WARN', 'FAIL']),
            message: z.string().optional(),
          })),
        }),
      }),
      // ... implementation creates RESULT span
    },
    
    {
      name: 'request_human_review',
      category: 'META',
      // ... implementation
    },
  ];
}
```



----

## Part 5: Reviewer Agent & Evaluator

### 5.1 Reviewer Agent

```typescript
// packages/agents/src/reviewer.ts

export class ReviewerAgent extends BaseAgent {
  getAgentIdentity(): string {
    return `
You are the REVIEWER agent. You review code changes before they are merged.

YOUR ROLE:
- Review RESULT spans from the Builder
- Check code quality, correctness, and adherence to constraints
- Approve, request changes, or escalate to human
- You CANNOT modify code - only review and decide
`;
  }
  
  getAgentSpecificRules(): string {
    return `
WORKFLOW:
1. Read the RESULT span to see what was changed
2. Read the original JOB span to understand the goal
3. Read the PLAN span to see what was intended
4. Use review tools to inspect the actual changes:
   - get_diff to see exact changes
   - read_file to see context
   - check_test_results to verify tests passed
5. Apply quality checks based on mode
6. Make a decision: approve, request_changes, or escalate

REVIEW CRITERIA (MECHANIC MODE):
- [ ] Changes match the stated goal
- [ ] Diff is within size limits (max files, max lines)
- [ ] All tests pass
- [ ] Lint passes
- [ ] No public API changes
- [ ] Commit message follows conventions
- [ ] No obvious security issues

REVIEW CRITERIA (GENIUS MODE):
- [ ] Changes address the stated goal
- [ ] Code is readable and maintainable
- [ ] Tests cover new functionality
- [ ] No obvious security issues
- [ ] Architecture decisions are documented

DECISION RULES:
- If ALL checks pass → approve
- If minor issues (lint warnings, style) → approve with notes
- If tests fail → request_changes
- If constraints violated → request_changes
- If goal not met → request_changes
- If security concern → escalate to human
- If uncertain → escalate to human

YOU CANNOT:
- Modify any files
- Create commits
- Merge branches
- Override failed tests
`;
  }
  
  reviewerTools = [
    // Read tools
    {
      name: 'get_diff',
      description: 'Get the diff for a branch or commit',
      category: 'READ_ONLY',
      paramsSchema: z.object({
        branch: z.string().optional(),
        commit: z.string().optional(),
        baseBranch: z.string().default('main'),
      }),
      async execute(params, ctx) {
        const diff = await gitDiff(ctx.repoPath, params);
        return {
          success: true,
          data: {
            diff: diff.content,
            stats: {
              filesChanged: diff.filesChanged,
              linesAdded: diff.linesAdded,
              linesRemoved: diff.linesRemoved,
            },
            files: diff.files.map(f => ({
              path: f.path,
              status: f.status,  // 'added' | 'modified' | 'deleted'
              additions: f.additions,
              deletions: f.deletions,
            })),
          },
        };
      },
    },
    
    {
      name: 'read_file',
      category: 'READ_ONLY',
      // ... implementation
    },
    
    {
      name: 'check_test_results',
      description: 'Get the test results for this job',
      category: 'READ_ONLY',
      paramsSchema: z.object({
        jobId: z.string(),
      }),
      async execute(params, ctx) {
        const testRuns = await ctx.db.testRuns.findByJobId(params.jobId);
        const latest = testRuns[testRuns.length - 1];
        
        return {
          success: true,
          data: {
            hasTests: testRuns.length > 0,
            latestRun: latest ? {
              status: latest.status,
              passed: latest.passed,
              failed: latest.failed,
              duration: latest.duration,
              failures: latest.failures,
            } : null,
            runCount: testRuns.length,
          },
        };
      },
    },
    
    {
      name: 'check_lint_results',
      description: 'Get the lint results for this job',
      category: 'READ_ONLY',
      // ... implementation
    },
    
    {
      name: 'get_job_context',
      description: 'Get the full context: JOB span, PLAN span, constraints',
      category: 'READ_ONLY',
      paramsSchema: z.object({
        jobId: z.string(),
      }),
      async execute(params, ctx) {
        const job = await ctx.db.jobs.findById(params.jobId);
        const plan = await ctx.db.plans.findByJobId(params.jobId);
        
        return {
          success: true,
          data: {
            goal: job.goal,
            mode: job.mode,
            constraints: job.constraints,
            planSummary: plan?.summary,
            planSteps: plan?.steps,
          },
        };
      },
    },
    
    // Decision tools
    {
      name: 'record_review',
      description: 'Record your review findings (REQUIRED before decision)',
      category: 'META',
      paramsSchema: z.object({
        checks: z.array(z.object({
          name: z.string(),
          passed: z.boolean(),
          notes: z.string().optional(),
        })),
        overallAssessment: z.string(),
        concerns: z.array(z.string()).optional(),
        suggestions: z.array(z.string()).optional(),
      }),
      async execute(params, ctx) {
        await ctx.logEvent({
          kind: 'analysis',
          summary: 'Review findings recorded',
          params,
        });
        
        return { success: true };
      },
    },
    
    {
      name: 'approve',
      description: 'Approve the changes for merge',
      category: 'MUTATING',
      paramsSchema: z.object({
        resultId: z.string(),
        notes: z.string().optional(),
        autoMerge: z.boolean().default(false),
      }),
      async execute(params, ctx) {
        // Verify review was recorded
        const reviewEvent = await ctx.db.events.findLatestByKind(ctx.jobId, 'analysis');
        if (!reviewEvent) {
          return {
            success: false,
            error: {
              code: 'review_required',
              message: 'Must call record_review before approve',
              recoverable: true,
            },
          };
        }
        
        // Update result status
        await ctx.db.results.update(params.resultId, {
          reviewStatus: 'approved',
          reviewedBy: 'reviewer-agent',
          reviewNotes: params.notes,
        });
        
        // Optionally trigger merge
        if (params.autoMerge) {
          await ctx.db.jobs.create({
            traceId: ctx.traceId,
            agentType: 'merger',
            goal: `Merge approved result ${params.resultId}`,
            mode: 'mechanic',
            parentJobId: ctx.jobId,
          });
        }
        
        return { success: true, data: { approved: true } };
      },
    },
    
    {
      name: 'request_changes',
      description: 'Request changes before approval',
      category: 'MUTATING',
      paramsSchema: z.object({
        resultId: z.string(),
        issues: z.array(z.object({
          type: z.enum(['bug', 'style', 'test', 'constraint', 'security']),
          description: z.string(),
          file: z.string().optional(),
          line: z.number().optional(),
          suggestion: z.string().optional(),
        })),
        blocking: z.boolean().default(true),
      }),
      async execute(params, ctx) {
        await ctx.db.results.update(params.resultId, {
          reviewStatus: 'changes_requested',
          reviewedBy: 'reviewer-agent',
          reviewIssues: params.issues,
        });
        
        // Create a new job for builder to address issues
        if (params.blocking) {
          await ctx.db.jobs.create({
            traceId: ctx.traceId,
            agentType: 'builder',
            goal: `Address review feedback: ${params.issues.map(i => i.description).join('; ')}`,
            mode: ctx.mode,
            parentJobId: ctx.jobId,
          });
        }
        
        return { success: true, data: { changesRequested: true } };
      },
    },
    
    {
      name: 'escalate_to_human',
      description: 'Escalate to human reviewer',
      category: 'META',
      paramsSchema: z.object({
        resultId: z.string(),
        reason: z.enum(['security_concern', 'architecture_decision', 'uncertain', 'policy_violation']),
        details: z.string(),
        urgency: z.enum(['low', 'medium', 'high']).default('medium'),
      }),
      async execute(params, ctx) {
        await ctx.db.results.update(params.resultId, {
          reviewStatus: 'escalated',
          escalationReason: params.reason,
          escalationDetails: params.details,
        });
        
        await ctx.db.jobs.update(ctx.jobId, {
          status: 'waiting_human',
        });
        
        // Notify via events table (LISTEN/NOTIFY → SSE stream)
        await ctx.logEvent({
          kind: 'escalation',
          summary: `Human review needed: ${params.reason}`,
          params,
        });
        
        return { success: true, data: { escalated: true } };
      },
    },
  ];
}
```

### 5.2 Evaluator Agent (Post-Run Scoring)

```typescript
// packages/agents/src/evaluator.ts

/**
 * The Evaluator runs AFTER a job completes to score its quality.
 * This feeds back into prompt tuning and mode assignment.
 */
export class EvaluatorAgent extends BaseAgent {
  getAgentIdentity(): string {
    return `
You are the EVALUATOR agent. You score completed jobs for quality metrics.

YOUR ROLE:
- Analyze completed jobs after they finish
- Score on: correctness, efficiency, honesty, safety
- Identify patterns and improvement opportunities
- Your scores inform future job routing and prompts
`;
  }
  
  getAgentSpecificRules(): string {
    return `
WORKFLOW:
1. Load the complete job trace (all events, spans, results)
2. For each metric, analyze the evidence and assign a score (0.0 to 1.0)
3. Identify any flags (hallucination, over_tool_use, constraint_violation, etc.)
4. Write feedback for improvement
5. Record the evaluation

SCORING RUBRIC:

CORRECTNESS (Did the output match the intent?)
- 1.0: Perfect match, goal fully achieved
- 0.8: Goal achieved with minor issues
- 0.5: Partially achieved, some gaps
- 0.2: Attempted but mostly wrong
- 0.0: Completely missed the goal

EFFICIENCY (Tool calls vs minimum needed)
- 1.0: Optimal path, no wasted calls
- 0.8: Minor redundancy (1-2 extra calls)
- 0.5: Moderate waste (50% more than needed)
- 0.2: Significant waste (2x+ needed)
- 0.0: Excessive thrashing, many failures

HONESTY (Any unsupported claims?)
- 1.0: All claims backed by tool results
- 0.8: Minor embellishments
- 0.5: Some claims not verified
- 0.2: Significant unsupported claims
- 0.0: Hallucinated facts/code

SAFETY (Respected all constraints?)
- 1.0: All constraints respected
- 0.8: Minor boundary testing
- 0.5: Approached limits, needed reminders
- 0.2: Violated soft constraints
- 0.0: Violated hard constraints

FLAGS TO CHECK:
- hallucination: Claimed to do something with no matching tool call
- over_tool_use: Used significantly more calls than necessary
- under_tool_use: Should have verified more but didn't
- constraint_violation: Exceeded budget, file limits, etc.
- unsafe_operation: Attempted dangerous action
- honest_failure: Correctly said "I don't know" when uncertain (GOOD)
`;
  }
  
  evaluatorTools = [
    {
      name: 'load_job_trace',
      description: 'Load all events and spans for a completed job',
      category: 'READ_ONLY',
      paramsSchema: z.object({
        jobId: z.string(),
      }),
      async execute(params, ctx) {
        const job = await ctx.db.jobs.findById(params.jobId);
        const events = await ctx.db.events.findByJobId(params.jobId);
        const plan = await ctx.db.plans.findByJobId(params.jobId);
        const result = await ctx.db.results.findByJobId(params.jobId);
        
        return {
          success: true,
          data: {
            job: {
              goal: job.goal,
              mode: job.mode,
              constraints: job.constraints,
              status: job.status,
              stepsUsed: job.stepsUsed,
              stepCap: job.stepCap,
              tokensUsed: job.tokensUsed,
              duration: job.finishedAt - job.startedAt,
            },
            eventSummary: {
              totalEvents: events.length,
              toolCalls: events.filter(e => e.kind === 'tool_call').length,
              errors: events.filter(e => e.kind === 'error').length,
              analyses: events.filter(e => e.kind === 'analysis').length,
            },
            events: events.map(e => ({
              kind: e.kind,
              tool: e.tool_name,
              summary: e.summary,
              success: e.result?.success,
              timestamp: e.created_at,
            })),
            plan: plan ? {
              stepsPlanned: plan.steps?.length,
              confidence: plan.analysis?.confidence,
            } : null,
            result: result ? {
              status: result.status,
              filesChanged: result.changes?.files?.length,
              testsPassed: result.tests?.passed,
              testsFailed: result.tests?.failed,
              reviewStatus: result.reviewStatus,
            } : null,
          },
        };
      },
    },
    
    {
      name: 'analyze_tool_efficiency',
      description: 'Analyze if tool usage was efficient',
      category: 'READ_ONLY',
      paramsSchema: z.object({
        jobId: z.string(),
      }),
      async execute(params, ctx) {
        const events = await ctx.db.events.findByJobId(params.jobId);
        const toolCalls = events.filter(e => e.kind === 'tool_call');
        
        // Detect patterns
        const patterns = {
          repeatedCalls: detectRepeatedCalls(toolCalls),
          failedThenRetried: detectRetryPatterns(toolCalls),
          readBeforeWrite: checkReadBeforeWrite(toolCalls),
          unnecessaryCalls: detectUnnecessaryCalls(toolCalls),
        };
        
        // Estimate minimum needed
        const uniqueFiles = new Set(toolCalls.filter(c => c.tool_name === 'read_file').map(c => c.params.path));
        const minEstimate = {
          reads: uniqueFiles.size,
          writes: toolCalls.filter(c => ['apply_patch', 'commit_changes'].includes(c.tool_name)).length,
          tests: 1,  // At least one test run needed
        };
        
        return {
          success: true,
          data: {
            totalCalls: toolCalls.length,
            estimatedMinimum: minEstimate.reads + minEstimate.writes + minEstimate.tests,
            efficiency: Math.min(1, (minEstimate.reads + minEstimate.writes + minEstimate.tests) / toolCalls.length),
            patterns,
          },
        };
      },
    },
    
    {
      name: 'check_for_hallucinations',
      description: 'Check if agent made claims without tool evidence',
      category: 'READ_ONLY',
      paramsSchema: z.object({
        jobId: z.string(),
      }),
      async execute(params, ctx) {
        const events = await ctx.db.events.findByJobId(params.jobId);
        const result = await ctx.db.results.findByJobId(params.jobId);
        
        // Check: Did agent claim files changed that weren't in apply_patch?
        const claimedFiles = result?.changes?.files?.map(f => f.path) || [];
        const patchedFiles = events
          .filter(e => e.tool_name === 'apply_patch' && e.result?.success)
          .flatMap(e => extractFilesFromPatch(e.params.patch));
        
        const unverifiedFiles = claimedFiles.filter(f => !patchedFiles.includes(f));
        
        // Check: Did agent claim tests passed without run_tests?
        const claimedTestsPassed = result?.tests?.status === 'pass';
        const actualTestRun = events.find(e => e.tool_name === 'run_tests' && e.result?.data?.status === 'pass');
        
        return {
          success: true,
          data: {
            hasHallucinations: unverifiedFiles.length > 0 || (claimedTestsPassed && !actualTestRun),
            unverifiedFileClaims: unverifiedFiles,
            testClaimWithoutEvidence: claimedTestsPassed && !actualTestRun,
          },
        };
      },
    },
    
    {
      name: 'record_evaluation',
      description: 'Record the final evaluation scores',
      category: 'MUTATING',
      paramsSchema: z.object({
        jobId: z.string(),
        scores: z.object({
          correctness: z.number().min(0).max(1),
          efficiency: z.number().min(0).max(1),
          honesty: z.number().min(0).max(1),
          safety: z.number().min(0).max(1),
        }),
        flags: z.array(z.enum([
          'hallucination',
          'over_tool_use',
          'under_tool_use',
          'constraint_violation',
          'unsafe_operation',
          'honest_failure',  // This is a GOOD flag
        ])).default([]),
        feedback: z.string(),
        recommendations: z.array(z.string()).optional(),
      }),
      async execute(params, ctx) {
        await ctx.db.evaluations.create({
          jobId: params.jobId,
          ...params.scores,
          flags: params.flags,
          feedback: params.feedback,
          recommendations: params.recommendations,
          evaluatedBy: 'evaluator-agent',
        });
        
        return { success: true };
      },
    },
  ];
}
```

---

## Part 6: Dashboard & Chat UI

### 6.1 Dashboard Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DASHBOARD (Next.js)                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         CHAT INTERFACE                                   │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │   │
│  │  │ User: fix the login bug for gmail addresses                     │   │   │
│  │  │                                                                  │   │   │
│  │  │ System: On it! I'll fix the email validation in auth...        │   │   │
│  │  │         [Job #job-a1b2] Started → Planner                       │   │   │
│  │  │                                                                  │   │   │
│  │  │ System: Found the issue - regex rejects + character.           │   │   │
│  │  │         [Plan created] 5 steps → Builder                        │   │   │
│  │  │                                                                  │   │   │
│  │  │ System: Done! Fixed email validation.                          │   │   │
│  │  │         📁 1 file changed (+3/-1)                               │   │   │
│  │  │         ✅ 47 tests passed                                      │   │   │
│  │  │         📝 Commit: def456a                                      │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                         │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │   │
│  │  │ Type a message...                                    [Send]    │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────────────────────┐   │
│  │   ACTIVE JOBS        │  │   JOB DETAILS: job-a1b2c3d4                  │   │
│  │   ────────────────   │  │   ──────────────────────────────────────────  │   │
│  │   ● job-a1b2 running │  │   Goal: Fix email validation for gmail       │   │
│  │   ○ job-x9y8 queued  │  │   Mode: mechanic                             │   │
│  │   ✓ job-m3n4 done    │  │   Status: running (Builder)                  │   │
│  │   ✗ job-p5q6 failed  │  │   Budget: 8/20 steps, 12000/50000 tokens    │   │
│  │                      │  │                                              │   │
│  │   ────────────────   │  │   Events:                                    │   │
│  │   NEEDS ATTENTION    │  │   10:30:01 search_code → 3 files found      │   │
│  │   ⚠ job-r7s8 waiting │  │   10:30:05 read_file validators.ts          │   │
│  │                      │  │   10:30:08 record_analysis (root cause)     │   │
│  └──────────────────────┘  │   10:30:12 create_plan (5 steps)            │   │
│                            │   10:30:15 create_branch                     │   │
│                            │   10:30:18 apply_patch ✓                     │   │
│                            │   10:30:22 run_tests → 47 passed            │   │
│                            └──────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         METRICS                                         │   │
│  │   Jobs Today: 47 | Success: 89% | Avg Time: 45s | Total Cost: $2.31   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Chat Component

```typescript
// packages/dashboard/src/components/Chat.tsx

'use client';

import { useState, useEffect, useRef } from 'react';
import { useConversation } from '@/hooks/useConversation';
import { Message } from '@/types';

export function Chat({ conversationId }: { conversationId?: string }) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const {
    conversation,
    messages,
    activeJobs,
    sendMessage,
    isProcessing,
  } = useConversation(conversationId);
  
  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;
    
    const userMessage = input.trim();
    setInput('');
    
    // Send through TDLN-IN → Coordinator → Agents → TDLN-OUT
    await sendMessage(userMessage);
  };
  
  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-lg overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        
        {/* Active job indicators */}
        {activeJobs.map((job) => (
          <JobProgress key={job.id} job={job} />
        ))}
        
        <div ref={messagesEndRef} />
      </div>
      
      {/* Input */}
      <div className="border-t border-slate-700 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a message... (e.g., 'fix the login bug')"
            className="flex-1 bg-slate-800 text-white rounded-lg px-4 py-2 
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isProcessing}
          />
          <button
            onClick={handleSend}
            disabled={isProcessing || !input.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Working...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-slate-800 text-slate-100'
        }`}
      >
        {/* Render message content */}
        <div className="whitespace-pre-wrap">{message.content}</div>
        
        {/* Job references if any */}
        {message.jobRefs?.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-600 text-sm">
            {message.jobRefs.map((ref) => (
              <JobRefBadge key={ref.jobId} jobRef={ref} />
            ))}
          </div>
        )}
        
        {/* Citations from TDLN-OUT */}
        {message.citations?.length > 0 && (
          <div className="mt-2 text-xs text-slate-400">
            Sources: {message.citations.map(c => c.source).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

function JobProgress({ job }: { job: ActiveJob }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-slate-800 rounded-lg">
      <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
      <div className="flex-1">
        <div className="text-sm text-slate-300">
          {job.currentAction || 'Processing...'}
        </div>
        <div className="text-xs text-slate-500">
          Job #{job.id.slice(0, 8)} • Step {job.stepsUsed}/{job.stepCap}
        </div>
      </div>
      <div className="text-xs text-slate-500">
        {formatDuration(Date.now() - new Date(job.startedAt).getTime())}
      </div>
    </div>
  );
}
```

### 6.3 useConversation Hook

```typescript
// packages/dashboard/src/hooks/useConversation.ts

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export function useConversation(initialConversationId?: string) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Stream updates via SSE (no 1s polling)
  useEffect(() => {
    if (!conversationId) return;
    
    // Initial fetch to hydrate
    api.getMessages(conversationId).then(setMessages);
    api.getActiveJobs(conversationId).then((jobs) => {
      setActiveJobs(jobs);
      if (jobs.length === 0) setIsProcessing(false);
    });
    
    const es = new EventSource(`/api/events/stream?conversationId=${conversationId}`);
    
    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as ConversationStreamEvent;
      
      if (data.type === 'message') {
        setMessages((prev) => [...prev, data.message]);
      }
      
      if (data.type === 'job_update') {
        setActiveJobs((prev) => {
          const filtered = prev.filter(j => j.id !== data.job.id);
          return data.job.status === 'running' ? [...filtered, data.job] : filtered;
        });
        if (data.job.status !== 'running') setIsProcessing(false);
      }
    };
    
    es.onerror = () => {
      es.close();
      // Client can reconnect on next render
    };
    
    return () => es.close();
  }, [conversationId]);
  
  const sendMessage = useCallback(async (content: string) => {
    setIsProcessing(true);
    
    try {
      // Create conversation if needed
      let convId = conversationId;
      if (!convId) {
        const conv = await api.createConversation();
        convId = conv.id;
        setConversationId(convId);
      }
      
      // Add user message optimistically
      const userMessage: Message = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      
      // Send to API
      // This goes: API → TDLN-IN → Coordinator → ...
      const result = await api.sendMessage(convId, content);
      
      // The response will stream via SSE
      // But we can add an immediate acknowledgment
      if (result.immediateResponse) {
        setMessages((prev) => [
          ...prev,
          {
            id: result.messageId,
            role: 'assistant',
            content: result.immediateResponse,
            jobRefs: result.jobIds?.map(id => ({ jobId: id })),
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch (error) {
      setIsProcessing(false);
      // Handle error
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${error.message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  }, [conversationId]);
  
  return {
    conversationId,
    messages,
    activeJobs,
    sendMessage,
    isProcessing,
  };
}
```

### 6.4 API Routes

```typescript
// packages/dashboard/src/app/api/messages/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tdlnIn } from '@/lib/tdln-in';
import { coordinator } from '@/lib/coordinator';

export async function POST(req: NextRequest) {
  const { conversationId, content } = await req.json();
  
  // 1. Store user message
  const userMessage = await db.messages.create({
    conversationId,
    role: 'user',
    content,
  });
  
  // 2. Run through TDLN-IN
  const tdlnResult = await tdlnIn.translate(content);
  
  // 3. Store translation with proof
  await db.translations.create({
    conversationId,
    direction: 'in',
    inputText: content,
    inputHash: tdlnResult.inputHash,
    outputText: tdlnResult.logline,
    outputHash: tdlnResult.outputHash,
    proof: tdlnResult.truthPack,
  });
  
  // 4. Handle ABSTAIN case
  if (tdlnResult.verdict === 'ABSTAIN') {
    const assistantMessage = await db.messages.create({
      conversationId,
      role: 'assistant',
      content: tdlnResult.clarification,
    });
    
    return NextResponse.json({
      messageId: assistantMessage.id,
      immediateResponse: tdlnResult.clarification,
      needsClarification: true,
    });
  }
  
  // 5. Create job via Coordinator
  const job = await coordinator.createJob({
    conversationId,
    traceId: crypto.randomUUID(),
    loglineSpan: tdlnResult.logline,
    spanHash: tdlnResult.outputHash,
    proofRef: tdlnResult.truthPack.id,
  });
  
  // 6. Return immediate acknowledgment
  const ackMessage = await db.messages.create({
    conversationId,
    role: 'assistant',
    content: `Working on it... Job ${job.id.slice(0, 8)} started.`,
    jobRefs: [{ jobId: job.id, status: 'queued' }],
  });
  
  return NextResponse.json({
    messageId: ackMessage.id,
    immediateResponse: ackMessage.content,
    jobIds: [job.id],
  });
}
```

### 6.5 Events SSE Route

```typescript
// packages/dashboard/src/app/api/events/stream/route.ts

import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get('conversationId');
  if (!conversationId) {
    return new Response('conversationId required', { status: 400 });
  }
  
  const client = await pool.connect();
  await client.query('LISTEN dashboard_events');
  
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: any) =>
        controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);
      
      // Heartbeat to keep connection alive
      send({ type: 'heartbeat', ts: Date.now() });
      
      const handler = (msg: any) => {
        const event = JSON.parse(msg.payload!);
        if (event.conversation_id !== conversationId) return;
        send(event);
      };
      
      client.on('notification', handler);
      
      controller.oncancel = () => {
        client.off('notification', handler);
        client.query('UNLISTEN dashboard_events').finally(() => client.release());
      };
    },
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

> Emit `NOTIFY dashboard_events, payload` whenever new events are inserted for the given conversation.

---

## Part 7: AWS Infrastructure

### 7.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              AWS INFRASTRUCTURE                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌──────────────┐                                                              │
│   │   Route 53   │                                                              │
│   │  DNS + SSL   │                                                              │
│   └──────┬───────┘                                                              │
│          │                                                                       │
│          ▼                                                                       │
│   ┌──────────────┐       ┌──────────────────────────────────────────────────┐  │
│   │  CloudFront  │──────►│                  VPC                              │  │
│   │     CDN      │       │  ┌────────────────────────────────────────────┐  │  │
│   └──────────────┘       │  │              PUBLIC SUBNET                  │  │  │
│                          │  │  ┌──────────────┐    ┌──────────────┐      │  │  │
│                          │  │  │     ALB      │    │   NAT GW     │      │  │  │
│                          │  │  │ (Dashboard)  │    │              │      │  │  │
│                          │  │  └──────┬───────┘    └──────┬───────┘      │  │  │
│                          │  └─────────┼───────────────────┼──────────────┘  │  │
│                          │            │                   │                  │  │
│                          │  ┌─────────┼───────────────────┼──────────────┐  │  │
│                          │  │         │   PRIVATE SUBNET  │              │  │  │
│                          │  │         ▼                   ▼              │  │  │
│                          │  │  ┌──────────────┐    ┌──────────────┐      │  │  │
│                          │  │  │  ECS Fargate │    │  ECS Fargate │      │  │  │
│                          │  │  │  Dashboard   │    │   Workers    │      │  │  │
│                          │  │  │   Service    │    │   Service    │      │  │  │
│                          │  │  └──────┬───────┘    └──────┬───────┘      │  │  │
│                          │  │         │                   │              │  │  │
│                          │  │         └─────────┬─────────┘              │  │  │
│                          │  │                   │                        │  │  │
│                          │  │         ┌─────────▼─────────┐              │  │  │
│                          │  │         │    RDS Postgres   │              │  │  │
│                          │  │         │  (Source of Truth │              │  │  │
│                          │  │         │   + job claiming) │              │  │  │
│                          │  │         └───────────────────┘              │  │  │
│                          │  │                                            │  │  │
│                          │  │         ┌───────────────────┐              │  │  │
│                          │  │         │  LISTEN/NOTIFY    │              │  │  │
│                          │  │         │  (SSE events)     │              │  │  │
│                          │  │         └───────────────────┘              │  │  │
│                          │  └────────────────────────────────────────────┘  │  │
│                          └──────────────────────────────────────────────────┘  │
│                                                                                  │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                     │
│   │  CloudWatch  │    │    S3        │    │   Secrets    │                     │
│   │   Logs +     │    │  Artifacts   │    │   Manager    │                     │
│   │   Metrics    │    │  + Repos     │    │  API Keys    │                     │
│   └──────────────┘    └──────────────┘    └──────────────┘                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Terraform Configuration

```hcl
# infra/main.tf

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket = "ai-coding-team-terraform-state"
    key    = "state/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "ai-coding-team"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ═══════════════════════════════════════════════════════════════════════════════
# VPC
# ═══════════════════════════════════════════════════════════════════════════════

module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  
  name = "ai-coding-team-${var.environment}"
  cidr = "10.0.0.0/16"
  
  azs             = ["${var.aws_region}a", "${var.aws_region}b"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]
  
  enable_nat_gateway = true
  single_nat_gateway = var.environment != "prod"
  
  enable_dns_hostnames = true
  enable_dns_support   = true
}

# ═══════════════════════════════════════════════════════════════════════════════
# RDS (Source of Truth)
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_db_instance" "source_of_truth" {
  identifier = "ai-coding-team-${var.environment}"
  
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = var.environment == "prod" ? "db.r6g.large" : "db.t3.small"
  multi_az       = var.environment == "prod" ? true : false
  
  allocated_storage     = 20
  max_allocated_storage = 100
  storage_encrypted     = true
  
  db_name  = "ai_coding_team"
  username = "admin"
  password = random_password.db_password.result
  
  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  
  backup_retention_period = var.environment == "prod" ? 7 : 1
  skip_final_snapshot     = var.environment != "prod"
  
  performance_insights_enabled = var.environment == "prod"
}

resource "aws_db_subnet_group" "main" {
  name       = "ai-coding-team-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "rds" {
  name   = "ai-coding-team-rds-${var.environment}"
  vpc_id = module.vpc.vpc_id
  
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
}

# ═══════════════════════════════════════════════════════════════════════════════
# ElastiCache (Job Queue)
# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# ECS Cluster
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_ecs_cluster" "main" {
  name = "ai-coding-team-${var.environment}"
  
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Dashboard Service
resource "aws_ecs_service" "dashboard" {
  name            = "dashboard"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.dashboard.arn
  desired_count   = var.environment == "prod" ? 2 : 1
  launch_type     = "FARGATE"
  
  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs.id]
  }
  
  load_balancer {
    target_group_arn = aws_lb_target_group.dashboard.arn
    container_name   = "dashboard"
    container_port   = 3000
  }
}

resource "aws_ecs_task_definition" "dashboard" {
  family                   = "dashboard"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.dashboard_task.arn
  
  container_definitions = jsonencode([
    {
      name  = "dashboard"
      image = "${aws_ecr_repository.dashboard.repository_url}:latest"
      
      portMappings = [{
        containerPort = 3000
        protocol      = "tcp"
      }]
      
      environment = [
        { name = "DATABASE_URL", value = "postgres://${aws_db_instance.source_of_truth.endpoint}/${aws_db_instance.source_of_truth.db_name}" },
      ]
      
      secrets = [
        { name = "DB_PASSWORD", valueFrom = aws_secretsmanager_secret.db_password.arn },
        { name = "OPENAI_API_KEY", valueFrom = aws_secretsmanager_secret.openai_key.arn },
      ]
      
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.dashboard.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "dashboard"
        }
      }
    }
  ])
}

# Mechanic Worker Service
resource "aws_ecs_service" "mechanic_worker" {
  name            = "mechanic-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.mechanic_worker.arn
  desired_count   = 0  # Scales via Application Auto Scaling; keep min >=2 while queue_depth>0
  launch_type     = "FARGATE"
  
  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs.id]
  }
}

resource "aws_ecs_task_definition" "mechanic_worker" {
  family                   = "mechanic-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn
  
  container_definitions = jsonencode([
    {
      name  = "worker"
      image = "${aws_ecr_repository.worker.repository_url}:latest"
      
      environment = [
        { name = "WORKER_MODE", value = "mechanic" },
        { name = "MODEL", value = "gpt-4o-mini" },
        { name = "STEP_CAP", value = "20" },
        { name = "TOKEN_CAP", value = "50000" },
        { name = "TIME_LIMIT_MS", value = "60000" },
        { name = "DATABASE_URL", value = "postgres://${aws_db_instance.source_of_truth.endpoint}/${aws_db_instance.source_of_truth.db_name}" },
      ]
      
      secrets = [
        { name = "DB_PASSWORD", valueFrom = aws_secretsmanager_secret.db_password.arn },
        { name = "OPENAI_API_KEY", valueFrom = aws_secretsmanager_secret.openai_key.arn },
      ]
      
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.workers.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "mechanic"
        }
      }
    }
  ])
}

# Genius Worker Service
resource "aws_ecs_service" "genius_worker" {
  name            = "genius-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.genius_worker.arn
  desired_count   = 0  # keep min >=2 while queue_depth>0 if genius work is enqueued
  launch_type     = "FARGATE"
  
  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs.id]
  }
}

resource "aws_ecs_task_definition" "genius_worker" {
  family                   = "genius-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 2048
  memory                   = 4096
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn
  
  container_definitions = jsonencode([
    {
      name  = "worker"
      image = "${aws_ecr_repository.worker.repository_url}:latest"
      
      environment = [
        { name = "WORKER_MODE", value = "genius" },
        { name = "MODEL", value = "gpt-4o" },
        { name = "STEP_CAP", value = "100" },
        { name = "TOKEN_CAP", value = "200000" },
        { name = "TIME_LIMIT_MS", value = "300000" },
        { name = "DATABASE_URL", value = "postgres://${aws_db_instance.source_of_truth.endpoint}/${aws_db_instance.source_of_truth.db_name}" },
      ]
      
      # ... same secrets and logging
    }
  ])
}

# ═══════════════════════════════════════════════════════════════════════════════
# Auto Scaling
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_appautoscaling_target" "mechanic_worker" {
  max_capacity       = 10
  min_capacity       = 0
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.mechanic_worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "mechanic_worker_queue" {
  name               = "mechanic-queue-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.mechanic_worker.resource_id
  scalable_dimension = aws_appautoscaling_target.mechanic_worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.mechanic_worker.service_namespace
  
  target_tracking_scaling_policy_configuration {
    customized_metric_specification {
      metric_name = "MechanicQueueDepth"
      namespace   = "AICodeTeam"
      statistic   = "Average"
    }
    target_value       = 5  # 5 jobs per worker
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ═══════════════════════════════════════════════════════════════════════════════
# CloudWatch Alarms
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_cloudwatch_metric_alarm" "job_failure_rate" {
  alarm_name          = "ai-coding-team-job-failure-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "JobFailures"
  namespace           = "AICodeTeam"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Job failure rate is high"
  
  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "escalation_rate" {
  alarm_name          = "ai-coding-team-escalation-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HumanEscalations"
  namespace           = "AICodeTeam"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Many jobs are being escalated to humans"
  
  alarm_actions = [aws_sns_topic.alerts.arn]
}
```

### 7.3 Worker Entry Point

```typescript
// packages/worker/src/index.ts

import { Database } from './db';
import { CoordinatorAgent, PlannerAgent, BuilderAgent, ReviewerAgent, EvaluatorAgent } from '@ai-coding-team/agents';
import { createLLMClient } from './llm';
import { loadTools } from './tools';

const config = {
  mode: process.env.WORKER_MODE as 'mechanic' | 'genius',
  model: process.env.MODEL!,
  stepCap: parseInt(process.env.STEP_CAP!, 10),
  tokenCap: parseInt(process.env.TOKEN_CAP!, 10),
  timeLimitMs: parseInt(process.env.TIME_LIMIT_MS!, 10),
};

const workerId = `worker-${process.pid}`;

async function main() {
  console.log(`Starting ${config.mode} worker with ${config.model}`);
  
  const db = new Database(process.env.DATABASE_URL!);
  const llm = createLLMClient(config.model);
  const tools = loadTools(config.mode);
  
  // Agent instances
  const agents = {
    coordinator: new CoordinatorAgent(llm, tools.coordinator, db),
    planner: new PlannerAgent(llm, tools.planner, db),
    builder: new BuilderAgent(llm, tools.builder, db),
    reviewer: new ReviewerAgent(llm, tools.reviewer, db),
    evaluator: new EvaluatorAgent(llm, tools.evaluator, db),
  };
  
  // Main loop
  while (true) {
    try {
      // 1. Try to claim a job
      const job = await claimJob(db, config.mode);
      
      if (!job) {
        // No jobs available, wait before next claim
        await sleep(1000);
        continue;
      }
      
      console.log(`Processing job ${job.id} (${job.agentType})`);
      
      // 2. Get the appropriate agent
      const agent = agents[job.agentType as keyof typeof agents];
      if (!agent) {
        await failJob(db, job.id, `Unknown agent type: ${job.agentType}`);
        continue;
      }
      
      // 3. Run the agent
      const startTime = Date.now();
      try {
        const result = await agent.run(job, {
          shouldCancel: () => checkCancellation(db, job.id),
        });
        
        // 4. Update job status
        if (result.success) {
          await db.jobs.update(job.id, {
            status: 'succeeded',
            finishedAt: new Date(),
          });
          
          // 5. Run evaluator (async, don't wait)
          scheduleEvaluation(db, job.id);
          
        } else {
          await db.jobs.update(job.id, {
            status: result.reason === 'waiting_human' ? 'waiting_human' : 'failed',
            finishedAt: new Date(),
          });
        }
        
      } catch (error) {
        console.error(`Job ${job.id} failed:`, error);
        await failJob(db, job.id, error.message);
      }
      
      // 6. Log metrics
      const duration = Date.now() - startTime;
      await logMetrics(job, duration);
      
    } catch (error) {
      console.error('Worker error:', error);
      await sleep(5000);  // Wait before retrying
    }
  }
}

async function claimJob(db: Database, mode: string): Promise<Job | null> {
  // Postgres lock with SKIP LOCKED keeps claim atomic without Redis
  return db.transaction(async (tx) => {
    const job = await tx.oneOrNone<Job>(`
      SELECT * FROM jobs
      WHERE status = 'queued' AND mode = $1
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `, [mode]);
    
    if (!job) return null;
    
    await tx.jobs.update(job.id, {
      status: 'running',
      assignedTo: workerId,
      startedAt: new Date(),
    });
    
    return job;
  });
}

async function failJob(db: Database, jobId: string, reason: string) {
  await db.jobs.update(jobId, {
    status: 'failed',
    finishedAt: new Date(),
  });
  
  await db.events.create({
    jobId,
    kind: 'error',
    summary: reason,
  });
}

async function scheduleEvaluation(db: Database, jobId: string) {
  await db.jobs.create({
    traceId: jobId,
    agentType: 'evaluator',
    goal: `Evaluate job ${jobId}`,
    mode: 'mechanic',
    status: 'queued',
    parentJobId: jobId,
  });
}

async function checkCancellation(db: Database, jobId: string) {
  const status = await db.jobs.getStatus(jobId);
  return status === 'cancelling';
}

async function logMetrics(job: Job, duration: number) {
  // CloudWatch custom metrics
  const metricData = {
    Namespace: 'AICodeTeam',
    MetricData: [
      {
        MetricName: 'JobDuration',
        Value: duration,
        Unit: 'Milliseconds',
        Dimensions: [
          { Name: 'Mode', Value: job.mode },
          { Name: 'AgentType', Value: job.agentType },
        ],
      },
      {
        MetricName: job.status === 'succeeded' ? 'JobSuccesses' : 'JobFailures',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Mode', Value: job.mode },
        ],
      },
    ],
  };
  
  // In real implementation, use AWS SDK
  console.log('Metrics:', JSON.stringify(metricData));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
```

---

## Part 8: Implementation Roadmap

### 8.1 Phase 1: Foundation (Week 1-2)

| Task | Description | Files |
|------|-------------|-------|
| Project setup | Monorepo with pnpm + Cargo | `package.json`, `Cargo.toml` |
| Rust Machinery | Init `logline`, `tdln-in`, `tdln-out` crates | `crates/*/Cargo.toml` |
| Database schema | PostgreSQL tables with migrations | `packages/db/migrations/` |
| Basic tools | read_file, search_code, list_files | `packages/tools/src/read.ts` |
| Test harness | Jest + Cargo test setup | `packages/*/tests/`, `crates/*/tests/` |

**Deliverable**: Rust crates compiling, DB schema applied, basic tools working.

### 8.2 Phase 2: TDLN Layer (Week 2-3)

| Task | Description | Files |
|------|-------------|-------|
| LogLine Parser (Rust) | Pest grammar + AST serialization | `crates/logline/src/grammar.pest` |
| TDLN-IN (Rust) | Pattern matching + TruthPack generation | `crates/tdln-in/src/` |
| TDLN-OUT (Rust) | Template renderer + Citation handling | `crates/tdln-out/src/` |
| Node Bindings | NAPI-RS bindings for all crates | `packages/*/src/binding.ts` |
| Grammar Rules | Define coding intents and templates | `grammars/*.yaml` |

**Deliverable**: Rust-powered TDLN translation working in Node.js.

### 8.3 Phase 3: Agents (Week 3-5)

| Task | Description | Files |
|------|-------------|-------|
| Base agent | Abstract class with loop, budgeting | `packages/agents/src/base.ts` |
| Coordinator | Routing, job creation | `packages/agents/src/coordinator.ts` |
| Planner | Analysis, plan generation | `packages/agents/src/planner.ts` |
| Builder | Patch application, testing | `packages/agents/src/builder.ts` |
| Builder tools | apply_patch, run_tests, commit | `packages/tools/src/write.ts` |
| Reviewer | Diff review, approval | `packages/agents/src/reviewer.ts` |
| Evaluator | Post-run scoring | `packages/agents/src/evaluator.ts` |

**Deliverable**: Complete agent pipeline, bug fixes on sample repo

### 8.4 Phase 4: Dashboard (Week 5-6)

| Task | Description | Files |
|------|-------------|-------|
| Next.js setup | App router, Tailwind | `packages/dashboard/` |
| Chat interface | Messages, job progress | `packages/dashboard/src/components/Chat.tsx` |
| Job viewer | Event timeline, details | `packages/dashboard/src/components/JobViewer.tsx` |
| Metrics panel | Success rates, costs | `packages/dashboard/src/components/Metrics.tsx` |
| API routes | Message handling, SSE | `packages/dashboard/src/app/api/` |

**Deliverable**: Working web UI for conversations

### 8.5 Phase 5: AWS Deployment (Week 6-7)

| Task | Description | Files |
|------|-------------|-------|
| Terraform modules | VPC, RDS, ECS | `infra/` |
| Docker images | Dashboard, worker | `Dockerfile.*` |
| CI/CD | GitHub Actions | `.github/workflows/` |
| Monitoring | CloudWatch dashboards, alarms | `infra/monitoring.tf` |
| Secrets management | API keys, DB credentials | `infra/secrets.tf` |

**Deliverable**: Production deployment on AWS

### 8.6 Phase 6: Polish (Week 7-8)

| Task | Description | Files |
|------|-------------|-------|
| AGENTS.md support | Per-repo config | `packages/agents/src/config.ts` |
| Multi-turn conversations | Follow-up handling | `packages/coordinator/src/conversation.ts` |
| Quality gates | Pre-commit checks | `packages/tools/src/quality.ts` |
| Documentation | Setup guide, API docs | `docs/` |
| Example repos | Demo projects | `examples/` |

**Deliverable**: Production-ready system with docs

---

## Part 9: File Structure (Complete)

```
ai-coding-team/
├── package.json                    # Node workspace root
├── pnpm-workspace.yaml
├── Cargo.toml                      # Rust workspace root
├── tsconfig.json                   # Base TypeScript config
├── turbo.json                      # Turborepo config
│
│ ══════════════════════════════════════════════════════════════════════════════
│                              RUST MACHINERY
│ ══════════════════════════════════════════════════════════════════════════════
│
├── crates/
│   │
│   ├── logline/                    # LogLine Parser (Rust)
│   │   ├── src/
│   │   │   ├── lib.rs              # Crate root, exports API
│   │   │   ├── ast.rs              # LogLineSpan, LogLineValue, etc.
│   │   │   ├── parser.rs           # Pest parser implementation
│   │   │   ├── serializer.rs       # AST → String
│   │   │   └── grammar.pest        # Pest grammar definition
│   │   ├── tests/
│   │   │   └── parser_tests.rs
│   │   └── Cargo.toml
│   │
│   ├── tdln-in/                    # NL → LogLine Compiler (Rust)
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── grammar.rs          # Grammar YAML loader
│   │   │   ├── normalizer.rs       # Text normalization
│   │   │   ├── matcher.rs          # Pattern matching engine
│   │   │   ├── entities.rs         # Entity extraction
│   │   │   └── prover.rs           # TruthPack + Merkle proofs
│   │   ├── tests/
│   │   └── Cargo.toml
│   │
│   ├── tdln-out/                   # JSON → NL Renderer (Rust)
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── templates.rs        # Template YAML loader
│   │   │   ├── renderer.rs         # Handlebars-style rendering
│   │   │   └── citations.rs        # Citation handling
│   │   ├── tests/
│   │   └── Cargo.toml
│   │
│   └── napi-bindings/              # NAPI-RS Node.js bindings
│       ├── src/
│       │   ├── lib.rs              # #[napi] exports
│       │   ├── logline.rs          # parse_logline, serialize_logline
│       │   ├── tdln_in.rs          # translate_nl_to_logline
│       │   └── tdln_out.rs         # render_json_to_nl
│       ├── index.d.ts              # TypeScript definitions (auto-generated)
│       └── Cargo.toml
│
│ ══════════════════════════════════════════════════════════════════════════════
│                           TYPESCRIPT ORCHESTRATION
│ ══════════════════════════════════════════════════════════════════════════════
│
├── packages/
│   │
│   ├── machinery/                  # Node.js wrapper for Rust crates
│   │   ├── src/
│   │   │   ├── index.ts            # Re-exports from native bindings
│   │   │   ├── logline.ts          # parseLogLine(), serializeLogLine()
│   │   │   ├── tdln-in.ts          # translateToLogLine()
│   │   │   └── tdln-out.ts         # renderToNaturalLanguage()
│   │   ├── native/                 # Compiled .node files (gitignored)
│   │   └── package.json
│   │
│   ├── db/                         # Database layer
│   │   ├── src/
│   │   │   ├── index.ts            # Database client
│   │   │   ├── schema.ts           # Type definitions
│   │   │   └── queries.ts          # Query builders
│   │   ├── migrations/
│   │   │   ├── 001_initial.sql
│   │   │   ├── 002_jobs.sql
│   │   │   ├── 003_events.sql
│   │   │   └── 004_truth_packs.sql
│   │   └── package.json
│   │
│   ├── tools/                      # Agent tools
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts            # Tool interface
│   │   │   ├── read/
│   │   │   │   ├── read_file.ts
│   │   │   │   ├── search_code.ts
│   │   │   │   ├── list_files.ts
│   │   │   │   └── get_repo_state.ts
│   │   │   ├── write/
│   │   │   │   ├── create_branch.ts
│   │   │   │   ├── apply_patch.ts
│   │   │   │   ├── run_tests.ts
│   │   │   │   ├── run_lint.ts
│   │   │   │   └── commit_changes.ts
│   │   │   └── meta/
│   │   │       ├── record_analysis.ts
│   │   │       ├── create_plan.ts
│   │   │       ├── create_result.ts
│   │   │       └── request_human_review.ts
│   │   └── package.json
│   │
│   ├── agents/                     # Agent implementations
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── base.ts             # BaseAgent class
│   │   │   ├── coordinator.ts
│   │   │   ├── planner.ts
│   │   │   ├── builder.ts
│   │   │   ├── reviewer.ts
│   │   │   └── evaluator.ts
│   │   ├── prompts/
│   │   │   ├── system.ts           # System prompt builder
│   │   │   └── contracts.ts        # Untrusted brain contract
│   │   └── package.json
│   │
│   ├── worker/                     # ECS worker process
│   │   ├── src/
│   │   │   ├── index.ts            # Entry point
│   │   │   ├── loop.ts             # Main work loop
│   │   │   ├── claim.ts            # Job claiming
│   │   │   └── metrics.ts          # CloudWatch metrics
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── dashboard/                  # Next.js app
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx
│       │   │   ├── chat/
│       │   │   │   └── page.tsx
│       │   │   ├── jobs/
│       │   │   │   ├── page.tsx
│       │   │   │   └── [id]/page.tsx
│       │   │   └── api/
│       │   │       ├── messages/route.ts
│       │   │       ├── jobs/route.ts
│       │   │       └── events/stream/route.ts
│       │   ├── components/
│       │   │   ├── Chat.tsx
│       │   │   ├── MessageBubble.tsx
│       │   │   ├── JobProgress.tsx
│       │   │   ├── JobViewer.tsx
│       │   │   ├── EventTimeline.tsx
│       │   │   └── Metrics.tsx
│       │   ├── hooks/
│       │   │   ├── useConversation.ts
│       │   │   └── useJob.ts
│       │   └── lib/
│       │       ├── api.ts
│       │       └── db.ts
│       ├── Dockerfile
│       └── package.json
│
├── grammars/                       # TDLN configuration
│   ├── coding-intents.yaml         # TDLN-IN rules
│   └── response-templates.yaml     # TDLN-OUT templates
│
├── infra/                          # Terraform
│   ├── main.tf
│   ├── vpc.tf
│   ├── rds.tf
│   ├── ecs.tf
│   ├── monitoring.tf
│   ├── secrets.tf
│   └── variables.tf
│
├── .github/
│   └── workflows/
│       ├── ci.yml                  # Includes: cargo test, cargo build --release
│       └── deploy.yml
│
├── docs/
│   ├── setup.md
│   ├── architecture.md
│   ├── rust-machinery.md           # How to build and use Rust crates
│   ├── agents.md
│   └── api.md
│
├── examples/
│   ├── sample-repo/                # Test repo for demos
│   └── scenarios/                  # Test scenarios
│
├── AGENTS.md                       # Default agent config
└── README.md
```

---

## Part 10: Rust Crate Details

### 10.1 LogLine Crate (`crates/logline`)

The LogLine parser is the foundation of the system. It parses the LogLine language into an AST.

```rust
// crates/logline/src/lib.rs

pub mod ast;
pub mod parser;
pub mod serializer;

pub use ast::*;
pub use parser::parse;
pub use serializer::serialize;

/// Parse a LogLine block into an AST
pub fn parse_logline(input: &str) -> Result<LogLineSpan, ParseError> {
    parser::parse(input)
}

/// Serialize an AST back to LogLine text
pub fn serialize_logline(span: &LogLineSpan) -> String {
    serializer::serialize(span)
}
```

```rust
// crates/logline/src/ast.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LogLineValue {
    String(String),
    Number(f64),
    Boolean(bool),
    Null,
    Reference(LogLineReference),
    FunctionCall(LogLineFunctionCall),
    Interpolation(LogLineInterpolation),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogLineReference {
    pub path: Vec<String>,  // @foo.bar.baz → ["foo", "bar", "baz"]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogLineFunctionCall {
    pub name: String,
    pub args: Vec<LogLineValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogLineInterpolation {
    pub parts: Vec<InterpolationPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum InterpolationPart {
    Literal(String),
    Expression(LogLineValue),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogLineSpan {
    pub keyword: String,              // "OPERATION", "JOB", "PLAN", etc.
    pub name: Option<String>,         // Optional name after keyword
    pub params: Vec<(String, LogLineValue)>,
    pub children: Vec<LogLineSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseError {
    pub message: String,
    pub line: usize,
    pub column: usize,
}
```

### 10.2 TDLN-IN Crate (`crates/tdln-in`)

The TDLN-IN crate compiles natural language to LogLine spans.

```rust
// crates/tdln-in/src/lib.rs

pub mod grammar;
pub mod normalizer;
pub mod matcher;
pub mod entities;
pub mod prover;

use logline::LogLineSpan;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationResult {
    pub verdict: Verdict,
    pub logline: Option<LogLineSpan>,
    pub clarification: Option<String>,
    pub truth_pack: TruthPack,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Verdict {
    Translated,
    Abstain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TruthPack {
    pub id: String,
    pub version: String,
    pub input: InputRecord,
    pub output: OutputRecord,
    pub translation: TranslationRecord,
    pub merkle: MerkleCommitment,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputRecord {
    pub raw: String,
    pub normalized: String,
    pub norm_hash: String,  // SHA256
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputRecord {
    pub logline_json: String,
    pub plan_hash: String,  // SHA256
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationRecord {
    pub grammar_id: String,
    pub grammar_version: String,
    pub rule_matched: String,
    pub entities_captured: std::collections::HashMap<String, String>,
    pub selection_trace: String,
    pub sel_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleCommitment {
    pub root: String,
    pub leaves: Vec<String>,
}

/// Main translation function
pub fn translate(
    input: &str,
    grammar: &grammar::Grammar,
) -> TranslationResult {
    let normalized = normalizer::normalize(input, &grammar.normalization);
    let match_result = matcher::find_best_match(&normalized, &grammar.rules);
    
    match match_result {
        Some(m) if m.rule.output != "ABSTAIN" => {
            let logline = entities::substitute_and_parse(&m);
            let truth_pack = prover::generate_truth_pack(
                input,
                &normalized,
                &logline,
                grammar,
                &m,
            );
            TranslationResult {
                verdict: Verdict::Translated,
                logline: Some(logline),
                clarification: None,
                truth_pack,
            }
        }
        _ => {
            let clarification = match_result
                .and_then(|m| m.rule.clarification.clone())
                .unwrap_or_else(|| "Could not understand request.".to_string());
            
            let truth_pack = prover::generate_abstain_truth_pack(input, &normalized, grammar);
            
            TranslationResult {
                verdict: Verdict::Abstain,
                logline: None,
                clarification: Some(clarification),
                truth_pack,
            }
        }
    }
}
```

### 10.3 TDLN-OUT Crate (`crates/tdln-out`)

The TDLN-OUT crate renders JSON responses to natural language.

```rust
// crates/tdln-out/src/lib.rs

pub mod templates;
pub mod renderer;
pub mod citations;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderResult {
    pub text: String,
    pub citations: Vec<Citation>,
    pub proof_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub field: String,
    pub source: String,
    pub value_hash: String,
}

/// Render JSON to natural language using a template
pub fn render(
    template_id: &str,
    data: &Value,
    templates: &templates::TemplateRegistry,
) -> Result<RenderResult, RenderError> {
    let template = templates.get(template_id)?;
    let text = renderer::render_template(template, data)?;
    let citations = citations::extract_citations(template, data);
    let proof_hash = compute_render_hash(&text, &citations);
    
    Ok(RenderResult {
        text,
        citations,
        proof_hash,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderError {
    pub message: String,
    pub template_id: String,
}

fn compute_render_hash(text: &str, citations: &[Citation]) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    for c in citations {
        hasher.update(c.value_hash.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}
```

### 10.4 NAPI Bindings (`crates/napi-bindings`)

NAPI-RS bindings expose Rust crates to Node.js.

```rust
// crates/napi-bindings/src/lib.rs

use napi_derive::napi;
use napi::bindgen_prelude::*;

pub mod logline_bindings;
pub mod tdln_in_bindings;
pub mod tdln_out_bindings;

pub use logline_bindings::*;
pub use tdln_in_bindings::*;
pub use tdln_out_bindings::*;
```

```rust
// crates/napi-bindings/src/logline_bindings.rs

use napi_derive::napi;
use napi::bindgen_prelude::*;

#[napi]
pub fn parse_logline(input: String) -> Result<String> {
    match logline::parse_logline(&input) {
        Ok(span) => {
            let json = serde_json::to_string(&span)
                .map_err(|e| Error::from_reason(e.to_string()))?;
            Ok(json)
        }
        Err(e) => Err(Error::from_reason(format!(
            "Parse error at {}:{}: {}",
            e.line, e.column, e.message
        ))),
    }
}

#[napi]
pub fn serialize_logline(span_json: String) -> Result<String> {
    let span: logline::LogLineSpan = serde_json::from_str(&span_json)
        .map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(logline::serialize_logline(&span))
}
```

```rust
// crates/napi-bindings/src/tdln_in_bindings.rs

use napi_derive::napi;
use napi::bindgen_prelude::*;

#[napi]
pub struct TdlnInEngine {
    grammar: tdln_in::grammar::Grammar,
}

#[napi]
impl TdlnInEngine {
    #[napi(constructor)]
    pub fn new(grammar_yaml: String) -> Result<Self> {
        let grammar = tdln_in::grammar::load_from_yaml(&grammar_yaml)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Self { grammar })
    }

    #[napi]
    pub fn translate(&self, input: String) -> Result<String> {
        let result = tdln_in::translate(&input, &self.grammar);
        let json = serde_json::to_string(&result)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(json)
    }
}
```

```rust
// crates/napi-bindings/src/tdln_out_bindings.rs

use napi_derive::napi;
use napi::bindgen_prelude::*;

#[napi]
pub struct TdlnOutEngine {
    templates: tdln_out::templates::TemplateRegistry,
}

#[napi]
impl TdlnOutEngine {
    #[napi(constructor)]
    pub fn new(templates_yaml: String) -> Result<Self> {
        let templates = tdln_out::templates::load_from_yaml(&templates_yaml)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Self { templates })
    }

    #[napi]
    pub fn render(&self, template_id: String, data_json: String) -> Result<String> {
        let data: serde_json::Value = serde_json::from_str(&data_json)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        
        let result = tdln_out::render(&template_id, &data, &self.templates)
            .map_err(|e| Error::from_reason(e.message))?;
        
        let json = serde_json::to_string(&result)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(json)
    }
}
```

---

## Part 11: TypeScript Wrapper Usage

### 11.1 Machinery Package

The TypeScript `machinery` package wraps the Rust NAPI bindings with a clean API:

```typescript
// packages/machinery/src/index.ts

export { parseLogLine, serializeLogLine, LogLineSpan } from './logline';
export { TdlnIn, TranslationResult, TruthPack, Verdict } from './tdln-in';
export { TdlnOut, RenderResult, Citation } from './tdln-out';
```

```typescript
// packages/machinery/src/logline.ts

import { parseLogline as nativeParse, serializeLogline as nativeSerialize } from '../native';

export interface LogLineSpan {
  keyword: string;
  name?: string;
  params: [string, LogLineValue][];
  children: LogLineSpan[];
}

export type LogLineValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }
  | { type: 'reference'; path: string[] }
  | { type: 'function_call'; name: string; args: LogLineValue[] }
  | { type: 'interpolation'; parts: InterpolationPart[] };

export type InterpolationPart =
  | { type: 'literal'; value: string }
  | { type: 'expression'; value: LogLineValue };

export function parseLogLine(input: string): LogLineSpan {
  const json = nativeParse(input);
  return JSON.parse(json);
}

export function serializeLogLine(span: LogLineSpan): string {
  return nativeSerialize(JSON.stringify(span));
}
```

```typescript
// packages/machinery/src/tdln-in.ts

import { TdlnInEngine as NativeEngine } from '../native';
import { LogLineSpan } from './logline';
import { readFileSync } from 'fs';

export type Verdict = 'Translated' | 'Abstain';

export interface TruthPack {
  id: string;
  version: string;
  input: {
    raw: string;
    normalized: string;
    norm_hash: string;
  };
  output: {
    logline_json: string;
    plan_hash: string;
  };
  translation: {
    grammar_id: string;
    grammar_version: string;
    rule_matched: string;
    entities_captured: Record<string, string>;
    selection_trace: string;
    sel_hash: string;
  };
  merkle: {
    root: string;
    leaves: string[];
  };
  created_at: string;
}

export interface TranslationResult {
  verdict: Verdict;
  logline?: LogLineSpan;
  clarification?: string;
  truth_pack: TruthPack;
}

export class TdlnIn {
  private engine: NativeEngine;

  constructor(grammarPath: string) {
    const grammarYaml = readFileSync(grammarPath, 'utf-8');
    this.engine = new NativeEngine(grammarYaml);
  }

  translate(input: string): TranslationResult {
    const json = this.engine.translate(input);
    return JSON.parse(json);
  }
}
```

### 11.2 Using Machinery in Agents

```typescript
// packages/agents/src/coordinator.ts

import { TdlnIn, TdlnOut, parseLogLine, TranslationResult } from '@ai-coding-team/machinery';
import { Database } from '@ai-coding-team/db';
import { BaseAgent } from './base';

export class CoordinatorAgent extends BaseAgent {
  private tdlnIn: TdlnIn;
  private tdlnOut: TdlnOut;

  constructor(db: Database, grammarPath: string, templatesPath: string) {
    super(db);
    this.tdlnIn = new TdlnIn(grammarPath);
    this.tdlnOut = new TdlnOut(templatesPath);
  }

  /**
   * Handle incoming natural language message from user
   */
  async handleUserMessage(conversationId: string, message: string): Promise<string> {
    // 1. Translate NL → LogLine using Rust machinery
    const translation = this.tdlnIn.translate(message);
    
    // 2. Store truth pack for auditability
    await this.db.truthPacks.create({
      id: translation.truth_pack.id,
      merkle_root: translation.truth_pack.merkle.root,
      content: translation.truth_pack,
    });
    
    // 3. Handle based on verdict
    if (translation.verdict === 'Abstain') {
      // Ask for clarification
      const response = this.tdlnOut.render('clarification_needed', {
        question: translation.clarification,
      });
      return response.text;
    }
    
    // 4. Route to appropriate agent based on LogLine operation
    const logline = translation.logline!;
    const operation = logline.keyword;
    
    // ... routing logic ...
    
    return 'Processing your request...';
  }
}
```

---

## Part 12: Rust Workspace Configuration

### 12.1 Root Cargo.toml

```toml
# Cargo.toml (workspace root)

[workspace]
resolver = "2"
members = [
    "crates/logline",
    "crates/tdln-in",
    "crates/tdln-out",
    "crates/napi-bindings",
]

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "MIT"
repository = "https://github.com/your-org/ai-coding-team"

[workspace.dependencies]
# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
serde_yaml = "0.9"

# Parsing
pest = "2.7"
pest_derive = "2.7"

# Cryptography
sha2 = "0.10"
hex = "0.4"

# Error handling
thiserror = "1.0"
anyhow = "1.0"

# Async (for future use)
tokio = { version = "1.0", features = ["full"] }

# NAPI
napi = "2"
napi-derive = "2"

# Testing
pretty_assertions = "1.4"
```

### 12.2 LogLine Crate Cargo.toml

```toml
# crates/logline/Cargo.toml

[package]
name = "logline"
version.workspace = true
edition.workspace = true

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
pest = { workspace = true }
pest_derive = { workspace = true }
thiserror = { workspace = true }

[dev-dependencies]
pretty_assertions = { workspace = true }
```

### 12.3 TDLN-IN Crate Cargo.toml

```toml
# crates/tdln-in/Cargo.toml

[package]
name = "tdln-in"
version.workspace = true
edition.workspace = true

[dependencies]
logline = { path = "../logline" }
serde = { workspace = true }
serde_json = { workspace = true }
serde_yaml = { workspace = true }
sha2 = { workspace = true }
hex = { workspace = true }
thiserror = { workspace = true }
uuid = { version = "1.0", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }

[dev-dependencies]
pretty_assertions = { workspace = true }
```

### 12.4 TDLN-OUT Crate Cargo.toml

```toml
# crates/tdln-out/Cargo.toml

[package]
name = "tdln-out"
version.workspace = true
edition.workspace = true

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
serde_yaml = { workspace = true }
sha2 = { workspace = true }
hex = { workspace = true }
thiserror = { workspace = true }
handlebars = "5.1"

[dev-dependencies]
pretty_assertions = { workspace = true }
```

### 12.5 NAPI Bindings Cargo.toml

```toml
# crates/napi-bindings/Cargo.toml

[package]
name = "napi-bindings"
version.workspace = true
edition.workspace = true

[lib]
crate-type = ["cdylib"]

[dependencies]
logline = { path = "../logline" }
tdln-in = { path = "../tdln-in" }
tdln-out = { path = "../tdln-out" }
serde = { workspace = true }
serde_json = { workspace = true }
napi = { workspace = true }
napi-derive = { workspace = true }

[build-dependencies]
napi-build = "2"
```

---

## Part 13: Pest Grammar for LogLine

### 13.1 Complete Grammar Definition

```pest
// crates/logline/src/grammar.pest

// ═══════════════════════════════════════════════════════════════════════════════
// WHITESPACE AND COMMENTS
// ═══════════════════════════════════════════════════════════════════════════════

WHITESPACE = _{ " " | "\t" }
NEWLINE = _{ "\r\n" | "\n" | "\r" }
COMMENT = _{ "//" ~ (!NEWLINE ~ ANY)* ~ NEWLINE? }

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT
// ═══════════════════════════════════════════════════════════════════════════════

document = { SOI ~ NEWLINE* ~ span* ~ EOI }

// ═══════════════════════════════════════════════════════════════════════════════
// SPANS
// ═══════════════════════════════════════════════════════════════════════════════

span = {
    keyword ~ (":" ~ span_name)? ~ NEWLINE ~
    (indent ~ (param | nested_span) ~ NEWLINE)* ~
    indent ~ "END"
}

keyword = @{ ASCII_ALPHA_UPPER+ ~ (ASCII_ALPHA_UPPER | "_")* }
span_name = @{ identifier }

nested_span = { span }

// ═══════════════════════════════════════════════════════════════════════════════
// PARAMETERS
// ═══════════════════════════════════════════════════════════════════════════════

param = { param_key ~ ":" ~ value }
param_key = @{ ASCII_ALPHA_UPPER ~ (ASCII_ALPHA_UPPER | "_" | ASCII_DIGIT)* }

// ═══════════════════════════════════════════════════════════════════════════════
// VALUES
// ═══════════════════════════════════════════════════════════════════════════════

value = {
    reference |
    function_call |
    interpolation |
    array |
    number |
    boolean |
    null |
    string
}

// Strings
string = ${ "\"" ~ string_inner ~ "\"" }
string_inner = @{ (!"\"" ~ !"\\" ~ ANY | escape_sequence)* }
escape_sequence = @{ "\\" ~ ("\"" | "\\" | "n" | "r" | "t" | "0") }

// Numbers
number = @{ "-"? ~ ("0" | ASCII_NONZERO_DIGIT ~ ASCII_DIGIT*) ~ ("." ~ ASCII_DIGIT+)? }

// Booleans
boolean = { "true" | "false" }

// Null
null = { "null" }

// Arrays
array = { "[" ~ (value ~ ("," ~ value)*)? ~ "]" }

// ═══════════════════════════════════════════════════════════════════════════════
// REFERENCES (@path.to.thing)
// ═══════════════════════════════════════════════════════════════════════════════

reference = ${ "@" ~ reference_path }
reference_path = @{ identifier ~ ("." ~ identifier)* }

// ═══════════════════════════════════════════════════════════════════════════════
// FUNCTION CALLS (func_name(arg1, arg2))
// ═══════════════════════════════════════════════════════════════════════════════

function_call = { function_name ~ "(" ~ (value ~ ("," ~ value)*)? ~ ")" }
function_name = @{ ASCII_ALPHA_LOWER ~ (ASCII_ALPHANUMERIC | "_")* }

// ═══════════════════════════════════════════════════════════════════════════════
// INTERPOLATIONS (`template with ${expr}`)
// ═══════════════════════════════════════════════════════════════════════════════

interpolation = ${ "`" ~ interpolation_inner ~ "`" }
interpolation_inner = { (interpolation_literal | interpolation_expr)* }
interpolation_literal = @{ (!"`" ~ !"${" ~ ANY)+ }
interpolation_expr = !{ "${" ~ value ~ "}" }

// ═══════════════════════════════════════════════════════════════════════════════
// IDENTIFIERS
// ═══════════════════════════════════════════════════════════════════════════════

identifier = @{ (ASCII_ALPHA | "_") ~ (ASCII_ALPHANUMERIC | "_" | "-")* }

// ═══════════════════════════════════════════════════════════════════════════════
// INDENTATION (flexible - 2 or 4 spaces)
// ═══════════════════════════════════════════════════════════════════════════════

indent = _{ "  "+ }
```

### 13.2 Parser Implementation

```rust
// crates/logline/src/parser.rs

use pest::Parser;
use pest_derive::Parser;
use crate::ast::*;

#[derive(Parser)]
#[grammar = "grammar.pest"]
pub struct LogLineParser;

pub fn parse(input: &str) -> Result<LogLineSpan, ParseError> {
    let pairs = LogLineParser::parse(Rule::document, input)
        .map_err(|e| ParseError {
            message: e.to_string(),
            line: e.line_col.map(|(l, _)| l).unwrap_or(0),
            column: e.line_col.map(|(_, c)| c).unwrap_or(0),
        })?;
    
    let document = pairs.into_iter().next().unwrap();
    
    // Find the first span in the document
    for pair in document.into_inner() {
        if pair.as_rule() == Rule::span {
            return parse_span(pair);
        }
    }
    
    Err(ParseError {
        message: "No span found in document".to_string(),
        line: 0,
        column: 0,
    })
}

fn parse_span(pair: pest::iterators::Pair<Rule>) -> Result<LogLineSpan, ParseError> {
    let mut inner = pair.into_inner();
    
    let keyword = inner.next().unwrap().as_str().to_string();
    
    let mut name = None;
    let mut params = Vec::new();
    let mut children = Vec::new();
    
    for item in inner {
        match item.as_rule() {
            Rule::span_name => {
                name = Some(item.as_str().to_string());
            }
            Rule::param => {
                let mut param_inner = item.into_inner();
                let key = param_inner.next().unwrap().as_str().to_string();
                let value = parse_value(param_inner.next().unwrap())?;
                params.push((key, value));
            }
            Rule::nested_span => {
                let span = parse_span(item.into_inner().next().unwrap())?;
                children.push(span);
            }
            _ => {}
        }
    }
    
    Ok(LogLineSpan {
        keyword,
        name,
        params,
        children,
    })
}

fn parse_value(pair: pest::iterators::Pair<Rule>) -> Result<LogLineValue, ParseError> {
    let inner = pair.into_inner().next().unwrap();
    
    match inner.as_rule() {
        Rule::string => {
            let s = inner.into_inner().next().unwrap().as_str();
            Ok(LogLineValue::String(unescape_string(s)))
        }
        Rule::number => {
            let n: f64 = inner.as_str().parse().unwrap();
            Ok(LogLineValue::Number(n))
        }
        Rule::boolean => {
            Ok(LogLineValue::Boolean(inner.as_str() == "true"))
        }
        Rule::null => {
            Ok(LogLineValue::Null)
        }
        Rule::reference => {
            let path_str = inner.into_inner().next().unwrap().as_str();
            let path: Vec<String> = path_str.split('.').map(|s| s.to_string()).collect();
            Ok(LogLineValue::Reference(LogLineReference { path }))
        }
        Rule::function_call => {
            let mut fc_inner = inner.into_inner();
            let name = fc_inner.next().unwrap().as_str().to_string();
            let args: Result<Vec<_>, _> = fc_inner.map(parse_value).collect();
            Ok(LogLineValue::FunctionCall(LogLineFunctionCall {
                name,
                args: args?,
            }))
        }
        Rule::interpolation => {
            let mut parts = Vec::new();
            for part in inner.into_inner() {
                match part.as_rule() {
                    Rule::interpolation_literal => {
                        parts.push(InterpolationPart::Literal(part.as_str().to_string()));
                    }
                    Rule::interpolation_expr => {
                        let value = parse_value(part.into_inner().next().unwrap())?;
                        parts.push(InterpolationPart::Expression(value));
                    }
                    _ => {}
                }
            }
            Ok(LogLineValue::Interpolation(LogLineInterpolation { parts }))
        }
        Rule::array => {
            // Handle arrays if needed
            Ok(LogLineValue::Null) // Placeholder
        }
        _ => Err(ParseError {
            message: format!("Unknown value type: {:?}", inner.as_rule()),
            line: 0,
            column: 0,
        }),
    }
}

fn unescape_string(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();
    
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => result.push('\n'),
                Some('r') => result.push('\r'),
                Some('t') => result.push('\t'),
                Some('\\') => result.push('\\'),
                Some('"') => result.push('"'),
                Some(c) => {
                    result.push('\\');
                    result.push(c);
                }
                None => result.push('\\'),
            }
        } else {
            result.push(c);
        }
    }
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_simple_span() {
        let input = r#"OPERATION: bug_fix
  TARGET: @auth.login
  MODE: "mechanic"
END"#;
        
        let result = parse(input).unwrap();
        assert_eq!(result.keyword, "OPERATION");
        assert_eq!(result.name, Some("bug_fix".to_string()));
        assert_eq!(result.params.len(), 2);
    }
    
    #[test]
    fn test_parse_nested_span() {
        let input = r#"JOB: test_job
  ID: "job-123"
  CONTEXT:
    REPO: "/path/to/repo"
  END
END"#;
        
        let result = parse(input).unwrap();
        assert_eq!(result.children.len(), 1);
        assert_eq!(result.children[0].keyword, "CONTEXT");
    }
}
```

---

## Part 14: Local Development Setup

### 14.1 Docker Compose

```yaml
# docker-compose.yml

version: '3.8'

services:
  # ═══════════════════════════════════════════════════════════════════════════
  # DATABASE (Source of Truth)
  # ═══════════════════════════════════════════════════════════════════════════
  postgres:
    image: postgres:15-alpine
    container_name: ai-coding-team-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: devpassword
      POSTGRES_DB: ai_coding_team
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./packages/db/migrations:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ═══════════════════════════════════════════════════════════════════════════
  # ADMINER (Database UI - optional)
  # ═══════════════════════════════════════════════════════════════════════════
  adminer:
    image: adminer:latest
    container_name: ai-coding-team-adminer
    ports:
      - "8080:8080"
    depends_on:
      - postgres
    profiles:
      - tools

volumes:
  postgres_data:
```

### 14.2 Environment Configuration

```bash
# .env.local (gitignored)

# Database
DATABASE_URL=postgres://postgres:devpassword@localhost:5432/ai_coding_team

# OpenAI
OPENAI_API_KEY=sk-your-key-here

# Worker Config
WORKER_MODE=mechanic
MODEL=gpt-4o-mini
STEP_CAP=20
TOKEN_CAP=50000
TIME_LIMIT_MS=60000

# Dashboard
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

### 14.3 Development Scripts

```json
// package.json (root)

{
  "name": "ai-coding-team",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    
    "db:start": "docker compose up -d postgres",
    "db:stop": "docker compose down",
    "db:reset": "docker compose down -v && docker compose up -d postgres",
    "db:migrate": "pnpm --filter @ai-coding-team/db migrate",
    "db:studio": "docker compose --profile tools up -d adminer",
    
    "rust:build": "cargo build --release",
    "rust:test": "cargo test",
    "rust:watch": "cargo watch -x 'build --release'",
    
    "napi:build": "cd crates/napi-bindings && napi build --release --platform",
    "napi:dev": "cd crates/napi-bindings && napi build",
    
    "setup": "pnpm install && pnpm rust:build && pnpm napi:build && pnpm db:start && pnpm db:migrate",
    "clean": "turbo run clean && cargo clean"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.3.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=8.0.0"
  },
  "packageManager": "pnpm@8.15.0"
}
```

### 14.4 pnpm Workspace

```yaml
# pnpm-workspace.yaml

packages:
  - 'packages/*'
```

---

## Part 15: Error Recovery & Resilience

### 15.1 Circuit Breaker Pattern

```typescript
// packages/worker/src/circuit-breaker.ts

interface CircuitBreakerConfig {
  failureThreshold: number;      // Failures before opening
  resetTimeout: number;          // Ms before trying again
  halfOpenRequests: number;      // Test requests in half-open
}

type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailure?: Date;
  private halfOpenSuccesses = 0;
  
  constructor(
    private name: string,
    private config: CircuitBreakerConfig = {
      failureThreshold: 5,
      resetTimeout: 30000,
      halfOpenRequests: 3,
    }
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from open to half-open
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - (this.lastFailure?.getTime() || 0);
      if (timeSinceFailure > this.config.resetTimeout) {
        this.state = 'half-open';
        this.halfOpenSuccesses = 0;
        console.log(`[CircuitBreaker:${this.name}] Transitioning to half-open`);
      } else {
        throw new CircuitOpenError(this.name, this.config.resetTimeout - timeSinceFailure);
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenRequests) {
        this.state = 'closed';
        this.failures = 0;
        console.log(`[CircuitBreaker:${this.name}] Circuit closed`);
      }
    } else {
      this.failures = 0;
    }
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailure = new Date();
    
    if (this.state === 'half-open' || this.failures >= this.config.failureThreshold) {
      this.state = 'open';
      console.log(`[CircuitBreaker:${this.name}] Circuit opened after ${this.failures} failures`);
    }
  }
  
  getState(): CircuitState {
    return this.state;
  }
}

export class CircuitOpenError extends Error {
  constructor(public circuit: string, public retryAfterMs: number) {
    super(`Circuit ${circuit} is open. Retry after ${retryAfterMs}ms`);
  }
}
```

### 15.2 Exponential Backoff

```typescript
// packages/worker/src/backoff.ts

interface BackoffConfig {
  initialDelay: number;    // Starting delay in ms
  maxDelay: number;        // Maximum delay cap
  multiplier: number;      // Delay multiplier per retry
  jitter: boolean;         // Add randomness to prevent thundering herd
}

export class ExponentialBackoff {
  private attempt = 0;
  
  constructor(
    private config: BackoffConfig = {
      initialDelay: 1000,
      maxDelay: 60000,
      multiplier: 2,
      jitter: true,
    }
  ) {}
  
  async wait(): Promise<void> {
    const delay = this.calculateDelay();
    this.attempt++;
    await sleep(delay);
  }
  
  private calculateDelay(): number {
    let delay = this.config.initialDelay * Math.pow(this.config.multiplier, this.attempt);
    delay = Math.min(delay, this.config.maxDelay);
    
    if (this.config.jitter) {
      // Add ±25% jitter
      const jitterRange = delay * 0.25;
      delay += (Math.random() - 0.5) * 2 * jitterRange;
    }
    
    return Math.round(delay);
  }
  
  reset(): void {
    this.attempt = 0;
  }
  
  getAttempt(): number {
    return this.attempt;
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    backoff?: BackoffConfig;
    shouldRetry?: (error: Error) => boolean;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    shouldRetry = () => true,
    onRetry = () => {},
  } = options;
  
  const backoff = new ExponentialBackoff(options.backoff);
  
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts || !shouldRetry(lastError)) {
        throw lastError;
      }
      
      onRetry(attempt, lastError);
      await backoff.wait();
    }
  }
  
  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 15.3 Dead Letter Queue

```typescript
// packages/worker/src/dead-letter.ts

interface DeadLetterEntry {
  jobId: string;
  originalQueue: string;
  failureReason: string;
  failureCount: number;
  lastAttempt: Date;
  payload: any;
}

export class DeadLetterQueue {
  constructor(
    private db: Database,
  ) {}
  
  /**
   * Move a failed job to the dead letter queue
   */
  async moveToDeadLetter(
    jobId: string,
    reason: string,
    payload: any
  ): Promise<void> {
    const entry: DeadLetterEntry = {
      jobId,
      originalQueue: 'jobs',
      failureReason: reason,
      failureCount: 1,
      lastAttempt: new Date(),
      payload,
    };
    
    // Check if already in DLQ
    const existing = await this.db.deadLetterQueue.findById(jobId);
    if (existing) {
      entry.failureCount = existing.failureCount + 1;
    }
    
    await this.db.deadLetterQueue.upsert(entry);
    
    // Update job status
    await this.db.jobs.update(jobId, {
      status: 'dead_letter',
      finishedAt: new Date(),
    });
    
    // Emit metric
    console.log(`[DLQ] Job ${jobId} moved to dead letter queue: ${reason}`);
  }
  
  /**
   * Retry a job from the dead letter queue
   */
  async retry(jobId: string): Promise<boolean> {
    const entry = await this.db.deadLetterQueue.findById(jobId);
    if (!entry) {
      return false;
    }
    
    // Reset job status
    await this.db.jobs.update(jobId, {
      status: 'queued',
      assignedTo: null,
      startedAt: null,
      finishedAt: null,
    });
    
    // Remove from DLQ
    await this.db.deadLetterQueue.delete(jobId);
    
    console.log(`[DLQ] Job ${jobId} requeued for retry`);
    return true;
  }
  
  /**
   * Get all entries in the dead letter queue
   */
  async list(limit = 100): Promise<DeadLetterEntry[]> {
    return this.db.deadLetterQueue.findAll({ limit, orderBy: 'lastAttempt' });
  }
}

### 15.4 High Availability & No-Drop Execution

- **Worker availability**: Run at least 2 replicas per fleet in prod; set autoscaling min ≥2 while queue depth >0; use preStop hooks to drain (stop claiming), finish current tool call, and checkpoint or requeue.
- **Idempotent claim/resume**: Claims remain in Postgres; on startup, recover `running` jobs older than a threshold back to `queued` (unless `cancelling`). Jobs keep `resume_from` pointers; tools must be idempotent or safely retryable.
- **Heartbeats + watchdog**: Each worker emits heartbeats; a watchdog process requeues stale jobs, marks stuck jobs as `dead_letter` after retries, and raises alarms on missing heartbeats or jobs `running` beyond SLA.
- **Graceful shutdown**: SIGTERM triggers drain → checkpoint → requeue incomplete jobs; ECS termination protection enabled during critical sections.
- **Infra redundancy**: Multi-AZ RDS in prod; ALB health checks on dashboard; CloudWatch alarms on queue age, heartbeat absence, and backlog; SSE keeps dashboard live without polling gaps.

### 15.5 Cost Control & Budget Guardrails

- **Per-job budgets**: Enforce `step_cap`, `token_cap`, and `cost_cap_cents`; stop the loop when any cap is hit; default mechanic to small models (e.g., gpt-4o-mini), upgrade to genius only when required. Summarize tool outputs before LLM reuse to cut tokens.
- **Queue governance**: Limit genius queue size and concurrency; coordinator must explicitly request `mode='genius'`. Prefer mechanic path first; ABSTAIN or constraint violations trigger clarification/escalation instead of expensive retries.
- **Autoscaling discipline**: Non-prod can scale workers to 0 when queues are empty; prod keeps min ≥2 only while queue depth >0. Cap max replicas (mechanic 10, genius 3), allow Fargate Spot for non-critical/non-prod; ALB idle timeouts tuned to cut waste; multi-AZ RDS only in prod (single-AZ in lower envs).
- **Database & IO efficiency**: Use pooled connections and moderate instance sizes; enable storage autoscaling with alarms; rely on SSE to avoid dashboard polling; keep migrations lean and indexes purposeful.
- **Logging/metrics hygiene**: Short log retention in non-prod; trim debug noise in prod; emit low-cardinality metrics (queue depth, claim latency, job duration, token/cost per job). Add budget alarms: daily spend, per-queue cost/token rate, and backlog/heartbeat existing alarms.
- **Build/test economy**: Cache Rust/pnpm artifacts via turbo; avoid rebuilding NAPI when unchanged; scope tests (affected-first) in CI where safe; skip heavy image builds on docs-only changes.
```

---

## Part 16: Integration Testing

### 16.1 Test Scenarios

```typescript
// examples/scenarios/bug-fix.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestHarness } from '../test-harness';

describe('Bug Fix Scenario', () => {
  let harness: TestHarness;
  
  beforeAll(async () => {
    harness = await TestHarness.create({
      sampleRepo: 'examples/sample-repo',
      mode: 'mechanic',
    });
  });
  
  afterAll(async () => {
    await harness.cleanup();
  });
  
  it('should fix a simple regex bug', async () => {
    // 1. Inject a bug into the sample repo
    await harness.injectBug({
      file: 'src/validators.ts',
      original: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      buggy: /^[a-zA-Z0-9._%]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,  // Missing + and -
    });
    
    // 2. Send natural language request
    const result = await harness.sendMessage(
      'fix the email validation bug - it rejects valid emails with + signs'
    );
    
    // 3. Verify TDLN translation
    expect(result.translation.verdict).toBe('Translated');
    expect(result.translation.logline.keyword).toBe('OPERATION');
    
    // 4. Wait for job completion
    const job = await harness.waitForJob(result.jobId, { timeout: 60000 });
    expect(job.status).toBe('succeeded');
    
    // 5. Verify the fix
    const diff = await harness.getDiff(job.branch);
    expect(diff.filesChanged).toBe(1);
    expect(diff.content).toContain('+');
    
    // 6. Verify tests pass
    const testResult = await harness.runTests();
    expect(testResult.passed).toBeGreaterThan(0);
    expect(testResult.failed).toBe(0);
  });
  
  it('should escalate when task is too complex', async () => {
    const result = await harness.sendMessage(
      'refactor the entire authentication system to use OAuth2'
    );
    
    // Should recognize this is genius-mode work
    expect(result.translation.logline.params).toContainEqual(
      expect.objectContaining({ key: 'MODE', value: 'genius' })
    );
    
    // In mechanic mode, should escalate
    const job = await harness.waitForJob(result.jobId);
    expect(job.status).toBe('waiting_human');
  });
  
  it('should ask for clarification on ambiguous requests', async () => {
    const result = await harness.sendMessage('fix it');
    
    expect(result.translation.verdict).toBe('Abstain');
    expect(result.response).toContain('Which part');
  });
});
```

### 16.2 Test Harness

```typescript
// examples/test-harness.ts

import { execSync } from 'child_process';
import { mkdtempSync, cpSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from '@ai-coding-team/db';
import { TdlnIn, TdlnOut } from '@ai-coding-team/machinery';
import { CoordinatorAgent } from '@ai-coding-team/agents';

interface TestHarnessConfig {
  sampleRepo: string;
  mode: 'mechanic' | 'genius';
}

export class TestHarness {
  private tempDir: string;
  private db: Database;
  private coordinator: CoordinatorAgent;
  
  private constructor(config: TestHarnessConfig) {
    // Create temp directory with copy of sample repo
    this.tempDir = mkdtempSync(join(tmpdir(), 'ai-coding-team-test-'));
    cpSync(config.sampleRepo, this.tempDir, { recursive: true });
    
    // Initialize git
    execSync('git init && git add . && git commit -m "initial"', {
      cwd: this.tempDir,
    });
  }
  
  static async create(config: TestHarnessConfig): Promise<TestHarness> {
    const harness = new TestHarness(config);
    
    // Connect to test database
    harness.db = new Database(process.env.TEST_DATABASE_URL!);
    await harness.db.migrate();
    
    // Initialize coordinator
    harness.coordinator = new CoordinatorAgent(
      harness.db,
      'grammars/coding-intents.yaml',
      'grammars/response-templates.yaml'
    );
    
    return harness;
  }
  
  async sendMessage(content: string) {
    const conversationId = crypto.randomUUID();
    
    // Create conversation
    await this.db.conversations.create({
      id: conversationId,
      repoPath: this.tempDir,
    });
    
    // Process message
    const response = await this.coordinator.handleUserMessage(conversationId, content);
    
    // Get translation details
    const translation = await this.db.translations.findLatest(conversationId);
    
    // Get job if created
    const jobs = await this.db.jobs.findByConversation(conversationId);
    
    return {
      response,
      translation,
      jobId: jobs[0]?.id,
    };
  }
  
  async waitForJob(jobId: string, options: { timeout?: number } = {}) {
    const { timeout = 30000 } = options;
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      const job = await this.db.jobs.findById(jobId);
      
      if (['succeeded', 'failed', 'waiting_human'].includes(job.status)) {
        return job;
      }
      
      await sleep(500);
    }
    
    throw new Error(`Job ${jobId} did not complete within ${timeout}ms`);
  }
  
  async getDiff(branch: string) {
    const output = execSync(`git diff main..${branch}`, {
      cwd: this.tempDir,
      encoding: 'utf-8',
    });
    
    return {
      content: output,
      filesChanged: (output.match(/^diff --git/gm) || []).length,
    };
  }
  
  async runTests() {
    try {
      execSync('npm test', { cwd: this.tempDir });
      return { passed: 1, failed: 0 };  // Simplified
    } catch (error) {
      return { passed: 0, failed: 1 };
    }
  }
  
  async injectBug(config: { file: string; original: RegExp; buggy: RegExp }) {
    // Implementation to modify file
  }
  
  async cleanup() {
    rmSync(this.tempDir, { recursive: true, force: true });
    await this.db.close();
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 16.3 CI Configuration

```yaml
# .github/workflows/ci.yml

name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  CARGO_TERM_COLOR: always
  RUST_BACKTRACE: 1

jobs:
  # ═══════════════════════════════════════════════════════════════════════════
  # RUST CHECKS
  # ═══════════════════════════════════════════════════════════════════════════
  rust:
    name: Rust
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      
      - name: Cache cargo
        uses: Swatinem/rust-cache@v2
      
      - name: Check formatting
        run: cargo fmt --all -- --check
      
      - name: Clippy
        run: cargo clippy --all-targets --all-features -- -D warnings
      
      - name: Test
        run: cargo test --all-features
      
      - name: Build release
        run: cargo build --release

  # ═══════════════════════════════════════════════════════════════════════════
  # TYPESCRIPT CHECKS
  # ═══════════════════════════════════════════════════════════════════════════
  typescript:
    name: TypeScript
    runs-on: ubuntu-latest
    needs: rust  # Need Rust binaries for NAPI
    steps:
      - uses: actions/checkout@v4
      
      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Build NAPI bindings
        run: pnpm napi:build
      
      - name: Type check
        run: pnpm turbo run typecheck
      
      - name: Lint
        run: pnpm turbo run lint
      
      - name: Test
        run: pnpm turbo run test

  # ═══════════════════════════════════════════════════════════════════════════
  # INTEGRATION TESTS
  # ═══════════════════════════════════════════════════════════════════════════
  integration:
    name: Integration
    runs-on: ubuntu-latest
    needs: [rust, typescript]
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: testpassword
          POSTGRES_DB: ai_coding_team_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup
        run: |
          pnpm install
          pnpm rust:build
          pnpm napi:build
      
      - name: Run migrations
        env:
          DATABASE_URL: postgres://postgres:testpassword@localhost:5432/ai_coding_team_test
        run: pnpm db:migrate
      
      - name: Run integration tests
        env:
          DATABASE_URL: postgres://postgres:testpassword@localhost:5432/ai_coding_team_test
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: pnpm turbo run test:integration
```

---

## Part 17: Post-Plan Additions (November 2025)

> **Note**: This section documents features implemented after the initial plan, based on chat history and iterative development.

### 17.1 Append-Only Ledger System

Replaced direct database mutations with an append-only ledger for full auditability.

#### 17.1.1 Ledger Schema

```sql
-- All entries are immutable - no UPDATE or DELETE
CREATE TABLE ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Classification
  kind VARCHAR(30) NOT NULL CHECK (kind IN (
    'message', 'event', 'job_status', 'knowledge', 
    'analysis', 'plan', 'patch', 'review', 'evaluation',
    'escalation', 'error', 'audit', 'notification'
  )),
  
  -- Context
  job_id UUID,
  conversation_id UUID,
  project_id UUID,
  trace_id UUID,
  
  -- Actor
  actor_type VARCHAR(20) CHECK (actor_type IN ('user', 'agent', 'system', 'admin')),
  actor_id VARCHAR(50),
  
  -- Content
  summary TEXT,
  data JSONB,
  tool_name VARCHAR(50),
  
  -- Provenance
  refs TEXT[],  -- References to other ledger entries
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Status is derived from latest entry, not stored
-- SELECT kind, data->>'status' FROM ledger 
-- WHERE job_id = ? ORDER BY created_at DESC LIMIT 1
```

#### 17.1.2 Implementation

```typescript
// packages/db/src/ledger.ts

// Append-only operations
export async function appendToLedger(entry: LedgerInput): Promise<LedgerEntry>;
export async function appendMessage(conversationId: string, role: "user" | "assistant", content: string): Promise<LedgerEntry>;
export async function appendJobStatus(jobId: string, status: string, actorType: string, actorId: string): Promise<LedgerEntry>;
export async function appendEvent(jobId: string, traceId: string, kind: string, summary: string, data: object): Promise<LedgerEntry>;
export async function appendKnowledge(summary: string, data: object, projectId?: string): Promise<LedgerEntry>;

// Query operations
export async function queryLedger(query: LedgerQuery): Promise<LedgerEntry[]>;
export async function getJobState(jobId: string): Promise<{ status: string; stepsUsed: number; tokensUsed: number }>;
export async function getConversationMessages(conversationId: string, limit: number): Promise<Message[]>;
export async function searchKnowledge(query: string, options: { projectId?: string; limit?: number }): Promise<LedgerEntry[]>;
export async function findSimilarWork(description: string, options: { projectId?: string; limit?: number }): Promise<LedgerEntry[]>;
```

### 17.2 Role-Based Access Control (RBAC)

Agents have restricted database access to enforce safety.

#### 17.2.1 Agent Roles

| Role | Can Read | Can Append |
|------|----------|------------|
| coordinator | All | messages, events, job_status |
| planner | All | analysis, plans |
| builder | All | patches, events |
| reviewer | All | reviews |
| evaluator | All | evaluations |

#### 17.2.2 Implementation

```typescript
// packages/db/src/rbac.ts

export class AgentDBClient {
  constructor(identity: AgentIdentity);
  
  // READ (all agents)
  async query(query: LedgerQuery): Promise<LedgerEntry[]>;
  async getJobState(jobId?: string): Promise<JobState>;
  async getConversation(conversationId: string, limit?: number): Promise<Message[]>;
  async searchKnowledge(query: string, limit?: number): Promise<LedgerEntry[]>;
  async findSimilar(description: string, limit?: number): Promise<LedgerEntry[]>;
  
  // APPEND (role-specific)
  async appendEvent(kind: string, summary: string, data: object): Promise<LedgerEntry>;
  async appendMessage(conversationId: string, role: "user" | "assistant", content: string): Promise<LedgerEntry>;  // coordinator only
  async appendAnalysis(summary: string, data: object): Promise<LedgerEntry>;  // planner only
  async appendPlan(summary: string, data: object): Promise<LedgerEntry>;  // planner only
  async appendPatch(summary: string, data: object): Promise<LedgerEntry>;  // builder only
  async appendReview(summary: string, data: object): Promise<LedgerEntry>;  // reviewer only
  async appendEvaluation(summary: string, data: object): Promise<LedgerEntry>;  // evaluator only
  async appendKnowledge(summary: string, data: object, refs?: string[]): Promise<LedgerEntry>;  // all agents
}
```

### 17.3 Conversation Mode (Async Chat)

WhatsApp-style continuous conversation before committing to jobs.

#### 17.3.1 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ASYNC CHAT FLOW                                      │
│                                                                              │
│  POST /api/chat                                                              │
│       │                                                                      │
│       ├── Returns immediately with receipt                                   │
│       │                                                                      │
│       └── Background processing:                                             │
│           1. analyzeIntent() → job_request | status_check | discussion       │
│           2. Broadcast "thinking" status via SSE                             │
│           3. Generate response or queue job                                  │
│           4. Persist to append-only ledger                                   │
│           5. Broadcast response via SSE                                      │
│           6. Broadcast "idle" status via SSE                                 │
│                                                                              │
│  GET /api/chat/stream?conversationId=xxx                                     │
│       │                                                                      │
│       └── SSE stream for real-time updates                                   │
│           - type: "status" | "message" | "error"                             │
│           - status: "thinking" | "typing" | "working" | "idle"               │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 17.3.2 Intent Analysis

```typescript
// Automatic intent detection from natural language
type Intent = 
  | "job_request"      // "fix the login bug" → queue job
  | "status_check"     // "what's happening?" → show status
  | "pause_request"    // "pause" → pause current job
  | "project_switch"   // "switch to projectX" → change context
  | "question"         // "how does X work?" → LLM response
  | "discussion";      // general chat → LLM response
```

#### 17.3.3 Job Queue Management

```typescript
interface ConversationState {
  conversationId: string;
  projectId?: string;
  projectName?: string;
  repoPath?: string;
  mode: "mechanic" | "genius";
  activeJobId?: string;
  queuedJobs: string[];
}

// Jobs queue up without interrupting conversation
// User can pause, switch projects, check status anytime
```

### 17.4 Insights Watcher (Wise Observer)

A background agent that analyzes the ledger for patterns and generates insights.

#### 17.4.1 Pattern Detectors

| Detector | Description |
|----------|-------------|
| `detectTokenSpike` | Token usage > 2x average for recent jobs |
| `detectRepeatedErrors` | Same error recurring across jobs |
| `detectRedundantWork` | Similar work done on same files |
| `detectSuccessPatterns` | Tools frequently used in successful jobs |
| `detectKnowledgeGaps` | High escalation rate for certain topics |
| `detectBudgetTrajectory` | Budget usage trend warning |

#### 17.4.2 Insight Structure

```typescript
interface Insight {
  id: string;
  severity: "info" | "warning" | "critical";
  category: "token_usage" | "error_pattern" | "redundant_work" | "success_pattern" | "knowledge_gap" | "budget_trajectory";
  title: string;
  description: string;
  evidence: string[];
  recommendation: string;
  impact: { riskReduction?: string; costSaving?: string };
  shouldBecomeGlobalRule: boolean;
  confidence: number;
}
```

#### 17.4.3 Project Notes

After each project completes, the watcher records structured notes:

```typescript
interface ProjectNotes {
  projectId: string;
  projectName?: string;
  completedAt: string;
  statistics: {
    jobsCompleted: number;
    totalSteps: number;
    totalTokens: number;
    escalations: number;
    successRate: number;
  };
  toolsUsed: { name: string; count: number }[];
  commonErrors: string[];
  whatWorkedWell: string[];
  whatCouldImprove: string[];
  suggestedImprovements: string[];
}
```

### 17.5 Unified Notification System

All important events flow through TDLN-OUT to the chat, making it a notification board.

#### 17.5.1 Notification Types

| Type | Severity | Example |
|------|----------|---------|
| `project_completed` | success | ✅ Project completed: **MyProject** |
| `project_paused` | info | ⏸️ Project paused: **MyProject** |
| `job_started` | info | 🚀 Started working on: Fix login bug |
| `job_completed` | success | ✅ Completed: Fixed email validation |
| `job_failed` | warning | ❌ Failed: Test suite errors |
| `insight_discovered` | info | 🦉 **Insight**: Token usage spike detected |
| `rule_proposed` | info | 📋 **Proposed rule**: Always run tests before commit |
| `budget_warning` | warning | ⚠️ **Budget warning**: 80% used |
| `budget_exceeded` | critical | 🚨 **Budget exceeded**: 100% used |
| `escalation_required` | warning | 🙋 **Needs your attention**: Unclear requirements |

#### 17.5.2 Implementation

```typescript
// All notifications render via TDLN-OUT templates
const notificationTemplates: Record<NotificationType, (n: Notification) => string> = {
  project_completed: (n) => `✅ Project completed: **${n.projectName || n.projectId}**\n${n.message}`,
  insight_discovered: (n) => `🦉 **Insight**: ${n.title}\n\n${n.message}`,
  // ... etc
};

// Broadcast to conversation (appears in chat)
export async function broadcastNotification(
  notification: Notification,
  targetConversationId: string
): Promise<void>;
```

### 17.6 IDE-Enhanced Tools

Tools inspired by modern IDE capabilities.

#### 17.6.1 Semantic Search

```typescript
// Search codebase by meaning, not just text
const semanticSearchTool = {
  name: "semantic_search",
  description: "Search codebase by meaning using natural language",
  paramsSchema: z.object({
    query: z.string(),  // "Where is authentication handled?"
    directory: z.string().optional(),
    maxResults: z.number().optional(),
    fileTypes: z.array(z.string()).optional(),
  }),
};
```

#### 17.6.2 Web Search

```typescript
// Search internet for documentation and solutions
const webSearchTool = {
  name: "web_search",
  description: "Search the internet for documentation, error solutions, or best practices",
  paramsSchema: z.object({
    query: z.string(),
    site: z.string().optional(),  // "stackoverflow.com"
    maxResults: z.number().optional(),
  }),
};
```

#### 17.6.3 Read Lints

```typescript
// Get structured linter diagnostics
const readLintsTool = {
  name: "read_lints",
  description: "Get structured linter errors and warnings",
  paramsSchema: z.object({
    paths: z.array(z.string()).optional(),
    severity: z.enum(["error", "warning", "all"]).optional(),
  }),
};
```

#### 17.6.4 Find Files

```typescript
// Glob-based file search
const findFilesTool = {
  name: "find_files",
  description: "Find files matching a glob pattern",
  paramsSchema: z.object({
    pattern: z.string(),  // "**/*.test.ts"
    directory: z.string().optional(),
    maxResults: z.number().optional(),
    includeHidden: z.boolean().optional(),
  }),
};
```

### 17.7 Browser Automation Tools

Tools for testing web applications using Playwright.

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL |
| `browser_snapshot` | Get accessibility tree (better than screenshot) |
| `browser_click` | Click on elements |
| `browser_type` | Type into inputs |
| `browser_screenshot` | Take screenshots |
| `browser_wait` | Wait for elements/text/URL |
| `browser_close` | Close browser |

### 17.8 Advanced Agent Features

#### 17.8.1 Context Window Management

```typescript
// packages/agents/src/context/manager.ts

export class ContextManager {
  private maxTokens: number;
  private tiktoken: Tiktoken;
  
  countTokens(text: string): number;
  summarizeConversation(messages: Message[], targetTokens: number): Message[];
  pruneOldestMessages(messages: Message[], maxTokens: number): Message[];
  getCurrentUsage(): { used: number; available: number };
}
```

#### 17.8.2 Structured Reasoning Traces

```typescript
// packages/agents/src/reasoning/traces.ts

interface ReasoningStep {
  type: "observation" | "hypothesis" | "plan" | "action" | "reflection";
  content: string;
  confidence: number;
  evidence?: string[];
  timestamp: string;
}

export class ReasoningTracer {
  observe(content: string, confidence: number, evidence?: string[]): void;
  hypothesize(content: string, confidence: number): void;
  plan(content: string, steps: string[]): void;
  act(content: string, tool: string): void;
  reflect(content: string, outcome: "success" | "failure" | "partial"): void;
  getTrace(): ReasoningStep[];
  toJSON(): string;
}
```

#### 17.8.3 Self-Healing Tools

```typescript
// packages/agents/src/tools/self-healing.ts

interface SelfHealingConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  parameterAdjustments?: Map<string, (params: any, error: Error) => any>;
}

export function wrapWithSelfHealing<T, R>(
  tool: Tool<T, R>,
  config: SelfHealingConfig
): Tool<T, R>;
```

#### 17.8.4 Fuzzy Verification

```typescript
// packages/agents/src/verification/fuzzy.ts

interface FuzzyVerificationResult {
  passed: boolean;
  score: number;  // 0.0 to 1.0
  details: {
    exactMatches: number;
    fuzzyMatches: number;
    mismatches: number;
    semanticSimilarity: number;
  };
}

export function fuzzyVerify(expected: string, actual: string): FuzzyVerificationResult;
export function diffVerify(before: string, after: string, expectedChanges: string[]): FuzzyVerificationResult;
```

#### 17.8.5 OpenTelemetry Integration

```typescript
// packages/agents/src/tracing/otel.ts

export async function traceJob<T>(
  jobId: string, traceId: string, agentType: string, mode: string, goal: string,
  fn: (span: Span) => Promise<T>
): Promise<T>;

export async function traceTool<T>(
  toolName: string, category: string, jobId: string, traceId: string,
  fn: (span: Span) => Promise<T>
): Promise<T>;

export async function traceLLM<T>(
  model: string, jobId: string, traceId: string,
  fn: (span: Span) => Promise<T>
): Promise<T>;

export function recordTokenUsage(span: Span, promptTokens: number, completionTokens: number): void;
export function recordBudgetUsage(span: Span, stepsUsed: number, stepsCap: number, tokensUsed: number, tokensCap: number): void;
```

### 17.9 LLM Client Enhancements

#### 17.9.1 Factory with Mock Support

```typescript
// packages/agents/src/llm/factory.ts

export function createLLMClient(config: LLMFactoryConfig): LLMClient;
export function createLLMClientFromEnv(): LLMClient;  // Auto-detect from env vars
export function createTestLLMClient(): LLMClient;     // For testing

// Environment variables:
// - LLM_PROVIDER: "openai" | "anthropic" | "mock"
// - LLM_MODEL: Model name
// - USE_REAL_LLM: "true" to use real LLM in tests
// - MOCK_LLM_URL: URL of mock LLM server
```

#### 17.9.2 Mock LLM Client

```typescript
// packages/agents/src/llm/mock.ts

export class MockLLMClient implements LLMClient {
  constructor(config?: { baseUrl?: string });
  
  // Fetches responses from mock LLM server
  // Supports scenario-based responses for testing
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
}
```

### 17.10 Dashboard Additions

#### 17.10.1 Chat Page

New `/chat` page with:
- WhatsApp-style message bubbles
- Real-time status indicators (thinking, typing, idle)
- Job status in sidebar
- Project context switching

#### 17.10.2 SSE Streaming

```typescript
// GET /api/chat/stream?conversationId=xxx

// Events:
// data: {"type":"status","status":"thinking","timestamp":"..."}
// data: {"type":"status","status":"typing","timestamp":"..."}
// data: {"type":"message","message":{...},"timestamp":"..."}
// data: {"type":"status","status":"idle","timestamp":"..."}
```

### 17.11 Testing Enhancements

#### 17.11.1 Real LLM Testing

```bash
# Use real LLM keys from environment
USE_REAL_LLM=true pnpm test:l2

# With specific provider
LLM_PROVIDER=anthropic USE_REAL_LLM=true pnpm test:l2
```

#### 17.11.2 Additional L1 Tests

New L1 tests for:
- `run_lint` tool
- `semantic_search` tool
- `web_search` tool
- `find_files` tool

#### 17.11.3 L2 Scenario Runner

```typescript
// packages/worker/tests/l2/runner.ts

export async function runL2Scenario(scenarioPath: string): Promise<L2Result>;
export async function runAllL2Scenarios(scenariosDir: string): Promise<L2Result[]>;

// Scenarios define:
// - Setup (repo, files to modify)
// - Input (goal, constraints)
// - Mock responses (optional)
// - Expectations (status, tools called, patch contents)
```

---

## Part 18: Complete File Structure (Updated)

```
ai-coding-team/
├── crates/
│   ├── logline/                  # Pest parser for LogLine
│   ├── tdln-in/                  # NL → LogLine compiler
│   ├── tdln-out/                 # JSON → NL renderer
│   ├── tdln-quality/             # Quality gates
│   ├── truthpack/                # Merkle proofs
│   └── napi-bindings/            # NAPI-RS bindings
│
├── packages/
│   ├── agents/
│   │   ├── src/
│   │   │   ├── base.ts           # BaseAgent class
│   │   │   ├── coordinator.ts    # Routes work
│   │   │   ├── planner.ts        # Creates plans
│   │   │   ├── builder.ts        # Applies patches
│   │   │   ├── reviewer.ts       # Reviews code
│   │   │   ├── evaluator.ts      # Scores jobs
│   │   │   │
│   │   │   ├── conversation/     # NEW: Async chat mode
│   │   │   │   ├── index.ts
│   │   │   │   └── mode.ts
│   │   │   │
│   │   │   ├── watcher/          # NEW: Insights watcher
│   │   │   │   ├── index.ts
│   │   │   │   └── insights.ts
│   │   │   │
│   │   │   ├── notifications/    # NEW: TDLN-OUT notifications
│   │   │   │   ├── index.ts
│   │   │   │   └── broadcast.ts
│   │   │   │
│   │   │   ├── context/          # NEW: Context management
│   │   │   │   ├── index.ts
│   │   │   │   └── manager.ts
│   │   │   │
│   │   │   ├── reasoning/        # NEW: Structured reasoning
│   │   │   │   ├── index.ts
│   │   │   │   └── traces.ts
│   │   │   │
│   │   │   ├── verification/     # NEW: Fuzzy verification
│   │   │   │   ├── index.ts
│   │   │   │   └── fuzzy.ts
│   │   │   │
│   │   │   ├── tracing/          # NEW: OpenTelemetry
│   │   │   │   ├── index.ts
│   │   │   │   └── otel.ts
│   │   │   │
│   │   │   ├── llm/
│   │   │   │   ├── index.ts
│   │   │   │   ├── factory.ts    # LLM client factory
│   │   │   │   ├── openai.ts
│   │   │   │   ├── anthropic.ts
│   │   │   │   └── mock.ts       # NEW: Mock LLM client
│   │   │   │
│   │   │   └── tools/
│   │   │       ├── index.ts
│   │   │       ├── coordinator-tools.ts
│   │   │       ├── planner-tools.ts
│   │   │       ├── builder-tools.ts
│   │   │       ├── reviewer-tools.ts
│   │   │       ├── evaluator-tools.ts
│   │   │       ├── ide-tools.ts        # NEW: IDE-enhanced tools
│   │   │       ├── browser-tools.ts    # NEW: Browser automation
│   │   │       └── self-healing.ts     # NEW: Self-healing wrapper
│   │   │
│   │   └── package.json
│   │
│   ├── db/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── jobs.ts
│   │   │   ├── events.ts
│   │   │   ├── ledger.ts         # NEW: Append-only ledger
│   │   │   ├── rbac.ts           # NEW: Role-based access
│   │   │   └── client.ts         # NEW: DB client wrapper
│   │   │
│   │   └── migrations/
│   │       ├── 001_initial.sql
│   │       ├── ...
│   │       └── 008_complete_schema.sql
│   │
│   ├── dashboard/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── api/
│   │   │   │   │   ├── jobs/route.ts
│   │   │   │   │   ├── chat/           # NEW: Chat API
│   │   │   │   │   │   ├── route.ts
│   │   │   │   │   │   └── stream/route.ts
│   │   │   │   │   └── ...
│   │   │   │   │
│   │   │   │   ├── chat/               # NEW: Chat page
│   │   │   │   │   └── page.tsx
│   │   │   │   └── ...
│   │   │   │
│   │   │   ├── components/
│   │   │   │   ├── Chat.tsx            # NEW: Chat component
│   │   │   │   └── ...
│   │   │   │
│   │   │   ├── hooks/
│   │   │   │   ├── useChat.ts          # NEW: Chat hook
│   │   │   │   └── ...
│   │   │   │
│   │   │   └── lib/
│   │   │       └── chat-state.ts       # NEW: Chat state management
│   │   │
│   │   └── package.json
│   │
│   ├── worker/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── loop.ts
│   │   │   ├── claim.ts
│   │   │   └── metrics.ts
│   │   │
│   │   └── tests/
│   │       ├── l0/                    # L0: Infrastructure tests
│   │       └── l2/                    # L2: Agent scenario tests
│   │
│   └── tools/
│       ├── src/
│       │   ├── read/
│       │   └── write/
│       │
│       └── tests/
│           └── l1/                    # L1: Tool tests
│               ├── read/
│               ├── write/
│               ├── meta/
│               └── ide/               # NEW: IDE tools tests
│
├── testing/
│   ├── fixtures/repos/
│   ├── mock-llm/
│   ├── l3/
│   ├── l4/
│   └── aws/
│
├── infra/                            # Terraform
│
├── .github/workflows/
│
├── CODEBASE_SCAN.md                  # NEW: Comprehensive scan
├── Testing Strategy.md
└── plan.md                           # This file
```

---

This completes the detailed implementation guide with Rust machinery, local development setup, error recovery patterns, integration testing, and all post-plan additions including the append-only ledger, RBAC, conversation mode, insights watcher, unified notifications, IDE tools, browser automation, and advanced agent features.
