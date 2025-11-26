import { z } from "zod";

export type Mode = "mechanic" | "genius";

export interface Budget {
  stepsRemaining: number;
  tokensRemaining: number;
}

export interface ToolContext {
  jobId: string;
  traceId: string;
  repoPath: string;
  mode: Mode;
  budget: Budget;
  logEvent: (event: EventInput) => Promise<string>;
}

export interface ToolResult<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; recoverable: boolean };
  eventId: string;
  spanId?: string;
  hash?: string;
}

export interface Tool<TParams, TResult> {
  name: string;
  description: string;
  category: "READ_ONLY" | "MUTATING" | "META";
  paramsSchema: z.ZodSchema<TParams>;
  resultSchema: z.ZodSchema<TResult>;
  execute(params: TParams, ctx: ToolContext): Promise<ToolResult<TResult>>;
  idempotencyKey?: (params: TParams) => string;
  costHint?: "cheap" | "moderate" | "expensive";
  riskHint?: "safe" | "reversible" | "irreversible";
}

export interface EventInput {
  kind:
    | "tool_call"
    | "tool_result"
    | "analysis"
    | "plan"
    | "decision"
    | "error"
    | "escalation"
    | "evaluation";
  tool_name?: string;
  params?: unknown;
  result?: unknown;
  summary?: string;
  duration_ms?: number;
  tokens_used?: number;
  cost_cents?: number;
  span_hash?: string;
}

export interface JobRecord {
  id: string;
  traceId: string;
  mode: Mode;
  agentType: string;
  goal: string;
  repoPath: string;
  status: "queued" | "running" | "waiting_human" | "succeeded" | "failed" | "aborted";
  stepCap: number;
  stepsUsed: number;
  tokenCap?: number;
  tokensUsed?: number;
  costCapCents?: number;
  costUsedCents?: number;
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkerConfig {
  mode: Mode;
  model: string;
  stepCap: number;
  tokenCap: number;
  timeLimitMs: number;
}

export const ToolResultSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      recoverable: z.boolean()
    })
    .optional(),
  eventId: z.string(),
  spanId: z.string().optional(),
  hash: z.string().optional()
});
