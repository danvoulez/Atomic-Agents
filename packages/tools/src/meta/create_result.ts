/**
 * create_result - Document the execution result
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";

const paramsSchema = z.object({
  status: z.enum(["complete", "partial", "failed"]).describe("Overall status"),
  changes: z.object({
    branch: z.string(),
    files: z.array(
      z.object({
        path: z.string(),
        linesAdded: z.number(),
        linesRemoved: z.number(),
      })
    ),
    commits: z.array(
      z.object({
        hash: z.string(),
        message: z.string(),
      })
    ),
  }),
  tests: z.object({
    status: z.enum(["pass", "fail", "skipped"]),
    passed: z.number(),
    failed: z.number(),
  }),
  qualityCheck: z.object({
    verdict: z.enum(["OK", "WARN", "BLOCK"]),
    checks: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["OK", "WARN", "FAIL"]),
        message: z.string().optional(),
      })
    ),
  }),
  summary: z.string().describe("Human-readable summary of what was done"),
});

type CreateResultParams = z.infer<typeof paramsSchema>;

export interface CreateResultResult {
  recorded: boolean;
  resultId: string;
}

export const createResultTool: Tool<CreateResultParams, CreateResultResult> = {
  name: "create_result",
  description:
    "Create a RESULT span documenting the execution. Use this to conclude a build job.",
  category: "META",
  paramsSchema,
  resultSchema: z.object({
    recorded: z.boolean(),
    resultId: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<CreateResultResult>> {
    const resultId = crypto.randomUUID();

    await ctx.logEvent({
      kind: "decision",
      summary: params.summary,
      result: {
        resultId,
        ...params,
      },
    });

    return {
      success: true,
      data: {
        recorded: true,
        resultId,
      },
      eventId: resultId,
    };
  },
};
