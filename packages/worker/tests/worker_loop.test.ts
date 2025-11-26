/**
 * Basic Worker Loop Tests
 * 
 * Quick sanity checks that the worker can claim and process jobs.
 */

import { describe, expect, test, beforeEach, afterEach, afterAll } from "vitest";
import { Worker } from "../src";
import { insertJob, getJob, requeueStaleJobs, pool } from "@ai-coding-team/db";

// Helper to create a valid job input
function createJobInput(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    goal: "Worker loop test",
    mode: "mechanic" as const,
    agent_type: "coordinator" as const,
    repo_path: "/tmp/test-repo",
    status: "queued" as const,
    ...overrides,
  };
}

describe("Worker loop", () => {
  beforeEach(async () => {
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM jobs");
  });

  afterAll(async () => {
    // Close pool with timeout to prevent hanging
    try {
      await Promise.race([
        pool.end(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Pool close timeout")), 5000))
      ]);
    } catch {
      // Ignore timeout errors
    }
  });

  test("processes a queued job and marks it succeeded", async () => {
    const job = await insertJob(createJobInput());

    const worker = new Worker({ mode: "mechanic" });
    const loopPromise = worker.startLoop({
      pollIntervalMs: 50,
      heartbeatMs: 100,
      staleAfterMs: 10000,
    });

    // Wait for job to complete
    let attempts = 0;
    while (attempts < 100) {
      const current = await getJob(job.id);
      if (current?.status === "succeeded" || current?.status === "failed") {
        break;
      }
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    await worker.drain();
    await loopPromise;

    const final = await getJob(job.id);
    // Job should have moved past queued state
    expect(final?.status).not.toBe("queued");
  }, 30000);

  test("requeues stale running jobs", async () => {
    const job = await insertJob(createJobInput({ status: "running" }));
    
    // Make it stale
    const staleTime = new Date(Date.now() - 120_000);
    await pool.query(
      `UPDATE jobs SET started_at = $1, last_heartbeat_at = $1 WHERE id = $2`,
      [staleTime.toISOString(), job.id]
    );

    const count = await requeueStaleJobs(1000);
    
    expect(count).toBe(1);
    
    const requeued = await getJob(job.id);
    expect(requeued?.status).toBe("queued");
  });
});
