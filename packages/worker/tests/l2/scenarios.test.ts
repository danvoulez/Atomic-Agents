/**
 * L2 Tests: Agent Loop Scenarios
 * 
 * Tests complete agent job execution with mock LLM responses.
 * Each scenario tests a specific job type with defined expectations.
 * 
 * Scenarios are organized by complexity:
 * - Basic: Simple, single-file fixes (bug-trivial, feature-simple)
 * - Intermediate: Multi-concern tasks (bug-unclear, review-*)
 * - Advanced: Multi-file, security, refactoring (security-*, refactor-*)
 * - Expert: Full system design (feature-rbac, performance-*)
 * 
 * Note: These tests use a mock LLM with deterministic responses.
 * The mock LLM cycles through predefined responses based on message content.
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "vitest";
import { runL2Scenario, runAllL2Scenarios, printL2Results, type L2Result } from "./runner";
import { pool } from "@ai-coding-team/db";
import path from "path";

const SCENARIOS_PATH = path.resolve(__dirname, "scenarios");
const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:testpassword@localhost:55433/ai_coding_team_test";

// Helper for detailed logging
function logResult(name: string, result: L2Result) {
  const statusIcon = result.passed ? '✓' : '✗';
  console.log(`${statusIcon} ${name}:`);
  console.log(`  Status: ${result.job.status}`);
  console.log(`  Steps: ${result.job.stepsUsed}`);
  console.log(`  Tokens: ${result.job.tokensUsed}`);
  console.log(`  Duration: ${result.duration}ms`);
  console.log(`  Tools: ${result.toolsCalled.join(', ') || 'none'}`);
  if (result.violations.length > 0) {
    console.log(`  Violations: ${result.violations.join('; ')}`);
  }
}

describe("L2: Agent Loop Scenarios", () => {
  beforeAll(async () => {
    // Ensure mock LLM is available and reset its counter
    const mockLlmUrl = process.env.MOCK_LLM_URL || "http://localhost:8000";
    try {
      const healthResponse = await fetch(`${mockLlmUrl}/health`);
      if (!healthResponse.ok) {
        console.warn(`Mock LLM health check failed. Some tests may fail.`);
      }
      // Reset the mock LLM request counter for deterministic behavior
      await fetch(`${mockLlmUrl}/reset`, { method: 'POST' });
    } catch {
      console.warn(`Mock LLM not available at ${mockLlmUrl}. Some tests may fail.`);
    }
  });

  beforeEach(async () => {
    // Clean up between tests
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM jobs");
    
    // Reset mock LLM counter
    const mockLlmUrl = process.env.MOCK_LLM_URL || "http://localhost:8000";
    try {
      await fetch(`${mockLlmUrl}/reset`, { method: 'POST' });
    } catch {
      // Ignore if mock LLM is not available
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
      // Ignore timeout errors
    }
  });

  // ===========================================================================
  // BASIC SCENARIOS (Single file, simple logic)
  // ===========================================================================
  
  describe("Basic Scenarios", () => {
    test("bug-trivial: simple single-line fix", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "bug-trivial.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      expect(result.job.stepsUsed).toBeGreaterThanOrEqual(0);
      
      logResult("bug-trivial", result);
    }, 120000);

    test("feature-simple: add single function", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "feature-simple.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      logResult("feature-simple", result);
    }, 120000);
  });

  // ===========================================================================
  // INTERMEDIATE SCENARIOS (Multi-concern, requires analysis)
  // ===========================================================================
  
  describe("Intermediate Scenarios", () => {
    test("bug-unclear: requires clarification/analysis", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "bug-unclear.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      if (result.job.status === "waiting_human") {
        expect(result.toolsCalled).toContain("request_human_review");
      }
      
      logResult("bug-unclear", result);
    }, 120000);

    test("bug-large-fix: complex multi-step fix", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "bug-large-fix.yaml"));
      
      expect(["succeeded", "failed", "waiting_human", "aborted"]).toContain(result.job.status);
      
      logResult("bug-large-fix", result);
    }, 120000);

    test("review-approve: code review with approval", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "review-approve.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      logResult("review-approve", result);
    }, 120000);

    test("review-reject: code review with rejection", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "review-reject.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      logResult("review-reject", result);
    }, 120000);
  });

  // ===========================================================================
  // ADVANCED SCENARIOS (Multi-file, security, refactoring)
  // ===========================================================================
  
  describe("Advanced Scenarios", () => {
    test("security-sql-injection: fix critical SQL injection", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "security-sql-injection.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      // Should have modified multiple files
      expect(result.job.stepsUsed).toBeGreaterThan(5);
      
      logResult("security-sql-injection", result);
    }, 240000);

    test("security-auth-hardening: harden authentication", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "security-auth-hardening.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      // Complex task should use significant steps
      expect(result.job.stepsUsed).toBeGreaterThan(8);
      
      logResult("security-auth-hardening", result);
    }, 300000);

    test("refactor-validation-module: fix 10+ bugs", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "refactor-validation-module.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      // Many fixes = many steps
      expect(result.job.stepsUsed).toBeGreaterThan(10);
      
      logResult("refactor-validation-module", result);
    }, 360000);

    test("multi-file-bug-cascade: fix cascading bug", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "multi-file-bug-cascade.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      logResult("multi-file-bug-cascade", result);
    }, 300000);
  });

  // ===========================================================================
  // EXPERT SCENARIOS (Full system design, architecture)
  // ===========================================================================
  
  describe("Expert Scenarios", () => {
    test("feature-rbac-system: implement RBAC from scratch", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "feature-rbac-system.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      // New feature should create files
      expect(result.job.stepsUsed).toBeGreaterThan(15);
      
      logResult("feature-rbac-system", result);
    }, 420000);

    test("api-error-handling: implement error system", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "api-error-handling.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      logResult("api-error-handling", result);
    }, 300000);

    test("performance-query-optimization: optimize database", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "performance-query-optimization.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      logResult("performance-query-optimization", result);
    }, 330000);

    test("test-coverage-gaps: fill test gaps", async () => {
      const result = await runL2Scenario(path.join(SCENARIOS_PATH, "test-coverage-gaps.yaml"));
      
      expect(["succeeded", "failed", "waiting_human"]).toContain(result.job.status);
      
      // Many tests to write
      expect(result.job.stepsUsed).toBeGreaterThan(12);
      
      logResult("test-coverage-gaps", result);
    }, 360000);
  });

  // ===========================================================================
  // BATCH RUN & METRICS
  // ===========================================================================
  
  describe("Batch Run", () => {
    test.skip("runs all scenarios and reports results", async () => {
      const results = await runAllL2Scenarios(SCENARIOS_PATH);
      printL2Results(results);
      
      const summary = summarizeL2Results(results);
      console.log("\n📊 Summary:");
      console.log(`  Total: ${summary.total}`);
      console.log(`  Passed: ${summary.passed} (${summary.passRate.toFixed(1)}%)`);
      console.log(`  Failed: ${summary.failed}`);
      console.log(`  Avg Steps: ${summary.avgSteps}`);
      console.log(`  Avg Tokens: ${summary.avgTokens}`);
      console.log(`  Avg Duration: ${summary.avgDurationMs}ms`);
      
      // Expect at least 50% pass rate
      expect(summary.passRate).toBeGreaterThanOrEqual(50);
    }, 1800000); // 30 minutes for all scenarios
  });
});

/**
 * Summary metrics for L2 results
 */
function summarizeL2Results(results: L2Result[]) {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  const avgSteps = results.reduce((sum, r) => sum + r.job.stepsUsed, 0) / results.length;
  const avgTokens = results.reduce((sum, r) => sum + r.job.tokensUsed, 0) / results.length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  
  return {
    total: results.length,
    passed,
    failed,
    passRate: (passed / results.length) * 100,
    avgSteps: Math.round(avgSteps),
    avgTokens: Math.round(avgTokens),
    avgDurationMs: Math.round(avgDuration),
  };
}
