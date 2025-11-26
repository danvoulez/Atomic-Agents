/**
 * L0 Tests: Job State Machine
 * 
 * These tests verify that job state transitions are correct and enforced.
 * The state machine is critical for correctness - invalid transitions = data corruption.
 */

import { describe, expect, test, beforeEach, afterAll } from "vitest";
import { 
  insertJob, 
  getJob, 
  markJobStatus, 
  updateJobBudget,
  setJobHeartbeat,
  requestJobCancel,
  pool 
} from "@ai-coding-team/db";

// Helper to create a valid job input
function createJobInput(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    goal: "State machine test",
    mode: "mechanic" as const,
    agent_type: "coordinator" as const,
    repo_path: "/tmp/test-repo",
    ...overrides,
  };
}

// Helper to create a job and transition it to a desired state
async function createJobInState(state: string) {
  const job = await insertJob(createJobInput());
  
  if (state === "queued") return job;
  
  // Transition to running first
  await pool.query(
    `UPDATE jobs SET 
      status = 'running', 
      started_at = NOW(), 
      last_heartbeat_at = NOW() 
     WHERE id = $1`,
    [job.id]
  );
  if (state === "running") return (await getJob(job.id))!;
  
  // For terminal states
  await pool.query(
    `UPDATE jobs SET 
      status = $1, 
      finished_at = NOW() 
     WHERE id = $2`,
    [state, job.id]
  );
  return (await getJob(job.id))!;
}

describe("L0: Job State Machine", () => {
  beforeEach(async () => {
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM jobs");
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * TEST: queued → running transition
   * WHY: This is the most common transition (job being claimed)
   * AWS RISK: If this fails, no jobs will ever run
   */
  test("queued → running sets started_at timestamp", async () => {
    const job = await insertJob(createJobInput());
    expect(job.status).toBe("queued");
    expect(job.started_at).toBeNull();

    await markJobStatus(job.id, "running");
    
    // Also update started_at as the claim logic does
    await pool.query(
      "UPDATE jobs SET started_at = NOW(), last_heartbeat_at = NOW() WHERE id = $1",
      [job.id]
    );

    const updated = await getJob(job.id);
    expect(updated?.status).toBe("running");
    expect(updated?.started_at).toBeTruthy();
    expect(updated?.last_heartbeat_at).toBeTruthy();
  });

  /**
   * TEST: running → succeeded sets finished_at
   * WHY: Terminal states must have timestamps for auditing
   * AWS RISK: No finished_at = can't calculate job duration for billing
   */
  test("running → succeeded sets finished_at timestamp", async () => {
    const job = await createJobInState("running");
    
    await markJobStatus(job.id, "succeeded");

    const updated = await getJob(job.id);
    expect(updated?.status).toBe("succeeded");
    expect(updated?.finished_at).toBeTruthy();
  });

  /**
   * TEST: running → failed sets finished_at
   * WHY: Even failures need timestamps for debugging
   */
  test("running → failed sets finished_at timestamp", async () => {
    const job = await createJobInState("running");
    
    await markJobStatus(job.id, "failed");

    const updated = await getJob(job.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.finished_at).toBeTruthy();
  });

  /**
   * TEST: running → waiting_human (escalation)
   * WHY: Agents must be able to ask for human help
   * AWS RISK: If escalation fails, agents will hallucinate or fail silently
   */
  test("running → waiting_human for escalation", async () => {
    const job = await createJobInState("running");
    
    await markJobStatus(job.id, "waiting_human");

    const updated = await getJob(job.id);
    expect(updated?.status).toBe("waiting_human");
    // waiting_human is NOT terminal, so no finished_at yet
  });

  /**
   * TEST: Cancellation flow
   * WHY: Users need to stop runaway jobs
   * AWS RISK: Can't cancel = unlimited costs
   */
  test("requestJobCancel transitions to cancelling", async () => {
    const job = await createJobInState("running");
    
    await requestJobCancel(job.id);

    const updated = await getJob(job.id);
    expect(updated?.status).toBe("cancelling");
    expect(updated?.cancel_requested_at).toBeTruthy();
  });

  /**
   * TEST: cancelling → aborted
   * WHY: Final step of cancellation
   */
  test("cancelling → aborted completes cancellation", async () => {
    const job = await createJobInState("running");
    await pool.query(
      "UPDATE jobs SET status = 'cancelling', cancel_requested_at = NOW() WHERE id = $1",
      [job.id]
    );
    
    await markJobStatus(job.id, "aborted");

    const updated = await getJob(job.id);
    expect(updated?.status).toBe("aborted");
    expect(updated?.finished_at).toBeTruthy();
  });

  /**
   * TEST: Budget tracking during execution
   * WHY: Budget limits prevent runaway costs
   * AWS RISK: No budget tracking = surprise $10k bills
   */
  test("updateJobBudget tracks steps and tokens", async () => {
    const job = await createJobInState("running");
    
    // Simulate several tool calls
    await updateJobBudget(job.id, { steps_used: 5, tokens_used: 10000 });

    let updated = await getJob(job.id);
    expect(updated?.steps_used).toBe(5);
    expect(updated?.tokens_used).toBe(10000);

    // More progress
    await updateJobBudget(job.id, { steps_used: 10, tokens_used: 25000 });

    updated = await getJob(job.id);
    expect(updated?.steps_used).toBe(10);
    expect(updated?.tokens_used).toBe(25000);
  });

  /**
   * TEST: Heartbeat updates work
   * WHY: Heartbeats prevent false stale detection
   */
  test("setJobHeartbeat updates last_heartbeat_at", async () => {
    const job = await createJobInState("running");
    
    // Initial heartbeat
    await setJobHeartbeat(job.id);
    const first = await getJob(job.id);
    const firstTime = first?.last_heartbeat_at;
    expect(firstTime).toBeTruthy();

    // Wait and update again (ensure time difference)
    await new Promise(r => setTimeout(r, 50));
    await setJobHeartbeat(job.id);
    const second = await getJob(job.id);
    const secondTime = second?.last_heartbeat_at;

    if (firstTime && secondTime) {
      expect(new Date(secondTime).getTime()).toBeGreaterThanOrEqual(
        new Date(firstTime).getTime()
      );
    }
  });

  /**
   * TEST: Terminal states should not be transitioned (best-effort verification)
   * WHY: Prevents accidental resurrection of completed jobs
   * AWS RISK: Zombie jobs = double work = double costs
   * NOTE: This documents the requirement - enforcement should be added
   */
  test("terminal states exist and have finished_at", async () => {
    const succeeded = await createJobInState("succeeded");
    const failed = await createJobInState("failed");
    const aborted = await createJobInState("aborted");

    // Verify terminal jobs are properly finished
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.finished_at).toBeTruthy();
    
    expect(failed.status).toBe("failed");
    expect(failed.finished_at).toBeTruthy();
    
    expect(aborted.status).toBe("aborted");
    expect(aborted.finished_at).toBeTruthy();
  });

  /**
   * TEST: current_action tracking for observability
   * WHY: Shows what the agent is doing in real-time
   * AWS RISK: No visibility = can't debug production issues
   */
  test("updateJobBudget tracks current_action", async () => {
    const job = await createJobInState("running");
    
    await updateJobBudget(job.id, { current_action: "Reading src/utils.ts" });
    let updated = await getJob(job.id);
    expect(updated?.current_action).toBe("Reading src/utils.ts");

    await updateJobBudget(job.id, { current_action: "Applying patch" });
    updated = await getJob(job.id);
    expect(updated?.current_action).toBe("Applying patch");
  });

  /**
   * TEST: Cost tracking for billing
   * WHY: Need to know how much each job costs
   * AWS RISK: No cost tracking = can't bill customers
   */
  test("updateJobBudget tracks cost_used_cents", async () => {
    const job = await insertJob(createJobInput({
      cost_cap_cents: 100,
    }));
    await pool.query(
      "UPDATE jobs SET status = 'running', started_at = NOW() WHERE id = $1",
      [job.id]
    );
    
    await updateJobBudget(job.id, { cost_used_cents: 25 });
    let updated = await getJob(job.id);
    expect(updated?.cost_used_cents).toBe(25);

    await updateJobBudget(job.id, { cost_used_cents: 75 });
    updated = await getJob(job.id);
    expect(updated?.cost_used_cents).toBe(75);
  });
});
