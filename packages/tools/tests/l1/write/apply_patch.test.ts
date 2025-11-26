/**
 * L1 Tests: apply_patch tool
 * 
 * Tests patch application with git apply.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { applyPatchTool } from "../../../src/write/apply_patch";
import { ToolContext } from "@ai-coding-team/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

let testDir: string;

function createTestContext(mode: "mechanic" | "genius" = "mechanic"): ToolContext {
  return {
    jobId: "test-job-id",
    traceId: "test-trace-id",
    repoPath: testDir,
    mode,
    budget: { stepsRemaining: 100, tokensRemaining: 50000 },
    logEvent: vi.fn().mockResolvedValue("event-id"),
  };
}

function initGitRepo() {
  execSync("git init", { cwd: testDir });
  execSync("git config user.email 'test@test.com'", { cwd: testDir });
  execSync("git config user.name 'Test'", { cwd: testDir });
}

describe("L1: apply_patch", () => {
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "applypatch-test-"));
    initGitRepo();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("applies valid unified diff", async () => {
    // Create initial file
    fs.writeFileSync(path.join(testDir, "test.txt"), "line1\nline2\nline3\n");
    execSync("git add .", { cwd: testDir });
    execSync("git commit -m 'initial'", { cwd: testDir });

    const patch = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line1
-line2
+line2 modified
 line3
`;

    const ctx = createTestContext();
    const result = await applyPatchTool.execute(
      { patch, description: "Modify line2" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.applied).toBe(true);
    expect(result.data?.filesChanged).toBe(1);
    expect(result.data?.files).toContain("test.txt");
  });

  test("rejects malformed diff", async () => {
    const ctx = createTestContext();
    const result = await applyPatchTool.execute(
      { patch: "not a valid patch", description: "Bad patch" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("invalid_patch");
  });

  test("enforces mechanic mode file limit", async () => {
    const ctx = createTestContext("mechanic");
    
    // Create patch touching 6 files (limit is 5)
    const patch = Array.from({ length: 6 }, (_, i) => `
--- a/file${i}.txt
+++ b/file${i}.txt
@@ -0,0 +1 @@
+new content
`).join("\n");

    const result = await applyPatchTool.execute(
      { patch, description: "Too many files" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("too_many_files");
  });

  test("enforces mechanic mode line limit", async () => {
    const ctx = createTestContext("mechanic");
    
    // Create patch with 201 lines (limit is 200)
    const additions = Array.from({ length: 210 }, (_, i) => `+line ${i}`).join("\n");
    const patch = `--- a/big.txt
+++ b/big.txt
@@ -0,0 +1,210 @@
${additions}
`;

    const result = await applyPatchTool.execute(
      { patch, description: "Too many lines" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("too_many_lines");
  });

  test("genius mode has no file/line limits", async () => {
    fs.writeFileSync(path.join(testDir, "test.txt"), "initial\n");
    execSync("git add .", { cwd: testDir });
    execSync("git commit -m 'initial'", { cwd: testDir });

    const ctx = createTestContext("genius");
    
    // Create large patch that would fail in mechanic mode
    const additions = Array.from({ length: 250 }, (_, i) => `+line ${i}`).join("\n");
    const patch = `--- a/test.txt
+++ b/test.txt
@@ -1 +1,251 @@
 initial
${additions}
`;

    const result = await applyPatchTool.execute(
      { patch, description: "Large change in genius mode" },
      ctx
    );

    // Should not fail due to line limits (may fail if patch doesn't apply)
    if (!result.success) {
      expect(result.error?.code).not.toBe("too_many_lines");
    }
  });

  test("returns patch statistics", async () => {
    fs.writeFileSync(path.join(testDir, "stats.txt"), "line1\nline2\nline3\n");
    execSync("git add .", { cwd: testDir });
    execSync("git commit -m 'initial'", { cwd: testDir });

    const patch = `--- a/stats.txt
+++ b/stats.txt
@@ -1,3 +1,4 @@
 line1
-line2
+line2 modified
+new line
 line3
`;

    const ctx = createTestContext();
    const result = await applyPatchTool.execute(
      { patch, description: "Stats test" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.linesAdded).toBe(2);
    expect(result.data?.linesRemoved).toBe(1);
  });

  test("tool metadata is correct", () => {
    expect(applyPatchTool.name).toBe("apply_patch");
    expect(applyPatchTool.category).toBe("MUTATING");
    expect(applyPatchTool.costHint).toBe("moderate");
    expect(applyPatchTool.riskHint).toBe("reversible");
  });
});
