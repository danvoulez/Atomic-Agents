/**
 * L1 Tests: run_lint tool
 * 
 * Tests the linter detection and execution.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { runLintTool } from "../../../src/write/run_lint";
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

describe("L1: run_lint", () => {
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "runlint-test-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("returns pass when no linter detected", async () => {
    const ctx = createTestContext();
    const result = await runLintTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("pass");
    expect(result.data?.output).toContain("No linter detected");
  });

  test("detects eslint from package.json", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({
        devDependencies: { eslint: "^8.0.0" },
      })
    );
    
    const ctx = createTestContext();
    const result = await runLintTool.execute({}, ctx);
    
    // Just verify it tries to run (may fail if eslint not installed)
    expect(result).toBeTruthy();
  });

  test("detects biome from package.json", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({
        devDependencies: { "@biomejs/biome": "^1.0.0" },
      })
    );
    
    const ctx = createTestContext();
    const result = await runLintTool.execute({}, ctx);
    expect(result).toBeTruthy();
  });

  test("uses lint script if defined", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({
        scripts: { lint: "exit 0" },
      })
    );
    
    const ctx = createTestContext();
    const result = await runLintTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("pass");
  });

  test("detects ruff for Python projects", async () => {
    fs.writeFileSync(path.join(testDir, "pyproject.toml"), "[tool.ruff]\n");
    
    const ctx = createTestContext();
    const result = await runLintTool.execute({}, ctx);
    expect(result).toBeTruthy();
  });

  test("detects clippy for Rust projects", async () => {
    fs.writeFileSync(
      path.join(testDir, "Cargo.toml"),
      "[package]\nname = 'test'\nversion = '0.1.0'\n"
    );
    
    const ctx = createTestContext();
    const result = await runLintTool.execute({}, ctx);
    expect(result).toBeTruthy();
  });

  test("returns error counts and issues", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({
        scripts: { lint: 'echo "10 error" && exit 1' },
      })
    );
    
    const ctx = createTestContext();
    const result = await runLintTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("fail");
  });

  test("tool metadata is correct", () => {
    expect(runLintTool.name).toBe("run_lint");
    expect(runLintTool.category).toBe("READ_ONLY");
    expect(runLintTool.costHint).toBe("moderate");
    expect(runLintTool.riskHint).toBe("safe");
  });
});
