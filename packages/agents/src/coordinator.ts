/**
 * CoordinatorAgent - Routes user requests to specialist agents
 *
 * Role:
 * - Receive user requests (as LogLine operation spans)
 * - Route to the appropriate specialist agent via TDLN-IN translation
 * - Monitor progress and report back
 * - Handle clarifications when TDLN returns ABSTAIN
 */

import { BaseAgent, AgentJob } from "./base";
import {
  translateToLogLine,
  type TranslateResult,
} from "@ai-coding-team/machinery";

/**
 * Cached translation result for the current job
 */
interface TranslationCache {
  jobId: string;
  result: TranslateResult;
}

export class CoordinatorAgent extends BaseAgent {
  private translationCache: TranslationCache | null = null;

  getAgentType(): string {
    return "coordinator";
  }

  getAgentIdentity(): string {
    return `
You are the COORDINATOR of an AI coding team.

YOUR ROLE:
- Receive user requests and translate them to LogLine operation spans
- Route to the appropriate specialist agent based on operation type
- Monitor delegated job progress and report back
- Handle clarifications when intent is unclear (ABSTAIN verdict)

CRITICAL: You are the entry point. All user requests flow through you.
`.trim();
  }

  getAgentSpecificRules(): string {
    return `
ROUTING RULES (based on TDLN-IN translation):
┌─────────────────┬──────────────────────────────────────────────────┐
│ OPERATION       │ ACTION                                           │
├─────────────────┼──────────────────────────────────────────────────┤
│ bug_fix         │ delegate_to_agent(planner, mechanic)             │
│ feature         │ delegate_to_agent(planner, genius)               │
│ analyze         │ delegate_to_agent(planner, mechanic, read-only)  │
│ review          │ delegate_to_agent(reviewer, mechanic)            │
│ refactor        │ delegate_to_agent(planner, genius)               │
│ ABSTAIN         │ ask_user for clarification                       │
└─────────────────┴──────────────────────────────────────────────────┘

WORKFLOW:
1. TDLN-IN has translated the user request (see TRANSLATION section below)
2. If verdict is ABSTAIN → use ask_user tool with the clarification message
3. If verdict is Translated → use delegate_to_agent with the operation type
4. After delegation → use check_job_status to monitor progress
5. When delegated job completes → use format_response to return result

IMPORTANT RULES:
- NEVER guess what the user meant - use ask_user if unclear
- ALWAYS check delegated job status before formatting response
- Wait for delegated jobs to complete (status: succeeded/failed)
- If delegated job fails, report the failure to the user

MONITORING PATTERN:
After calling delegate_to_agent, you should:
1. Call check_job_status with the returned jobId
2. If status is "running" or "queued", wait and check again
3. If status is "succeeded", get the output and format_response
4. If status is "failed", report the error to the user
5. If status is "waiting_human", inform user and wait

MODE SELECTION:
- mechanic mode: Safe, bounded changes. Max 5 files, 200 lines. Use for bug fixes.
- genius mode: Larger changes allowed. Use for features and refactoring.
`.trim();
  }

  /**
   * Translate the user request using TDLN-IN before building the job prompt.
   * This is called by the base agent's run() method.
   */
  buildJobPrompt(job: AgentJob): string {
    // Translate the user request through TDLN-IN
    const translated = this.translateUserRequest(job);

    // Build prompt based on translation result
    if (translated.verdict === "Abstain") {
      return `
COORDINATION JOB
================

TRANSLATION: ABSTAIN
────────────────────
The user request could not be translated to a specific operation.

User Request: "${job.goal}"
Reason: ${translated.abstainReason || "unclear_intent"}
Suggested Clarification: ${translated.clarification || "I'm not sure what you'd like me to do."}

ACTION REQUIRED:
Use the ask_user tool to request clarification from the user.
Pass the suggested clarification text as the question.

DO NOT PROCEED with delegation until you have a clear operation type.
`.trim();
    }

    // Successfully translated - provide operation details
    const operationType = translated.span.name || "unknown";
    const params = this.formatSpanParams(translated.span.params);
    const mode = this.getModeForOperation(operationType, job.mode);

    return `
COORDINATION JOB
================

TRANSLATION: SUCCESS
────────────────────
Operation: ${operationType}
Mode: ${mode}
Parameters:
${params}

Original Request: "${job.goal}"
Repository: ${job.repoPath}

ACTION REQUIRED:
1. Delegate to the appropriate agent based on the operation type
2. Use delegate_to_agent with:
   - agentType: "${this.getAgentForOperation(operationType)}"
   - goal: "${job.goal}"
   - mode: "${mode}"
3. Monitor the delegated job with check_job_status
4. Format the result when complete

START by calling delegate_to_agent now.
`.trim();
  }

  /**
   * Translate user request using TDLN-IN
   */
  private translateUserRequest(job: AgentJob): TranslateResult {
    // Check cache first (in case buildJobPrompt is called multiple times)
    if (this.translationCache?.jobId === job.id) {
      return this.translationCache.result;
    }

    // Translate using TDLN-IN
    const result = translateToLogLine({ text: job.goal });

    // Cache the result
    this.translationCache = { jobId: job.id, result };

    return result;
  }

  /**
   * Format span parameters for display
   */
  private formatSpanParams(params: Array<[string, unknown]> | undefined): string {
    if (!params || params.length === 0) {
      return "  (none)";
    }

    return params
      .map(([key, value]) => {
        const displayValue = typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
        return `  - ${key}: ${displayValue}`;
      })
      .join("\n");
  }

  /**
   * Determine the appropriate mode for an operation
   */
  private getModeForOperation(
    operation: string,
    defaultMode: "mechanic" | "genius"
  ): "mechanic" | "genius" {
    // Operations that should always use genius mode
    const geniusOperations = ["feature", "refactor"];
    if (geniusOperations.includes(operation)) {
      return "genius";
    }

    // Operations that should always use mechanic mode
    const mechanicOperations = ["bug_fix", "analyze", "review"];
    if (mechanicOperations.includes(operation)) {
      return "mechanic";
    }

    // Default to the job's mode
    return defaultMode;
  }

  /**
   * Get the appropriate agent type for an operation
   */
  private getAgentForOperation(operation: string): string {
    const routingTable: Record<string, string> = {
      bug_fix: "planner",
      feature: "planner",
      analyze: "planner",
      review: "reviewer",
      refactor: "planner",
    };

    return routingTable[operation] || "planner";
  }

  async processCompletion(content: string): Promise<unknown> {
    return {
      type: "coordination_complete",
      message: content || "Task coordinated successfully",
    };
  }
}
