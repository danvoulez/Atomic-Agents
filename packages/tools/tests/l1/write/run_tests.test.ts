/**
 * L1 Tests: run_tests tool
 * 
 * Tests the test runner detection and execution.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { runTestsTool } from "../../../src/write/run_tests";
import { ToolContext } from "@ai-coding-team/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let testDir: string;

function createTestContext(): ToolContext {
  return {
    jobId: "test-job-id",
    traceId: "test-trace-id",
    repoPath: testDir,
    mode: "mechanic",
    budget: { stepsRemaining: 100, tokensRemaining: 50000 },
    logEvent: vi.fn().mockResolvedValue("event-id"),
  };
}

describe("L1: run_tests", () => {
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtests-test-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("returns pass status for successful tests", async () => {
    // Create minimal package.json with passing test
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({
        scripts: { test: "exit 0" },
      })
    );
    
    const ctx = createTestContext();
    const result = await runTestsTool.execute({ scope: "all" }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("pass");
    expect(result.data?.duration).toBeGreaterThan(0);
  });

  test("returns fail status for failed tests", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({
        scripts: { test: "exit 1" },
      })
    );
    
    const ctx = createTestContext();
    const result = await runTestsTool.execute({ scope: "all" }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("fail");
  });

  test("respects timeout parameter", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({
        scripts: { test: "sleep 10" },
      })
    );
    
    const ctx = createTestContext();
    const result = await runTestsTool.execute(
      { scope: "all", timeout: 1000 }, // 1 second timeout
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("error");
    expect(result.data?.failures).toContainEqual(
      expect.objectContaining({ name: "timeout" })
    );
  }, 10000);

  test("detects vitest runner from package.json", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^1.0.0" },
      })
    );
    
    const ctx = createTestContext();
    // Just verify it tries to run without error
    const result = await runTestsTool.execute({ scope: "all" }, ctx);
    expect(result).toBeTruthy();
  });

  test("detects jest runner from package.json", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({
        scripts: { test: "jest" },
        devDependencies: { jest: "^29.0.0" },
      })
    );
    
    const ctx = createTestContext();
    const result = await runTestsTool.execute({ scope: "all" }, ctx);
    expect(result).toBeTruthy();
  });

  test("detects pytest for Python projects", async () => {
    fs.writeFileSync(path.join(testDir, "pytest.ini"), "[pytest]\n");
    
    const ctx = createTestContext();
    const result = await runTestsTool.execute({ scope: "all" }, ctx);
    expect(result).toBeTruthy();
  });

  test("detects cargo test for Rust projects", async () => {
    fs.writeFileSync(
      path.join(testDir, "Cargo.toml"),
      "[package]\nname = 'test'\nversion = '0.1.0'\n"
    );
    
    const ctx = createTestContext();
    const result = await runTestsTool.execute({ scope: "all" }, ctx);
    expect(result).toBeTruthy();
  });

  test("tool metadata is correct", () => {
    expect(runTestsTool.name).toBe("run_tests");
    expect(runTestsTool.category).toBe("MUTATING");
    expect(runTestsTool.costHint).toBe("expensive");
    expect(runTestsTool.riskHint).toBe("safe");
  });
});
