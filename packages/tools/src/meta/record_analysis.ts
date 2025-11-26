/**
 * record_analysis - Document analysis findings
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";

const paramsSchema = z.object({
  rootCause: z.string().optional().describe("Root cause of the bug (for bug fixes)"),
  scope: z.string().optional().describe("Scope of the feature or change"),
  affectedFiles: z.array(z.string()).describe("List of files that need to change"),
  complexity: z
    .enum(["trivial", "simple", "moderate", "complex"])
    .describe("Estimated complexity of the change"),
  risk: z.enum(["low", "medium", "high"]).describe("Risk level of the change"),
  evidence: z.array(z.string()).describe("Evidence supporting the analysis (code snippets, logs, etc.)"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence level in the analysis (0-1)"),
  dependencies: z
    .array(z.string())
    .optional()
    .describe("Dependencies or ordering constraints"),
  alternatives: z
    .array(z.string())
    .optional()
    .describe("Alternative approaches considered"),
});

type RecordAnalysisParams = z.infer<typeof paramsSchema>;

export interface RecordAnalysisResult {
  recorded: boolean;
  analysisId: string;
}

export const recordAnalysisTool: Tool<RecordAnalysisParams, RecordAnalysisResult> = {
  name: "record_analysis",
  description:
    "Record your analysis findings. REQUIRED before creating a plan. Documents root cause, affected files, complexity, and risk.",
  category: "META",
  paramsSchema,
  resultSchema: z.object({
    recorded: z.boolean(),
    analysisId: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<RecordAnalysisResult>> {
    const analysisId = crypto.randomUUID();

    // Store analysis as an event via the context
    await ctx.logEvent({
      kind: "analysis",
      summary: `Analysis complete: ${params.complexity} complexity, ${params.risk} risk, ${params.affectedFiles.length} files affected`,
      result: {
        analysisId,
        ...params,
      },
    });

    return {
      success: true,
      data: {
        recorded: true,
        analysisId,
      },
      eventId: analysisId,
    };
  },
};
