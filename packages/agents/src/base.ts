/**
 * BaseAgent - Abstract base class for all agents
 *
 * Provides the core execution loop with:
 * - LLM integration (OpenAI/Anthropic)
 * - Tool dispatch and execution
 * - Budget tracking (steps, tokens, time)
 * - Event logging to database
 * - Cooperative cancellation
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import {
  insertEvent,
  updateJobBudget,
  EventInput,
  JobRow,
} from "@ai-coding-team/db";
import {
  LLMClient,
  Message,
  ChatOptions,
  ToolSchema,
  ToolCall,
} from "./llm";
import { buildUntrustedBrainContract } from "./prompts/contracts";

/**
 * Job information passed to agent run()
 */
export interface AgentJob {
  id: string;
  traceId: string;
  mode: "mechanic" | "genius";
  agentType: string;
  goal: string;
  repoPath: string;
  stepCap: number;
  tokenCap: number;
  timeLimitMs: number;
  conversationId?: string;
}

/**
 * Result from agent execution
 */
export interface AgentResult {
  success: boolean;
  output?: unknown;
  reason?: "completed" | "cancelled" | "step_limit_exceeded" | "token_limit_exceeded" | "time_limit_exceeded" | "error";
  error?: string;
}

/**
 * Options for agent run
 */
export interface AgentRunOptions {
  shouldCancel?: () => Promise<boolean>;
}

/**
 * Internal execution context
 */
interface ExecutionContext {
  job: AgentJob;
  budget: {
    stepsRemaining: number;
    tokensRemaining: number;
  };
  startTime: number;
  shouldCancel?: () => Promise<boolean>;
}

/**
 * Abstract base class for agents
 */
export abstract class BaseAgent {
  protected llm: LLMClient;
  protected tools: Map<string, Tool<unknown, unknown>>;

  constructor(llm: LLMClient, tools: Tool<unknown, unknown>[] = []) {
    this.llm = llm;
    this.tools = new Map(tools.map((t) => [t.name, t]));
  }

  /**
   * Main execution loop
   */
  async run(job: AgentJob, options?: AgentRunOptions): Promise<AgentResult> {
    const ctx: ExecutionContext = {
      job,
      budget: {
        stepsRemaining: job.stepCap,
        tokensRemaining: job.tokenCap,
      },
      startTime: Date.now(),
      shouldCancel: options?.shouldCancel,
    };

    // Build initial messages
    const messages: Message[] = [
      { role: "system", content: this.buildSystemPrompt(job) },
      { role: "user", content: this.buildJobPrompt(job) },
    ];

    // Log job start
    await this.logEvent(ctx, {
      kind: "info",
      summary: `Agent ${this.getAgentType()} starting job: ${job.goal}`,
    });

    try {
      // Main loop
      while (ctx.budget.stepsRemaining > 0) {
        // Check cancellation
        if (ctx.shouldCancel && (await ctx.shouldCancel())) {
          await this.logEvent(ctx, {
            kind: "info",
            summary: "Job cancelled by request",
          });
          return { success: false, reason: "cancelled" };
        }

        // Check time budget
        const elapsed = Date.now() - ctx.startTime;
        if (elapsed > job.timeLimitMs) {
          await this.logEvent(ctx, {
            kind: "error",
            summary: `Time limit exceeded: ${elapsed}ms > ${job.timeLimitMs}ms`,
          });
          return { success: false, reason: "time_limit_exceeded" };
        }

        // Check token budget
        if (ctx.budget.tokensRemaining <= 0) {
          await this.logEvent(ctx, {
            kind: "error",
            summary: "Token budget exhausted",
          });
          return { success: false, reason: "token_limit_exceeded" };
        }

        // Call LLM
        const chatOptions: ChatOptions = {
          tools: this.getToolSchemas(),
          maxTokens: Math.min(4096, ctx.budget.tokensRemaining),
          temperature: job.mode === "mechanic" ? 0.1 : 0.3,
        };

        const response = await this.llm.chat(messages, chatOptions);

        // Update token budget
        ctx.budget.tokensRemaining -= response.usage.totalTokens;
        await this.updateBudget(ctx);

        // Handle tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const toolCall of response.toolCalls) {
            ctx.budget.stepsRemaining--;
            await this.updateBudget(ctx);

            const toolResult = await this.executeToolCall(toolCall, ctx);

            // Add assistant message with tool call
            messages.push({
              role: "assistant",
              content: response.content || "",
            });

            // Add tool result message
            messages.push({
              role: "tool",
              content: JSON.stringify(toolResult),
              tool_call_id: toolCall.id,
              name: toolCall.name,
            });
          }
        } else {
          // No tool calls - agent is done
          if (response.finishReason === "stop") {
            const finalOutput = await this.processCompletion(response.content ?? "", ctx);
            await this.logEvent(ctx, {
              kind: "info",
              summary: "Agent completed successfully",
            });
            return { success: true, output: finalOutput, reason: "completed" };
          }

          // Add assistant response to history
          messages.push({
            role: "assistant",
            content: response.content ?? "",
          });
        }
      }

      // Ran out of steps
      await this.logEvent(ctx, {
        kind: "error",
        summary: `Step limit exceeded: used ${job.stepCap} steps`,
      });
      return { success: false, reason: "step_limit_exceeded" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.logEvent(ctx, {
        kind: "error",
        summary: `Agent error: ${errorMessage}`,
      });
      return { success: false, reason: "error", error: errorMessage };
    }
  }

  /**
   * Execute a tool call from the LLM
   */
  private async executeToolCall(
    toolCall: ToolCall,
    ctx: ExecutionContext
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const tool = this.tools.get(toolCall.name);

    if (!tool) {
      await this.logEvent(ctx, {
        kind: "error",
        tool_name: toolCall.name,
        summary: `Unknown tool: ${toolCall.name}`,
      });
      return { success: false, error: `Unknown tool: ${toolCall.name}` };
    }

    // Parse arguments
    let params: unknown;
    try {
      params = JSON.parse(toolCall.arguments);
    } catch {
      await this.logEvent(ctx, {
        kind: "error",
        tool_name: toolCall.name,
        summary: `Invalid tool arguments: ${toolCall.arguments}`,
      });
      return { success: false, error: "Invalid tool arguments" };
    }

    // Log tool call
    const callStartTime = Date.now();
    await this.logEvent(ctx, {
      kind: "tool_call",
      tool_name: toolCall.name,
      params: params as Record<string, unknown>,
      summary: `Calling ${toolCall.name}`,
    });

    // Update current action
    await updateJobBudget(ctx.job.id, { current_action: `Running ${toolCall.name}` });

    // Execute tool
    const toolCtx: ToolContext = {
      jobId: ctx.job.id,
      traceId: ctx.job.traceId,
      repoPath: ctx.job.repoPath,
      mode: ctx.job.mode,
      budget: ctx.budget,
      logEvent: async (event) => {
        const e = await this.logEvent(ctx, event as Partial<EventInput>);
        return e.id;
      },
    };

    try {
      const result = await tool.execute(params, toolCtx);
      const duration = Date.now() - callStartTime;

      // Log tool result
      await this.logEvent(ctx, {
        kind: "tool_result",
        tool_name: toolCall.name,
        result: this.summarizeResult(result),
        duration_ms: duration,
        summary: result.success
          ? `${toolCall.name} succeeded`
          : `${toolCall.name} failed: ${result.error?.message}`,
      });

      // Summarize for LLM context
      return {
        success: result.success,
        data: this.summarizeForLLM(toolCall.name, result),
        error: result.error?.message,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - callStartTime;

      await this.logEvent(ctx, {
        kind: "error",
        tool_name: toolCall.name,
        duration_ms: duration,
        summary: `Tool execution error: ${errorMessage}`,
      });

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Build the system prompt
   */
  protected buildSystemPrompt(job: AgentJob): string {
    const contract = buildUntrustedBrainContract({
      traceId: job.traceId,
      mode: job.mode,
      stepCap: job.stepCap,
      tokenCap: job.tokenCap,
      timeLimitSeconds: Math.floor(job.timeLimitMs / 1000),
    });

    const toolDescriptions = this.formatToolDescriptions();

    return `
${this.getAgentIdentity()}

${contract}

${this.getAgentSpecificRules()}

═══════════════════════════════════════════════════════════════════════════════
AVAILABLE TOOLS
═══════════════════════════════════════════════════════════════════════════════

${toolDescriptions}
`.trim();
  }

  /**
   * Format tool descriptions for the system prompt
   */
  protected formatToolDescriptions(): string {
    const descriptions: string[] = [];

    for (const [name, tool] of this.tools) {
      descriptions.push(`**${name}** (${tool.category})`);
      descriptions.push(`  ${tool.description}`);
      if (tool.riskHint) {
        descriptions.push(`  Risk: ${tool.riskHint}`);
      }
      descriptions.push("");
    }

    return descriptions.join("\n");
  }

  /**
   * Get tool schemas for LLM
   */
  protected getToolSchemas(): ToolSchema[] {
    const schemas: ToolSchema[] = [];

    for (const [name, tool] of this.tools) {
      // Convert Zod schema to JSON schema
      const jsonSchema = this.zodToJsonSchema(tool.paramsSchema);

      schemas.push({
        name,
        description: tool.description,
        parameters: jsonSchema,
      });
    }

    return schemas;
  }

  /**
   * Convert Zod schema to JSON schema (simplified)
   */
  private zodToJsonSchema(schema: unknown): ToolSchema["parameters"] {
    // For now, use a simple approach - in production you'd use zod-to-json-schema
    if (schema && typeof schema === "object" && "_def" in schema) {
      const def = (schema as { _def: { typeName?: string; shape?: () => Record<string, unknown> } })._def;
      if (def.typeName === "ZodObject" && def.shape) {
        const shape = def.shape();
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
          const valueDef = (value as { _def?: { typeName?: string; description?: string } })._def;
          properties[key] = {
            type: this.zodTypeToJsonType(valueDef?.typeName),
            description: valueDef?.description,
          };
          // All properties are required by default in Zod
          required.push(key);
        }

        return { type: "object", properties, required };
      }
    }

    // Fallback
    return { type: "object", properties: {} };
  }

  private zodTypeToJsonType(typeName?: string): string {
    switch (typeName) {
      case "ZodString":
        return "string";
      case "ZodNumber":
        return "number";
      case "ZodBoolean":
        return "boolean";
      case "ZodArray":
        return "array";
      default:
        return "string";
    }
  }

  /**
   * Log an event to the database
   */
  protected async logEvent(
    ctx: ExecutionContext,
    event: Partial<EventInput>
  ): Promise<{ id: string }> {
    const fullEvent: EventInput = {
      job_id: ctx.job.id,
      trace_id: ctx.job.traceId,
      kind: event.kind ?? "info",
      tool_name: event.tool_name,
      params: event.params,
      result: event.result,
      summary: event.summary,
      duration_ms: event.duration_ms,
      tokens_used: event.tokens_used,
      cost_cents: event.cost_cents,
      span_hash: event.span_hash,
      conversation_id: ctx.job.conversationId,
    };

    const result = await insertEvent(fullEvent);
    return { id: result.id };
  }

  /**
   * Update job budget in database
   */
  private async updateBudget(ctx: ExecutionContext): Promise<void> {
    const stepsUsed = ctx.job.stepCap - ctx.budget.stepsRemaining;
    const tokensUsed = ctx.job.tokenCap - ctx.budget.tokensRemaining;

    await updateJobBudget(ctx.job.id, {
      steps_used: stepsUsed,
      tokens_used: tokensUsed,
    });
  }

  /**
   * Summarize tool result for database storage
   */
  private summarizeResult(result: ToolResult<unknown>): Record<string, unknown> {
    return {
      success: result.success,
      eventId: result.eventId,
      hasData: result.data !== undefined,
      error: result.error,
    };
  }

  /**
   * Summarize tool result for LLM context (to avoid huge payloads)
   */
  protected summarizeForLLM(toolName: string, result: ToolResult<unknown>): unknown {
    const json = JSON.stringify(result.data ?? {});
    const maxLen = 2000;

    if (json.length <= maxLen) {
      return result.data;
    }

    return {
      _truncated: true,
      _originalLength: json.length,
      summary: json.slice(0, maxLen) + "...",
      success: result.success,
    };
  }

  // =========================================================================
  // Abstract methods - must be implemented by subclasses
  // =========================================================================

  /**
   * Get the agent type identifier
   */
  abstract getAgentType(): string;

  /**
   * Get the agent identity description for the system prompt
   */
  abstract getAgentIdentity(): string;

  /**
   * Get agent-specific rules for the system prompt
   */
  abstract getAgentSpecificRules(): string;

  /**
   * Build the job prompt (user message)
   */
  abstract buildJobPrompt(job: AgentJob): string;

  /**
   * Process the final completion from the LLM
   */
  abstract processCompletion(content: string, ctx: ExecutionContext): Promise<unknown>;
}
