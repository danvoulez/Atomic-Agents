/**
 * L1 Tests: read_file tool
 * 
 * Tests file reading functionality.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { readFileTool } from "../../../src/read/read_file";
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

describe("L1: read_file", () => {
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "readfile-test-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("reads entire file with line numbers", async () => {
    fs.writeFileSync(path.join(testDir, "test.txt"), "line1\nline2\nline3");
    
    const ctx = createTestContext();
    const result = await readFileTool.execute({ path: "test.txt" }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.content).toContain("line1");
    expect(result.data?.content).toContain("line2");
    expect(result.data?.content).toContain("line3");
    expect(result.data?.totalLines).toBe(3);
  });

  test("reads specific line range", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join("\n");
    fs.writeFileSync(path.join(testDir, "long.txt"), lines);
    
    const ctx = createTestContext();
    const result = await readFileTool.execute(
      { path: "long.txt", startLine: 10, endLine: 20 },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.content).toContain("Line 10");
    expect(result.data?.content).toContain("Line 20");
    expect(result.data?.startLine).toBe(10);
  });

  test("returns file_not_found for missing file", async () => {
    const ctx = createTestContext();
    const result = await readFileTool.execute({ path: "nonexistent.txt" }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("file_not_found");
    expect(result.error?.recoverable).toBe(false);
  });

  test("returns is_directory for directories", async () => {
    fs.mkdirSync(path.join(testDir, "subdir"));
    
    const ctx = createTestContext();
    const result = await readFileTool.execute({ path: "subdir" }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("is_directory");
  });

  test("handles empty files", async () => {
    fs.writeFileSync(path.join(testDir, "empty.txt"), "");
    
    const ctx = createTestContext();
    const result = await readFileTool.execute({ path: "empty.txt" }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.totalLines).toBe(1);  // Empty file has 1 line
  });

  test("includes line numbers in output", async () => {
    fs.writeFileSync(path.join(testDir, "numbered.txt"), "a\nb\nc");
    
    const ctx = createTestContext();
    const result = await readFileTool.execute({ path: "numbered.txt" }, ctx);

    expect(result.success).toBe(true);
    // Line numbers are padded and followed by |
    expect(result.data?.content).toMatch(/\d+\| a/);
    expect(result.data?.content).toMatch(/\d+\| b/);
  });

  test("tool metadata is correct", () => {
    expect(readFileTool.name).toBe("read_file");
    expect(readFileTool.category).toBe("READ_ONLY");
    expect(readFileTool.costHint).toBe("cheap");
    expect(readFileTool.riskHint).toBe("safe");
  });
});
