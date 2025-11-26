/**
 * Mock LLM Client
 *
 * Connects to the mock-llm server for deterministic testing.
 * Can also return pre-configured responses without network calls.
 */

import type { LLMClient, LLMClientConfig, Message, LLMResponse, ToolSchema } from "./index";

export interface MockLLMConfig extends LLMClientConfig {
  baseUrl?: string; // Mock server URL (default: http://localhost:8000)
  scenario?: string; // Pre-configured scenario name
  responses?: LLMResponse[]; // Pre-configured responses for sequential calls
}

export class MockLLMClient implements LLMClient {
  private baseUrl: string;
  private scenario?: string;
  private responses: LLMResponse[];
  private responseIndex: number = 0;
  private requestCount: number = 0;

  constructor(config: MockLLMConfig = {}) {
    this.baseUrl = config.baseUrl ?? process.env.MOCK_LLM_URL ?? "http://localhost:8000";
    this.scenario = config.scenario;
    this.responses = config.responses ?? [];
  }

  async chat(
    messages: Message[],
    options?: {
      tools?: ToolSchema[];
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<LLMResponse> {
    this.requestCount++;

    // If pre-configured responses exist, use them
    if (this.responses.length > 0) {
      const response = this.responses[this.responseIndex % this.responses.length];
      this.responseIndex++;
      return response;
    }

    // Otherwise call mock server
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.scenario && { "X-Mock-Scenario": this.scenario }),
        },
        body: JSON.stringify({
          model: "mock",
          messages,
          tools: options?.tools,
          max_tokens: options?.maxTokens,
          temperature: options?.temperature,
        }),
      });

      if (!response.ok) {
        throw new Error(`Mock LLM request failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Parse OpenAI format response
      const choice = data.choices?.[0];
      const message = choice?.message;

      return {
        content: message?.content || null,
        toolCalls: message?.tool_calls?.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        })),
        finishReason: choice?.finish_reason || "stop",
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      console.error("Mock LLM error:", error);
      // Return a safe fallback response
      return {
        content: "Mock LLM server unavailable. Returning fallback response.",
        finishReason: "stop",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  /**
   * Reset the response index and request count
   */
  reset(): void {
    this.responseIndex = 0;
    this.requestCount = 0;
  }

  /**
   * Get the number of requests made
   */
  getRequestCount(): number {
    return this.requestCount;
  }

  /**
   * Set a scenario for subsequent requests
   */
  setScenario(scenario: string): void {
    this.scenario = scenario;
  }

  /**
   * Set pre-configured responses
   */
  setResponses(responses: LLMResponse[]): void {
    this.responses = responses;
    this.responseIndex = 0;
  }
}

/**
 * Create a mock response for testing
 */
export function createMockResponse(
  content: string | null,
  toolCalls?: { name: string; arguments: Record<string, unknown> }[],
  finishReason: LLMResponse["finishReason"] = "stop"
): LLMResponse {
  return {
    content,
    toolCalls: toolCalls?.map((tc, i) => ({
      id: `mock_call_${i}`,
      name: tc.name,
      arguments: JSON.stringify(tc.arguments),
    })),
    finishReason,
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  };
}

/**
 * Create a sequence of mock responses for multi-turn testing
 */
export function createMockConversation(steps: {
  thought?: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  finalResponse?: string;
}[]): LLMResponse[] {
  return steps.map((step) => {
    if (step.finalResponse) {
      return createMockResponse(step.finalResponse);
    }
    
    if (step.toolCall) {
      return createMockResponse(
        step.thought || null,
        [step.toolCall],
        "tool_calls"
      );
    }
    
    return createMockResponse(step.thought || "Thinking...");
  });
}

