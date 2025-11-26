/**
 * L4 Chaos Testing Runner
 * 
 * Implements chaos engineering patterns for testing system resilience:
 * - Random worker kills
 * - Database pauses
 * - Network latency injection
 * - LLM timeout simulation
 * - State corruption
 */

import { execSync } from "child_process";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    "postgres://postgres:testpassword@localhost:55434/ai_coding_team_l3",
});

interface ChaosAction {
  name: string;
  probability: number;
  execute: () => Promise<void>;
  recover: () => Promise<void>;
  duration: number; // ms
}

interface ChaosConfig {
  enabled: boolean;
  intervalMs: number;
  maxConcurrentActions: number;
  actions: ChaosAction[];
}

const chaosActions: ChaosAction[] = [
  {
    name: "kill_random_worker",
    probability: 0.1,
    duration: 5000,
    async execute() {
      console.log("[CHAOS] Killing random worker...");
      try {
        // Get list of worker containers
        const containers = execSync(
          'docker ps --filter "name=worker" --format "{{.Names}}"',
          { encoding: "utf-8" }
        ).trim().split("\n").filter(Boolean);

        if (containers.length > 1) {
          const target = containers[Math.floor(Math.random() * containers.length)];
          execSync(`docker kill ${target}`, { stdio: "ignore" });
          console.log(`[CHAOS] Killed worker: ${target}`);
        }
      } catch (error) {
        console.warn("[CHAOS] Failed to kill worker:", error);
      }
    },
    async recover() {
      console.log("[CHAOS] Restarting workers...");
      try {
        execSync("docker compose -f docker-compose.l3.yml up -d worker-mechanic worker-genius", {
          stdio: "ignore",
        });
      } catch {
        // Ignore recovery errors
      }
    },
  },

  {
    name: "pause_database",
    probability: 0.05,
    duration: 3000,
    async execute() {
      console.log("[CHAOS] Pausing database...");
      try {
        execSync("docker pause ai-coding-team-l3-postgres", { stdio: "ignore" });
      } catch (error) {
        console.warn("[CHAOS] Failed to pause database:", error);
      }
    },
    async recover() {
      console.log("[CHAOS] Unpausing database...");
      try {
        execSync("docker unpause ai-coding-team-l3-postgres", { stdio: "ignore" });
      } catch {
        // Ignore
      }
    },
  },

  {
    name: "inject_network_latency",
    probability: 0.1,
    duration: 10000,
    async execute() {
      console.log("[CHAOS] Injecting network latency...");
      try {
        // Add latency to mock-llm container
        execSync(
          'docker exec ai-coding-team-l3-mock-llm sh -c "tc qdisc add dev eth0 root netem delay 500ms" || true',
          { stdio: "ignore" }
        );
      } catch (error) {
        console.warn("[CHAOS] Failed to inject latency:", error);
      }
    },
    async recover() {
      console.log("[CHAOS] Removing network latency...");
      try {
        execSync(
          'docker exec ai-coding-team-l3-mock-llm sh -c "tc qdisc del dev eth0 root" || true',
          { stdio: "ignore" }
        );
      } catch {
        // Ignore
      }
    },
  },

  {
    name: "simulate_llm_timeout",
    probability: 0.15,
    duration: 15000,
    async execute() {
      console.log("[CHAOS] Simulating LLM timeout...");
      try {
        // Set mock LLM to return slow responses
        await fetch("http://localhost:8000/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ delay: 30000 }), // 30 second delay
        });
      } catch (error) {
        console.warn("[CHAOS] Failed to configure LLM timeout:", error);
      }
    },
    async recover() {
      console.log("[CHAOS] Resetting LLM timeout...");
      try {
        await fetch("http://localhost:8000/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ delay: 0 }),
        });
        await fetch("http://localhost:8000/reset", { method: "POST" });
      } catch {
        // Ignore
      }
    },
  },

  {
    name: "corrupt_job_state",
    probability: 0.05,
    duration: 5000,
    async execute() {
      console.log("[CHAOS] Corrupting job state...");
      try {
        // Set random running job to invalid state
        await pool.query(`
          UPDATE jobs 
          SET status = 'invalid_state_test'
          WHERE status = 'running'
          AND id = (SELECT id FROM jobs WHERE status = 'running' LIMIT 1)
        `);
      } catch (error) {
        console.warn("[CHAOS] Failed to corrupt job state:", error);
      }
    },
    async recover() {
      console.log("[CHAOS] Recovering corrupted jobs...");
      try {
        // Reset invalid jobs to queued
        await pool.query(`
          UPDATE jobs 
          SET status = 'queued'
          WHERE status = 'invalid_state_test'
        `);
      } catch {
        // Ignore
      }
    },
  },

  {
    name: "exhaust_connections",
    probability: 0.03,
    duration: 5000,
    async execute() {
      console.log("[CHAOS] Exhausting database connections...");
      // This is intentionally light - just logs the intent
      // Real implementation would open many connections
    },
    async recover() {
      console.log("[CHAOS] Releasing connections...");
    },
  },

  {
    name: "fill_disk",
    probability: 0.02,
    duration: 3000,
    async execute() {
      console.log("[CHAOS] Simulating disk pressure...");
      // Creates a large temp file
      try {
        execSync(
          'docker exec ai-coding-team-l3-postgres sh -c "dd if=/dev/zero of=/tmp/chaos.dat bs=1M count=100" || true',
          { stdio: "ignore" }
        );
      } catch {
        // Ignore
      }
    },
    async recover() {
      console.log("[CHAOS] Cleaning up disk...");
      try {
        execSync(
          'docker exec ai-coding-team-l3-postgres sh -c "rm -f /tmp/chaos.dat" || true',
          { stdio: "ignore" }
        );
      } catch {
        // Ignore
      }
    },
  },
];

class ChaosRunner {
  private config: ChaosConfig;
  private activeActions: Set<string> = new Set();
  private running = false;

  constructor(config: Partial<ChaosConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      intervalMs: config.intervalMs ?? 10000, // Check every 10 seconds
      maxConcurrentActions: config.maxConcurrentActions ?? 2,
      actions: config.actions ?? chaosActions,
    };
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log("[CHAOS] Chaos testing disabled");
      return;
    }

    console.log("[CHAOS] Starting chaos runner...");
    console.log(`[CHAOS] Interval: ${this.config.intervalMs}ms`);
    console.log(`[CHAOS] Max concurrent: ${this.config.maxConcurrentActions}`);
    console.log(`[CHAOS] Actions: ${this.config.actions.map(a => a.name).join(", ")}`);

    this.running = true;

    while (this.running) {
      await this.tick();
      await new Promise(r => setTimeout(r, this.config.intervalMs));
    }
  }

  stop(): void {
    console.log("[CHAOS] Stopping chaos runner...");
    this.running = false;
  }

  private async tick(): Promise<void> {
    if (this.activeActions.size >= this.config.maxConcurrentActions) {
      return;
    }

    for (const action of this.config.actions) {
      if (this.activeActions.has(action.name)) continue;
      if (Math.random() > action.probability) continue;

      // Execute chaos action
      this.activeActions.add(action.name);

      try {
        await action.execute();

        // Schedule recovery
        setTimeout(async () => {
          await action.recover();
          this.activeActions.delete(action.name);
        }, action.duration);
      } catch (error) {
        console.error(`[CHAOS] Action ${action.name} failed:`, error);
        this.activeActions.delete(action.name);
      }

      // Only trigger one action per tick
      break;
    }
  }
}

// Verification functions
export async function verifySystemRecovery(): Promise<{
  passed: boolean;
  checks: { name: string; passed: boolean; details: string }[];
}> {
  const checks: { name: string; passed: boolean; details: string }[] = [];

  // Check database connectivity
  try {
    await pool.query("SELECT 1");
    checks.push({ name: "database_connectivity", passed: true, details: "OK" });
  } catch (error) {
    checks.push({
      name: "database_connectivity",
      passed: false,
      details: String(error),
    });
  }

  // Check no zombie jobs
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM jobs 
      WHERE status = 'running' 
      AND last_heartbeat_at < NOW() - INTERVAL '5 minutes'
    `);
    const zombieCount = parseInt(result.rows[0].count);
    checks.push({
      name: "no_zombie_jobs",
      passed: zombieCount === 0,
      details: `${zombieCount} zombie jobs found`,
    });
  } catch (error) {
    checks.push({
      name: "no_zombie_jobs",
      passed: false,
      details: String(error),
    });
  }

  // Check workers are running
  try {
    const output = execSync(
      'docker ps --filter "name=worker" --format "{{.Status}}"',
      { encoding: "utf-8" }
    );
    const runningWorkers = output.trim().split("\n").filter(s => s.includes("Up")).length;
    checks.push({
      name: "workers_running",
      passed: runningWorkers >= 2,
      details: `${runningWorkers} workers running`,
    });
  } catch (error) {
    checks.push({
      name: "workers_running",
      passed: false,
      details: String(error),
    });
  }

  // Check mock LLM is responding
  try {
    const response = await fetch("http://localhost:8000/health");
    checks.push({
      name: "mock_llm_healthy",
      passed: response.ok,
      details: response.ok ? "OK" : `Status: ${response.status}`,
    });
  } catch (error) {
    checks.push({
      name: "mock_llm_healthy",
      passed: false,
      details: String(error),
    });
  }

  return {
    passed: checks.every(c => c.passed),
    checks,
  };
}

// Main entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const duration = parseInt(args[0]) || 60000; // Default 1 minute

  console.log(`\n${"=".repeat(60)}`);
  console.log("L4 CHAOS TESTING");
  console.log(`${"=".repeat(60)}\n`);
  console.log(`Duration: ${duration}ms`);

  const runner = new ChaosRunner();

  // Stop after duration
  setTimeout(() => {
    runner.stop();
  }, duration);

  await runner.start();

  // Wait for any active chaos to complete
  console.log("\n[CHAOS] Waiting for recovery...");
  await new Promise(r => setTimeout(r, 15000));

  // Verify system recovered
  console.log("[CHAOS] Verifying system recovery...");
  const verification = await verifySystemRecovery();

  console.log(`\n${"=".repeat(60)}`);
  console.log("CHAOS TEST RESULTS");
  console.log(`${"=".repeat(60)}\n`);

  for (const check of verification.checks) {
    const status = check.passed ? "✓" : "✗";
    console.log(`${status} ${check.name}: ${check.details}`);
  }

  console.log(`\nOverall: ${verification.passed ? "PASSED" : "FAILED"}`);

  await pool.end();
  process.exit(verification.passed ? 0 : 1);
}

main().catch(console.error);

export { ChaosRunner, chaosActions };

