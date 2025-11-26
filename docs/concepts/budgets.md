# Budget System

Understanding resource limits, cost control, and safety mechanisms.

## Overview

The budget system is a core safety feature that prevents:
- Runaway costs from infinite loops
- Resource exhaustion from complex tasks
- Hallucination spirals
- Uncontrolled system behavior

## Budget Types

### Step Budget

**What it measures**: Number of agent loop iterations.

| Mode | Limit | Rationale |
|------|-------|-----------|
| mechanic | 20 | Simple tasks should complete quickly |
| genius | 100 | Complex tasks need more iterations |

**What counts as a step**:
- Each LLM call
- Each tool execution
- Each decision point

**Why it matters**: Prevents infinite loops where the agent keeps trying the same thing or hallucinating new approaches.

### Token Budget

**What it measures**: LLM tokens consumed (input + output).

| Mode | Limit | Approx Cost |
|------|-------|-------------|
| mechanic | 50,000 | ~$0.50-1.50 |
| genius | 200,000 | ~$2.00-6.00 |

**What counts**:
- System prompt tokens
- Conversation history
- Tool results returned to LLM
- LLM output tokens

**Why it matters**: Direct cost control. Prevents expensive runaway completions.

### Time Budget

**What it measures**: Wall-clock execution time.

| Mode | Limit | Rationale |
|------|-------|-----------|
| mechanic | 60s | Bug fixes should be quick |
| genius | 300s | Features need more time |

**Why it matters**: Prevents jobs from running indefinitely, even if step/token budgets aren't exhausted.

### Cost Budget (Optional)

**What it measures**: Estimated monetary cost in cents.

| Mode | Default | Customizable |
|------|---------|--------------|
| mechanic | $10 | Yes |
| genius | $50 | Yes |

**Calculation**:
```
cost = (prompt_tokens * prompt_rate) + (completion_tokens * completion_rate)
```

## Budget Enforcement

### At Each Step

```typescript
// Before each LLM call
if (stepsUsed >= stepCap) {
  return { 
    success: false, 
    reason: "step_limit_exceeded" 
  };
}

if (tokensUsed >= tokenCap) {
  return { 
    success: false, 
    reason: "token_limit_exceeded" 
  };
}

if (Date.now() - startTime >= timeLimitMs) {
  return { 
    success: false, 
    reason: "time_limit_exceeded" 
  };
}
```

### Database Tracking

```sql
-- Job budget columns
jobs (
  step_cap          INT DEFAULT 20,
  token_cap         INT DEFAULT 50000,
  cost_cap_cents    INT DEFAULT 1000,
  steps_used        INT DEFAULT 0,
  tokens_used       INT DEFAULT 0,
  cost_used_cents   INT DEFAULT 0
)

-- Budget update after each step
UPDATE jobs SET
  steps_used = steps_used + 1,
  tokens_used = tokens_used + $1,
  cost_used_cents = cost_used_cents + $2
WHERE id = $3
```

### Events for Auditability

```json
{
  "kind": "budget_update",
  "job_id": "abc123",
  "data": {
    "steps_used": 15,
    "steps_remaining": 5,
    "tokens_used": 35000,
    "tokens_remaining": 15000,
    "utilization_percent": 70
  }
}
```

## Budget Exceeded Behavior

When any budget is exceeded:

1. **Current Step Completes**: Don't interrupt mid-operation
2. **Job Fails Gracefully**: Status set to `failed`
3. **Reason Recorded**: Clear indication of which limit hit
4. **Escalation Option**: Can request human to increase limit

```typescript
// Example failure
{
  success: false,
  reason: "step_limit_exceeded",
  stepsUsed: 20,
  stepCap: 20,
  tokensUsed: 45000,
  tokenCap: 50000,
  message: "Reached step limit. Task may be too complex for mechanic mode."
}
```

## Mode Selection Guide

### Use Mechanic Mode When:

- ✅ Fixing a specific bug
- ✅ Adding a small function
- ✅ Updating documentation
- ✅ Simple refactoring
- ✅ Adding tests for existing code

### Use Genius Mode When:

- ✅ Implementing new features
- ✅ Complex refactoring
- ✅ Multiple related changes
- ✅ Exploratory analysis
- ✅ Unclear scope

## Custom Budgets

Override defaults per job:

```typescript
// API request
POST /api/jobs
{
  "goal": "Complex refactoring",
  "mode": "genius",
  "stepCap": 150,      // Override default 100
  "tokenCap": 300000,   // Override default 200000
  "costCapCents": 10000 // $100 max
}
```

**Caution**: Higher budgets mean higher risk of runaway costs.

## Budget Optimization Tips

### 1. Be Specific

```
❌ "Improve the code"
✅ "Add error handling to the login function in auth.ts"
```

Specific goals = fewer exploration steps.

### 2. Provide Context

```
❌ "Fix the bug"
✅ "Fix the bug in calculateTotal() - it returns NaN when items is empty"
```

Context = less searching = fewer tokens.

### 3. Use Right Mode

Don't use genius mode for simple tasks - it uses more resources even for easy work.

### 4. Review Events

Check event history to understand token usage patterns:

```sql
SELECT tool_name, SUM(tokens_used) 
FROM events 
WHERE job_id = $1 
GROUP BY tool_name 
ORDER BY SUM(tokens_used) DESC;
```

## Budget Metrics

Dashboard metrics to monitor:

| Metric | Description | Alert If |
|--------|-------------|----------|
| avg_steps_used | Average steps per job | > 80% of cap |
| avg_tokens_used | Average tokens per job | > 80% of cap |
| budget_exceeded_count | Jobs hitting limits | > 10% of jobs |
| utilization_by_mode | Resource use by mode | Unbalanced |

## Related Documentation

- [Architecture Overview](../architecture/overview.md)
- [Job Creation](../reference/api.md#create-job)
- [Monitoring Guide](../guides/monitoring.md)

