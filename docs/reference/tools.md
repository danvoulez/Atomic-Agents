# Tool Reference

Complete catalog of tools available to AI Coding Team agents.

## Tool Categories

| Category | Risk Level | Description |
|----------|------------|-------------|
| `READ_ONLY` | Safe | Read files, search code - no modifications |
| `MUTATING` | Reversible | Apply patches, commit - can be undone |
| `META` | Safe | Record events, create plans - metadata only |

---

## Read-Only Tools

### read_file

Read contents of a file from the repository.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | Yes | Relative path to file |
| `startLine` | number | No | Line to start reading |
| `endLine` | number | No | Line to stop reading |

**Result**
```typescript
{
  content: string;      // File contents
  lineCount: number;    // Total lines
  truncated: boolean;   // If file was truncated
}
```

**Example**
```typescript
await readFile({ path: "src/utils.ts" });
// { content: "export function...", lineCount: 45, truncated: false }

await readFile({ path: "large-file.ts", startLine: 100, endLine: 200 });
// { content: "// lines 100-200...", lineCount: 101, truncated: true }
```

**Error Codes**
- `file_not_found` - File doesn't exist
- `read_error` - Permission or encoding issue

---

### search_code

Search repository for text patterns using ripgrep/grep.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | Yes | Search pattern (regex supported) |
| `path` | string | No | Subdirectory to search |
| `filePattern` | string | No | Glob pattern for files (e.g., `*.ts`) |
| `maxResults` | number | No | Limit results (default: 20) |

**Result**
```typescript
{
  matches: Array<{
    file: string;
    line: number;
    content: string;
  }>;
  totalMatches: number;
  truncated: boolean;
}
```

**Example**
```typescript
await searchCode({ query: "function login", filePattern: "*.ts" });
// { matches: [{ file: "src/auth.ts", line: 15, content: "function login(..." }], ... }
```

---

### list_files

List directory contents with optional filtering.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | No | Directory path (default: root) |
| `pattern` | string | No | Glob pattern filter |
| `recursive` | boolean | No | Include subdirectories |
| `maxDepth` | number | No | Recursion depth limit |

**Result**
```typescript
{
  files: Array<{
    path: string;
    type: "file" | "directory";
    size?: number;
  }>;
  totalCount: number;
}
```

---

### get_repo_state

Get git repository status and information.

**Parameters**
None required.

**Result**
```typescript
{
  branch: string;           // Current branch
  clean: boolean;           // No uncommitted changes
  ahead: number;            // Commits ahead of remote
  behind: number;           // Commits behind remote
  staged: string[];         // Staged files
  modified: string[];       // Modified files
  untracked: string[];      // Untracked files
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
}
```

---

## Mutating Tools

### create_branch

Create and checkout a new git branch.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | Yes | Branch name (auto-prefixed with `ai/`) |
| `baseBranch` | string | No | Base branch (default: `main`) |

**Result**
```typescript
{
  branchName: string;   // Full branch name (ai/job-id/name)
  basedOn: string;      // Base branch
  created: boolean;     // True if new, false if switched to existing
}
```

**Notes**
- Branch names are prefixed: `ai/{job-id-prefix}/{name}`
- Idempotent: switches to existing branch if already exists
- ALWAYS call before making changes

---

### apply_patch

Apply a unified diff patch to files.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `patch` | string | Yes | Unified diff format patch |
| `dryRun` | boolean | No | Validate without applying |

**Result**
```typescript
{
  applied: boolean;
  filesModified: number;
  linesChanged: number;
}
```

**Patch Format**
```diff
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,5 +1,6 @@
 export function add(a: number, b: number): number {
   return a + b;
 }
+
+export function multiply(a: number, b: number): number {
+  return a * b;
+}
```

**Mechanic Mode Limits**
- Max 5 files per patch
- Max 200 lines changed

**Error Codes**
- `invalid_patch` - Malformed diff
- `apply_error` - Patch doesn't apply cleanly
- `limits_exceeded` - Over mechanic mode limits

---

### run_tests

Run the project's test suite.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | No | Subdirectory to test |
| `pattern` | string | No | Test file pattern |
| `timeout` | number | No | Timeout in ms (default: 60000) |

**Result**
```typescript
{
  status: "pass" | "fail" | "error";
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures?: Array<{
    name: string;
    message: string;
  }>;
  output: string;
}
```

**Auto-Detection**
Automatically detects test runner:
- `vitest` - if vitest in package.json
- `jest` - if jest in package.json
- `pytest` - if pytest.ini or setup.py exists
- `cargo test` - if Cargo.toml exists

---

### run_lint

Run the project's linter.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | No | Subdirectory to lint |
| `fix` | boolean | No | Auto-fix issues |

**Result**
```typescript
{
  status: "pass" | "fail" | "error";
  errorCount: number;
  warningCount: number;
  fixedCount?: number;
  issues: Array<{
    file: string;
    line: number;
    severity: "error" | "warning";
    message: string;
    rule: string;
  }>;
}
```

**Auto-Detection**
- `eslint` - JavaScript/TypeScript
- `biome` - JavaScript/TypeScript
- `ruff` - Python
- `clippy` - Rust

---

### commit_changes

Create a git commit with staged changes.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `message` | string | Yes | Commit message |

**Result**
```typescript
{
  committed: boolean;
  commitHash: string;
  filesCommitted: number;
  branch: string;
}
```

**Notes**
- Auto-stages all changes (`git add -A`)
- REQUIRES tests and lint to pass first
- NEVER skip tests

**Error Codes**
- `nothing_to_commit` - No changes to commit
- `commit_error` - Git error

---

## Meta Tools

### record_analysis

Record analysis findings for a job.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `findings` | string | Yes | Analysis summary |
| `files` | string[] | No | Files analyzed |
| `complexity` | string | No | `low`, `medium`, `high` |
| `risks` | string[] | No | Identified risks |

**Result**
```typescript
{
  recorded: boolean;
  analysisId: string;
}
```

---

### create_plan

Create an execution plan for a job.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `steps` | Array<{description, tool, files?}> | Yes | Planned steps |
| `estimatedSteps` | number | No | Expected step count |
| `estimatedTokens` | number | No | Expected token usage |

**Result**
```typescript
{
  stored: boolean;
  planId: string;
  stepCount: number;
}
```

---

### request_human_review

Escalate to human reviewer.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `reason` | string | Yes | Why escalation is needed |
| `severity` | string | No | `low`, `medium`, `high` |
| `context` | object | No | Additional context |

**Result**
```typescript
{
  escalated: boolean;
  escalationId: string;
}
```

**Use When**
- Request is ambiguous
- Changes are risky
- Outside agent's expertise
- Budget would be exceeded

---

## IDE-Enhanced Tools

### semantic_search

Search codebase by semantic meaning.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | Yes | Natural language query |
| `path` | string | No | Subdirectory to search |
| `maxResults` | number | No | Limit results |

**Result**
```typescript
{
  results: Array<{
    file: string;
    startLine: number;
    endLine: number;
    content: string;
    relevance: number;
  }>;
}
```

---

### find_files

Find files by glob pattern.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pattern` | string | Yes | Glob pattern |
| `path` | string | No | Base directory |

**Result**
```typescript
{
  files: string[];
  totalCount: number;
}
```

---

### web_search

Search the web for documentation or solutions.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `maxResults` | number | No | Limit results |

**Result**
```typescript
{
  results: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}
```

---

### read_lints

Get linter diagnostics from IDE.

**Parameters**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | No | File or directory path |

**Result**
```typescript
{
  diagnostics: Array<{
    file: string;
    line: number;
    column: number;
    severity: "error" | "warning" | "info";
    message: string;
    source: string;
  }>;
}
```

---

## Tool Execution Context

All tools receive execution context:

```typescript
interface ToolContext {
  jobId: string;          // Current job ID
  traceId: string;        // Trace ID for logging
  mode: "mechanic" | "genius";
  repoPath: string;       // Repository root
  logEvent: (event) => Promise<void>;
}
```

## Tool Costs

| Tool | Cost Hint | Typical Duration |
|------|-----------|------------------|
| read_file | cheap | 10-50ms |
| search_code | moderate | 100-500ms |
| list_files | cheap | 50-100ms |
| get_repo_state | cheap | 100-200ms |
| create_branch | cheap | 100-300ms |
| apply_patch | moderate | 200-500ms |
| run_tests | expensive | 5-60s |
| run_lint | moderate | 1-10s |
| commit_changes | cheap | 200-500ms |
| semantic_search | expensive | 1-5s |
| web_search | expensive | 1-3s |

---

## Related Documentation

- [Agent Architecture](../architecture/agents.md)
- [API Reference](./api.md)
- [Testing Guide](../guides/testing.md)

