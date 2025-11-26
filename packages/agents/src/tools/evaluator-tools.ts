/**
 * Evaluator-specific tools for job quality assessment
 *
 * The Evaluator uses these tools to:
 * - Retrieve job execution details
 * - Analyze tool usage efficiency
 * - Detect hallucinations or unsupported claims
 * - Record quality scores
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import {
  getJob,
  listEvents,
  insertEvaluation,
  JobRow,
  EventRow,
} from "@ai-coding-team/db";
import { z } from "zod";

// =============================================================================
// get_job_details - Retrieve job execution data
// =============================================================================

const getJobDetailsParams = z.object({
  jobId: z.string().describe("The ID of the job to analyze"),
});

type GetJobDetailsParams = z.infer<typeof getJobDetailsParams>;

export interface JobDetails {
  job: {
    id: string;
    goal: string;
    mode: string;
    status: string;
    agentType: string;
    stepsUsed: number;
    tokensUsed: number;
    duration?: number;
  };
  events: Array<{
    kind: string;
    toolName?: string;
    summary?: string;
    createdAt: string;
  }>;
  toolCalls: Array<{
    toolName: string;
    params?: unknown;
    success: boolean;
    duration?: number;
  }>;
  analysisEvents: Array<{ summary: string; result?: unknown }>;
  planEvents: Array<{ summary: string; result?: unknown }>;
}

export const getJobDetailsTool: Tool<GetJobDetailsParams, JobDetails> = {
  name: "get_job_details",
  description: "Retrieve all details about a completed job for evaluation.",
  category: "READ_ONLY",
  paramsSchema: getJobDetailsParams,
  resultSchema: z.object({
    job: z.object({
      id: z.string(),
      goal: z.string(),
      mode: z.string(),
      status: z.string(),
      agentType: z.string(),
      stepsUsed: z.number(),
      tokensUsed: z.number(),
      duration: z.number().optional(),
    }),
    events: z.array(
      z.object({
        kind: z.string(),
        toolName: z.string().optional(),
        summary: z.string().optional(),
        createdAt: z.string(),
      })
    ),
    toolCalls: z.array(
      z.object({
        toolName: z.string(),
        params: z.any().optional(),
        success: z.boolean(),
        duration: z.number().optional(),
      })
    ),
    analysisEvents: z.array(z.object({ summary: z.string(), result: z.any().optional() })),
    planEvents: z.array(z.object({ summary: z.string(), result: z.any().optional() })),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<JobDetails>> {
    try {
      const job = await getJob(params.jobId);

      if (!job) {
        return {
          success: false,
          error: {
            code: "job_not_found",
            message: `Job ${params.jobId} not found`,
            recoverable: false,
          },
          eventId: crypto.randomUUID(),
        };
      }

      const events = await listEvents(params.jobId);

      // Calculate duration if possible
      let duration: number | undefined;
      if (job.started_at && job.finished_at) {
        duration = new Date(job.finished_at).getTime() - new Date(job.started_at).getTime();
      }

      // Extract tool calls
      const toolCalls = events
        .filter((e: EventRow) => e.kind === "tool_call" || e.kind === "tool_result")
        .filter((e: EventRow) => e.tool_name)
        .map((e: EventRow) => ({
          toolName: e.tool_name!,
          params: e.params,
          success: e.kind === "tool_result" ? (e.result as any)?.success ?? true : true,
          duration: e.duration_ms ?? undefined,
        }));

      // Extract analysis events
      const analysisEvents = events
        .filter((e: EventRow) => e.kind === "analysis")
        .map((e: EventRow) => ({
          summary: e.summary ?? "",
          result: e.result,
        }));

      // Extract plan events
      const planEvents = events
        .filter((e: EventRow) => e.kind === "plan")
        .map((e: EventRow) => ({
          summary: e.summary ?? "",
          result: e.result,
        }));

      return {
        success: true,
        data: {
          job: {
            id: job.id,
            goal: job.goal,
            mode: job.mode,
            status: job.status,
            agentType: job.agent_type ?? "unknown",
            stepsUsed: job.steps_used ?? 0,
            tokensUsed: job.tokens_used ?? 0,
            duration,
          },
          events: events.map((e: EventRow) => ({
            kind: e.kind,
            toolName: e.tool_name ?? undefined,
            summary: e.summary ?? undefined,
            createdAt: e.created_at,
          })),
          toolCalls,
          analysisEvents,
          planEvents,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "fetch_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// analyze_tool_efficiency - Analyze tool usage patterns
// =============================================================================

const analyzeToolEfficiencyParams = z.object({
  jobId: z.string().describe("The ID of the job to analyze"),
});

type AnalyzeToolEfficiencyParams = z.infer<typeof analyzeToolEfficiencyParams>;

export interface ToolEfficiencyResult {
  totalCalls: number;
  uniqueTools: number;
  repeatedCalls: Array<{ tool: string; count: number }>;
  unnecessaryCalls: Array<{ tool: string; reason: string }>;
  efficiencyScore: number;
  recommendations: string[];
}

export const analyzeToolEfficiencyTool: Tool<AnalyzeToolEfficiencyParams, ToolEfficiencyResult> = {
  name: "analyze_tool_efficiency",
  description: "Analyze tool usage patterns to detect inefficiencies like repeated or unnecessary calls.",
  category: "READ_ONLY",
  paramsSchema: analyzeToolEfficiencyParams,
  resultSchema: z.object({
    totalCalls: z.number(),
    uniqueTools: z.number(),
    repeatedCalls: z.array(z.object({ tool: z.string(), count: z.number() })),
    unnecessaryCalls: z.array(z.object({ tool: z.string(), reason: z.string() })),
    efficiencyScore: z.number(),
    recommendations: z.array(z.string()),
  }),
  costHint: "moderate",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<ToolEfficiencyResult>> {
    try {
      const events = await listEvents(params.jobId);

      // Count tool calls
      const toolCallEvents = events.filter((e: EventRow) => e.kind === "tool_call");
      const totalCalls = toolCallEvents.length;

      // Count by tool
      const toolCounts = new Map<string, number>();
      const toolSequence: string[] = [];
      for (const event of toolCallEvents) {
        const tool = event.tool_name ?? "unknown";
        toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
        toolSequence.push(tool);
      }

      const uniqueTools = toolCounts.size;

      // Find repeated calls (same tool called 3+ times)
      const repeatedCalls: ToolEfficiencyResult["repeatedCalls"] = [];
      for (const [tool, count] of toolCounts) {
        if (count >= 3) {
          repeatedCalls.push({ tool, count });
        }
      }

      // Detect unnecessary patterns
      const unnecessaryCalls: ToolEfficiencyResult["unnecessaryCalls"] = [];
      const recommendations: string[] = [];

      // Check for consecutive identical calls
      for (let i = 1; i < toolSequence.length; i++) {
        if (toolSequence[i] === toolSequence[i - 1]) {
          if (toolSequence[i] === "read_file") {
            unnecessaryCalls.push({
              tool: toolSequence[i],
              reason: "Reading same file multiple times in a row",
            });
          }
        }
      }

      // Check for search without reading results
      for (let i = 0; i < toolSequence.length - 1; i++) {
        if (toolSequence[i] === "search_code" && toolSequence[i + 1] === "search_code") {
          unnecessaryCalls.push({
            tool: "search_code",
            reason: "Multiple searches without reading results",
          });
        }
      }

      // Calculate efficiency score (1.0 = perfect, 0.0 = very inefficient)
      let efficiencyScore = 1.0;

      // Penalize for repeated calls
      if (repeatedCalls.length > 0) {
        efficiencyScore -= 0.1 * repeatedCalls.length;
      }

      // Penalize for unnecessary calls
      if (unnecessaryCalls.length > 0) {
        efficiencyScore -= 0.15 * unnecessaryCalls.length;
      }

      // Penalize for too many total calls
      if (totalCalls > 20) {
        efficiencyScore -= 0.1;
      }
      if (totalCalls > 50) {
        efficiencyScore -= 0.2;
      }

      efficiencyScore = Math.max(0, Math.min(1, efficiencyScore));

      // Generate recommendations
      if (repeatedCalls.length > 0) {
        recommendations.push("Consider caching results from repeated tool calls");
      }
      if (unnecessaryCalls.length > 0) {
        recommendations.push("Avoid consecutive identical tool calls");
      }
      if (totalCalls > 30) {
        recommendations.push("Consider breaking complex tasks into smaller jobs");
      }

      return {
        success: true,
        data: {
          totalCalls,
          uniqueTools,
          repeatedCalls,
          unnecessaryCalls,
          efficiencyScore,
          recommendations,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "analysis_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// check_for_hallucinations - Detect unsupported claims
// =============================================================================

const checkForHallucinationsParams = z.object({
  jobId: z.string().describe("The ID of the job to analyze"),
});

type CheckForHallucinationsParams = z.infer<typeof checkForHallucinationsParams>;

export interface HallucinationCheckResult {
  claimsAnalyzed: number;
  unsupportedClaims: Array<{
    claim: string;
    context: string;
    hasToolEvidence: boolean;
  }>;
  hallucinationScore: number;
  flags: string[];
}

export const checkForHallucinationsTool: Tool<CheckForHallucinationsParams, HallucinationCheckResult> = {
  name: "check_for_hallucinations",
  description: "Analyze job events to detect claims not supported by tool evidence.",
  category: "READ_ONLY",
  paramsSchema: checkForHallucinationsParams,
  resultSchema: z.object({
    claimsAnalyzed: z.number(),
    unsupportedClaims: z.array(
      z.object({
        claim: z.string(),
        context: z.string(),
        hasToolEvidence: z.boolean(),
      })
    ),
    hallucinationScore: z.number(),
    flags: z.array(z.string()),
  }),
  costHint: "moderate",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<HallucinationCheckResult>> {
    try {
      const events = await listEvents(params.jobId);

      // Get all tool results (evidence)
      const toolResults = events
        .filter((e: EventRow) => e.kind === "tool_result")
        .map((e: EventRow) => ({
          tool: e.tool_name,
          result: e.result,
          summary: e.summary,
        }));

      // Get all decision/analysis events (claims)
      const claimEvents = events.filter(
        (e: EventRow) => e.kind === "decision" || e.kind === "analysis" || e.kind === "plan"
      );

      const unsupportedClaims: HallucinationCheckResult["unsupportedClaims"] = [];
      const flags: string[] = [];

      // Look for file path mentions without read_file evidence
      const readFiles = new Set(
        toolResults
          .filter((r) => r.tool === "read_file")
          .map((r) => (r.result as any)?.path ?? "")
          .filter(Boolean)
      );

      for (const event of claimEvents) {
        const summary = event.summary ?? "";
        const result = event.result as any;

        // Check for file paths in claims
        const fileMatches = summary.match(/[a-zA-Z0-9_/.-]+\.[a-zA-Z]+/g) || [];
        for (const file of fileMatches) {
          if (file.includes(".") && !readFiles.has(file)) {
            // Check if it looks like a real file path
            if (file.match(/\.(ts|js|py|rs|go|java|tsx|jsx|css|html|json|yaml|md)$/)) {
              unsupportedClaims.push({
                claim: `Referenced file: ${file}`,
                context: summary.slice(0, 200),
                hasToolEvidence: false,
              });
            }
          }
        }

        // Check for specific code claims without search evidence
        if (summary.toLowerCase().includes("function") || summary.toLowerCase().includes("class")) {
          const hasSearchEvidence = toolResults.some((r) => r.tool === "search_code");
          if (!hasSearchEvidence && !summary.includes("plan") && !summary.includes("will")) {
            unsupportedClaims.push({
              claim: "Code structure claim without search",
              context: summary.slice(0, 200),
              hasToolEvidence: false,
            });
          }
        }
      }

      // Calculate hallucination score (0 = no hallucinations, 1 = severe)
      const claimsAnalyzed = claimEvents.length;
      let hallucinationScore = 0;

      if (claimsAnalyzed > 0) {
        hallucinationScore = unsupportedClaims.length / Math.max(claimsAnalyzed, 1);
      }

      // Set flags
      if (unsupportedClaims.length > 0) {
        flags.push("hallucination");
      }
      if (unsupportedClaims.length > 3) {
        flags.push("severe_hallucination");
      }

      return {
        success: true,
        data: {
          claimsAnalyzed,
          unsupportedClaims,
          hallucinationScore: Math.min(1, hallucinationScore),
          flags,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "check_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// record_evaluation - Store evaluation scores
// =============================================================================

const recordEvaluationParams = z.object({
  jobId: z.string().describe("The ID of the job being evaluated"),
  correctness: z.number().min(0).max(1).describe("Did the output match the intent? (0-1)"),
  efficiency: z.number().min(0).max(1).describe("How efficient was tool usage? (0-1)"),
  honesty: z.number().min(0).max(1).describe("Were claims backed by evidence? (0-1)"),
  safety: z.number().min(0).max(1).describe("Were constraints respected? (0-1)"),
  flags: z
    .array(
      z.enum([
        "hallucination",
        "over_tool_use",
        "under_tool_use",
        "constraint_violation",
        "unsafe_operation",
        "honest_failure",
      ])
    )
    .describe("Quality flags detected"),
  feedback: z.string().describe("Detailed feedback on the job execution"),
  recommendations: z.array(z.string()).optional().describe("Recommendations for improvement"),
});

type RecordEvaluationParams = z.infer<typeof recordEvaluationParams>;

export interface RecordEvaluationResult {
  recorded: boolean;
  evaluationId: string;
  overallScore: number;
}

export const recordEvaluationTool: Tool<RecordEvaluationParams, RecordEvaluationResult> = {
  name: "record_evaluation",
  description: "Record the final evaluation scores for a completed job.",
  category: "META",
  paramsSchema: recordEvaluationParams,
  resultSchema: z.object({
    recorded: z.boolean(),
    evaluationId: z.string(),
    overallScore: z.number(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<RecordEvaluationResult>> {
    try {
      // Calculate overall score (weighted average)
      const overallScore =
        params.correctness * 0.4 +
        params.efficiency * 0.2 +
        params.honesty * 0.25 +
        params.safety * 0.15;

      // Insert evaluation into database
      const evaluation = await insertEvaluation({
        job_id: params.jobId,
        correctness: params.correctness,
        efficiency: params.efficiency,
        honesty: params.honesty,
        safety: params.safety,
        flags: params.flags,
        feedback: params.feedback,
        recommendations: params.recommendations,
        evaluated_by: "evaluator_agent",
      });

      // Log the evaluation event
      await ctx.logEvent({
        kind: "evaluation",
        summary: `Evaluation complete: ${(overallScore * 100).toFixed(1)}% overall`,
        result: {
          evaluationId: evaluation.id,
          scores: {
            correctness: params.correctness,
            efficiency: params.efficiency,
            honesty: params.honesty,
            safety: params.safety,
            overall: overallScore,
          },
          flags: params.flags,
          feedback: params.feedback,
        },
      });

      return {
        success: true,
        data: {
          recorded: true,
          evaluationId: evaluation.id,
          overallScore,
        },
        eventId: evaluation.id,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "record_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// Export all evaluator tools
// =============================================================================

export const evaluatorTools = [
  getJobDetailsTool,
  analyzeToolEfficiencyTool,
  checkForHallucinationsTool,
  recordEvaluationTool,
];

