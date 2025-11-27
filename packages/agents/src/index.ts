/**
 * AI Coding Team Agents
 *
 * Provides LLM-powered agents for code analysis, planning, building, and review.
 */

import { Tool } from "@ai-coding-team/types";
import { CoordinatorAgent } from "./coordinator";
import { PlannerAgent } from "./planner";
import { BuilderAgent } from "./builder";
import { ReviewerAgent } from "./reviewer";
import { EvaluatorAgent } from "./evaluator";
import { WatcherAgent } from "./watcher";
import { BaseAgent } from "./base";
import { LLMClient } from "./llm";
import { getToolsForAgent } from "./tools";

// Base agent and types
export { BaseAgent, type AgentJob, type AgentResult, type AgentRunOptions } from "./base";

// Specialized agents
export { CoordinatorAgent } from "./coordinator";
export { PlannerAgent } from "./planner";
export { BuilderAgent, type BuilderInput, type BuilderResult, type PlanStep } from "./builder";
export { ReviewerAgent } from "./reviewer";
export { EvaluatorAgent, type EvaluatorInput, type EvaluatorResult, type QualityScores } from "./evaluator";
export { WatcherAgent, type WatcherInput, type WatcherResult, type Finding } from "./watcher";

// LLM clients
export {
  createLLMClient,
  OpenAIClient,
  AnthropicClient,
  type LLMClient,
  type LLMConfig,
  type Message,
  type ChatOptions,
  type ChatResponse,
  type ToolSchema,
  type ToolCall,
} from "./llm";

// Re-export factory utilities
export { createLLMClientFromEnv, RECOMMENDED_MODELS } from "./llm/factory";

// Prompts
export { buildUntrustedBrainContract, untrustedBrainContractShort } from "./prompts/contracts";

// Tools
export {
  getToolsForAgent,
  getAllTools,
  coordinatorTools,
  plannerTools,
  builderTools,
  reviewerTools,
} from "./tools";

// IDE-Enhanced Tools
export {
  semanticSearchTool,
  webSearchTool,
  readLintsTool,
  findFilesTool,
  ideTools,
} from "./tools/ide-tools";

// Browser Automation Tools
export {
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
  browserWaitTool,
  browserCloseTool,
  browserTools,
} from "./tools/browser-tools";

// Self-Healing Tools
export {
  executeWithHealing,
  withHealing,
  fileOperationHealing,
  gitOperationHealing,
  testExecutionHealing,
  apiCallHealing,
  type HealingStrategy,
  type HealingAction,
  type RetryConfig,
} from "./tools/self-healing";

// Context Management
export {
  ContextManager,
  createContextManager,
  type ContextConfig,
  type TokenEstimate,
} from "./context";

// Reasoning Traces
export {
  ReasoningTracer,
  parseReasoningFromText,
  formatReasoningForPrompt,
  type ReasoningStep,
  type ReasoningChain,
} from "./reasoning";

// Fuzzy Verification
export {
  fuzzyMatch,
  semanticSimilarity,
  verifyCodeOutput,
  verifyJsonStructure,
  verifyGoalAchievement,
  type VerificationResult,
  type VerificationIssue,
} from "./verification";

// OpenTelemetry Tracing
export {
  getTracer,
  traceJob,
  traceTool,
  traceLLM,
  addSpanAttributes,
  recordTokenUsage,
  recordBudgetUsage,
  setupConsoleTracing,
  setupOTLPTracing,
} from "./tracing";

// Conversation Mode
export {
  ConversationAgent,
  createConversation,
  type ConversationContext,
  type ConversationMessage,
  type ConversationIntent,
  type ConversationTurn,
} from "./conversation";

// Insights Watcher (Pattern Detection)
export {
  InsightsWatcher,
  getInsightsWatcher,
  startInsightsWatcher,
} from "./watcher/insights";

// Re-export types from insights
export type {
  Insight,
  InsightCategory,
  WatcherConfig,
  ProjectNotes,
} from "./watcher/insights";

// Notifications (TDLN-OUT broadcast)
export {
  broadcastNotification,
  broadcastToProject,
  broadcastGlobal,
  createProjectNotification,
  createJobNotification,
  createInsightNotification,
  createBudgetNotification,
  createProjectNotesNotification,
  type Notification,
  type NotificationType,
  type NotificationAction,
} from "./notifications";

/**
 * Create an agent instance for the given type with appropriate tools
 */
export function createAgent(
  agentType: string,
  llm: LLMClient,
  customTools?: Tool<unknown, unknown>[]
): BaseAgent {
  const tools = customTools ?? getToolsForAgent(agentType);

  switch (agentType) {
    case "coordinator":
      return new CoordinatorAgent(llm, tools);
    case "planner":
      return new PlannerAgent(llm, tools);
    case "builder":
      return new BuilderAgent(llm, tools);
    case "reviewer":
      return new ReviewerAgent(llm, tools);
    case "evaluator":
      return new EvaluatorAgent(llm, tools);
    case "watcher":
      return new WatcherAgent(llm, tools);
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}
