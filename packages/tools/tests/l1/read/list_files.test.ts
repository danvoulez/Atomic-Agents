/**
 * L1 Tests: list_files tool
 * 
 * Tests directory listing functionality.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { listFilesTool } from "../../../src/read/list_files";
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

describe("L1: list_files", () => {
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "listfiles-test-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("lists files in root directory", async () => {
    fs.writeFileSync(path.join(testDir, "file1.ts"), "");
    fs.writeFileSync(path.join(testDir, "file2.ts"), "");
    
    const ctx = createTestContext();
    const result = await listFilesTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.files.length).toBe(2);
    expect(result.data?.files.some(f => f.path === "file1.ts")).toBe(true);
    expect(result.data?.files.some(f => f.path === "file2.ts")).toBe(true);
  });

  test("distinguishes files and directories", async () => {
    fs.writeFileSync(path.join(testDir, "file.ts"), "");
    fs.mkdirSync(path.join(testDir, "subdir"));
    
    const ctx = createTestContext();
    const result = await listFilesTool.execute({}, ctx);

    expect(result.success).toBe(true);
    const file = result.data?.files.find(f => f.path === "file.ts");
    const dir = result.data?.files.find(f => f.path === "subdir");
    
    expect(file?.type).toBe("file");
    expect(dir?.type).toBe("directory");
  });

  test("lists subdirectory contents", async () => {
    fs.mkdirSync(path.join(testDir, "subdir"));
    fs.writeFileSync(path.join(testDir, "subdir/nested.ts"), "");
    
    const ctx = createTestContext();
    const result = await listFilesTool.execute({ path: "subdir" }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.files.some(f => f.path === "nested.ts")).toBe(true);
  });

  test("returns path_not_found for missing path", async () => {
    const ctx = createTestContext();
    const result = await listFilesTool.execute({ path: "nonexistent" }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("path_not_found");
  });

  test("returns not_a_directory for file path", async () => {
    fs.writeFileSync(path.join(testDir, "file.ts"), "");
    
    const ctx = createTestContext();
    const result = await listFilesTool.execute({ path: "file.ts" }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("not_a_directory");
  });

  test("recursive listing includes nested files", async () => {
    fs.mkdirSync(path.join(testDir, "a/b/c"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "a/b/c/deep.ts"), "");
    
    const ctx = createTestContext();
    const result = await listFilesTool.execute({ recursive: true }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.files.some(f => f.path.includes("deep.ts"))).toBe(true);
  });

  test("filters by pattern", async () => {
    fs.writeFileSync(path.join(testDir, "test.ts"), "");
    fs.writeFileSync(path.join(testDir, "test.py"), "");
    fs.writeFileSync(path.join(testDir, "readme.md"), "");
    
    const ctx = createTestContext();
    const result = await listFilesTool.execute({ pattern: "*.ts" }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.files.every(f => f.path.endsWith(".ts"))).toBe(true);
  });

  test("includes file sizes", async () => {
    fs.writeFileSync(path.join(testDir, "withsize.txt"), "hello world");
    
    const ctx = createTestContext();
    const result = await listFilesTool.execute({}, ctx);

    expect(result.success).toBe(true);
    const file = result.data?.files.find(f => f.path === "withsize.txt");
    expect(file?.size).toBeGreaterThan(0);
  });

  test("skips hidden files", async () => {
    fs.writeFileSync(path.join(testDir, ".hidden"), "");
    fs.writeFileSync(path.join(testDir, "visible.ts"), "");
    
    const ctx = createTestContext();
    const result = await listFilesTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.files.some(f => f.path === ".hidden")).toBe(false);
    expect(result.data?.files.some(f => f.path === "visible.ts")).toBe(true);
  });

  test("tool metadata is correct", () => {
    expect(listFilesTool.name).toBe("list_files");
    expect(listFilesTool.category).toBe("READ_ONLY");
    expect(listFilesTool.costHint).toBe("cheap");
    expect(listFilesTool.riskHint).toBe("safe");
  });
});
