# Agent Architecture

Deep dive into the multi-agent system that powers AI Coding Team.

## Agent Overview

The system uses specialized agents that collaborate on tasks:

```
                    ┌─────────────────┐
                    │   Coordinator   │
                    │  (orchestrator) │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
   │   Planner   │    │   Builder   │    │  Reviewer   │
   │  (analyze)  │    │   (code)    │    │  (review)   │
   └─────────────┘    └─────────────┘    └─────────────┘

                             │
                             ▼
                    ┌─────────────────┐
                    │   Evaluator     │
                    │   (quality)     │
                    └─────────────────┘

          ┌─────────────────────────────────────────┐
          │              Watcher                     │
          │  (periodic pattern detection)           │
          └─────────────────────────────────────────┘
```

## Agent Definitions

### 1. Coordinator Agent

**Role**: Orchestrates work, handles user communication

**Responsibilities**:
- Parse and route user requests
- Delegate to specialized agents
- Manage async chat conversation
- Handle escalations to humans

**Tools**:
| Tool | Category | Description |
|------|----------|-------------|
| `delegate_to_agent` | META | Delegate work to another agent |
| `check_job_status` | META | Check status of delegated job |
| `ask_user` | META | Request clarification from user |
| `format_response` | META | Format response for user |

**System Prompt**:
```
You are a Coordinator agent. Your job is to:
1. Understand what the user wants
2. Delegate to the right specialist agent
3. Keep the user informed of progress
4. Escalate when something is unclear or risky

NEVER write code yourself - always delegate to Builder.
ALWAYS explain what you're doing in plain language.
```

### 2. Planner Agent

**Role**: Analyzes codebases, creates execution plans

**Responsibilities**:
- Read and understand existing code
- Identify files and functions to modify
- Create step-by-step execution plans
- Estimate complexity and effort

**Tools**:
| Tool | Category | Description |
|------|----------|-------------|
| `read_file` | READ_ONLY | Read file contents |
| `search_code` | READ_ONLY | Search codebase |
| `list_files` | READ_ONLY | List directory contents |
| `get_repo_state` | READ_ONLY | Get git status |
| `record_analysis` | META | Record analysis findings |
| `create_plan` | META | Create execution plan |
| `request_human_review` | META | Escalate to human |

**System Prompt**:
```
You are a Planner agent. Your job is to:
1. Thoroughly analyze the codebase
2. Understand the existing patterns and conventions
3. Create a detailed plan for the requested changes
4. Identify risks and dependencies

NEVER make changes - only analyze and plan.
ALWAYS record your analysis before creating a plan.
```

### 3. Builder Agent

**Role**: Writes code, runs tests

**Responsibilities**:
- Create branches for work
- Apply code patches
- Run tests and linters
- Create commits

**Tools**:
| Tool | Category | Description |
|------|----------|-------------|
| `create_branch` | MUTATING | Create git branch |
| `apply_patch` | MUTATING | Apply unified diff |
| `run_tests` | MUTATING | Run test suite |
| `run_lint` | MUTATING | Run linter |
| `commit_changes` | MUTATING | Create git commit |
| `request_human_review` | META | Escalate to human |

**System Prompt**:
```
You are a Builder agent. Your job is to:
1. Create a branch for your changes
2. Apply code changes following the plan
3. Run tests to verify changes work
4. Run linter to ensure code quality
5. Commit changes with clear messages

ALWAYS create a branch first.
ALWAYS run tests before committing.
NEVER skip the linter.
```

### 4. Reviewer Agent

**Role**: Reviews code changes

**Responsibilities**:
- Review patches for correctness
- Check for security issues
- Validate code style
- Provide actionable feedback

**Tools**:
| Tool | Category | Description |
|------|----------|-------------|
| `read_file` | READ_ONLY | Read file contents |
| `search_code` | READ_ONLY | Search for patterns |
| `create_review` | META | Create review with feedback |

**System Prompt**:
```
You are a Reviewer agent. Your job is to:
1. Review code changes carefully
2. Check for bugs, security issues, and style problems
3. Provide specific, actionable feedback
4. Approve or request changes

Be thorough but not nitpicky.
Focus on correctness, security, and maintainability.
```

### 5. Evaluator Agent

**Role**: Scores job quality

**Responsibilities**:
- Analyze completed jobs
- Score on multiple dimensions
- Provide recommendations
- Track trends

**Tools**:
| Tool | Category | Description |
|------|----------|-------------|
| `query_ledger` | READ_ONLY | Query job history |
| `create_evaluation` | META | Create quality evaluation |

**Evaluation Dimensions**:
- **Correctness**: Did it do what was asked?
- **Efficiency**: Was it done with minimal steps/tokens?
- **Honesty**: Did it accurately represent its actions?
- **Safety**: Did it follow rules and escalate appropriately?

### 6. Watcher Agent (Wise Observer)

**Role**: Detects patterns across projects

**Responsibilities**:
- Periodically analyze the ledger
- Detect non-obvious patterns
- Generate insights and recommendations
- Track cross-project knowledge

**Tools**:
| Tool | Category | Description |
|------|----------|-------------|
| `query_ledger` | READ_ONLY | Query full ledger |
| `create_insight` | META | Create insight notification |
| `create_note` | META | Record observation |

**Pattern Detectors**:
- Token usage spikes
- Repeated errors
- Success patterns
- Budget anomalies
- Cross-project similarities

## Agent Lifecycle

### Creation

```typescript
// Create agent with LLM client
const agent = createAgent("builder", llmClient);

// Configure for job
const result = await agent.run(job, {
  shouldCancel: () => isJobCancelling(job.id)
});
```

### Execution Loop

```
1. Initialize
   └─> Load tools, set context

2. Process (loop)
   ├─> Generate prompt
   ├─> Call LLM
   ├─> Parse tool calls
   ├─> Execute tools
   ├─> Log events
   └─> Check budget/cancel

3. Complete
   └─> Return result
```

### Budget Checks

Each step checks:
```typescript
// Check step limit
if (stepsUsed >= stepCap) {
  return { success: false, reason: "step_limit_exceeded" };
}

// Check token limit
if (tokensUsed >= tokenCap) {
  return { success: false, reason: "token_limit_exceeded" };
}

// Check time limit
if (Date.now() - startTime >= timeLimitMs) {
  return { success: false, reason: "time_limit_exceeded" };
}

// Check cancellation
if (await shouldCancel()) {
  return { success: false, reason: "cancelled" };
}
```

## Tool Execution

### Tool Categories

| Category | Risk | Examples |
|----------|------|----------|
| `READ_ONLY` | Safe | read_file, search_code |
| `MUTATING` | Reversible | apply_patch, commit_changes |
| `META` | Safe | record_analysis, create_plan |

### Tool Interface

```typescript
interface Tool<P, R> {
  name: string;
  description: string;
  category: "READ_ONLY" | "MUTATING" | "META";
  paramsSchema: ZodType<P>;
  resultSchema: ZodType<R>;
  costHint: "cheap" | "moderate" | "expensive";
  riskHint: "safe" | "reversible" | "dangerous";
  
  execute(params: P, ctx: ToolContext): Promise<ToolResult<R>>;
}
```

### Tool Context

```typescript
interface ToolContext {
  jobId: string;
  traceId: string;
  mode: "mechanic" | "genius";
  repoPath: string;
  logEvent: (event: EventInput) => Promise<void>;
}
```

## LLM Integration

### Supported Providers

| Provider | Model | Best For |
|----------|-------|----------|
| OpenAI | gpt-4-turbo | General purpose |
| Anthropic | claude-3-opus | Complex reasoning |
| Mock | - | Testing |

### Message Format

```typescript
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
```

### Tool Call Format

```typescript
interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON
  };
}
```

## Agent Communication

Agents communicate through:

1. **Ledger Events**: All actions recorded
2. **Job Delegation**: Coordinator assigns sub-jobs
3. **Notifications**: Broadcast via event bus

### Event Types

| Event | Description |
|-------|-------------|
| `planning` | Agent is analyzing |
| `tool_call` | Tool executed |
| `tool_result` | Tool completed |
| `error` | Error occurred |
| `escalation` | Human review requested |
| `completion` | Work completed |

## Error Handling

### Retry Strategy

```typescript
// Exponential backoff with jitter
async function executeWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error) || i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000 + Math.random() * 1000);
    }
  }
}
```

### Circuit Breaker

```typescript
// Prevent cascading failures
if (failures >= 5) {
  circuitOpen = true;
  setTimeout(() => circuitOpen = false, 60000);
}
```

### Self-Healing

Tools can adjust parameters on retry:
```typescript
// If file too large, try with line limits
if (error.code === "file_too_large") {
  return execute({ ...params, maxLines: 100 });
}
```

## Testing Agents

### L1 Tests (Unit)

Test individual tools:
```typescript
test("read_file returns file contents", async () => {
  const result = await readFileTool.execute(
    { path: "test.txt" },
    mockContext
  );
  expect(result.success).toBe(true);
});
```

### L2 Tests (Integration)

Test full agent loops with mock LLM:
```typescript
test("builder creates and commits changes", async () => {
  const result = await runL2Scenario("bug-trivial.yaml");
  expect(result.job.status).toBe("succeeded");
  expect(result.toolsCalled).toContain("apply_patch");
});
```

## Related Documentation

- [Architecture Overview](./overview.md)
- [Tool Reference](../reference/tools.md)
- [Testing Guide](../guides/testing.md)

