/**
 * L0 Tests: Crash Recovery
 * 
 * These tests verify the system can recover from worker crashes.
 * Critical for production - workers WILL crash, and jobs must survive.
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
    goal: "Crash recovery test",
    mode: "mechanic" as const,
    agent_type: "coordinator" as const,
    repo_path: "/tmp/test-repo",
    ...overrides,
  };
}

// Helper to create a job and transition it to running state
async function createRunningJob(staleMinutesAgo?: number) {
  const job = await insertJob(createJobInput());
  
  if (staleMinutesAgo !== undefined) {
    const staleTime = new Date(Date.now() - staleMinutesAgo * 60_000);
    await pool.query(
      `UPDATE jobs SET 
        status = 'running',
        started_at = $1, 
        last_heartbeat_at = $1,
        assigned_to = 'test-worker'
       WHERE id = $2`,
      [staleTime.toISOString(), job.id]
    );
  } else {
    await pool.query(
      `UPDATE jobs SET 
        status = 'running',
        started_at = NOW(), 
        last_heartbeat_at = NOW(),
        assigned_to = 'test-worker'
       WHERE id = $1`,
      [job.id]
    );
  }
  
  return (await getJob(job.id))!;
}

describe("L0: Crash Recovery", () => {
  beforeEach(async () => {
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM jobs");
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * TEST: Stale job detection works
   * WHY: Crashed workers leave jobs in "running" with old heartbeats
   * AWS RISK: Stale jobs block queue capacity = autoscaling doesn't help
   */
  test("detects jobs with stale heartbeats", async () => {
    // Create a job that's been running for 5 minutes (stale)
    const job = await createRunningJob(5);
    
    expect(job.status).toBe("running");

    // Detect stale (1 second threshold)
    const count = await requeueStaleJobs(1000);

    expect(count).toBe(1);
    
    const updated = await getJob(job.id);
    expect(updated?.status).toBe("queued");
    expect(updated?.started_at).toBeNull();
    expect(updated?.last_heartbeat_at).toBeNull();
    expect(updated?.assigned_to).toBeNull();
  });

  /**
   * TEST: Recent heartbeats prevent requeue
   * WHY: Don't requeue jobs that are actually running
   * AWS RISK: Premature requeue = duplicate work = double costs
   */
  test("does not requeue jobs with recent heartbeats", async () => {
    // Create a job that's running (recent heartbeat)
    const job = await createRunningJob(); // No stale time = NOW()
    
    expect(job.status).toBe("running");

    // Try to requeue with 1 hour threshold (job is recent, not stale)
    const count = await requeueStaleJobs(3600_000);

    expect(count).toBe(0);
    
    const updated = await getJob(job.id);
    expect(updated?.status).toBe("running");
    expect(updated?.assigned_to).toBe("test-worker");
  });

  /**
   * TEST: Batch requeue works
   * WHY: A crashed server might leave multiple jobs stale
   * AWS RISK: Slow requeue = prolonged outage
   */
  test("requeues multiple stale jobs in one call", async () => {
    // Create multiple stale jobs
    const jobs = await Promise.all([
      createRunningJob(10),
      createRunningJob(10),
      createRunningJob(10),
    ]);

    const count = await requeueStaleJobs(1000);

    expect(count).toBe(3);
    
    for (const job of jobs) {
      const updated = await getJob(job.id);
      expect(updated?.status).toBe("queued");
    }
  });

  /**
   * TEST: Only running jobs get requeued
   * WHY: Don't touch jobs in other states
   * AWS RISK: Requeuing completed jobs = infinite loops
   */
  test("only requeues running jobs, not other states", async () => {
    // Create jobs in different states
    const staleRunning = await createRunningJob(10);
    
    const queued = await insertJob(createJobInput());
    
    // Create completed jobs via proper state transitions
    const succeededJob = await insertJob(createJobInput());
    await pool.query(
      `UPDATE jobs SET status = 'running', started_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [succeededJob.id]
    );
    await pool.query(
      `UPDATE jobs SET status = 'succeeded', finished_at = NOW() WHERE id = $1`,
      [succeededJob.id]
    );
    
    const failedJob = await insertJob(createJobInput());
    await pool.query(
      `UPDATE jobs SET status = 'running', started_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [failedJob.id]
    );
    await pool.query(
      `UPDATE jobs SET status = 'failed', finished_at = NOW() WHERE id = $1`,
      [failedJob.id]
    );

    const count = await requeueStaleJobs(1000);

    // Only the stale running job should be requeued
    expect(count).toBe(1);
    
    // Check each state
    expect((await getJob(staleRunning.id))?.status).toBe("queued");
    expect((await getJob(queued.id))?.status).toBe("queued");
    expect((await getJob(succeededJob.id))?.status).toBe("succeeded");
    expect((await getJob(failedJob.id))?.status).toBe("failed");
  });

  /**
   * TEST: Cancelling jobs don't get requeued
   * WHY: User explicitly requested cancellation
   * AWS RISK: Requeue cancelling = user can't stop runaway jobs
   */
  test("does not requeue jobs that are cancelling", async () => {
    const job = await insertJob(createJobInput());
    
    // Transition to cancelling
    await pool.query(
      `UPDATE jobs SET 
        status = 'cancelling',
        started_at = NOW() - INTERVAL '5 minutes',
        last_heartbeat_at = NOW() - INTERVAL '5 minutes',
        cancel_requested_at = NOW()
       WHERE id = $1`,
      [job.id]
    );

    const count = await requeueStaleJobs(1000);

    expect(count).toBe(0);
    expect((await getJob(job.id))?.status).toBe("cancelling");
  });

  /**
   * TEST: Requeued job can be picked up again
   * WHY: Requeue is useless if jobs can't be reclaimed
   * AWS RISK: Broken requeue = jobs stuck forever
   */
  test("requeued job is ready for claiming", async () => {
    const job = await createRunningJob(10); // Stale

    // Requeue
    await requeueStaleJobs(1000);

    // Verify it's in correct state for claiming
    const requeued = await getJob(job.id);
    expect(requeued?.status).toBe("queued");
    expect(requeued?.assigned_to).toBeNull();
    expect(requeued?.started_at).toBeNull();
    expect(requeued?.last_heartbeat_at).toBeNull();
  });

  /**
   * TEST: Job progress is preserved across crashes
   * WHY: Don't lose work already done
   * AWS RISK: Lost progress = repeated API calls = more costs
   */
  test("preserves steps_used and tokens_used after requeue", async () => {
    const job = await insertJob(createJobInput());
    
    // Set as running with progress
    await pool.query(
      `UPDATE jobs SET 
        status = 'running',
        started_at = NOW() - INTERVAL '10 minutes',
        last_heartbeat_at = NOW() - INTERVAL '10 minutes',
        steps_used = 5,
        tokens_used = 15000
       WHERE id = $1`,
      [job.id]
    );

    await requeueStaleJobs(1000);

    const requeued = await getJob(job.id);
    expect(requeued?.status).toBe("queued");
    // Progress should be preserved
    expect(requeued?.steps_used).toBe(5);
    expect(requeued?.tokens_used).toBe(15000);
  });

  /**
   * TEST: Null heartbeat treated as stale
   * WHY: Job might have crashed before first heartbeat
   * AWS RISK: Jobs stuck in running with null heartbeat = ghost jobs
   */
  test("treats null heartbeat as stale for running jobs", async () => {
    const job = await insertJob(createJobInput());
    
    // Simulate claimed but never got heartbeat (crashed immediately)
    await pool.query(
      `UPDATE jobs SET 
        status = 'running',
        started_at = NOW() - INTERVAL '1 hour',
        last_heartbeat_at = NULL
       WHERE id = $1`,
      [job.id]
    );

    const count = await requeueStaleJobs(1000);

    expect(count).toBe(1);
    expect((await getJob(job.id))?.status).toBe("queued");
  });
});
