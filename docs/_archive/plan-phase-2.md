# Phase 2 Implementation Plan: Items 11-16

This document covers the remaining implementation work to complete the AI Coding Team system.

---

## Overview

| # | Component | Current State | Target State |
|---|-----------|---------------|--------------|
| 11 | Rust Enhancements | Stubs, basic parsing | Full TDLN pipeline |
| 12 | API Handlers | Placeholder JSON responses | Real DB integration |
| 13 | Infrastructure | Placeholder TF files | Production-ready AWS |
| 14 | CI/CD | None | GitHub Actions + ECR |
| 15 | Dashboard Polish | Basic functional UI | Production UX |
| 16 | Integration Tests | Unit tests only | E2E scenarios |

---

## 11. Rust Enhancements

### 11.1 tdln-in: Complete Translation Pipeline

**File:** `crates/tdln-in/src/matcher.rs`

```rust
// Current: Basic pattern matching stub
// Target: Full intent extraction with slot filling

pub struct IntentMatcher {
    grammars: HashMap<String, CompiledGrammar>,
}

impl IntentMatcher {
    /// Match natural language to LogLine operation
    pub fn match_intent(&self, input: &str) -> MatchResult {
        // 1. Normalize input (lowercase, remove punctuation)
        let normalized = self.normalizer.normalize(input);
        
        // 2. Try each grammar rule in order
        for rule in &self.active_rules {
            if let Some(captures) = rule.pattern.captures(&normalized) {
                return MatchResult::Match {
                    operation: rule.operation.clone(),
                    params: self.extract_slots(&captures, &rule.slots),
                    confidence: self.calculate_confidence(&captures),
                };
            }
        }
        
        // 3. Return abstain if no match
        MatchResult::Abstain {
            reason: "No matching intent pattern",
            clarification: self.generate_clarification(input),
        }
    }
}
```

**Tasks:**
- [ ] Implement slot extraction with type coercion
- [ ] Add confidence scoring based on pattern specificity
- [ ] Implement abstain logic with clarification generation
- [ ] Add grammar hot-reloading from YAML files
- [ ] Wire to NAPI bindings

### 11.2 tdln-out: Template Rendering

**File:** `crates/tdln-out/src/renderer.rs`

```rust
// Current: Returns raw JSON
// Target: Handlebars-style template rendering with citations

pub struct TemplateRenderer {
    templates: HashMap<String, CompiledTemplate>,
    helpers: HelperRegistry,
}

impl TemplateRenderer {
    pub fn render(&self, template_name: &str, data: &Value) -> RenderResult {
        let template = self.templates.get(template_name)?;
        
        // 1. Resolve citations
        let cited_data = self.resolve_citations(data)?;
        
        // 2. Apply filters (percent, truncate, etc.)
        let processed = self.apply_filters(&cited_data)?;
        
        // 3. Render template
        let output = template.render(&processed)?;
        
        // 4. Validate output (no hallucinations)
        self.validate_output(&output, data)?;
        
        Ok(output)
    }
}
```

**Tasks:**
- [ ] Implement Handlebars-compatible template engine
- [ ] Add citation resolution from TruthPack
- [ ] Implement helper functions (eq, percent, truncate)
- [ ] Add output validation against source data
- [ ] Wire to NAPI bindings

### 11.3 tdln-quality: Quality Gates

**File:** `crates/tdln-quality/src/gate.rs`

```rust
// Current: Placeholder verdict
// Target: Full quality gate evaluation

pub struct QualityGate {
    profile: QualityProfile,
}

impl QualityGate {
    pub fn evaluate(&self, result: &JobResult) -> QualityVerdict {
        let mut checks = Vec::new();
        
        // Tests must pass
        if self.profile.require_tests {
            checks.push(Check {
                name: "tests_pass",
                status: if result.tests.failed == 0 { CheckStatus::Ok } else { CheckStatus::Fail },
                message: format!("{} passed, {} failed", result.tests.passed, result.tests.failed),
            });
        }
        
        // Lint must pass
        if self.profile.require_lint {
            checks.push(Check {
                name: "lint_clean",
                status: if result.lint.errors == 0 { CheckStatus::Ok } else { CheckStatus::Warn },
                message: format!("{} errors, {} warnings", result.lint.errors, result.lint.warnings),
            });
        }
        
        // Check file limits (mechanic mode)
        if let Some(max_files) = self.profile.max_files {
            let files_changed = result.changes.files.len();
            checks.push(Check {
                name: "file_limit",
                status: if files_changed <= max_files { CheckStatus::Ok } else { CheckStatus::Fail },
                message: format!("{}/{} files changed", files_changed, max_files),
            });
        }
        
        // Determine overall verdict
        let has_fail = checks.iter().any(|c| c.status == CheckStatus::Fail);
        let has_warn = checks.iter().any(|c| c.status == CheckStatus::Warn);
        
        QualityVerdict {
            verdict: if has_fail { "BLOCK" } else if has_warn { "WARN" } else { "OK" },
            checks,
        }
    }
}
```

**Tasks:**
- [ ] Implement check evaluation logic
- [ ] Add configurable quality profiles (mechanic vs genius)
- [ ] Integrate with builder tools
- [ ] Add NAPI bindings for TS consumption

### 11.4 tdln-truthpack: Provenance Tracking

**File:** `crates/tdln-truthpack/src/pack.rs`

**Tasks:**
- [ ] Implement TruthPack manifest generation
- [ ] Add citation tracking (what file:line backed each claim)
- [ ] Implement Merkle root computation for verification
- [ ] Add NAPI bindings

---

## 12. API Handlers (Rust + TypeScript)

### 12.1 Rust API Server (`crates/tdln-api`)

**File:** `crates/tdln-api/src/handlers.rs`

```rust
// Current: Placeholder responses
// Target: Real DB integration

pub async fn compile(
    State(state): State<AppState>,
    Json(payload): Json<CompileRequest>,
) -> Result<Json<CompileResponse>, AppError> {
    // 1. Validate input
    let input = InputPack::try_from(payload)?;
    
    // 2. Run TDLN-IN translation
    let logline = state.tdln_in.translate(&input.prompt, &input.grammar)?;
    
    // 3. Run policy checks
    let policy_result = state.policy.check(&logline)?;
    if policy_result.verdict == "BLOCK" {
        return Err(AppError::PolicyBlocked(policy_result));
    }
    
    // 4. Generate artifact
    let artifact = CompiledArtifact {
        logline,
        truth_pack: state.truth_pack.seal()?,
        policy_result,
    };
    
    // 5. Store in DB
    let artifact_id = state.db.store_artifact(&artifact).await?;
    
    Ok(Json(CompileResponse {
        artifact_id,
        artifact_hash: artifact.hash(),
        mime: "application/logline+json",
    }))
}
```

**Tasks:**
- [ ] Add DB connection pool (sqlx/deadpool)
- [ ] Implement compile handler with real TDLN-IN
- [ ] Implement verify handler with signature validation
- [ ] Add rate limiting middleware
- [ ] Add OpenTelemetry tracing
- [ ] Implement graceful shutdown

### 12.2 TypeScript API Routes (`packages/dashboard/src/app/api`)

**New File:** `packages/dashboard/src/app/api/jobs/[id]/route.ts`

```typescript
// GET /api/jobs/[id] - Get job details
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const job = await getJob(params.id);
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }
  
  const events = await listEvents(params.id);
  const evaluation = await getEvaluation(params.id);
  
  return Response.json({
    job: {
      ...job,
      // Compute derived fields
      duration: job.finished_at 
        ? new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()
        : null,
    },
    events,
    evaluation,
  });
}

// POST /api/jobs/[id]/cancel - Cancel a job
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await requestCancellation(params.id);
  return Response.json({ status: "cancelling" });
}
```

**New File:** `packages/dashboard/src/app/api/jobs/route.ts` (expand)

```typescript
// POST /api/jobs - Create new job
export async function POST(req: NextRequest) {
  const body = await req.json();
  
  // Validate input
  const { goal, mode, conversationId, repoPath } = body;
  if (!goal) {
    return Response.json({ error: "Goal is required" }, { status: 400 });
  }
  
  // Create job
  const job = await insertJob({
    goal,
    mode: mode ?? "mechanic",
    agent_type: "coordinator",
    status: "queued",
    conversation_id: conversationId,
    repo_path: repoPath ?? process.env.DEFAULT_REPO_PATH,
  });
  
  return Response.json({ job }, { status: 201 });
}
```

**Tasks:**
- [ ] Implement job detail endpoint with events/evaluation
- [ ] Add job cancellation endpoint
- [ ] Implement job creation with validation
- [ ] Add conversation management endpoints
- [ ] Implement user feedback endpoint (for human review)
- [ ] Add WebSocket support for real-time updates

---

## 13. Infrastructure (Terraform)

### 13.1 Complete `infra/main.tf`

```hcl
terraform {
  required_version = ">= 1.4.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket         = "ai-coding-team-tfstate"
    key            = "terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "ai-coding-team-tflock"
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

# Import all modules
module "vpc" {
  source = "./modules/vpc"
  # ...
}

module "rds" {
  source = "./modules/rds"
  vpc_id = module.vpc.vpc_id
  # ...
}

module "ecs" {
  source = "./modules/ecs"
  vpc_id = module.vpc.vpc_id
  # ...
}

module "monitoring" {
  source = "./modules/monitoring"
  # ...
}
```

**Tasks:**
- [ ] Create VPC module with public/private subnets
- [ ] Create RDS module with PostgreSQL 15
- [ ] Create ECS module with Fargate
- [ ] Create ECR repositories
- [ ] Set up ALB with SSL termination
- [ ] Configure auto-scaling for workers
- [ ] Set up CloudWatch dashboards and alarms
- [ ] Add WAF for API protection
- [ ] Create S3 bucket for TruthPack storage

### 13.2 Secrets Management

**File:** `infra/secrets.tf`

```hcl
resource "aws_secretsmanager_secret" "db_password" {
  name = "${var.project}-db-password"
}

resource "aws_secretsmanager_secret" "openai_key" {
  name = "${var.project}-openai-key"
}

resource "aws_secretsmanager_secret" "anthropic_key" {
  name = "${var.project}-anthropic-key"
}

# IAM policy for secrets access
resource "aws_iam_policy" "secrets_access" {
  name = "${var.project}-secrets-access"
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.db_password.arn,
          aws_secretsmanager_secret.openai_key.arn,
          aws_secretsmanager_secret.anthropic_key.arn,
        ]
      }
    ]
  })
}
```

---

## 14. CI/CD (GitHub Actions)

### 14.1 Main CI Pipeline

**File:** `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  CARGO_TERM_COLOR: always
  NODE_VERSION: "20"
  RUST_VERSION: "1.75"

jobs:
  # TypeScript checks
  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test

  # Rust checks
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: ${{ env.RUST_VERSION }}
          components: clippy, rustfmt
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --all -- --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test --all

  # NAPI bindings
  napi:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: macos-latest
            target: aarch64-apple-darwin
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: pnpm install
      - run: cd crates/napi-bindings && pnpm build
      - uses: actions/upload-artifact@v4
        with:
          name: napi-${{ matrix.target }}
          path: crates/napi-bindings/*.node

  # Integration tests
  integration:
    needs: [typescript, rust, napi]
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
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
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      - run: pnpm install
      - run: pnpm db:migrate
        env:
          DATABASE_URL: postgres://postgres:test@localhost:5432/ai_coding_team_test
      - run: pnpm test:integration
        env:
          DATABASE_URL: postgres://postgres:test@localhost:5432/ai_coding_team_test
```

### 14.2 Deployment Pipeline

**File:** `.github/workflows/deploy.yml`

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: "Environment to deploy to"
        required: true
        default: "staging"
        type: choice
        options:
          - staging
          - production

env:
  AWS_REGION: us-east-1

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Login to ECR
        id: ecr-login
        uses: aws-actions/amazon-ecr-login@v2
      
      - name: Build and push dashboard
        uses: docker/build-push-action@v5
        with:
          context: ./packages/dashboard
          push: true
          tags: ${{ steps.ecr-login.outputs.registry }}/ai-coding-team-dashboard:${{ github.sha }}
      
      - name: Build and push worker
        uses: docker/build-push-action@v5
        with:
          context: ./packages/worker
          push: true
          tags: ${{ steps.ecr-login.outputs.registry }}/ai-coding-team-worker:${{ github.sha }}

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment || 'staging' }}
    steps:
      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster ai-coding-team-${{ inputs.environment || 'staging' }} \
            --service dashboard \
            --force-new-deployment
          
          aws ecs update-service \
            --cluster ai-coding-team-${{ inputs.environment || 'staging' }} \
            --service mechanic-worker \
            --force-new-deployment
```

**Tasks:**
- [ ] Create CI workflow with lint/test/build
- [ ] Add NAPI cross-compilation matrix
- [ ] Create deployment workflow with ECR push
- [ ] Add Terraform plan/apply workflow
- [ ] Set up branch protection rules
- [ ] Add dependency scanning (Dependabot/Renovate)

---

## 15. Dashboard Polish

### 15.1 Visual Design Improvements

**Theme:** Dark IDE aesthetic with syntax highlighting colors

```typescript
// packages/dashboard/src/app/globals.css
:root {
  /* Base colors - inspired by VS Code Dark+ */
  --bg-primary: #1e1e1e;
  --bg-secondary: #252526;
  --bg-tertiary: #2d2d2d;
  --bg-accent: #37373d;
  
  /* Text colors */
  --text-primary: #d4d4d4;
  --text-secondary: #808080;
  --text-muted: #6a6a6a;
  
  /* Accent colors */
  --accent-blue: #569cd6;
  --accent-green: #4ec9b0;
  --accent-yellow: #dcdcaa;
  --accent-orange: #ce9178;
  --accent-purple: #c586c0;
  --accent-red: #f44747;
  
  /* Status colors */
  --status-success: #4ec9b0;
  --status-warning: #cca700;
  --status-error: #f44747;
  --status-info: #569cd6;
  
  /* Font */
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-sans: 'Inter', -apple-system, sans-serif;
}
```

### 15.2 New Components

**File:** `packages/dashboard/src/components/AgentCard.tsx`

```tsx
// Show agent status with animated avatar
export function AgentCard({ agent, status }: AgentCardProps) {
  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-lg",
      status === 'working' && "bg-accent/10 border border-accent/30"
    )}>
      <div className={cn(
        "w-10 h-10 rounded-full flex items-center justify-center",
        "bg-gradient-to-br",
        agentGradients[agent]
      )}>
        <AgentIcon agent={agent} className="w-5 h-5 text-white" />
      </div>
      <div>
        <div className="font-medium text-sm">{agentNames[agent]}</div>
        <div className="text-xs text-muted">{status}</div>
      </div>
      {status === 'working' && (
        <div className="ml-auto">
          <Spinner className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}
```

**File:** `packages/dashboard/src/components/CodeDiff.tsx`

```tsx
// Syntax-highlighted diff viewer
export function CodeDiff({ diff }: { diff: string }) {
  const lines = parseDiff(diff);
  
  return (
    <div className="font-mono text-sm bg-bg-secondary rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-bg-tertiary border-b border-border">
        <span className="text-text-secondary">Changes</span>
        <div className="flex gap-2 text-xs">
          <span className="text-status-success">+{lines.added}</span>
          <span className="text-status-error">-{lines.removed}</span>
        </div>
      </div>
      <pre className="p-4 overflow-x-auto">
        {lines.map((line, i) => (
          <DiffLine key={i} line={line} />
        ))}
      </pre>
    </div>
  );
}
```

**File:** `packages/dashboard/src/components/BudgetMeter.tsx`

```tsx
// Visual budget indicator
export function BudgetMeter({ used, cap, type }: BudgetMeterProps) {
  const percentage = (used / cap) * 100;
  const isWarning = percentage > 75;
  const isCritical = percentage > 90;
  
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-text-secondary">{type}</span>
        <span className={cn(
          isCritical && "text-status-error",
          isWarning && !isCritical && "text-status-warning"
        )}>
          {used.toLocaleString()} / {cap.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isCritical ? "bg-status-error" : isWarning ? "bg-status-warning" : "bg-accent-blue"
          )}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}
```

### 15.3 UX Improvements

**Tasks:**
- [ ] Add keyboard shortcuts (Cmd+K for command palette)
- [ ] Implement command palette for quick actions
- [ ] Add toast notifications for job status changes
- [ ] Implement dark/light theme toggle
- [ ] Add job cancellation button with confirmation
- [ ] Implement feedback form for human review requests
- [ ] Add loading skeletons for async data
- [ ] Improve mobile responsiveness
- [ ] Add job filtering and search
- [ ] Implement job timeline visualization

---

## 16. Integration Tests

### 16.1 Test Scenarios

**File:** `examples/scenarios/bug-fix.yaml`

```yaml
name: Simple Bug Fix
description: Fix a null pointer exception in authentication

setup:
  repo: examples/sample-repo
  branch: main
  files:
    - path: src/auth.ts
      content: |
        export function validateToken(token: string) {
          // BUG: token can be undefined
          return token.startsWith('Bearer');
        }

input:
  goal: "Fix the null pointer exception in validateToken"
  mode: mechanic

expected:
  status: succeeded
  changes:
    files:
      - path: src/auth.ts
        contains: "token?.startsWith"
  tests:
    status: pass
  evaluation:
    correctness: "> 0.8"
    honesty: "> 0.9"
```

### 16.2 Test Runner

**File:** `packages/worker/tests/scenarios.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadScenario, runScenario, verifyExpectations } from './helpers';
import { setupTestDb, teardownTestDb } from './db';

describe('Integration Scenarios', () => {
  beforeAll(async () => {
    await setupTestDb();
  });
  
  afterAll(async () => {
    await teardownTestDb();
  });
  
  const scenarios = [
    'bug-fix',
    'feature-add',
    'refactor',
    'review-approve',
    'review-reject',
    'abstain-clarify',
    'budget-exceeded',
    'cancellation',
  ];
  
  for (const name of scenarios) {
    it(`scenario: ${name}`, async () => {
      const scenario = await loadScenario(`examples/scenarios/${name}.yaml`);
      const result = await runScenario(scenario);
      await verifyExpectations(result, scenario.expected);
    }, 120_000); // 2 minute timeout
  }
});
```

**Tasks:**
- [ ] Create 8+ test scenarios covering happy paths
- [ ] Add error scenarios (budget exceeded, test failures)
- [ ] Implement scenario loader and runner
- [ ] Add verification helpers for expectations
- [ ] Create test fixtures (sample repos)
- [ ] Add performance benchmarks
- [ ] Implement snapshot testing for TDLN-OUT

---

## Implementation Order

### Week 1: Core Rust + API
1. [ ] Complete tdln-in matcher with slot extraction
2. [ ] Complete tdln-out renderer with templates
3. [ ] Implement tdln-api handlers with DB
4. [ ] Update NAPI bindings

### Week 2: Infrastructure + CI
5. [ ] Complete Terraform modules
6. [ ] Set up CI/CD pipelines
7. [ ] Configure secrets management
8. [ ] Deploy to staging

### Week 3: Dashboard + Polish
9. [ ] Implement new dashboard components
10. [ ] Add real-time updates (WebSocket/SSE)
11. [ ] Polish UX and styling
12. [ ] Add keyboard shortcuts

### Week 4: Testing + Launch
13. [ ] Write integration test scenarios
14. [ ] Performance testing and optimization
15. [ ] Security audit
16. [ ] Production deployment

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Build time | < 5 minutes |
| Test coverage | > 80% |
| API latency (p95) | < 200ms |
| Worker cold start | < 10s |
| Job success rate | > 90% |
| Dashboard LCP | < 2s |

