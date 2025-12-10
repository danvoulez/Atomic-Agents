#!/usr/bin/env npx tsx
/**
 * Postgres Queue Stress Test
 *
 * This script validates that the FOR UPDATE SKIP LOCKED pattern works correctly
 * under high concurrency. It:
 * 1. Inserts N jobs into the database
 * 2. Spawns M worker processes
 * 3. Waits for all jobs to complete
 * 4. Validates no jobs were processed twice
 *
 * Usage:
 *   npx tsx scripts/stress-queue.ts [--jobs=1000] [--workers=20]
 */

import { spawn, ChildProcess } from "child_process";
import { pool, query } from "@ai-coding-team/db";

// Configuration
const DEFAULT_JOB_COUNT = 1000;
const DEFAULT_WORKER_COUNT = 20;
const TIMEOUT_MS = 300000; // 5 minutes

interface StressTestConfig {
  jobCount: number;
  workerCount: number;
}

function parseArgs(): StressTestConfig {
  const args = process.argv.slice(2);
  let jobCount = DEFAULT_JOB_COUNT;
  let workerCount = DEFAULT_WORKER_COUNT;

  for (const arg of args) {
    const [key, value] = arg.split("=");
    if (key === "--jobs" && value) {
      jobCount = parseInt(value, 10);
    } else if (key === "--workers" && value) {
      workerCount = parseInt(value, 10);
    }
  }

  return { jobCount, workerCount };
}

async function cleanupTestJobs(): Promise<void> {
  console.log("Cleaning up existing test jobs...");
  await query(
    "DELETE FROM jobs WHERE goal LIKE 'STRESS_TEST_%'"
  );
}

async function insertTestJobs(count: number): Promise<string[]> {
  console.log(`Inserting ${count} test jobs...`);
  const ids: string[] = [];

  // Batch insert for efficiency
  const batchSize = 100;
  for (let i = 0; i < count; i += batchSize) {
    const batch = Math.min(batchSize, count - i);
    const values: string[] = [];
    const params: (string | number)[] = [];

    for (let j = 0; j < batch; j++) {
      const idx = i + j;
      const id = crypto.randomUUID();
      ids.push(id);
      const paramStart = j * 4;
      values.push(`($${paramStart + 1}, $${paramStart + 2}, $${paramStart + 3}, $${paramStart + 4})`);
      params.push(id, `STRESS_TEST_${idx}`, "mechanic", "queued");
    }

    await query(
      `INSERT INTO jobs (id, goal, mode, status) VALUES ${values.join(", ")}`,
      params
    );
  }

  console.log(`Inserted ${ids.length} jobs`);
  return ids;
}

function spawnWorker(workerId: number): ChildProcess {
  const proc = spawn("node", ["packages/worker/dist/index.js"], {
    env: {
      ...process.env,
      WORKER_ID: `stress-${workerId}`,
      // Use mock LLM for stress testing
      USE_MOCK_LLM: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (data) => {
    const line = data.toString().trim();
    if (line.includes("Job completed") || line.includes("error")) {
      console.log(`[Worker ${workerId}] ${line}`);
    }
  });

  proc.stderr?.on("data", (data) => {
    console.error(`[Worker ${workerId} ERR] ${data.toString().trim()}`);
  });

  return proc;
}

async function waitForCompletion(
  jobIds: string[],
  timeoutMs: number
): Promise<{ succeeded: number; failed: number; pending: number }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count
       FROM jobs
       WHERE id = ANY($1)
       GROUP BY status`,
      [jobIds]
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count, 10);
    }

    const succeeded = counts["succeeded"] || 0;
    const failed = counts["failed"] || 0;
    const aborted = counts["aborted"] || 0;
    const total = succeeded + failed + aborted;

    console.log(`Progress: ${total}/${jobIds.length} complete (${succeeded} succeeded, ${failed} failed)`);

    if (total === jobIds.length) {
      return {
        succeeded,
        failed: failed + aborted,
        pending: 0,
      };
    }

    await sleep(2000);
  }

  // Timeout - get final counts
  const result = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) as count
     FROM jobs
     WHERE id = ANY($1)
     GROUP BY status`,
    [jobIds]
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.status] = parseInt(row.count, 10);
  }

  return {
    succeeded: counts["succeeded"] || 0,
    failed: (counts["failed"] || 0) + (counts["aborted"] || 0),
    pending: (counts["queued"] || 0) + (counts["running"] || 0),
  };
}

async function validateNoDuplicateProcessing(jobIds: string[]): Promise<boolean> {
  // Check if any job was processed more than once by looking at events
  const result = await query<{ job_id: string; event_count: string }>(
    `SELECT job_id, COUNT(*) as event_count
     FROM events
     WHERE job_id = ANY($1) AND kind = 'info' AND summary LIKE 'Agent%starting%'
     GROUP BY job_id
     HAVING COUNT(*) > 1`,
    [jobIds]
  );

  if (result.rows.length > 0) {
    console.error("RACE CONDITION DETECTED!");
    console.error("The following jobs were processed multiple times:");
    for (const row of result.rows) {
      console.error(`  Job ${row.job_id}: processed ${row.event_count} times`);
    }
    return false;
  }

  return true;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = parseArgs();
  console.log("=".repeat(60));
  console.log("POSTGRES QUEUE STRESS TEST");
  console.log("=".repeat(60));
  console.log(`Configuration:`);
  console.log(`  Jobs: ${config.jobCount}`);
  console.log(`  Workers: ${config.workerCount}`);
  console.log(`  Timeout: ${TIMEOUT_MS}ms`);
  console.log("=".repeat(60));

  try {
    // Cleanup
    await cleanupTestJobs();

    // Insert jobs
    const jobIds = await insertTestJobs(config.jobCount);

    // Spawn workers
    console.log(`\nSpawning ${config.workerCount} workers...`);
    const workers: ChildProcess[] = [];
    for (let i = 0; i < config.workerCount; i++) {
      workers.push(spawnWorker(i));
    }

    // Wait for completion
    console.log("\nWaiting for jobs to complete...\n");
    const results = await waitForCompletion(jobIds, TIMEOUT_MS);

    // Kill workers
    console.log("\nStopping workers...");
    for (const worker of workers) {
      worker.kill("SIGTERM");
    }

    // Validate no duplicates
    console.log("\nValidating no duplicate processing...");
    const noDuplicates = await validateNoDuplicateProcessing(jobIds);

    // Final report
    console.log("\n" + "=".repeat(60));
    console.log("RESULTS");
    console.log("=".repeat(60));
    console.log(`Total Jobs:      ${config.jobCount}`);
    console.log(`Succeeded:       ${results.succeeded}`);
    console.log(`Failed:          ${results.failed}`);
    console.log(`Pending:         ${results.pending}`);
    console.log(`No Duplicates:   ${noDuplicates ? "PASS" : "FAIL"}`);

    // Success criteria
    const success =
      results.succeeded === config.jobCount &&
      results.pending === 0 &&
      noDuplicates;

    console.log("=".repeat(60));
    console.log(`OVERALL: ${success ? "PASS ✓" : "FAIL ✗"}`);
    console.log("=".repeat(60));

    // Cleanup
    await cleanupTestJobs();
    await pool.end();

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error("Stress test failed with error:", error);
    await pool.end();
    process.exit(1);
  }
}

main();
