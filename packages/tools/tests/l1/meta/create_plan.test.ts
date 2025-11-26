/**
 * L1 Tests: create_plan tool
 * 
 * Tests the plan creation mechanism for the Planner agent.
 */

import { describe, expect, test, vi } from "vitest";
import { createPlanTool } from "../../../src/meta/create_plan";
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

describe("L1: create_plan", () => {
  test("creates plan with all fields", async () => {
    const ctx = createTestContext();
    const params = {
      title: "Fix multiplication bug",
      analysis: {
        rootCause: "Wrong operator used",
        location: "src/utils.ts:7",
        confidence: 0.95,
      },
      steps: [
        {
          stepNumber: 1,
          action: "read_file",
          params: { path: "src/utils.ts" },
          expectedOutcome: "See the + operator that should be *",
        },
        {
          stepNumber: 2,
          action: "apply_patch",
          params: { patch: "..." },
          expectedOutcome: "File updated with * operator",
        },
      ],
    };

    const result = await createPlanTool.execute(params, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.stored).toBe(true);
    expect(result.data?.planId).toBeTruthy();
    expect(result.data?.stepCount).toBe(2);
  });

  test("logs plan as event", async () => {
    const ctx = createTestContext();
    const params = {
      title: "Test plan",
      analysis: {
        location: "test.ts",
        confidence: 0.9,
      },
      steps: [
        {
          stepNumber: 1,
          action: "read_file",
          params: {},
          expectedOutcome: "Done",
        },
      ],
    };

    await createPlanTool.execute(params, ctx);

    expect(ctx.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "plan",
        summary: expect.stringContaining("Test plan"),
      })
    );
  });

  test("handles multiple steps", async () => {
    const ctx = createTestContext();
    const steps = Array.from({ length: 10 }, (_, i) => ({
      stepNumber: i + 1,
      action: "read_file",
      params: {},
      expectedOutcome: `Completed step ${i + 1}`,
    }));

    const result = await createPlanTool.execute(
      {
        title: "Multi-step plan",
        analysis: { location: "complex.ts", confidence: 0.7 },
        steps,
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.stepCount).toBe(10);
  });

  test("includes constraints in event", async () => {
    const ctx = createTestContext();
    const constraints = {
      maxFiles: 5,
      maxLines: 200,
      mustPassTests: true,
    };

    await createPlanTool.execute(
      {
        title: "Constrained plan",
        analysis: { location: "src/", confidence: 0.85 },
        steps: [
          {
            stepNumber: 1,
            action: "apply_patch",
            params: {},
            expectedOutcome: "Changed",
          },
        ],
        constraints,
      },
      ctx
    );

    expect(ctx.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          constraints,
        }),
      })
    );
  });

  test("includes rollbackPlan in event", async () => {
    const ctx = createTestContext();
    const rollbackPlan = "git reset --hard HEAD~1";

    await createPlanTool.execute(
      {
        title: "Risky plan",
        analysis: { location: "critical.ts", confidence: 0.6 },
        steps: [
          {
            stepNumber: 1,
            action: "apply_patch",
            params: {},
            expectedOutcome: "Applied",
          },
        ],
        rollbackPlan,
      },
      ctx
    );

    expect(ctx.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          rollbackPlan,
        }),
      })
    );
  });

  test("tool metadata is correct", () => {
    expect(createPlanTool.name).toBe("create_plan");
    expect(createPlanTool.category).toBe("META");
    expect(createPlanTool.costHint).toBe("cheap");
    expect(createPlanTool.riskHint).toBe("safe");
  });
});
