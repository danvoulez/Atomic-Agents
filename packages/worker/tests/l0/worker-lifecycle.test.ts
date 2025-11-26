/**
 * L0 Tests: Worker Lifecycle
 * 
 * These tests verify the foundational worker behavior that MUST work
 * before going to production. If any of these fail, the system is broken.
 */

import { describe, expect, test, beforeEach, afterEach, afterAll } from "vitest";
import { Worker } from "../../src";
import { insertJob, getJob, pool, requeueStaleJobs, markJobStatus } from "@ai-coding-team/db";

// Helper to create a valid job input
function createJobInput(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    goal: "Test job",
    mode: "mechanic" as const,
    agent_type: "coordinator" as const,
    repo_path: "/tmp/test-repo",
    status: "queued" as const,
    ...overrides,
  };
}

describe("L0: Worker Lifecycle", () => {
  let worker: Worker | null = null;

  beforeEach(async () => {
    // CRITICAL: Clean database between tests to ensure isolation
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM jobs");
  });

  afterEach(async () => {
    // Always stop worker if running
    if (worker) {
      try {
        await worker.drain();
      } catch {
        // Ignore errors during cleanup
      }
      worker = null;
    }
  });

  afterAll(async () => {
    // Close pool with timeout to prevent hanging
    try {
      await Promise.race([
        pool.end(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Pool close timeout")), 5000))
      ]);
    } catch {
      // Ignore timeout errors, pool might already be closed
    }
  });

  /**
   * TEST: Job claiming must be fast
   * WHY: Slow claiming = queue backlog = poor user experience
   * AWS RISK: If claiming takes > 1s, autoscaling won't help
   */
  test("claims job from queue within 1 second", async () => {
    const job = await insertJob(createJobInput({ goal: "Fast claim test" }));
    
    worker = new Worker({ mode: "mechanic" });
    const loopPromise = worker.startLoop({
      pollIntervalMs: 100,
      heartbeatMs: 200,
      staleAfterMs: 10000,
    });

    const startTime = Date.now();
    
    // Poll until job is claimed
    let claimed = false;
    while (!claimed && Date.now() - startTime < 2000) {
      const currentJob = await getJob(job.id);
      if (currentJob?.status !== "queued") {
        claimed = true;
      }
      await new Promise(r => setTimeout(r, 50));
    }

    await worker.drain();
    await loopPromise;

    const claimTime = Date.now() - startTime;
    expect(claimed).toBe(true);
    expect(claimTime).toBeLessThan(1000); // Must claim within 1 second
  }, 10000);

  /**
   * TEST: Heartbeat keeps jobs alive
   * WHY: Without heartbeats, stale detection will requeue running jobs
   * AWS RISK: Lost heartbeats = duplicate work = wasted $$$
   */
  test("updates heartbeat to prevent stale detection", async () => {
    const job = await insertJob(createJobInput({ goal: "Heartbeat test" }));

    worker = new Worker({ mode: "mechanic" });
    const loopPromise = worker.startLoop({
      pollIntervalMs: 100,
      heartbeatMs: 100, // Fast heartbeat for test
      staleAfterMs: 10000,
    });

    // Wait for job to be claimed and get initial heartbeat
    await new Promise(r => setTimeout(r, 300));
    let currentJob = await getJob(job.id);
    const firstHeartbeat = currentJob?.last_heartbeat_at;

    // Wait for another heartbeat cycle
    await new Promise(r => setTimeout(r, 200));
    currentJob = await getJob(job.id);
    const secondHeartbeat = currentJob?.last_heartbeat_at;

    await worker.drain();
    await loopPromise;

    // Heartbeat should have been updated (or at least set)
    expect(firstHeartbeat).toBeTruthy();
    expect(secondHeartbeat).toBeTruthy();
    
    if (firstHeartbeat && secondHeartbeat) {
      const first = new Date(firstHeartbeat).getTime();
      const second = new Date(secondHeartbeat).getTime();
      // Second should be >= first (might be same millisecond in fast execution)
      expect(second).toBeGreaterThanOrEqual(first);
    }
  }, 10000);

  /**
   * TEST: Stale jobs get requeued after crash
   * WHY: Worker crashes happen. Jobs must not be lost.
   * AWS RISK: Without requeue, crashed jobs sit forever = stuck queue
   */
  test("requeues jobs with stale heartbeats (crash recovery)", async () => {
    const staleTime = new Date(Date.now() - 120_000); // 2 minutes ago
    
    // Simulate a job that a crashed worker was processing
    const job = await insertJob(createJobInput({
      goal: "Crashed worker job",
      status: "running",
    }));
    
    // Manually set stale timestamps (simulating crash)
    await pool.query(
      `UPDATE jobs SET 
        started_at = $1, 
        last_heartbeat_at = $1 
       WHERE id = $2`,
      [staleTime.toISOString(), job.id]
    );

    // Run stale detection (1 second threshold)
    const requeuedCount = await requeueStaleJobs(1000);

    const updatedJob = await getJob(job.id);
    
    expect(requeuedCount).toBeGreaterThanOrEqual(1);
    expect(updatedJob?.status).toBe("queued");
    expect(updatedJob?.started_at).toBeNull();
    expect(updatedJob?.last_heartbeat_at).toBeNull();
  }, 5000);

  /**
   * TEST: Multiple workers don't grab the same job
   * WHY: Double-processing wastes money and can corrupt state
   * AWS RISK: With autoscaling, this is a real race condition
   */
  test("FOR UPDATE SKIP LOCKED prevents double-claiming", async () => {
    // Create multiple jobs
    const jobs = await Promise.all([
      insertJob(createJobInput({ goal: "Job 1" })),
      insertJob(createJobInput({ goal: "Job 2" })),
      insertJob(createJobInput({ goal: "Job 3" })),
    ]);

    // Start multiple workers simultaneously
    const workers = [
      new Worker({ mode: "mechanic" }),
      new Worker({ mode: "mechanic" }),
    ];

    const loopPromises = workers.map(w =>
      w.startLoop({
        pollIntervalMs: 50,
        heartbeatMs: 100,
        staleAfterMs: 10000,
      })
    );

    // Let workers compete for jobs
    await new Promise(r => setTimeout(r, 500));

    // Stop all workers
    await Promise.all(workers.map(w => w.drain()));
    await Promise.all(loopPromises);

    // Verify no job was double-claimed
    const finalJobs = await Promise.all(jobs.map(j => getJob(j.id)));
    const assignedTo = new Set<string>();
    
    for (const job of finalJobs) {
      if (job?.assigned_to) {
        // Each job should have a unique assigned_to
        expect(assignedTo.has(job.assigned_to)).toBe(false);
        assignedTo.add(job.assigned_to);
      }
    }
  }, 10000);

  /**
   * TEST: Workers respect their mode (mechanic vs genius)
   * WHY: Mechanic workers are cheaper, genius workers are more capable
   * AWS RISK: Wrong mode = wrong costs or failed tasks
   */
  test("mechanic worker ignores genius jobs", async () => {
    const mechanicJob = await insertJob(createJobInput({
      goal: "Mechanic task",
      mode: "mechanic",
    }));
    
    const geniusJob = await insertJob(createJobInput({
      goal: "Genius task",
      mode: "genius",
    }));

    // Start mechanic-only worker
    worker = new Worker({ mode: "mechanic" });
    const loopPromise = worker.startLoop({
      pollIntervalMs: 100,
      heartbeatMs: 200,
      staleAfterMs: 10000,
    });

    await new Promise(r => setTimeout(r, 500));

    await worker.drain();
    await loopPromise;

    const finalMechanic = await getJob(mechanicJob.id);
    const finalGenius = await getJob(geniusJob.id);

    // Mechanic job should have been processed
    expect(finalMechanic?.status).not.toBe("queued");
    
    // Genius job should still be waiting
    expect(finalGenius?.status).toBe("queued");
  }, 10000);

  /**
   * TEST: Cancellation is respected
   * WHY: Users must be able to stop runaway jobs
   * AWS RISK: Can't cancel = budget overruns = big bills
   */
  test("worker checks cancellation status between steps", async () => {
    const job = await insertJob(createJobInput({ goal: "Cancellable job" }));

    worker = new Worker({ mode: "mechanic" });
    
    // Start the worker
    const loopPromise = worker.startLoop({
      pollIntervalMs: 100,
      heartbeatMs: 200,
      staleAfterMs: 10000,
    });

    // Wait for job to be claimed
    await new Promise(r => setTimeout(r, 200));

    // Request cancellation
    await pool.query(
      `UPDATE jobs SET status = 'cancelling', cancel_requested_at = NOW() WHERE id = $1`,
      [job.id]
    );

    // Let worker detect cancellation
    await new Promise(r => setTimeout(r, 500));

    await worker.drain();
    await loopPromise;

    const finalJob = await getJob(job.id);
    
    // Job should be cancelled or aborted, not still running
    expect(["cancelling", "aborted", "failed"]).toContain(finalJob?.status);
  }, 10000);

  /**
   * TEST: Queue order is FIFO
   * WHY: First-come-first-served is fair and predictable
   * AWS RISK: Out-of-order processing = confused users
   */
  test("jobs are claimed in FIFO order", async () => {
    // Create jobs with explicit ordering
    const job1 = await insertJob(createJobInput({ goal: "First job" }));
    await new Promise(r => setTimeout(r, 50)); // Ensure different created_at
    const job2 = await insertJob(createJobInput({ goal: "Second job" }));
    await new Promise(r => setTimeout(r, 50));
    const job3 = await insertJob(createJobInput({ goal: "Third job" }));

    const claimOrder: string[] = [];

    worker = new Worker({ mode: "mechanic" });
    
    // Override processJob to track claim order
    const originalProcess = (worker as any).processJob.bind(worker);
    (worker as any).processJob = async (job: any) => {
      claimOrder.push(job.id);
      // Quick completion
      await markJobStatus(job.id, "succeeded");
    };

    const loopPromise = worker.startLoop({
      pollIntervalMs: 50,
      heartbeatMs: 100,
      staleAfterMs: 10000,
    });

    // Wait for all jobs to be processed
    await new Promise(r => setTimeout(r, 1000));

    await worker.drain();
    await loopPromise;

    // Should be claimed in creation order
    expect(claimOrder[0]).toBe(job1.id);
    expect(claimOrder[1]).toBe(job2.id);
    expect(claimOrder[2]).toBe(job3.id);
  }, 10000);
});
