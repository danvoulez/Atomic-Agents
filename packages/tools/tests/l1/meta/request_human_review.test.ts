/**
 * L1 Tests: request_human_review tool
 * 
 * Tests the escalation mechanism for when agents need human help.
 */

import { describe, expect, test, vi } from "vitest";
import { requestHumanReviewTool } from "../../../src/meta/request_human_review";
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

describe("L1: request_human_review", () => {
  test("creates escalation with reason and context", async () => {
    const ctx = createTestContext();
    const result = await requestHumanReviewTool.execute(
      {
        reason: "Cannot determine which of 3 implementations is correct",
        context: "Found multiple conflicting implementations in legacy code",
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.escalated).toBe(true);
    expect(result.data?.escalationId).toBeTruthy();
  });

  test("logs escalation event with full details", async () => {
    const ctx = createTestContext();
    await requestHumanReviewTool.execute(
      {
        reason: "Need human judgment",
        context: "Multiple valid approaches exist",
        options: ["Option A", "Option B"],
      },
      ctx
    );

    expect(ctx.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "escalation",
        summary: expect.stringContaining("Need human judgment"),
      })
    );
  });

  test("includes options in result", async () => {
    const ctx = createTestContext();
    const options = ["Keep old implementation", "Use new pattern", "Hybrid approach"];
    
    await requestHumanReviewTool.execute(
      {
        reason: "Design decision needed",
        context: "Refactoring database access layer",
        options,
      },
      ctx
    );

    expect(ctx.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          options,
        }),
      })
    );
  });

  test("includes blockedOn information", async () => {
    const ctx = createTestContext();
    
    await requestHumanReviewTool.execute(
      {
        reason: "Missing requirements",
        context: "Cannot proceed without API specification",
        blockedOn: "API design document",
      },
      ctx
    );

    expect(ctx.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          blockedOn: "API design document",
        }),
      })
    );
  });

  test("returns unique escalationId each time", async () => {
    const ctx = createTestContext();
    
    const result1 = await requestHumanReviewTool.execute(
      { reason: "First", context: "First context" },
      ctx
    );
    const result2 = await requestHumanReviewTool.execute(
      { reason: "Second", context: "Second context" },
      ctx
    );

    expect(result1.data?.escalationId).not.toBe(result2.data?.escalationId);
  });

  test("tool metadata is correct", () => {
    expect(requestHumanReviewTool.name).toBe("request_human_review");
    expect(requestHumanReviewTool.category).toBe("META");
    expect(requestHumanReviewTool.costHint).toBe("cheap");
    // riskHint is "safe" because escalation itself is safe
    expect(requestHumanReviewTool.riskHint).toBe("safe");
  });
});
