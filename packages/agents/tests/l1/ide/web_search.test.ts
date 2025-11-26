/**
 * L1 Tests: web_search tool
 * 
 * Tests the web search tool for finding documentation and solutions
 */

import { describe, expect, test } from "vitest";
import { webSearchTool } from "../../../src/tools/ide-tools";
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

describe("L1: web_search", () => {
  test("searches for documentation", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await webSearchTool.execute(
      { query: "TypeScript async await" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.results).toBeTruthy();
    expect(result.data?.query).toBe("TypeScript async await");
  });

  test("limits results to maxResults", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await webSearchTool.execute(
      { query: "JavaScript array methods", maxResults: 3 },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.results.length).toBeLessThanOrEqual(3);
  });

  test("filters by site", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await webSearchTool.execute(
      { query: "map reduce filter", site: "developer.mozilla.org" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.query).toContain("site:developer.mozilla.org");
  });

  test("returns structured results", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await webSearchTool.execute(
      { query: "Node.js file system" },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.data?.results && result.data.results.length > 0) {
      const item = result.data.results[0];
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("url");
      expect(item).toHaveProperty("snippet");
      expect(item).toHaveProperty("source");
    }
  });

  test("handles no results gracefully", async () => {
    const ctx = createTestContext(path.join(FIXTURES_PATH, "simple-ts"));
    const result = await webSearchTool.execute(
      { query: "xyzabc123nonexistentquery" },
      ctx
    );

    expect(result.success).toBe(true);
    // Should have at least a fallback result
    expect(result.data?.results.length).toBeGreaterThan(0);
  });
});

