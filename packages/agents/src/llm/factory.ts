/**
 * LLM Client Factory
 *
 * Creates LLM clients for different providers with a unified interface.
 * Supports real providers (OpenAI, Anthropic) and mock for testing.
 */

import type { LLMClient, LLMConfig } from "./index";
import { OpenAIClient } from "./openai";
import { AnthropicClient } from "./anthropic";
import { MockLLMClient, type MockLLMConfig } from "./mock";

/**
 * Extended config that includes mock provider
 */
export interface LLMFactoryConfig {
  provider: "openai" | "anthropic" | "mock";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  mockConfig?: MockLLMConfig;
}

/**
 * Create an LLM client based on configuration
 */
export function createLLMClient(config: LLMFactoryConfig): LLMClient {
  switch (config.provider) {
    case "openai":
      return new OpenAIClient({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        defaultMaxTokens: config.defaultMaxTokens,
        defaultTemperature: config.defaultTemperature,
      });

    case "anthropic":
      return new AnthropicClient({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        defaultMaxTokens: config.defaultMaxTokens,
        defaultTemperature: config.defaultTemperature,
      });

    case "mock":
      return new MockLLMClient(config.mockConfig);

    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

/**
 * Create an LLM client from environment variables
 *
 * Uses OPENAI_API_KEY or ANTHROPIC_API_KEY to determine provider.
 * Can be overridden with LLM_PROVIDER and LLM_MODEL env vars.
 * 
 * Set USE_REAL_LLM=true in tests to use real LLM instead of mock.
 * Set LLM_PROVIDER=mock to explicitly use mock LLM.
 */
export function createLLMClientFromEnv(): LLMClient {
  const provider = process.env.LLM_PROVIDER as "openai" | "anthropic" | "mock" | undefined;
  const model = process.env.LLM_MODEL;
  const useRealLLM = process.env.USE_REAL_LLM === "true";
  const mockUrl = process.env.MOCK_LLM_URL ?? "http://localhost:8000";

  // Explicit mock provider
  if (provider === "mock") {
    console.log("[LLM] Using mock LLM server at", mockUrl);
    return createLLMClient({
      provider: "mock",
      mockConfig: { baseUrl: mockUrl },
    });
  }

  // Explicit real provider with API key
  if (provider === "openai") {
    console.log(`[LLM] Using OpenAI with model ${model ?? getDefaultModel("openai")}`);
    return createLLMClient({ provider: "openai", model: model ?? getDefaultModel("openai") });
  }
  
  if (provider === "anthropic") {
    console.log(`[LLM] Using Anthropic with model ${model ?? getDefaultModel("anthropic")}`);
    return createLLMClient({ provider: "anthropic", model: model ?? getDefaultModel("anthropic") });
  }

  // Auto-detect from available API keys (prefer Anthropic)
  if (process.env.ANTHROPIC_API_KEY && (useRealLLM || !process.env.MOCK_LLM_URL)) {
    console.log("[LLM] Using Anthropic (auto-detected from ANTHROPIC_API_KEY)");
    return createLLMClient({
      provider: "anthropic",
      model: model ?? "claude-sonnet-4-20250514",
    });
  }

  if (process.env.OPENAI_API_KEY && (useRealLLM || !process.env.MOCK_LLM_URL)) {
    console.log("[LLM] Using OpenAI (auto-detected from OPENAI_API_KEY)");
    return createLLMClient({
      provider: "openai",
      model: model ?? "gpt-4o",
    });
  }

  // Fall back to mock if MOCK_LLM_URL is set
  if (process.env.MOCK_LLM_URL) {
    console.log("[LLM] Falling back to mock LLM server at", mockUrl);
    return createLLMClient({
      provider: "mock",
      mockConfig: { baseUrl: mockUrl },
    });
  }

  throw new Error(
    "No LLM configuration found. Set one of:\n" +
    "  - OPENAI_API_KEY (for OpenAI)\n" +
    "  - ANTHROPIC_API_KEY (for Anthropic)\n" +
    "  - LLM_PROVIDER=mock + MOCK_LLM_URL (for testing)\n" +
    "Or explicitly set LLM_PROVIDER to 'openai', 'anthropic', or 'mock'."
  );
}

/**
 * Create an LLM client optimized for testing
 * 
 * If USE_REAL_LLM=true and API keys are available, uses real LLM.
 * Otherwise uses mock LLM server.
 */
export function createTestLLMClient(): LLMClient {
  const useRealLLM = process.env.USE_REAL_LLM === "true";
  
  if (useRealLLM) {
    // Try to create real LLM client
    if (process.env.ANTHROPIC_API_KEY) {
      console.log("[TEST LLM] Using real Anthropic API");
      return createLLMClient({
        provider: "anthropic",
        model: process.env.LLM_MODEL ?? "claude-sonnet-4-20250514",
      });
    }
    
    if (process.env.OPENAI_API_KEY) {
      console.log("[TEST LLM] Using real OpenAI API");
      return createLLMClient({
        provider: "openai",
        model: process.env.LLM_MODEL ?? "gpt-4o-mini",
      });
    }
    
    console.warn("[TEST LLM] USE_REAL_LLM=true but no API keys found, falling back to mock");
  }
  
  // Default to mock
  const mockUrl = process.env.MOCK_LLM_URL ?? "http://localhost:8000";
  console.log("[TEST LLM] Using mock LLM server at", mockUrl);
  return createLLMClient({
    provider: "mock",
    mockConfig: { baseUrl: mockUrl },
  });
}

function getDefaultModel(provider: "openai" | "anthropic"): string {
  switch (provider) {
    case "openai":
      return "gpt-4o";
    case "anthropic":
      return "claude-sonnet-4-20250514";
  }
}

/**
 * Recommended models for different modes
 */
export const RECOMMENDED_MODELS = {
  mechanic: {
    openai: "gpt-4o-mini",
    anthropic: "claude-sonnet-4-20250514",
  },
  genius: {
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
  },
} as const;

