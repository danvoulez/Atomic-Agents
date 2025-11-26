/**
 * L0 Tests: Stale Job Cleanup
 * 
 * Stale job cleanup is the system's self-healing mechanism.
 * Without it, crashed workers leave the system in a broken state.
 */

import { describe, expect, test, beforeEach, afterAll } from "vitest";
import { 
  insertJob, 
  getJob, 
  requeueStaleJobs,
  pool,
} from "@ai-coding-team/db";

// Helper to create a valid job input
function createJobInput(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    goal: "Stale cleanup test",
    mode: "mechanic" as const,
    agent_type: "coordinator" as const,
    repo_path: "/tmp/test-repo",
    ...overrides,
  };
}

// Helper to make a job running with stale heartbeat
async function createStaleRunningJob(minutesAgo: number, mode: string = "mechanic") {
  const job = await insertJob(createJobInput({ mode: mode as "mechanic" | "genius" }));
  
  const staleTime = new Date(Date.now() - minutesAgo * 60_000);
  await pool.query(
    `UPDATE jobs SET 
      status = 'running',
      started_at = $1, 
      last_heartbeat_at = $1
     WHERE id = $2`,
    [staleTime.toISOString(), job.id]
  );
  
  return (await getJob(job.id))!;
}

// Helper to create job with recent heartbeat (not stale)
async function createRecentRunningJob() {
  const job = await insertJob(createJobInput());
  
  await pool.query(
    `UPDATE jobs SET 
      status = 'running',
      started_at = NOW(), 
      last_heartbeat_at = NOW()
     WHERE id = $1`,
    [job.id]
  );
  
  return (await getJob(job.id))!;
}

describe("L0: Stale Job Cleanup", () => {
  beforeEach(async () => {
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM jobs");
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * TEST: Configurable threshold
   * WHY: Different environments need different thresholds
   * AWS RISK: Wrong threshold = premature requeue or missed stale jobs
   */
  test("respects threshold parameter", async () => {
    // Job1: stale by 5 minutes
    const job1 = await createStaleRunningJob(5);
    // Job2: stale by only 30 seconds
    const job2 = await createStaleRunningJob(0.5);

    // Threshold of 1 minute = only job1 should be requeued
    const count = await requeueStaleJobs(60_000);

    expect(count).toBe(1);
    expect((await getJob(job1.id))?.status).toBe("queued");
    expect((await getJob(job2.id))?.status).toBe("running");
  });

  /**
   * TEST: Mode isolation
   * WHY: Different worker pools shouldn't affect each other's jobs
   * AWS RISK: Cross-contamination = unpredictable behavior
   */
  test("requeues jobs regardless of mode", async () => {
    const mechanic = await createStaleRunningJob(10, "mechanic");
    const genius = await createStaleRunningJob(10, "genius");

    const count = await requeueStaleJobs(1000);

    expect(count).toBe(2);
    expect((await getJob(mechanic.id))?.status).toBe("queued");
    expect((await getJob(genius.id))?.status).toBe("queued");
  });

  /**
   * TEST: Queue order preserved after requeue
   * WHY: FIFO fairness - requeued jobs shouldn't jump ahead
   * AWS RISK: Priority inversion = unfair processing
   */
  test("requeued jobs retain original created_at for FIFO", async () => {
    // Create jobs in order with distinct timestamps
    const job1 = await insertJob(createJobInput({ goal: "First" }));
    await new Promise(r => setTimeout(r, 100));
    const job2 = await insertJob(createJobInput({ goal: "Second" }));
    await new Promise(r => setTimeout(r, 100));
    const job3 = await insertJob(createJobInput({ goal: "Third" }));

    // Make job2 stale
    await pool.query(
      `UPDATE jobs SET 
        status = 'running',
        started_at = NOW() - INTERVAL '10 minutes', 
        last_heartbeat_at = NOW() - INTERVAL '10 minutes'
       WHERE id = $1`,
      [job2.id]
    );
    
    await requeueStaleJobs(1000);

    // Get jobs and verify FIFO order is preserved
    const j1 = await getJob(job1.id);
    const j2 = await getJob(job2.id);
    const j3 = await getJob(job3.id);

    expect(j1).toBeTruthy();
    expect(j2).toBeTruthy();
    expect(j3).toBeTruthy();

    // Verify original creation order is preserved
    expect(new Date(j1!.created_at).getTime()).toBeLessThan(
      new Date(j2!.created_at).getTime()
    );
    expect(new Date(j2!.created_at).getTime()).toBeLessThan(
      new Date(j3!.created_at).getTime()
    );
  });

  /**
   * TEST: Cleanup doesn't affect completed jobs
   * WHY: Terminal states are sacred - never touch them
   * AWS RISK: Resurrecting completed jobs = infinite loops
   */
  test("never touches succeeded, failed, or aborted jobs", async () => {
    // Create properly transitioned terminal jobs
    const succeededJob = await insertJob(createJobInput());
    await pool.query(
      `UPDATE jobs SET status = 'running', started_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [succeededJob.id]
    );
    await pool.query(
      `UPDATE jobs SET status = 'succeeded', finished_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [succeededJob.id]
    );
    
    const failedJob = await insertJob(createJobInput());
    await pool.query(
      `UPDATE jobs SET status = 'running', started_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [failedJob.id]
    );
    await pool.query(
      `UPDATE jobs SET status = 'failed', finished_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [failedJob.id]
    );
    
    const abortedJob = await insertJob(createJobInput());
    await pool.query(
      `UPDATE jobs SET status = 'running', started_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [abortedJob.id]
    );
    await pool.query(
      `UPDATE jobs SET status = 'aborted', finished_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [abortedJob.id]
    );

    // Even with old timestamps, these should not be touched
    const count = await requeueStaleJobs(1000);

    expect(count).toBe(0);
    expect((await getJob(succeededJob.id))?.status).toBe("succeeded");
    expect((await getJob(failedJob.id))?.status).toBe("failed");
    expect((await getJob(abortedJob.id))?.status).toBe("aborted");
  });

  /**
   * TEST: Cleanup is atomic
   * WHY: Concurrent cleanups shouldn't cause issues
   * AWS RISK: Race conditions = double-requeue = chaos
   */
  test("concurrent cleanup calls are safe", async () => {
    // Create several stale jobs
    const jobs = await Promise.all([
      createStaleRunningJob(10),
      createStaleRunningJob(10),
      createStaleRunningJob(10),
      createStaleRunningJob(10),
      createStaleRunningJob(10),
    ]);

    // Run multiple cleanups concurrently
    const results = await Promise.all([
      requeueStaleJobs(1000),
      requeueStaleJobs(1000),
      requeueStaleJobs(1000),
    ]);

    // Total should be 5 (each job requeued exactly once)
    const total = results.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(5);

    // All should be queued
    for (const job of jobs) {
      expect((await getJob(job.id))?.status).toBe("queued");
    }
  });

  /**
   * TEST: Zero stale jobs returns zero
   * WHY: Sanity check for edge cases
   */
  test("returns zero when no stale jobs exist", async () => {
    // Fresh running job (not stale)
    await createRecentRunningJob();

    const count = await requeueStaleJobs(60_000); // 1 minute threshold
    expect(count).toBe(0);
  });

  /**
   * TEST: Empty database returns zero
   * WHY: Sanity check for startup
   */
  test("handles empty job table", async () => {
    // Already cleaned by beforeEach
    const count = await requeueStaleJobs(1000);
    expect(count).toBe(0);
  });

  /**
   * TEST: Budget limits are preserved
   * WHY: Job should remember its limits after requeue
   * AWS RISK: Lost limits = runaway jobs = big bills
   */
  test("preserves step_cap and token_cap after requeue", async () => {
    const job = await insertJob(createJobInput({
      step_cap: 10,
      token_cap: 25000,
      cost_cap_cents: 50,
    }));
    
    // Make it stale
    await pool.query(
      `UPDATE jobs SET 
        status = 'running',
        started_at = NOW() - INTERVAL '10 minutes', 
        last_heartbeat_at = NOW() - INTERVAL '10 minutes'
       WHERE id = $1`,
      [job.id]
    );
    
    await requeueStaleJobs(1000);

    const requeued = await getJob(job.id);
    expect(requeued?.step_cap).toBe(10);
    expect(requeued?.token_cap).toBe(25000);
    expect(requeued?.cost_cap_cents).toBe(50);
  });

  /**
   * TEST: Conversation context preserved
   * WHY: Job should stay linked to its conversation
   * AWS RISK: Lost context = orphaned jobs in UI
   */
  test("preserves conversation_id after requeue", async () => {
    const conversationId = crypto.randomUUID();
    
    // Ensure conversation exists first
    await pool.query(
      "INSERT INTO conversations (id) VALUES ($1) ON CONFLICT DO NOTHING",
      [conversationId]
    );
    
    const job = await insertJob(createJobInput({
      conversation_id: conversationId,
    }));
    
    // Make it stale
    await pool.query(
      `UPDATE jobs SET 
        status = 'running',
        started_at = NOW() - INTERVAL '10 minutes', 
        last_heartbeat_at = NOW() - INTERVAL '10 minutes'
       WHERE id = $1`,
      [job.id]
    );
    
    await requeueStaleJobs(1000);

    const requeued = await getJob(job.id);
    expect(requeued?.conversation_id).toBe(conversationId);
  });
});
