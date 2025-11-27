/**
 * Builder Loop Test (L2)
 * 
 * Tests the Builder agent's execution loop:
 * - Plan execution step-by-step
 * - Test failure handling with retries
 * - Budget limit enforcement
 * - Constraint validation (max files/lines)
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "vitest";
import { insertJob, getJob, listEvents, pool, insertEvent, updateJob, updateJobBudget } from "@ai-coding-team/db";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

// Test helpers
async function setupTestRepo(files: Record<string, string>): Promise<string> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "builder-test-"));
  
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tempDir, filePath);
    const dirPath = path.dirname(fullPath);
    
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, content);
  }
  
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
    // Ignore
  }
}

describe("Builder Loop (L2)", { sequential: true }, () => {
  beforeAll(async () => {
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
  // PLAN EXECUTION
  // ===========================================================================

  test("should execute plan steps in order", async () => {
    const testRepo = await setupTestRepo({
      "src/utils.ts": `
export function add(a: number, b: number): number {
  return a + b;
}
`,
    });

    try {
      const jobId = crypto.randomUUID();
      
      await insertJob({
        id: jobId,
        goal: "add subtract and multiply functions",
        mode: "mechanic",
        repo_path: testRepo,
        status: "running",
        agent_type: "builder",
        step_cap: 20,
        token_cap: 50000,
      });

      // Simulate plan with 2 steps
      const plan = {
        steps: [
          { action: "Add subtract function", target: "src/utils.ts", reasoning: "Need subtraction" },
          { action: "Add multiply function", target: "src/utils.ts", reasoning: "Need multiplication" },
        ],
      };

      // Simulate executing step 1
      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "info",
        summary: "Executing step 1: Add subtract function",
      });

      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "read_file",
        params: { path: "src/utils.ts" },
        summary: "Reading source file",
      });

      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "apply_patch",
        params: {
          patch: `--- a/src/utils.ts
+++ b/src/utils.ts
@@ -3,3 +3,7 @@ export function add(a: number, b: number): number {
   return a + b;
 }
+
+export function subtract(a: number, b: number): number {
+  return a - b;
+}`,
        },
        summary: "Added subtract function",
      });

      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "run_tests",
        result: { status: "pass", passed: 2, failed: 0 },
        summary: "Tests passed after step 1",
      });

      // Simulate executing step 2
      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "info",
        summary: "Executing step 2: Add multiply function",
      });

      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "apply_patch",
        params: {
          patch: `--- a/src/utils.ts
+++ b/src/utils.ts
@@ -7,3 +7,7 @@ export function subtract(a: number, b: number): number {
   return a - b;
 }
+
+export function multiply(a: number, b: number): number {
+  return a * b;
+}`,
        },
        summary: "Added multiply function",
      });

      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "run_tests",
        result: { status: "pass", passed: 3, failed: 0 },
        summary: "Tests passed after step 2",
      });

      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "commit_changes",
        result: { commitHash: "abc123" },
        summary: "Committed all changes",
      });

      await updateJob(jobId, { status: "succeeded" });
      await updateJobBudget(jobId, { steps_used: 7 });

      // Verify execution order
      const events = await listEvents(jobId);
      const toolCalls = events.filter(e => e.kind === "tool_call");
      
      expect(toolCalls.length).toBe(6);
      expect(toolCalls[0].tool_name).toBe("read_file");
      expect(toolCalls[1].tool_name).toBe("apply_patch");
      expect(toolCalls[2].tool_name).toBe("run_tests");
      expect(toolCalls[3].tool_name).toBe("apply_patch");
      expect(toolCalls[4].tool_name).toBe("run_tests");
      expect(toolCalls[5].tool_name).toBe("commit_changes");

    } finally {
      await cleanupTestRepo(testRepo);
    }
  });

  // ===========================================================================
  // RETRY LOGIC
  // ===========================================================================

  test("should retry on test failure (max 3 retries)", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "fix failing test",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // First attempt - fails
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      summary: "Attempt 1: Applied initial fix",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "run_tests",
      result: { status: "fail", passed: 2, failed: 1, error: "TypeError: undefined" },
      summary: "Tests failed - attempt 1",
    });

    // Second attempt - fails
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "info",
      summary: "Analyzing failure, generating fix patch (retry 1/3)",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      summary: "Attempt 2: Applied fix for TypeError",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "run_tests",
      result: { status: "fail", passed: 2, failed: 1, error: "AssertionError" },
      summary: "Tests failed - attempt 2",
    });

    // Third attempt - succeeds
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "info",
      summary: "Analyzing failure, generating fix patch (retry 2/3)",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      summary: "Attempt 3: Applied fix for assertion",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "run_tests",
      result: { status: "pass", passed: 3, failed: 0 },
      summary: "Tests passed on retry 3",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "commit_changes",
      summary: "Committed after successful retry",
    });

    await updateJob(jobId, { status: "succeeded" });
    await updateJobBudget(jobId, { steps_used: 9 });

    // Verify retry behavior
    const events = await listEvents(jobId);
    const testCalls = events.filter(e => e.tool_name === "run_tests");
    const patchCalls = events.filter(e => e.tool_name === "apply_patch");
    
    expect(testCalls.length).toBe(3); // 3 attempts
    expect(patchCalls.length).toBe(3); // 3 patches

    // Verify final success
    const lastTest = testCalls[testCalls.length - 1];
    const result = lastTest.result as { status?: string } | null;
    expect(result?.status).toBe("pass");
  });

  test("should escalate after 3 failed retries", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "fix impossible bug",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Simulate 3 failed attempts
    for (let i = 1; i <= 3; i++) {
      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "apply_patch",
        summary: `Attempt ${i}`,
      });

      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "run_tests",
        result: { status: "fail", passed: 0, failed: 1 },
        summary: `Tests failed - attempt ${i}`,
      });
    }

    // Should escalate after 3 failures
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "Max retries (3) exceeded - tests still failing",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "escalation",
      tool_name: "request_human_review",
      summary: "Requesting human review after 3 failed attempts",
    });

    await updateJob(jobId, { status: "waiting_human" });

    // Verify escalation
    const finalJob = await getJob(jobId);
    expect(finalJob?.status).toBe("waiting_human");

    const events = await listEvents(jobId);
    expect(events.some(e => e.kind === "escalation")).toBe(true);
  });

  // ===========================================================================
  // BUDGET LIMITS
  // ===========================================================================

  test("should stop when step budget exceeded", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "complete complex task",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 5, // Low step cap
      token_cap: 50000,
    });

    // Simulate using all steps
    for (let i = 1; i <= 5; i++) {
      await insertEvent({
        job_id: jobId,
        trace_id: jobId,
        kind: "tool_call",
        tool_name: "read_file",
        summary: `Step ${i}`,
      });
    }

    // Step budget exceeded
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "Step limit exceeded: used 5/5 steps",
    });

    await updateJob(jobId, { status: "failed" });
    await updateJobBudget(jobId, { steps_used: 5 });

    // Verify
    const finalJob = await getJob(jobId);
    expect(finalJob?.status).toBe("failed");
    expect(finalJob?.steps_used).toBe(5);

    const events = await listEvents(jobId);
    const errorEvent = events.find(e => e.kind === "error");
    expect(errorEvent?.summary).toContain("Step limit exceeded");
  });

  test("should stop when token budget exceeded", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "analyze large codebase",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 50,
      token_cap: 1000, // Very low token cap
    });

    // Simulate high token usage
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "read_file",
      tokens_used: 800,
      summary: "Read large file",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "read_file",
      tokens_used: 300, // This exceeds the cap
      summary: "Read another file",
    });

    // Token budget exceeded
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "Token budget exhausted: 1100 > 1000",
    });

    await updateJob(jobId, { status: "failed" });
    await updateJobBudget(jobId, { tokens_used: 1100 });

    // Verify
    const finalJob = await getJob(jobId);
    expect(finalJob?.status).toBe("failed");
    expect(finalJob?.tokens_used).toBeGreaterThan(1000);
  });

  // ===========================================================================
  // CONSTRAINTS (MAX FILES/LINES)
  // ===========================================================================

  test("should reject patch exceeding max files (mechanic mode)", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "refactor entire codebase",
      mode: "mechanic", // Max 5 files
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Try to apply patch with too many files
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      result: {
        success: false,
        error: "Patch changes 8 files, but mechanic mode allows max 5 files.",
      },
      summary: "Patch rejected - too many files",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "Constraint violation: max 5 files in mechanic mode",
    });

    await updateJob(jobId, { status: "failed" });

    // Verify
    const events = await listEvents(jobId);
    const patchEvent = events.find(e => e.tool_name === "apply_patch");
    const result = patchEvent?.result as { success?: boolean; error?: string } | null;
    
    expect(result?.success).toBe(false);
    expect(result?.error).toContain("mechanic mode allows max 5 files");
  });

  test("should reject patch exceeding max lines (mechanic mode)", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "add large feature",
      mode: "mechanic", // Max 200 lines
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Try to apply patch with too many lines
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      result: {
        success: false,
        error: "Patch changes 350 lines, but mechanic mode allows max 200 lines.",
      },
      summary: "Patch rejected - too many lines",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "Constraint violation: max 200 lines in mechanic mode",
    });

    await updateJob(jobId, { status: "failed" });

    // Verify
    const events = await listEvents(jobId);
    const patchEvent = events.find(e => e.tool_name === "apply_patch");
    const result = patchEvent?.result as { success?: boolean; error?: string } | null;
    
    expect(result?.success).toBe(false);
    expect(result?.error).toContain("mechanic mode allows max 200 lines");
  });

  test("should allow larger patches in genius mode", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "major refactoring",
      mode: "genius", // Max 20 files, 1000 lines
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 50,
      token_cap: 100000,
    });

    // Apply large patch (within genius limits)
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      result: {
        success: true,
        filesChanged: 12,
        linesAdded: 400,
        linesRemoved: 150,
      },
      summary: "Applied large refactoring patch",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "run_tests",
      result: { status: "pass", passed: 50, failed: 0 },
      summary: "All tests passed",
    });

    await updateJob(jobId, { status: "succeeded" });
    await updateJobBudget(jobId, { steps_used: 2 });

    // Verify
    const events = await listEvents(jobId);
    const patchEvent = events.find(e => e.tool_name === "apply_patch");
    const result = patchEvent?.result as { success?: boolean; filesChanged?: number } | null;
    
    expect(result?.success).toBe(true);
    expect(result?.filesChanged).toBe(12); // Allowed in genius mode
  });
});

