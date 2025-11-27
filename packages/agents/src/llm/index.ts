/**
 * LLM Client Interface
 *
 * Provides a unified interface for interacting with different LLM providers
 * (OpenAI, Anthropic, Google). Supports tool/function calling for agent workflows.
 * 
 * Uses Vercel AI SDK for unified provider access with intelligent model selection.
 */

export { OpenAIClient } from "./openai";
export { AnthropicClient } from "./anthropic";
export { MockLLMClient, createMockResponse, createMockConversation } from "./mock";
export { 
  createLLMClient, 
  createLLMClientFromEnv, 
  createTestLLMClient, 
  RECOMMENDED_MODELS,
} from "./factory";

// Unified LLM client (Vercel AI SDK)
export {
  UnifiedLLMClient,
  createUnifiedClient,
  createClientForMode,
  createClientWithModel,
  selectModel,
  getAvailableModels,
  MODELS,
  MODEL_CHARACTERISTICS,
  calculateCost,
  getModelPricing,
  estimateJobCost,
  formatCost,
  type UnifiedLLMConfig,
  type ProviderConfig,
  type ModelConfig,
  type TokenUsage,
  type CostEstimate,
  type ModelInfo,
} from "./unified";

// Model Selection Matrix (quick ratings-based selection)
export {
  MODEL_PROFILES,
  PHASE_REQUIREMENTS,
  TASK_PROFILES,
  getModelForTask,
  getModelForPhase,
  estimateTaskCost,
  formatCostEstimate,
  recommend,
  printModelMatrix,
  type Rating,
  type ModelRatings,
  type ModelProfile,
  type JobPhase,
  type PhaseRequirements,
  type TaskType,
  type TaskProfile,
  type ModelRecommendation,
} from "./model-matrix";

/**
 * Message in a conversation
 */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string; // Tool name for tool messages
  tool_call_id?: string; // For tool response messages
  tool_calls?: ToolCall[]; // Tool calls made by assistant
}

/**
 * Tool/function schema for LLM
 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool call requested by the LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

/**
 * Options for chat completion
 */
export interface ChatOptions {
  tools?: ToolSchema[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

/**
 * Response from chat completion
 */
export interface ChatResponse {
  content: string | null;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "content_filter";
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Unified LLM client interface
 */
export interface LLMClient {
  /**
   * Provider name
   */
  readonly provider?: "openai" | "anthropic" | "google" | "mock";

  /**
   * Model being used
   */
  readonly model?: string;

  /**
   * Send messages and get a response
   */
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
}

/**
 * Alias for ChatResponse (for backward compatibility)
 */
export type LLMResponse = ChatResponse;

/**
 * Configuration for creating an LLM client
 */
export interface LLMConfig {
  provider: "openai" | "anthropic";
  model?: string;
  apiKey?: string; // Falls back to env var
  baseUrl?: string; // For custom endpoints
  defaultMaxTokens?: number;
  defaultTemperature?: number;
}

/**
 * Configuration for LLM client implementations
 */
export interface LLMClientConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
}

