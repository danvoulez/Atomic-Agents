/**
 * LLM Client Interface
 *
 * Provides a unified interface for interacting with different LLM providers
 * (OpenAI, Anthropic, Mock). Supports tool/function calling for agent workflows.
 */

export { OpenAIClient } from "./openai";
export { AnthropicClient } from "./anthropic";
export { MockLLMClient, createMockResponse, createMockConversation } from "./mock";
export { createLLMClient, createLLMClientFromEnv, createTestLLMClient, RECOMMENDED_MODELS } from "./factory";

/**
 * Message in a conversation
 */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string; // Tool name for tool messages
  tool_call_id?: string; // For tool response messages
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
  readonly provider?: "openai" | "anthropic" | "mock";

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

