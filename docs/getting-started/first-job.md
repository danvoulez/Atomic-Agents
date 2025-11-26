# Your First Job

A step-by-step walkthrough of creating and monitoring your first AI Coding Team job.

## Prerequisites

Before starting, ensure you have:
- [ ] Completed the [Quickstart](./quickstart.md)
- [ ] Dashboard running at `http://localhost:3000`
- [ ] Worker running and connected to the database
- [ ] A test repository to work with

## Understanding Jobs

A **job** is a unit of work assigned to the AI team. Each job has:

| Property | Description |
|----------|-------------|
| `goal` | Natural language description of what to do |
| `mode` | `mechanic` (small, strict) or `genius` (large, exploratory) |
| `repoPath` | Path to the repository to modify |
| `status` | Current state: `queued`, `running`, `succeeded`, `failed`, etc. |

## Step 1: Prepare a Test Repository

Create a simple test project:

```bash
mkdir ~/test-repo
cd ~/test-repo
git init

# Create a simple TypeScript file
cat > src/utils.ts << 'EOF'
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
EOF

# Create package.json
cat > package.json << 'EOF'
{
  "name": "test-repo",
  "type": "module",
  "scripts": {
    "test": "echo 'No tests'"
  }
}
EOF

git add .
git commit -m "Initial commit"
```

## Step 2: Create a Job via Dashboard

### Option A: Chat Interface

1. Open [http://localhost:3000/chat](http://localhost:3000/chat)
2. Type your request:
   ```
   Add a multiply function to src/utils.ts that multiplies two numbers
   ```
3. Press Enter or click Send

### Option B: Jobs Page

1. Open [http://localhost:3000/jobs](http://localhost:3000/jobs)
2. Click "New Job"
3. Fill in the form:
   - **Goal**: Add a multiply function to src/utils.ts
   - **Mode**: mechanic
   - **Repository Path**: /Users/yourname/test-repo
4. Click "Create Job"

## Step 3: Create a Job via API

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Add a multiply function to src/utils.ts that multiplies two numbers",
    "mode": "mechanic",
    "repoPath": "/Users/yourname/test-repo"
  }'
```

Response:
```json
{
  "id": "abc123-...",
  "status": "queued",
  "goal": "Add a multiply function...",
  "mode": "mechanic",
  "created_at": "2024-01-15T10:30:00Z"
}
```

## Step 4: Monitor the Job

### Via Dashboard

1. Go to [http://localhost:3000/jobs](http://localhost:3000/jobs)
2. Click on your job to see details
3. Watch events appear in real-time:
   - `planning` - Agent analyzes the request
   - `tool_call` - Agent uses tools (read_file, apply_patch, etc.)
   - `completion` - Job finishes

### Via API

```bash
# Get job status
curl http://localhost:3000/api/jobs/abc123-...

# Stream events
curl http://localhost:3000/api/jobs/abc123-.../stream
```

## Step 5: Review the Results

Once the job completes (`status: "succeeded"`):

1. **Check the repository**:
   ```bash
   cd ~/test-repo
   git log --oneline
   cat src/utils.ts
   ```

2. **Review events**:
   ```bash
   curl http://localhost:3000/api/events?jobId=abc123-...
   ```

## What Happens Behind the Scenes

When you create a job, here's the flow:

```
1. Job Created
   └─> Status: "queued"
   └─> Stored in database

2. Worker Claims Job
   └─> Status: "running"
   └─> Coordinator agent starts

3. Agent Loop
   ├─> TDLN-IN: Parse goal into LogLine
   ├─> Plan: Identify files to read/modify
   ├─> Execute Tools:
   │   ├─> read_file("src/utils.ts")
   │   ├─> search_code("function")
   │   └─> apply_patch("...")
   ├─> Verify: run_tests, run_lint
   └─> Commit: commit_changes

4. Job Completes
   └─> Status: "succeeded"
   └─> Events recorded in ledger
```

## Example: Bug Fix Job

Let's try a bug fix:

1. **Introduce a bug**:
   ```bash
   cd ~/test-repo
   # Edit src/utils.ts to have a bug
   cat > src/utils.ts << 'EOF'
   export function add(a: number, b: number): number {
     return a - b;  // BUG: should be + not -
   }
   EOF
   git add . && git commit -m "Introduce bug"
   ```

2. **Create a fix job**:
   ```bash
   curl -X POST http://localhost:3000/api/jobs \
     -H "Content-Type: application/json" \
     -d '{
       "goal": "Fix the bug in the add function - it should add, not subtract",
       "mode": "mechanic",
       "repoPath": "/Users/yourname/test-repo"
     }'
   ```

3. **Verify the fix**:
   ```bash
   cd ~/test-repo
   git diff HEAD~1
   ```

## Example: Feature Request

Request a new feature:

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Add a divide function with proper error handling for division by zero",
    "mode": "genius",
    "repoPath": "/Users/yourname/test-repo"
  }'
```

The agent will:
1. Read existing code to understand patterns
2. Create the new function
3. Add error handling
4. Optionally add tests
5. Commit the changes

## Common Issues

### Job Stuck in "queued"

- Check worker is running
- Check DATABASE_URL is correct
- Check worker logs for errors

### Job Failed

1. Check job events:
   ```bash
   curl http://localhost:3000/api/events?jobId=abc123-...
   ```

2. Look for error events
3. Check if it escalated to human review

### No Changes Made

- Goal might be too vague
- Repository path might be wrong
- Files might be read-only

## Tips for Better Results

1. **Be specific**: "Add function X to file Y" > "Add some function"
2. **Use mechanic mode** for small changes
3. **Use genius mode** for complex features
4. **Provide context**: Mention related files or functions
5. **Check events**: They show exactly what the agent did

## Next Steps

- [Architecture Overview](../architecture/overview.md) - Understand how it works
- [Tool Reference](../reference/tools.md) - See available tools
- [Budget System](../concepts/budgets.md) - Understand limits
- [Testing Guide](../guides/testing.md) - Run the test suite

