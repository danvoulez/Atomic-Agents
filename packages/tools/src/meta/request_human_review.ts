/**
 * request_human_review - Escalate to human reviewer
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";

const paramsSchema = z.object({
  reason: z.string().describe("Why human review is needed"),
  context: z.string().describe("Relevant context for the reviewer"),
  options: z
    .array(z.string())
    .optional()
    .describe("Possible actions the human can choose"),
  blockedOn: z.string().optional().describe("What is blocking progress"),
});

type RequestHumanReviewParams = z.infer<typeof paramsSchema>;

export interface RequestHumanReviewResult {
  escalated: boolean;
  escalationId: string;
}

export const requestHumanReviewTool: Tool<RequestHumanReviewParams, RequestHumanReviewResult> = {
  name: "request_human_review",
  description:
    "Escalate to a human reviewer. Use when the task is too complex, risky, or unclear to proceed safely.",
  category: "META",
  paramsSchema,
  resultSchema: z.object({
    escalated: z.boolean(),
    escalationId: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<RequestHumanReviewResult>> {
    const escalationId = crypto.randomUUID();

    await ctx.logEvent({
      kind: "escalation",
      summary: `Human review requested: ${params.reason}`,
      result: {
        escalationId,
        ...params,
      },
    });

    return {
      success: true,
      data: {
        escalated: true,
        escalationId,
      },
      eventId: escalationId,
    };
  },
};
