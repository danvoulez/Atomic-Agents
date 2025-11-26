/**
 * L1 Tests: record_analysis tool
 * 
 * Tests analysis recording functionality.
 */

import { describe, expect, test, vi } from "vitest";
import { recordAnalysisTool } from "../../../src/meta/record_analysis";
import { ToolContext } from "@ai-coding-team/types";

function createTestContext(): ToolContext {
  return {
    jobId: "test-job-id",
    traceId: "test-trace-id",
    repoPath: "/tmp/test",
    mode: "mechanic",
    budget: { stepsRemaining: 100, tokensRemaining: 50000 },
    logEvent: vi.fn().mockResolvedValue("event-id"),
  };
}

describe("L1: record_analysis", () => {
  test("records complete analysis", async () => {
    const ctx = createTestContext();
    const result = await recordAnalysisTool.execute(
      {
        rootCause: "Wrong operator in calculation",
        affectedFiles: ["src/math.ts"],
        complexity: "trivial",
        risk: "low",
        evidence: ["x + y should be x * y"],
        confidence: 0.95,
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.recorded).toBe(true);
    expect(result.data?.analysisId).toBeTruthy();
  });

  test("logs analysis as event", async () => {
    const ctx = createTestContext();
    await recordAnalysisTool.execute(
      {
        affectedFiles: ["src/file.ts"],
        complexity: "simple",
        risk: "medium",
        evidence: ["Found the bug"],
        confidence: 0.8,
      },
      ctx
    );

    expect(ctx.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "analysis",
        summary: expect.stringContaining("simple complexity"),
      })
    );
  });

  test("includes all fields in event result", async () => {
    const ctx = createTestContext();
    const analysis = {
      rootCause: "Memory leak",
      scope: "User service",
      affectedFiles: ["src/user.ts", "src/db.ts"],
      complexity: "complex" as const,
      risk: "high" as const,
      evidence: ["Growing heap", "Unclosed connections"],
      confidence: 0.7,
      dependencies: ["must fix db first"],
      alternatives: ["restart service periodically"],
    };

    await recordAnalysisTool.execute(analysis, ctx);

    expect(ctx.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          rootCause: "Memory leak",
          affectedFiles: ["src/user.ts", "src/db.ts"],
          complexity: "complex",
          risk: "high",
        }),
      })
    );
  });

  test("returns unique analysisId each time", async () => {
    const ctx = createTestContext();
    
    const result1 = await recordAnalysisTool.execute(
      {
        affectedFiles: ["a.ts"],
        complexity: "trivial",
        risk: "low",
        evidence: ["test"],
        confidence: 0.9,
      },
      ctx
    );
    
    const result2 = await recordAnalysisTool.execute(
      {
        affectedFiles: ["b.ts"],
        complexity: "trivial",
        risk: "low",
        evidence: ["test"],
        confidence: 0.9,
      },
      ctx
    );

    expect(result1.data?.analysisId).not.toBe(result2.data?.analysisId);
  });

  test("handles multiple affected files", async () => {
    const ctx = createTestContext();
    const files = ["src/a.ts", "src/b.ts", "src/c.ts", "lib/d.ts"];
    
    await recordAnalysisTool.execute(
      {
        affectedFiles: files,
        complexity: "moderate",
        risk: "medium",
        evidence: ["Multiple files affected"],
        confidence: 0.85,
      },
      ctx
    );

    expect(ctx.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining("4 files affected"),
      })
    );
  });

  test("tool metadata is correct", () => {
    expect(recordAnalysisTool.name).toBe("record_analysis");
    expect(recordAnalysisTool.category).toBe("META");
    expect(recordAnalysisTool.costHint).toBe("cheap");
    expect(recordAnalysisTool.riskHint).toBe("safe");
  });
});
