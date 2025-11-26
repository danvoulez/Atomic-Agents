/**
 * Coordinator-specific tools for managing agent workflow
 *
 * The Coordinator uses these tools to:
 * - Delegate work to specialist agents (Planner, Builder, Reviewer)
 * - Monitor delegated job progress
 * - Request user clarification when intent is unclear
 * - Format final responses for output
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import {
  insertJob,
  getJob,
  listEvents,
  markJobStatus,
  insertEvent,
  JobInput,
  EventRow,
} from "@ai-coding-team/db";
import { z } from "zod";

// =============================================================================
// delegate_to_agent
// =============================================================================

const delegateToAgentParams = z.object({
  agentType: z.enum(["planner", "builder", "reviewer"]).describe("Which specialist agent to delegate to"),
  goal: z.string().describe("The goal for the delegated agent"),
  mode: z.enum(["mechanic", "genius"]).describe("Operating mode for the delegated agent"),
  constraints: z
    .object({
      maxFiles: z.number().optional().describe("Maximum files that can be changed"),
      maxLines: z.number().optional().describe("Maximum lines that can be changed"),
      mustPassTests: z.boolean().optional().describe("Whether tests must pass"),
    })
    .optional()
    .describe("Optional constraints for the delegated job"),
});

type DelegateToAgentParams = z.infer<typeof delegateToAgentParams>;

interface DelegateToAgentResult {
  jobId: string;
  agentType: string;
  status: string;
}

export const delegateToAgentTool: Tool<DelegateToAgentParams, DelegateToAgentResult> = {
  name: "delegate_to_agent",
  description:
    "Create a job for a specialist agent. Use this to delegate planning to Planner, building to Builder, or code review to Reviewer.",
  category: "MUTATING",
  paramsSchema: delegateToAgentParams,
  resultSchema: z.object({
    jobId: z.string(),
    agentType: z.string(),
    status: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<DelegateToAgentResult>> {
    const jobId = crypto.randomUUID();

    const jobInput: JobInput = {
      id: jobId,
      trace_id: ctx.traceId,
      mode: params.mode,
      agent_type: params.agentType,
      goal: params.goal,
      repo_path: ctx.repoPath,
      status: "queued",
      parent_job_id: ctx.jobId,
      created_by: "coordinator",
      // Store constraints in the logline_span field as JSON
      logline_span: params.constraints ? JSON.stringify(params.constraints) : undefined,
    };

    const job = await insertJob(jobInput);

    // Log the delegation event
    await ctx.logEvent({
      kind: "decision",
      summary: `Delegated to ${params.agentType}: ${params.goal}`,
      params: { agentType: params.agentType, childJobId: jobId },
    });

    return {
      success: true,
      data: {
        jobId: job.id,
        agentType: params.agentType,
        status: job.status,
      },
      eventId: crypto.randomUUID(),
    };
  },
};

// =============================================================================
// check_job_status
// =============================================================================

const checkJobStatusParams = z.object({
  jobId: z.string().describe("The ID of the job to check"),
});

type CheckJobStatusParams = z.infer<typeof checkJobStatusParams>;

interface CheckJobStatusResult {
  status: string;
  stepsUsed: number;
  tokensUsed: number;
  latestEvents: Array<{
    kind: string;
    summary?: string;
    created_at: string;
  }>;
  output?: unknown;
}

export const checkJobStatusTool: Tool<CheckJobStatusParams, CheckJobStatusResult> = {
  name: "check_job_status",
  description:
    "Check the status of a delegated job. Use this to monitor progress and wait for completion.",
  category: "READ_ONLY",
  paramsSchema: checkJobStatusParams,
  resultSchema: z.object({
    status: z.string(),
    stepsUsed: z.number(),
    tokensUsed: z.number(),
    latestEvents: z.array(
      z.object({
        kind: z.string(),
        summary: z.string().optional(),
        created_at: z.string(),
      })
    ),
    output: z.any().optional(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<CheckJobStatusResult>> {
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
    const latestEvents = events.slice(-5).map((e: EventRow) => ({
      kind: e.kind,
      summary: e.summary ?? undefined,
      created_at: e.created_at,
    }));

    // If job completed, try to extract output from the last result event
    let output: unknown;
    if (job.status === "succeeded" || job.status === "failed") {
      const resultEvent = events.find((e: EventRow) => e.kind === "plan" || e.kind === "decision");
      if (resultEvent?.result) {
        output = resultEvent.result;
      }
    }

    return {
      success: true,
      data: {
        status: job.status,
        stepsUsed: job.steps_used ?? 0,
        tokensUsed: job.tokens_used ?? 0,
        latestEvents,
        output,
      },
      eventId: crypto.randomUUID(),
    };
  },
};

// =============================================================================
// ask_user
// =============================================================================

const askUserParams = z.object({
  question: z.string().describe("The question to ask the user"),
  options: z.array(z.string()).optional().describe("Optional list of choices for the user"),
  context: z.string().optional().describe("Additional context to help the user understand"),
});

type AskUserParams = z.infer<typeof askUserParams>;

interface AskUserResult {
  waitingForUser: boolean;
  eventId: string;
}

export const askUserTool: Tool<AskUserParams, AskUserResult> = {
  name: "ask_user",
  description:
    "Ask the user for clarification. Use this when the request is ambiguous or when TDLN returns ABSTAIN.",
  category: "META",
  paramsSchema: askUserParams,
  resultSchema: z.object({
    waitingForUser: z.boolean(),
    eventId: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<AskUserResult>> {
    // Create a clarification_needed event that the UI watches for
    const eventId = await ctx.logEvent({
      kind: "escalation",
      summary: `Clarification needed: ${params.question}`,
      params: {
        question: params.question,
        options: params.options,
        context: params.context,
      },
    });

    // Mark job as waiting for human input
    await markJobStatus(ctx.jobId, "waiting_human");

    return {
      success: true,
      data: {
        waitingForUser: true,
        eventId,
      },
      eventId,
    };
  },
};

// =============================================================================
// format_response
// =============================================================================

const formatResponseParams = z.object({
  type: z.string().describe("Response template type (e.g., 'job_complete_success', 'job_failed')"),
  data: z.record(z.any()).describe("Data to include in the formatted response"),
  summary: z.string().describe("Human-readable summary of the result"),
});

type FormatResponseParams = z.infer<typeof formatResponseParams>;

interface FormatResponseResult {
  formatted: boolean;
  message: string;
}

export const formatResponseTool: Tool<FormatResponseParams, FormatResponseResult> = {
  name: "format_response",
  description:
    "Format the final response for the user. Use this to conclude a successful coordination.",
  category: "META",
  paramsSchema: formatResponseParams,
  resultSchema: z.object({
    formatted: z.boolean(),
    message: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<FormatResponseResult>> {
    // Log the formatted response as a decision event
    await ctx.logEvent({
      kind: "decision",
      summary: params.summary,
      result: {
        type: params.type,
        data: params.data,
      },
    });

    // Mark job as succeeded
    await markJobStatus(ctx.jobId, "succeeded");

    return {
      success: true,
      data: {
        formatted: true,
        message: params.summary,
      },
      eventId: crypto.randomUUID(),
    };
  },
};

// =============================================================================
// Export all coordinator tools
// =============================================================================

export const coordinatorTools = [
  delegateToAgentTool,
  checkJobStatusTool,
  askUserTool,
  formatResponseTool,
];

