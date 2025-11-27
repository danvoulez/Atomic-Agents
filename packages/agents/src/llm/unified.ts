/**
 * Unified LLM Client - Using Official Provider SDKs
 * 
 * This module provides a unified interface for OpenAI, Anthropic, and Google LLMs
 * using their official SDKs directly (not Vercel AI SDK which has tool schema bugs).
 */

import Anthropic from "@anthropic-ai/sdk";
// OpenAI and Google SDKs commented out for now
// import OpenAI from "openai";
// import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import type { LLMClient, Message, ChatOptions, ChatResponse, ToolSchema, ToolCall } from "./index";

// =============================================================================
// Types
// =============================================================================

export type Provider = "openai" | "anthropic" | "google";
export type Mode = "mechanic" | "genius";
export type TaskType = "coding" | "analysis" | "planning" | "review" | "creative" | "general";

export interface ModelInfo {
  tier: "flagship" | "balanced" | "fast";
  context: number;
  vision: boolean;
  tools: boolean;
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
  strengths: readonly string[];
  weaknesses: readonly string[];
  bestFor: readonly string[];
  avoidFor: readonly string[];
}

interface ModelSelection {
  provider: Provider;
  model: string;
  reason: string;
}

// =============================================================================
// Model Characteristics Database
// =============================================================================

export const MODEL_CHARACTERISTICS: Record<string, {
  strengths: readonly string[];
  weaknesses: readonly string[];
  bestFor: readonly string[];
  avoidFor: readonly string[];
}> = {
  "gpt-4o": {
    strengths: ["Fast", "Multimodal", "Good coding"],
    weaknesses: ["Not as deep reasoning as o1"],
    bestFor: ["General tasks", "Quick prototyping"],
    avoidFor: ["Complex multi-step reasoning"],
  },
  "gpt-4o-mini": {
    strengths: ["Fast", "Cost-efficient", "Good for well-defined tasks"],
    weaknesses: ["Less capable on complex reasoning"],
    bestFor: ["Quick bug fixes", "Code formatting", "Validation tasks"],
    avoidFor: ["Complex architectural decisions"],
  },
  "claude-3-5-sonnet-latest": {
    strengths: ["Best balance of speed and capability", "Excellent code gen"],
    weaknesses: ["Not as deep as Opus for complex reasoning"],
    bestFor: ["Daily coding", "Feature implementation", "Code review"],
    avoidFor: ["Extremely complex analysis"],
  },
  "claude-3-5-haiku-latest": {
    strengths: ["Ultra-fast", "Cost-effective", "200K context"],
    weaknesses: ["Limited complex reasoning"],
    bestFor: ["Quick fixes", "Simple refactoring", "Batch processing"],
    avoidFor: ["Complex debugging", "Nuanced analysis"],
  },
  "claude-3-opus-latest": {
    strengths: ["Deepest reasoning", "200K context", "Low hallucination"],
    weaknesses: ["Most expensive", "Slower"],
    bestFor: ["Complex code review", "Security analysis", "Research"],
    avoidFor: ["Simple tasks", "High-volume processing"],
  },
  "gemini-1.5-pro": {
    strengths: ["1M token context", "Strong multimodal", "Good code understanding"],
    weaknesses: ["Can be slower"],
    bestFor: ["Large codebase analysis", "Long documents"],
    avoidFor: ["Very simple tasks"],
  },
  "gemini-1.5-flash": {
    strengths: ["Very fast", "1M context", "Cost-efficient"],
    weaknesses: ["Not as capable as Pro for complex reasoning"],
    bestFor: ["Large file analysis", "Quick reviews", "Batch processing"],
    avoidFor: ["Highly complex reasoning"],
  },
} as const;

// =============================================================================
// Model Registry with Pricing
// =============================================================================

export const MODELS: Record<string, Record<string, ModelInfo>> = {
  openai: {
    "gpt-4o": { 
      tier: "flagship", context: 128000, vision: true, tools: true,
      pricing: { inputPerMillion: 2.50, outputPerMillion: 10.00 },
      ...MODEL_CHARACTERISTICS["gpt-4o"],
    },
    "gpt-4o-mini": { 
      tier: "balanced", context: 128000, vision: true, tools: true,
      pricing: { inputPerMillion: 0.15, outputPerMillion: 0.60 },
      ...MODEL_CHARACTERISTICS["gpt-4o-mini"],
    },
  },
  anthropic: {
    "claude-3-opus-latest": { 
      tier: "flagship", context: 200000, vision: true, tools: true,
      pricing: { inputPerMillion: 15.00, outputPerMillion: 75.00 },
      ...MODEL_CHARACTERISTICS["claude-3-opus-latest"],
    },
    "claude-3-5-sonnet-latest": { 
      tier: "balanced", context: 200000, vision: true, tools: true,
      pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00 },
      ...MODEL_CHARACTERISTICS["claude-3-5-sonnet-latest"],
    },
    "claude-3-5-haiku-latest": { 
      tier: "fast", context: 200000, vision: true, tools: true,
      pricing: { inputPerMillion: 0.80, outputPerMillion: 4.00 },
      ...MODEL_CHARACTERISTICS["claude-3-5-haiku-latest"],
    },
  },
  google: {
    "gemini-1.5-pro": { 
      tier: "flagship", context: 1000000, vision: true, tools: true,
      pricing: { inputPerMillion: 1.25, outputPerMillion: 5.00 },
      ...MODEL_CHARACTERISTICS["gemini-1.5-pro"],
    },
    "gemini-1.5-flash": { 
      tier: "balanced", context: 1000000, vision: true, tools: true,
      pricing: { inputPerMillion: 0.075, outputPerMillion: 0.30 },
      ...MODEL_CHARACTERISTICS["gemini-1.5-flash"],
    },
  },
};

// =============================================================================
// Model Selection Logic
// =============================================================================

export function selectModel(
  mode: Mode,
  taskType: TaskType = "general",
  preferredProvider?: Provider
): ModelSelection {
  const provider = preferredProvider 
    ?? (process.env.LLM_PROVIDER as Provider) 
    ?? "anthropic";

  if (mode === "mechanic") {
    switch (provider) {
      case "openai":
        return { provider, model: "gpt-4o-mini", reason: "Fast execution for bounded tasks" };
      case "anthropic":
        return { provider, model: "claude-3-5-haiku-latest", reason: "Quick responses for simple fixes" };
      case "google":
        return { provider, model: "gemini-1.5-flash", reason: "Ultra-fast for mechanical tasks" };
    }
  }

  // Genius mode - task-specific optimization
  switch (taskType) {
    case "coding":
    case "analysis":
    case "review":
      if (provider === "anthropic") return { provider, model: "claude-3-5-sonnet-latest", reason: "Best for coding" };
      if (provider === "openai") return { provider, model: "gpt-4o", reason: "Strong coding" };
      return { provider: "google", model: "gemini-1.5-pro", reason: "Strong coding with long context" };

    case "planning":
    default:
      switch (provider) {
        case "openai":
          return { provider, model: "gpt-4o", reason: "General flagship model" };
        case "anthropic":
          return { provider, model: "claude-3-5-sonnet-latest", reason: "Balanced performance" };
        case "google":
          return { provider, model: "gemini-1.5-pro", reason: "Best context window" };
      }
  }

  return { provider: "anthropic", model: "claude-3-5-sonnet-latest", reason: "Default fallback" };
}

// =============================================================================
// Unified Client Configuration
// =============================================================================

export interface UnifiedLLMConfig {
  provider?: Provider;
  model?: string;
  mode?: Mode;
  taskType?: TaskType;
  apiKeys?: {
    openai?: string;
    anthropic?: string;
    google?: string;
  };
}

// =============================================================================
// Unified Client Implementation
// =============================================================================

export class UnifiedLLMClient implements LLMClient {
  readonly provider: Provider;
  readonly model: string;
  
  private anthropic?: Anthropic;
  // OpenAI and Google clients commented out
  // private openai?: OpenAI;
  // private google?: GoogleGenerativeAI;
  // private googleModel?: GenerativeModel;
  private selection: ModelSelection;

  constructor(config: UnifiedLLMConfig = {}) {
    // Force Anthropic for now
    const forcedProvider: Provider = "anthropic";
    
    this.selection = config.model 
      ? { provider: forcedProvider, model: config.model, reason: "Explicit model" }
      : selectModel(config.mode ?? "mechanic", config.taskType, forcedProvider);
    
    this.provider = this.selection.provider;
    this.model = this.selection.model;

    console.log(`[UnifiedLLM] Selected: ${this.provider}/${this.model} (${this.selection.reason})`);

    // Initialize Anthropic only
    const anthropicKey = config.apiKeys?.anthropic ?? process.env.ANTHROPIC_API_KEY;

    if (anthropicKey) {
      this.anthropic = new Anthropic({ apiKey: anthropicKey });
    } else {
      throw new Error("ANTHROPIC_API_KEY is required");
    }
    
    // OpenAI and Google initialization commented out
    // const openaiKey = config.apiKeys?.openai ?? process.env.OPENAI_API_KEY;
    // const googleKey = config.apiKeys?.google ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    // if (openaiKey && this.provider === "openai") {
    //   this.openai = new OpenAI({ apiKey: openaiKey });
    // }
    // if (googleKey && this.provider === "google") {
    //   this.google = new GoogleGenerativeAI(googleKey);
    //   this.googleModel = this.google.getGenerativeModel({ model: this.model });
    // }
  }

  /**
   * Convert ToolSchema to provider-specific format
   */
  private convertToolsForAnthropic(tools: ToolSchema[]): Anthropic.Messages.Tool[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        properties: t.parameters.properties,
        required: t.parameters.required ?? [],
      },
    }));
  }

  // OpenAI tool conversion commented out
  // private convertToolsForOpenAI(tools: ToolSchema[]): OpenAI.Chat.ChatCompletionTool[] { ... }

  /**
   * Main chat method - implements LLMClient interface
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    // Only Anthropic is supported for now
    return this.chatAnthropic(messages, options);
  }

  private async chatAnthropic(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.anthropic) {
      throw new Error("Anthropic client not initialized. Set ANTHROPIC_API_KEY.");
    }

    // Separate system message
    const systemMessage = messages.find(m => m.role === "system");
    const otherMessages = messages.filter(m => m.role !== "system");

    // Convert messages to Anthropic format
    const anthropicMessages: Anthropic.Messages.MessageParam[] = otherMessages.map(m => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          content: [{
            type: "tool_result" as const,
            tool_use_id: m.tool_call_id ?? "",
            content: m.content,
          }],
        };
      }
      if (m.role === "assistant" && m.tool_calls?.length) {
        return {
          role: "assistant" as const,
          content: [
            ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
            ...m.tool_calls.map(tc => ({
              type: "tool_use" as const,
              id: tc.id,
              name: tc.name,
              input: JSON.parse(tc.arguments),
            })),
          ],
        };
      }
      return {
        role: m.role as "user" | "assistant",
        content: m.content,
      };
    });

    const tools = options?.tools ? this.convertToolsForAnthropic(options.tools) : undefined;

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: systemMessage?.content,
      messages: anthropicMessages,
      tools,
      temperature: options?.temperature ?? 0.1,
    });

    // Parse response
    const toolCalls: ToolCall[] = [];
    let textContent = "";

    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    let finishReason: ChatResponse["finishReason"] = "stop";
    if (response.stop_reason === "tool_use") {
      finishReason = "tool_calls";
    } else if (response.stop_reason === "max_tokens") {
      finishReason = "length";
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  // OpenAI and Google chat methods commented out for now
  // private async chatOpenAI(messages: Message[], options?: ChatOptions): Promise<ChatResponse> { ... }
  // private async chatGoogle(messages: Message[], options?: ChatOptions): Promise<ChatResponse> { ... }

  getSelection(): ModelSelection {
    return this.selection;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createUnifiedClient(config?: UnifiedLLMConfig): UnifiedLLMClient {
  return new UnifiedLLMClient(config);
}

export function createClientForMode(mode: Mode, taskType?: TaskType): UnifiedLLMClient {
  return new UnifiedLLMClient({ mode, taskType });
}

export function createClientWithModel(provider: Provider, model: string): UnifiedLLMClient {
  return new UnifiedLLMClient({ provider, model });
}

// =============================================================================
// Cost Calculation
// =============================================================================

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: "USD";
}

export function calculateCost(
  provider: Provider,
  model: string,
  usage: TokenUsage
): CostEstimate {
  const modelInfo = MODELS[provider]?.[model];
  
  if (!modelInfo) {
    return {
      inputCost: (usage.inputTokens / 1_000_000) * 1.00,
      outputCost: (usage.outputTokens / 1_000_000) * 5.00,
      totalCost: (usage.inputTokens / 1_000_000) * 1.00 + (usage.outputTokens / 1_000_000) * 5.00,
      currency: "USD",
    };
  }

  const inputCost = (usage.inputTokens / 1_000_000) * modelInfo.pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * modelInfo.pricing.outputPerMillion;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: "USD",
  };
}

export function getModelPricing(provider: Provider, model: string) {
  return MODELS[provider]?.[model]?.pricing ?? { inputPerMillion: 1.00, outputPerMillion: 5.00 };
}

export function estimateJobCost(
  provider: Provider,
  model: string,
  expectedInputTokens: number,
  expectedOutputTokens: number
): CostEstimate {
  return calculateCost(provider, model, {
    inputTokens: expectedInputTokens,
    outputTokens: expectedOutputTokens,
  });
}

export function formatCost(cost: CostEstimate): string {
  if (cost.totalCost < 0.01) {
    return `$${(cost.totalCost * 100).toFixed(3)}¢`;
  }
  return `$${cost.totalCost.toFixed(4)}`;
}

// =============================================================================
// UI Configuration Types
// =============================================================================

export interface ProviderConfig {
  id: Provider;
  name: string;
  icon: string;
  models: ModelConfig[];
}

export interface ModelConfig {
  id: string;
  name: string;
  tier: "flagship" | "balanced" | "fast";
  description: string;
  contextWindow: number;
  supportsVision: boolean;
  supportsTools: boolean;
  recommendedFor: Mode[];
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
}

export function getAvailableModels(): ProviderConfig[] {
  return [
    {
      id: "openai",
      name: "OpenAI",
      icon: "🤖",
      models: [
        { id: "gpt-4o", name: "GPT-4o", tier: "flagship", description: "Flagship multimodal", contextWindow: 128000, supportsVision: true, supportsTools: true, recommendedFor: ["genius"], pricing: { inputPerMillion: 2.50, outputPerMillion: 10.00 } },
        { id: "gpt-4o-mini", name: "GPT-4o Mini", tier: "balanced", description: "Fast, cost-efficient", contextWindow: 128000, supportsVision: true, supportsTools: true, recommendedFor: ["mechanic"], pricing: { inputPerMillion: 0.15, outputPerMillion: 0.60 } },
      ],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      icon: "🧠",
      models: [
        { id: "claude-3-opus-latest", name: "Claude 3 Opus", tier: "flagship", description: "Deepest reasoning", contextWindow: 200000, supportsVision: true, supportsTools: true, recommendedFor: ["genius"], pricing: { inputPerMillion: 15.00, outputPerMillion: 75.00 } },
        { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", tier: "balanced", description: "Best balance", contextWindow: 200000, supportsVision: true, supportsTools: true, recommendedFor: ["mechanic", "genius"], pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00 } },
        { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku", tier: "fast", description: "Ultra-fast", contextWindow: 200000, supportsVision: true, supportsTools: true, recommendedFor: ["mechanic"], pricing: { inputPerMillion: 0.80, outputPerMillion: 4.00 } },
      ],
    },
    {
      id: "google",
      name: "Google",
      icon: "✨",
      models: [
        { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", tier: "flagship", description: "1M context", contextWindow: 1000000, supportsVision: true, supportsTools: true, recommendedFor: ["genius"], pricing: { inputPerMillion: 1.25, outputPerMillion: 5.00 } },
        { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", tier: "balanced", description: "Fast with quality", contextWindow: 1000000, supportsVision: true, supportsTools: true, recommendedFor: ["mechanic"], pricing: { inputPerMillion: 0.075, outputPerMillion: 0.30 } },
      ],
    },
  ];
}
