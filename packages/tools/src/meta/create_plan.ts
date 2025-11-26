/**
 * create_plan - Create a structured plan for the Builder
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";

const planStepSchema = z.object({
  stepNumber: z.number().describe("Step number in sequence"),
  action: z.string().describe("Tool name to call (e.g., apply_patch, run_tests)"),
  params: z.record(z.any()).describe("Parameters for the tool"),
  expectedOutcome: z.string().describe("What should happen when this step succeeds"),
  onFailure: z
    .enum(["retry", "escalate", "continue"])
    .optional()
    .describe("What to do if this step fails (default: retry)"),
});

const paramsSchema = z.object({
  title: z.string().describe("Brief title for the plan"),
  analysis: z.object({
    rootCause: z.string().optional().describe("Root cause (from record_analysis)"),
    location: z.string().describe("Primary location of the change"),
    confidence: z.number().describe("Confidence level (from record_analysis)"),
  }),
  steps: z.array(planStepSchema).describe("Ordered list of steps for the Builder"),
  constraints: z
    .object({
      maxFiles: z.number().optional(),
      maxLines: z.number().optional(),
      mustPassTests: z.boolean().optional(),
    })
    .optional()
    .describe("Constraints for mechanic mode"),
  rollbackPlan: z.string().optional().describe("How to rollback if things go wrong"),
});

type CreatePlanParams = z.infer<typeof paramsSchema>;

export interface CreatePlanResult {
  stored: boolean;
  planId: string;
  stepCount: number;
}

export const createPlanTool: Tool<CreatePlanParams, CreatePlanResult> = {
  name: "create_plan",
  description:
    "Create a PLAN span with specific steps for the Builder agent. Each step should be a single tool action.",
  category: "META",
  paramsSchema,
  resultSchema: z.object({
    stored: z.boolean(),
    planId: z.string(),
    stepCount: z.number(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<CreatePlanResult>> {
    const planId = crypto.randomUUID();

    // Store plan as an event with kind: plan
    await ctx.logEvent({
      kind: "plan",
      summary: `Plan created: ${params.title} (${params.steps.length} steps)`,
      result: {
        planId,
        ...params,
      },
    });

    return {
      success: true,
      data: {
        stored: true,
        planId,
        stepCount: params.steps.length,
      },
      eventId: planId,
    };
  },
};
