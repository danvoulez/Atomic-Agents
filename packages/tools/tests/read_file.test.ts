import { describe, expect, test } from "vitest";
import path from "path";
import { readFileTool } from "../src/read/read_file";

const dummyCtx = {
  jobId: "job-1",
  traceId: "trace-1",
  repoPath: path.resolve(__dirname, "..", "..", ".."),
  mode: "mechanic" as const,
  budget: { stepsRemaining: 10, tokensRemaining: 10_000 },
  logEvent: async () => "evt-1"
};

describe("readFileTool", () => {
  test("reads an existing file", async () => {
    const result = await readFileTool.execute({ path: "README.md" }, dummyCtx);
    expect(result.success).toBe(true);
    expect(result.data?.content).toContain("AI Coding Team");
  });

  test("returns error for missing file", async () => {
    const result = await readFileTool.execute({ path: "no-such-file.txt" }, dummyCtx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("file_not_found");
  });
});
