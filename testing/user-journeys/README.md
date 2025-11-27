# User Journey Tests

This directory contains end-to-end tests that validate complete user journeys and data flows through the AI Coding Team system.

## Test Categories

### 1. Job Lifecycle Tests
Tests that validate the complete lifecycle of a job from creation to completion:
- Job creation via API
- Job claiming by worker
- Agent execution
- Tool calls and results
- Job completion and status updates

### 2. Data Flow Tests
Tests that validate how data flows through the system:
- User request → API → Database → Worker → Agent → Tools → Results
- Event streaming from worker to dashboard
- Ledger event recording
- Metrics collection and aggregation

### 3. Multi-Agent Collaboration Tests
Tests that validate agent-to-agent communication:
- Coordinator delegates to Planner
- Planner analyzes and creates plan
- Builder executes the plan
- Reviewer reviews the changes
- Evaluator scores the quality

### 4. User Interface Flows
Tests that validate UI interactions:
- Chat interface message flow
- Job creation and monitoring
- Real-time event streaming
- Cancellation requests

## Running Tests

```bash
# Run all user journey tests
pnpm test:journeys

# Run specific journey test
pnpm test testing/user-journeys/01-job-lifecycle.test.ts

# Run with coverage
pnpm test:journeys --coverage
```

## Test Structure

Each test file follows this structure:

```typescript
describe('User Journey: [Name]', () => {
  // Setup: Create test environment, database, etc.
  
  describe('Flow Step 1', () => {
    it('should perform action X', async () => {
      // Test implementation
    });
  });
  
  describe('Flow Step 2', () => {
    it('should perform action Y', async () => {
      // Test implementation
    });
  });
  
  // Cleanup
});
```

## Data Flows Tested

### Job Creation Flow
```
User Input
  ↓
API Endpoint (/api/jobs POST)
  ↓
Input Validation
  ↓
Database Insert (jobs table)
  ↓
Return Job ID
  ↓
Event Emission (job_created)
```

### Job Processing Flow
```
Worker Poll
  ↓
Claim Job (with lock)
  ↓
Initialize Agent Context
  ↓
Agent Loop:
  ├─ Generate Prompt
  ├─ Call LLM
  ├─ Parse Tool Calls
  ├─ Execute Tools
  ├─ Record Events
  └─ Check Budget/Cancellation
  ↓
Update Job Status
  ↓
Record Final Events
```

### Agent Collaboration Flow
```
User Goal: "Add login feature"
  ↓
Coordinator Agent
  ├─ Analyzes request
  ├─ Delegates to Planner
  └─ Records delegation event
  ↓
Planner Agent
  ├─ Reads codebase
  ├─ Creates execution plan
  └─ Returns plan to Coordinator
  ↓
Coordinator Delegates to Builder
  ↓
Builder Agent
  ├─ Creates branch
  ├─ Applies changes
  ├─ Runs tests
  └─ Commits changes
  ↓
Coordinator Delegates to Reviewer
  ↓
Reviewer Agent
  ├─ Reviews changes
  ├─ Provides feedback
  └─ Approves or requests changes
  ↓
Job Complete
```

### Event Streaming Flow
```
Agent Action
  ↓
Log Event to Database
  ↓
Emit Event to Stream
  ↓
Dashboard Receives Event (SSE)
  ↓
Update UI in Real-time
```

## Key User Journeys

1. **Simple Bug Fix** - User reports bug, system fixes it
2. **Feature Addition** - User requests feature, system implements it
3. **Code Review** - System reviews existing PR
4. **Refactoring** - User requests refactoring, system safely refactors
5. **Test Generation** - User requests tests, system generates them
6. **Documentation Update** - User requests docs, system updates them

## Test Data

Test scenarios use fixtures in `testing/fixtures/`:
- `repos/` - Sample repositories
- `scenarios/` - YAML scenario definitions
- `expectations/` - Expected outcomes

## Verification Points

Each test verifies:
1. **Correctness** - Did it achieve the goal?
2. **Completeness** - Were all steps executed?
3. **Efficiency** - Was it within budget?
4. **Safety** - Were constraints respected?
5. **Traceability** - Can we audit what happened?
