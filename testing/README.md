# AI Coding Team Testing Infrastructure

This directory contains the comprehensive testing infrastructure for the AI Coding Team project, implementing test levels L0-L4 as defined in `Testing Strategy.md`.

## Test Levels

### L0 - Infrastructure Tests
**Goal:** "The habitat lives"

Tests basic system infrastructure:
- Worker lifecycle (start, claim, heartbeat, stop)
- Job state machine transitions
- Crash recovery and requeue
- Stale job cleanup

```bash
pnpm test:l0
```

### L1 - Tool Tests
**Goal:** "The hands and legs don't lie"

Tests individual tools in isolation:
- READ tools: read_file, search_code, list_files, get_repo_state
- WRITE tools: apply_patch, run_tests, run_lint, commit_changes, create_branch
- META tools: record_analysis, create_plan, request_human_review

```bash
pnpm test:l1
```

### L2 - Agent Loop Tests
**Goal:** "Single job, controlled environment"

Tests complete agent workflows with mock LLM:
- Bug fix scenarios (trivial, unclear, large)
- Feature addition
- Code review (approve, reject)

```bash
pnpm test:l2
```

### L3 - E2E Batch Tests
**Goal:** "Multiple jobs, real queue, real Git"

Tests system under realistic load:
- Batch processing of multiple jobs
- Multiple workers competing for jobs
- Metrics collection and analysis

```bash
pnpm test:l3
```

### L4 - Battle/Chaos Tests
**Goal:** "Try to break the system"

Adversarial and chaos engineering tests:
- Prompt injection attempts
- Ambiguous/contradictory requests
- Limit bypass attempts
- Resource starvation
- Worker crashes, network partitions

```bash
pnpm test:l4
pnpm test:chaos
```

## Directory Structure

```
testing/
├── mock-llm/           # Deterministic LLM mock server
│   ├── Dockerfile
│   ├── src/
│   │   └── server.js
│   └── scenarios/      # Pre-canned responses
├── fixtures/           # Test repositories
│   └── repos/
│       ├── simple-ts/      # TypeScript project
│       ├── simple-rust/    # Rust project
│       ├── broken-tests/   # Failing tests
│       └── large-file/     # Truncation tests
├── l3/                 # L3 batch testing
│   ├── runner.js
│   └── scenarios/
├── l4/                 # L4 adversarial & chaos
│   ├── adversarial/
│   ├── hostile-code/
│   ├── resource-limits/
│   └── chaos/
├── prometheus/         # Metrics config
├── grafana/           # Dashboards
└── aws/               # AWS smoke & canary tests
```

## Docker Compose Files

- `docker-compose.test.yml` - Basic test environment
- `docker-compose.ci.yml` - CI-specific (no volumes)
- `docker-compose.l3.yml` - Full L3 stack with multiple workers

## Running Tests

### Local Development

```bash
# Start test database
pnpm test:env:start

# Run specific level
pnpm test:l0
pnpm test:l1
pnpm test:l2

# Stop test environment
pnpm test:env:stop
```

### Full Test Suite

```bash
# All tests (L0-L2)
pnpm test:all

# Including L3 (longer)
pnpm test:full
```

### CI/CD

The `.github/workflows/test-full.yml` workflow runs:
- L0/L1 on every push/PR
- L2 after L0/L1 pass
- L3 nightly or on manual trigger
- L4 on manual trigger only

## LLM Configuration

### Mock LLM (Default for L0-L2)

The mock LLM server provides deterministic responses for testing:

```bash
cd testing/mock-llm
npm install
npm start
```

Endpoints:
- `POST /v1/chat/completions` - OpenAI format
- `POST /v1/messages` - Anthropic format
- `GET /health` - Health check
- `POST /reset` - Reset request counter
- `GET /scenarios` - List available scenarios

### Real LLM Keys (L3+ and Integration Tests)

For more realistic testing, you can use real LLM API keys:

```bash
# Use real LLM instead of mock
export USE_REAL_LLM=true

# OpenAI
export OPENAI_API_KEY=sk-...
export LLM_MODEL=gpt-4o-mini  # Optional, defaults to gpt-4o

# OR Anthropic
export ANTHROPIC_API_KEY=sk-ant-...
export LLM_MODEL=claude-sonnet-4-20250514  # Optional

# Run tests with real LLM
pnpm test:l2
```

**Environment Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_REAL_LLM` | Set to `true` to use real LLM | `false` |
| `LLM_PROVIDER` | Force provider: `openai`, `anthropic`, or `mock` | Auto-detect |
| `LLM_MODEL` | Specific model to use | Provider default |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `MOCK_LLM_URL` | Mock server URL | `http://localhost:8000` |

**Recommended Test Strategy:**

1. **L0-L1**: Always use mock (no LLM needed)
2. **L2**: Use mock for CI, real LLM for integration testing
3. **L3**: Use real LLM for batch testing
4. **L4**: Use mock for adversarial, real for some chaos tests

**Cost Considerations:**

When using real LLM keys:
- Use `gpt-4o-mini` or `claude-3-haiku` for cheaper testing
- Set conservative `stepCap` and `tokenCap` in scenarios
- Monitor token usage in test output

## AWS Tests

Smoke tests for staging/production:

```bash
cd testing/aws
npm install

# Run smoke tests
API_URL=https://api.staging.example.com npm run smoke

# Run canary (creates real job)
API_URL=https://api.staging.example.com npm run canary
```

## Success Criteria

| Level | Pass Rate | Notes |
|-------|-----------|-------|
| L0 | 100% | Infrastructure must be solid |
| L1 | 100% | Tools must be reliable |
| L2 | ≥90% | Agent loop with mock LLM |
| L3 | ≥80% | Real LLM, batch processing |
| L4 | Document findings | Find weaknesses, not pass/fail |

## Adding New Tests

1. **L0/L1**: Add test files to `packages/*/tests/l0/` or `packages/*/tests/l1/`
2. **L2**: Add scenario YAML to `packages/worker/tests/l2/scenarios/`
3. **L3**: Add batch definition to `testing/l3/scenarios/`
4. **L4**: Add adversarial scenario to appropriate `testing/l4/` subdirectory

## Metrics

During L3+ tests, metrics are exposed at `:9100/metrics`:
- `l3_jobs_total` - Jobs by status/type/mode
- `l3_job_duration_ms` - Duration histogram
- `l3_job_steps` - Steps histogram
- `l3_job_tokens` - Tokens histogram

