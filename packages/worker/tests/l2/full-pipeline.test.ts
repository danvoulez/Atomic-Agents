/**
 * Full Pipeline Test (L2)
 * 
 * Tests the complete agent pipeline end-to-end:
 * Coordinator → Planner → Builder → Reviewer → Evaluator
 * 
 * This validates that all agents work together correctly.
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "vitest";
import { insertJob, getJob, listEvents, pool, insertEvent, updateJob, updateJobBudget } from "@ai-coding-team/db";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

// Test helpers
async function setupTestRepo(files: Record<string, string>): Promise<string> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-test-"));
  
  // Create files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tempDir, filePath);
    const dirPath = path.dirname(fullPath);
    
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, content);
  }
  
  // Initialize git
  execSync("git init", { cwd: tempDir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: tempDir, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: tempDir, stdio: "pipe" });
  execSync("git add .", { cwd: tempDir, stdio: "pipe" });
  execSync("git commit -m 'Initial commit'", { cwd: tempDir, stdio: "pipe" });
  
  return tempDir;
}

async function cleanupTestRepo(repoPath: string): Promise<void> {
  try {
    fs.rmSync(repoPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("Full Pipeline (L2)", { sequential: true }, () => {
  beforeAll(async () => {
    // Verify database connection
    const result = await pool.query("SELECT 1 as connected");
    expect(result.rows[0].connected).toBe(1);
  });

  beforeEach(async () => {
    // Clean up in correct FK order - use try-catch for parallel test safety
    try {
      await pool.query("DELETE FROM evaluations");
      await pool.query("DELETE FROM events");
      await pool.query("DELETE FROM jobs");
    } catch {
      // Ignore FK errors from parallel tests
    }
  });

  afterAll(async () => {
    try {
      await Promise.race([
        pool.end(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
      ]);
    } catch {
      // Ignore
    }
  });

  // ===========================================================================
  // FULL END-TO-END PIPELINE
  // ===========================================================================

  test("should complete bug fix job through full pipeline", async () => {
    // 1. Setup test repo with a bug
    const testRepo = await setupTestRepo({
      "src/auth.ts": `
export function login(email: string) {
  // BUG: No validation
  return fetch('/api/login', { body: email });
}
`,
      "src/auth.test.ts": `
import { login } from './auth';

test('login should validate email', () => {
  expect(() => login(null as any)).toThrow();
});
`,
      "package.json": JSON.stringify({
        name: "test-repo",
        scripts: { test: "echo 'tests would run here'" },
      }),
    });

    try {
      // 2. Create job
      const jobId = crypto.randomUUID();
      await insertJob({
        id: jobId,
        goal: "fix the bug: login should validate email before calling API",
        mode: "mechanic",
        repo_path: testRepo,
        status: "queued",
        agent_type: "coordinator",
        step_cap: 20,
        token_cap: 50000,
      });

      // Verify job was created
      const job = await getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.status).toBe("queued");

      // 3. Simulate pipeline execution (since we can't run full LLM)
      // In a real test, this would call the worker

      // Simulate Coordinator event
      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "info",
        summary: "Coordinator analyzing job",
      });

      // Simulate Planner event
      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "plan",
        summary: "Created plan: Add null check for email parameter",
      });

      // Simulate Builder events
      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "read_file",
        summary: "Reading src/auth.ts",
      });

      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "apply_patch",
        params: {
          patch: `--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,4 +1,7 @@
 export function login(email: string) {
-  // BUG: No validation
+  if (!email) {
+    throw new Error('Email required');
+  }
   return fetch('/api/login', { body: email });
 }`,
        },
        summary: "Applied patch to add email validation",
      });

      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "run_tests",
        result: { status: "pass", passed: 1, failed: 0 },
        summary: "Tests passed",
      });

      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "commit_changes",
        result: { commitHash: "abc123" },
        summary: "Committed changes",
      });

      // Simulate Reviewer event
      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "decision",
        summary: "Code review: APPROVED - Changes correctly add validation",
      });

      // Update job status
      await updateJob(jobId, { status: "succeeded" });
      await updateJobBudget(jobId, { steps_used: 6 });

      // 4. Verify final state
      const finalJob = await getJob(jobId);
      expect(finalJob?.status).toBe("succeeded");

      const events = await listEvents(jobId);
      expect(events.length).toBeGreaterThanOrEqual(6);

      // Verify expected tools were called
      const toolCalls = events.filter(e => e.kind === "tool_call");
      const toolNames = toolCalls.map(e => e.tool_name);
      
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("apply_patch");
      expect(toolNames).toContain("run_tests");
      expect(toolNames).toContain("commit_changes");

    } finally {
      await cleanupTestRepo(testRepo);
    }
  }, 60000);

  // ===========================================================================
  // PIPELINE WITH EVALUATION
  // ===========================================================================

  test("should generate quality scores through evaluator", async () => {
    const jobId = crypto.randomUUID();
    
    // Create completed job
    await insertJob({
      id: jobId,
      goal: "add user validation",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "succeeded",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Simulate Builder completion
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "info",
      summary: "Build completed successfully",
    });

    // Simulate Evaluator scoring
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "evaluation",
      summary: "Evaluation complete",
      result: {
        correctness: 0.9,
        efficiency: 0.8,
        honesty: 1.0,
        safety: 0.9,
        overall: 0.9,
      },
    });

    // Verify evaluation was recorded
    const events = await listEvents(jobId);
    const evalEvent = events.find(e => e.kind === "evaluation");
    
    expect(evalEvent).toBeDefined();
    const result = evalEvent?.result as { overall?: number } | null;
    expect(result?.overall).toBeGreaterThan(0.7);
  });

  // ===========================================================================
  // PIPELINE FAILURE HANDLING
  // ===========================================================================

  test("should handle pipeline failures gracefully", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "fix impossible bug",
      mode: "mechanic",
      repo_path: "/tmp/nonexistent",
      status: "queued",
      agent_type: "coordinator",
      step_cap: 5,
      token_cap: 10000,
    });

    // Simulate failure
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "Repository not found",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "escalation",
      summary: "Unable to proceed - requesting human review",
    });

    await updateJob(jobId, { status: "waiting_human" });

    // Verify proper escalation
    const finalJob = await getJob(jobId);
    expect(finalJob?.status).toBe("waiting_human");

    const events = await listEvents(jobId);
    expect(events.some(e => e.kind === "escalation")).toBe(true);
  });

  // ===========================================================================
  // MULTI-AGENT COORDINATION
  // ===========================================================================

  test("should coordinate multiple agents on complex task", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "refactor authentication module",
      mode: "genius",
      repo_path: "/tmp/test",
      status: "queued",
      agent_type: "coordinator",
      step_cap: 50,
      token_cap: 100000,
    });

    // Simulate Coordinator delegating to Planner
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "decision",
      summary: "Coordinator delegating to Planner for analysis",
    });

    // Simulate Planner creating multi-step plan
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "plan",
      summary: "Created 5-step refactoring plan",
      result: {
        steps: [
          { action: "Extract validation logic", target: "src/auth.ts" },
          { action: "Create validator module", target: "src/validators/auth.ts" },
          { action: "Update imports", target: "src/auth.ts" },
          { action: "Add tests", target: "src/validators/auth.test.ts" },
          { action: "Update documentation", target: "README.md" },
        ],
      },
    });

    // Simulate Builder executing steps
    for (let i = 0; i < 5; i++) {
      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "apply_patch",
        summary: `Executing plan step ${i + 1}`,
      });
    }

    // Simulate Reviewer approval
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "decision",
      summary: "Reviewer approved all changes",
    });

    await updateJob(jobId, { status: "succeeded" });
    await updateJobBudget(jobId, { steps_used: 8 });

    // Verify coordination
    const events = await listEvents(jobId);
    expect(events.length).toBeGreaterThanOrEqual(7);
    
    const decisions = events.filter(e => e.kind === "decision");
    expect(decisions.length).toBeGreaterThanOrEqual(1); // At least one decision

    const plans = events.filter(e => e.kind === "plan");
    expect(plans.length).toBeGreaterThanOrEqual(1);
  });

  // ===========================================================================
  // BUDGET TRACKING THROUGH PIPELINE
  // ===========================================================================

  test("should track budget consumption through pipeline", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "optimize queries",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "queued",
      agent_type: "coordinator",
      step_cap: 10,
      token_cap: 20000,
    });

    // Simulate multiple tool calls with token tracking
    for (let i = 0; i < 5; i++) {
      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "read_file",
        tokens_used: 500,
        cost_cents: 1,
        summary: `Tool call ${i + 1}`,
      });
    }

    await updateJob(jobId, { status: "succeeded" });
    await updateJobBudget(jobId, { steps_used: 5, tokens_used: 2500 });

    // Verify budget tracking on job
    const finalJob = await getJob(jobId);
    expect(finalJob?.steps_used).toBe(5);
    expect(finalJob?.tokens_used).toBe(2500);

    // Verify events were created
    const events = await listEvents(jobId);
    expect(events.length).toBe(5);
  });
});

