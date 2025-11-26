/**
 * L1 Tests: find_files tool
 * 
 * Tests the glob-based file finder
 */

import { describe, expect, test } from "vitest";
import { findFilesTool } from "../../../src/tools/ide-tools";
import { ToolContext } from "@ai-coding-team/types";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.resolve(__dirname, "../../../../../testing/fixtures/repos");

function createTestContext(repoPath: string): ToolContext {
  return {
    jobId: "test-job-id",
    traceId: "test-trace-id",
    repoPath,
    mode: "mechanic",
    budget: { stepsRemaining: 100, tokensRemaining: 50000 },
    logEvent: async () => "event-id",
  };
}

describe("L1: find_files", () => {
  test("finds files by glob pattern", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await findFilesTool.execute(
      { pattern: "*.ts" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.files.length).toBeGreaterThan(0);
    expect(result.data?.files.every(f => f.extension === ".ts")).toBe(true);
  });

  test("finds test files", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await findFilesTool.execute(
      { pattern: "*.test.ts" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.files.length).toBeGreaterThan(0);
    expect(result.data?.files[0].name).toContain("test");
  });

  test("limits results to maxResults", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await findFilesTool.execute(
      { pattern: "*.*", maxResults: 2 },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.files.length).toBeLessThanOrEqual(2);
    expect(result.data?.totalMatches).toBeGreaterThanOrEqual(result.data?.files.length ?? 0);
  });

  test("searches in subdirectory", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await findFilesTool.execute(
      { pattern: "*.ts", directory: "src" },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.data?.files) {
      const allFromSrc = result.data.files.every(f => f.path.startsWith("src"));
      expect(allFromSrc).toBe(true);
    }
  });

  test("excludes node_modules", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await findFilesTool.execute(
      { pattern: "*.js" },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.data?.files) {
      const hasNodeModules = result.data.files.some(f => f.path.includes("node_modules"));
      expect(hasNodeModules).toBe(false);
    }
  });

  test("returns file metadata", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await findFilesTool.execute(
      { pattern: "*.ts" },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.data?.files && result.data.files.length > 0) {
      const file = result.data.files[0];
      expect(file).toHaveProperty("path");
      expect(file).toHaveProperty("name");
      expect(file).toHaveProperty("extension");
      expect(file).toHaveProperty("size");
      expect(file).toHaveProperty("modified");
    }
  });

  test("sorts by modification time", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await findFilesTool.execute(
      { pattern: "*.ts" },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.data?.files && result.data.files.length > 1) {
      const times = result.data.files.map(f => new Date(f.modified).getTime());
      const isSorted = times.every((t, i) => i === 0 || t <= times[i - 1]);
      expect(isSorted).toBe(true);
    }
  });

  test("handles no matches", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await findFilesTool.execute(
      { pattern: "*.nonexistent" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.files.length).toBe(0);
    expect(result.data?.totalMatches).toBe(0);
  });
});

