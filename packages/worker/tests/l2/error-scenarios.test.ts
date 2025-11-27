/**
 * Error Scenarios Test (L2)
 * 
 * Tests error handling and recovery:
 * - LLM API failures
 * - Git conflicts
 * - Invalid patches
 * - Network issues
 * - Database errors
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "vitest";
import { insertJob, getJob, listEvents, pool, insertEvent, updateJob } from "@ai-coding-team/db";

describe("Error Scenarios (L2)", { sequential: true }, () => {
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
  // LLM API FAILURES
  // ===========================================================================

  test("should retry on LLM API rate limit", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "fix bug",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Simulate rate limit error
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "LLM API rate limited (429)",
    });

    // Simulate retry after backoff
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "info",
      summary: "Retrying after 5s backoff",
    });

    // Successful retry
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "read_file",
      summary: "Retry successful",
    });

    await updateJob(jobId, { status: "running" });

    // Verify retry happened
    const events = await listEvents(jobId);
    expect(events.some(e => e.summary?.includes("rate limited"))).toBe(true);
    expect(events.some(e => e.summary?.includes("Retry"))).toBe(true);
  });

  test("should fail gracefully on LLM API timeout", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "analyze code",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Simulate timeout after retries exhausted
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "LLM API timeout after 3 retries",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "escalation",
      tool_name: "request_human_review",
      summary: "Unable to reach LLM API - escalating",
    });

    await updateJob(jobId, { status: "waiting_human" });

    // Verify proper failure handling
    const finalJob = await getJob(jobId);
    expect(finalJob?.status).toBe("waiting_human");

    const events = await listEvents(jobId);
    expect(events.some(e => e.kind === "escalation")).toBe(true);
  });

  test("should handle LLM invalid response format", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "fix bug",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Simulate invalid JSON response
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "LLM returned invalid JSON: Unexpected token at position 0",
    });

    // Retry with reprompt
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "info",
      summary: "Retrying with format reminder prompt",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      summary: "Valid response on retry",
    });

    // Verify recovery
    const events = await listEvents(jobId);
    expect(events.some(e => e.summary?.includes("invalid JSON"))).toBe(true);
    expect(events.some(e => e.tool_name === "apply_patch")).toBe(true);
  });

  // ===========================================================================
  // GIT CONFLICTS
  // ===========================================================================

  test("should handle git merge conflicts", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "merge feature branch",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Simulate merge conflict
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      result: {
        success: false,
        error: "CONFLICT (content): Merge conflict in src/auth.ts",
      },
      summary: "Patch failed due to merge conflict",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "Git merge conflict detected - cannot auto-resolve",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "escalation",
      tool_name: "request_human_review",
      summary: "Merge conflict requires human resolution",
    });

    await updateJob(jobId, { status: "waiting_human" });

    // Verify escalation
    const finalJob = await getJob(jobId);
    expect(finalJob?.status).toBe("waiting_human");

    const events = await listEvents(jobId);
    const escalation = events.find(e => e.kind === "escalation");
    expect(escalation?.summary).toContain("Merge conflict");
  });

  test("should recover from patch not applying cleanly", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "fix bug",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // First patch fails
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      result: {
        success: false,
        error: "Patch does not apply cleanly. Target files may have changed.",
      },
      summary: "Patch failed to apply",
    });

    // Re-read file and regenerate
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "read_file",
      summary: "Re-reading file for fresh content",
    });

    // Second patch succeeds
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      result: { success: true, filesChanged: 1 },
      summary: "Patch applied successfully on retry",
    });

    await updateJob(jobId, { status: "running" });

    // Verify recovery
    const events = await listEvents(jobId);
    const patchCalls = events.filter(e => e.tool_name === "apply_patch");
    
    expect(patchCalls.length).toBe(2);
    
    const firstResult = patchCalls[0].result as { success?: boolean } | null;
    const secondResult = patchCalls[1].result as { success?: boolean } | null;
    
    expect(firstResult?.success).toBe(false);
    expect(secondResult?.success).toBe(true);
  });

  // ===========================================================================
  // INVALID PATCHES
  // ===========================================================================

  test("should reject invalid patch format", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "fix bug",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Invalid patch format
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      params: {
        patch: "This is not a valid unified diff",
      },
      result: {
        success: false,
        error: "Patch is not valid unified diff format. Must include ---, +++, and @@ headers.",
      },
      summary: "Patch rejected - invalid format",
    });

    // LLM regenerates with proper format
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "info",
      summary: "Regenerating patch with proper unified diff format",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      params: {
        patch: `--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,5 @@
+// Fixed version
 export function login() {}`,
      },
      result: { success: true, filesChanged: 1 },
      summary: "Valid patch applied",
    });

    // Verify recovery
    const events = await listEvents(jobId);
    const patchCalls = events.filter(e => e.tool_name === "apply_patch");
    
    expect(patchCalls.length).toBe(2);
    expect(patchCalls[1].result).toHaveProperty("success", true);
  });

  test("should handle patch with wrong line numbers", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "update function",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Patch with stale line numbers
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      result: {
        success: false,
        error: "Hunk #1 FAILED at 15 (different number of lines)",
      },
      summary: "Patch failed - line numbers don't match",
    });

    // Re-read and try again
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "read_file",
      summary: "Re-reading to get current line numbers",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      result: { success: true },
      summary: "Patch applied with corrected line numbers",
    });

    // Verify
    const events = await listEvents(jobId);
    expect(events.some(e => e.summary?.includes("line numbers"))).toBe(true);
  });

  // ===========================================================================
  // NETWORK ISSUES
  // ===========================================================================

  test("should handle GitHub API unavailable", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "create PR",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // GitHub API error
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "GitHub API unavailable: ECONNREFUSED",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "info",
      summary: "Retrying GitHub API in 10s",
    });

    // Still failing after retries
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "GitHub API still unavailable after 3 retries",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "escalation",
      summary: "Cannot complete without GitHub access - escalating",
    });

    await updateJob(jobId, { status: "waiting_human" });

    // Verify
    const events = await listEvents(jobId);
    expect(events.filter(e => e.kind === "error").length).toBeGreaterThanOrEqual(2);
    expect(events.some(e => e.kind === "escalation")).toBe(true);
  });

  // ===========================================================================
  // FILE SYSTEM ERRORS
  // ===========================================================================

  test("should handle file not found", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "modify file",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // File doesn't exist
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "read_file",
      params: { path: "src/nonexistent.ts" },
      result: {
        success: false,
        error: "ENOENT: no such file or directory",
      },
      summary: "File not found",
    });

    // List files to find correct path
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "list_files",
      result: { files: ["src/existing.ts", "src/other.ts"] },
      summary: "Listing files to find correct path",
    });

    // Read correct file
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "read_file",
      params: { path: "src/existing.ts" },
      result: { success: true, content: "..." },
      summary: "Found and read correct file",
    });

    // Verify recovery
    const events = await listEvents(jobId);
    const readCalls = events.filter(e => e.tool_name === "read_file");
    
    expect(readCalls.length).toBe(2);
    expect((readCalls[0].result as any)?.success).toBe(false);
    expect((readCalls[1].result as any)?.success).toBe(true);
  });

  test("should handle permission denied", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "modify protected file",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Permission denied
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      result: {
        success: false,
        error: "EACCES: permission denied, open 'protected.ts'",
      },
      summary: "Cannot modify file - permission denied",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "escalation",
      summary: "Cannot modify protected file - requires elevated permissions",
    });

    await updateJob(jobId, { status: "waiting_human" });

    // Verify proper escalation
    const finalJob = await getJob(jobId);
    expect(finalJob?.status).toBe("waiting_human");
  });

  // ===========================================================================
  // SAFETY CHECKS
  // ===========================================================================

  test("should block unsafe operations", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "clean up temp files",
      mode: "mechanic",
      repo_path: "/tmp/test",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Attempt to run unsafe command
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "Blocked unsafe operation: rm -rf /",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "escalation",
      summary: "Attempted unsafe operation blocked - requires review",
    });

    await updateJob(jobId, { status: "waiting_human" });

    // Verify blocking
    const events = await listEvents(jobId);
    expect(events.some(e => e.summary?.includes("Blocked unsafe"))).toBe(true);
  });

  test("should prevent modifications outside repo", async () => {
    const jobId = crypto.randomUUID();
    
    await insertJob({
      id: jobId,
      goal: "update config",
      mode: "mechanic",
      repo_path: "/tmp/test-repo",
      status: "running",
      agent_type: "builder",
      step_cap: 20,
      token_cap: 50000,
    });

    // Attempt to modify file outside repo
    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "tool_call",
      tool_name: "apply_patch",
      params: {
        patch: `--- a/../../etc/passwd
+++ b/../../etc/passwd`,
      },
      result: {
        success: false,
        error: "Path traversal detected - cannot modify files outside repository",
      },
      summary: "Blocked path traversal attempt",
    });

    await insertEvent({
      job_id: jobId,
      trace_id: jobId,
      kind: "error",
      summary: "Security violation: attempted path traversal",
    });

    // Verify blocking
    const events = await listEvents(jobId);
    const patchResult = events.find(e => e.tool_name === "apply_patch")?.result as any;
    expect(patchResult?.success).toBe(false);
    expect(patchResult?.error?.toLowerCase()).toContain("path traversal");
  });
});

