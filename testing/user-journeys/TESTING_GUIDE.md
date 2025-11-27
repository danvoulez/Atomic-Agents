# User Journey Test Suite - Summary

## Overview

This test suite validates the complete data flows and user journeys through the AI Coding Team system. Unlike unit tests that focus on individual functions or GitHub workflow tests that validate CI/CD pipelines, these tests verify how data moves through the entire system and how multiple components work together to deliver value to users.

## Test Philosophy

The tests follow the principle of **"one by one identification and validation"** (um a um) - each test file validates a specific journey or flow:

1. **Job Lifecycle** - How a single job moves through the system
2. **Data Flow** - How data transforms and moves between components
3. **Multi-Agent Collaboration** - How agents work together on complex tasks

## Test Files

### 01-job-lifecycle.test.ts
**Purpose**: Validates the complete lifecycle of a job from creation to completion

**Key Flows Tested**:
- Flow 1: Job Creation
  - Creates job with correct parameters
  - Validates required fields
  - Sets appropriate budget limits for mechanic vs genius mode
  
- Flow 2: Job Claiming
  - Transitions from queued → running
  - Records started_at timestamp
  - Prevents double-claiming (with proper worker logic)

- Flow 3: Job Execution
  - Tracks steps_used and tokens_used
  - Enforces budget limits
  - Fails gracefully when limits exceeded

- Flow 4: Job Completion
  - Transitions to succeeded/failed status
  - Records finished_at timestamp
  - Captures error messages on failure

- Flow 5: Event Recording
  - Records all events in ledger
  - Maintains chronological order
  - Links events with trace_id

- Flow 6: Status Transitions
  - Validates state machine transitions
  - Prevents invalid transitions

**User Journey**: Bug Fix
```
User creates job → Worker claims → Agent executes → Tests pass → Commits → Job succeeds
```

### 02-data-flow.test.ts
**Purpose**: Validates how data flows through system boundaries

**Key Flows Tested**:
- Flow 1: API Request → Database
  - Accepts valid requests
  - Rejects invalid data
  - Generates unique IDs
  - Sets timestamps correctly

- Flow 2: Database → Worker
  - Makes jobs available for claiming
  - Provides complete context
  - Maintains isolation between jobs

- Flow 3: Agent → Events → Ledger
  - Records planning events
  - Records tool calls with parameters
  - Records tool results with outputs
  - Maintains event chronology
  - Links events via trace_id

- Flow 4: Events → Dashboard Stream
  - Makes events queryable by job_id
  - Supports pagination
  - Includes all UI-necessary data

- Flow 5: Cross-Component Consistency
  - Maintains referential integrity
  - Handles conversation threading
  - Tracks budget across components

**User Journey**: Feature Request
```
User submits via API → DB stores → Worker polls → Agent plans → Tools execute →  
Events stream → Dashboard updates → Results returned
```

### 03-multi-agent-collaboration.test.ts
**Purpose**: Validates complex multi-agent workflows

**Key Flows Tested**:
- Flow 1: User → Coordinator
  - Receives and parses goals
  - Initializes context
  - Records start event

- Flow 2: Coordinator → Planner Delegation
  - Delegates complex tasks
  - Creates sub-jobs
  - Passes context

- Flow 3: Planner Analysis
  - Uses read-only tools
  - Creates execution plans
  - Completes with plan output

- Flow 4: Coordinator → Builder Delegation
  - Delegates with plan reference
  - Provides implementation context

- Flow 5: Builder Implementation
  - Creates branch
  - Applies patches
  - Runs tests
  - Commits changes

- Flow 6: Coordinator → Reviewer Delegation
  - Delegates for review
  - Passes commit info

- Flow 7: Reviewer Analysis
  - Reviews for correctness
  - Provides feedback
  - Approves or requests changes

- Flow 8: Multi-Agent Coordination
  - Tracks parent-child relationships
  - Aggregates budget
  - Handles handoffs gracefully

**User Journey**: Complex Refactoring
```
User requests refactor → Coordinator analyzes → Delegates to Planner →
Planner creates plan → Coordinator delegates to Builder → Builder implements →
Coordinator delegates to Reviewer → Reviewer approves → Job complete
```

## Data Flows Mapped

### Primary Flow: User Request to Completion
```
┌─────────────┐
│   User UI   │
│  Dashboard  │
└──────┬──────┘
       │ HTTP POST /api/jobs
       ▼
┌─────────────┐
│  API Layer  │
│ (validation)│
└──────┬──────┘
       │ insertJob()
       ▼
┌─────────────┐
│  Database   │
│ (Postgres)  │
└──────┬──────┘
       │ claimNextJob()
       ▼
┌─────────────┐
│   Worker    │
│   (poll)    │
└──────┬──────┘
       │ agent.run()
       ▼
┌─────────────┐
│    Agent    │
│  (LLM loop) │
└──────┬──────┘
       │ tool calls
       ▼
┌─────────────┐
│    Tools    │
│ (read/write)│
└──────┬──────┘
       │ insertEvent()
       ▼
┌─────────────┐
│   Events    │
│  (ledger)   │
└──────┬──────┘
       │ SSE stream
       ▼
┌─────────────┐
│  Dashboard  │
│  (updates)  │
└─────────────┘
```

### Secondary Flow: Multi-Agent Collaboration
```
Coordinator
    │
    ├──→ Planner ──→ Plan ──┐
    │                       │
    ├──→ Builder ──→ Code ──┤
    │                       ├──→ Result
    └──→ Reviewer ──→ OK ───┘
```

## Running the Tests

### Prerequisites
```bash
# Start test database
docker compose -f docker-compose.test.yml up -d

# Ensure database is migrated
pnpm db:migrate
```

### Run All Journey Tests
```bash
pnpm test:journeys
```

### Run Specific Test File
```bash
# Just job lifecycle
pnpm vitest run testing/user-journeys/01-job-lifecycle.test.ts

# Just data flow
pnpm vitest run testing/user-journeys/02-data-flow.test.ts

# Just multi-agent
pnpm vitest run testing/user-journeys/03-multi-agent-collaboration.test.ts
```

### Run with Watch Mode (for development)
```bash
pnpm vitest watch testing/user-journeys/
```

## Test Coverage

### What IS Tested
✅ Complete job lifecycle states  
✅ Data transformations at boundaries  
✅ Event recording and ordering  
✅ Budget tracking  
✅ Agent delegation patterns  
✅ Database referential integrity  
✅ Status transitions  
✅ Timestamp recording  

### What is NOT Tested (yet)
❌ Actual LLM responses (uses mocks)  
❌ Real git operations  
❌ Actual tool execution  
❌ Network failures and retries  
❌ Concurrent job processing  
❌ Performance/load testing  

## Future Enhancements

1. **Integration with Mock LLM**: Replace placeholder assertions with actual mock LLM responses
2. **Real Repository Tests**: Create actual test repos and verify git operations
3. **Concurrency Tests**: Test multiple workers claiming jobs simultaneously
4. **Error Recovery**: Test crash recovery and job requeuing
5. **Budget Enforcement**: Test hard stops when budgets are exceeded
6. **Streaming Tests**: Verify real-time event streaming to dashboard

## Debugging

If tests fail:

1. **Check Database Connection**:
   ```bash
   docker compose -f docker-compose.test.yml ps
   docker compose -f docker-compose.test.yml logs postgres
   ```

2. **Verify Migrations**:
   ```bash
   DATABASE_URL=postgresql://postgres:testpassword@localhost:5432/ai_coding_team_test \
     pnpm db:migrate
   ```

3. **Check Test Output**:
   ```bash
   pnpm vitest run testing/user-journeys/ --reporter=verbose
   ```

4. **Inspect Database**:
   ```bash
   docker exec -it <postgres-container> psql -U postgres -d ai_coding_team_test
   ```

## Contributing

When adding new journey tests:

1. **Identify the Flow**: What user journey are you testing?
2. **Map the Data**: Draw out how data moves through components
3. **Write Tests Top-Down**: Start with the complete journey, then test each step
4. **Use Real Schema**: Match actual database schemas, not idealized versions
5. **Document**: Add your flow to this README

## Related Documentation

- [Testing Strategy](../docs/guides/testing.md)
- [Architecture Overview](../docs/architecture/overview.md)
- [Agent Architecture](../docs/architecture/agents.md)
- [Database Schema](../packages/db/README.md)
