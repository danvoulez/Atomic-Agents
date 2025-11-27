/**
 * LLM Client Factory
 *
 * Creates LLM clients for different providers with a unified interface.
 * Now uses Vercel AI SDK for OpenAI, Anthropic, and Google providers.
 * Supports mock provider for testing.
 */

import type { LLMClient } from "./index";
import { UnifiedLLMClient, createUnifiedClient, type UnifiedLLMConfig } from "./unified";
import { MockLLMClient, type MockLLMConfig } from "./mock";

// Re-export legacy clients for backwards compatibility
export { OpenAIClient } from "./openai";
export { AnthropicClient } from "./anthropic";

/**
 * Extended config that includes mock provider
 */
export interface LLMFactoryConfig {
  provider: "openai" | "anthropic" | "google" | "mock";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  mockConfig?: MockLLMConfig;
  mode?: "mechanic" | "genius";
  taskType?: "coding" | "analysis" | "planning" | "review" | "creative" | "general";
}

/**
 * Create an LLM client based on configuration
 * Now uses UnifiedLLMClient (Vercel AI SDK) for real providers
 */
export function createLLMClient(config: LLMFactoryConfig): LLMClient {
  if (config.provider === "mock") {
    return new MockLLMClient(config.mockConfig);
  }

  // Use unified client for all real providers
  const unifiedConfig: UnifiedLLMConfig = {
    provider: config.provider as "openai" | "anthropic" | "google",
    model: config.model,
    mode: config.mode,
    taskType: config.taskType,
  };

  return createUnifiedClient(unifiedConfig);
}

/**
 * Create an LLM client from environment variables
 *
 * Uses API keys to determine provider priority: Anthropic > OpenAI > Google.
 * Can be overridden with LLM_PROVIDER, LLM_MODEL, and LLM_MODE env vars.
 * 
 * Set USE_REAL_LLM=true in tests to use real LLM instead of mock.
 * Set LLM_PROVIDER=mock to explicitly use mock LLM.
 */
export function createLLMClientFromEnv(): LLMClient {
  const provider = process.env.LLM_PROVIDER as "openai" | "anthropic" | "google" | "mock" | undefined;
  const model = process.env.LLM_MODEL;
  const mode = (process.env.LLM_MODE ?? "mechanic") as "mechanic" | "genius";
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

  // Explicit real provider with intelligent model selection
  if (provider === "openai" || provider === "anthropic" || provider === "google") {
    return createLLMClient({ 
      provider, 
      model: model ?? undefined, // Let unified client select based on mode
      mode,
    });
  }

  // Auto-detect from available API keys (prefer Anthropic > Google > OpenAI)
  if (process.env.ANTHROPIC_API_KEY && (useRealLLM || !process.env.MOCK_LLM_URL)) {
    return createLLMClient({
      provider: "anthropic",
      model: model ?? undefined,
      mode,
    });
  }

  if ((process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) && (useRealLLM || !process.env.MOCK_LLM_URL)) {
    return createLLMClient({
      provider: "google",
      model: model ?? undefined,
      mode,
    });
  }

  if (process.env.OPENAI_API_KEY && (useRealLLM || !process.env.MOCK_LLM_URL)) {
    return createLLMClient({
      provider: "openai",
      model: model ?? undefined,
      mode,
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
    "  - ANTHROPIC_API_KEY (for Anthropic Claude)\n" +
    "  - OPENAI_API_KEY (for OpenAI GPT)\n" +
    "  - GOOGLE_API_KEY or GEMINI_API_KEY (for Google Gemini)\n" +
    "  - LLM_PROVIDER=mock + MOCK_LLM_URL (for testing)\n" +
    "Or explicitly set LLM_PROVIDER to 'openai', 'anthropic', 'google', or 'mock'."
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
  const mode = (process.env.LLM_MODE ?? "mechanic") as "mechanic" | "genius";
  
  if (useRealLLM) {
    // Try to create real LLM client with intelligent model selection
    if (process.env.ANTHROPIC_API_KEY) {
      console.log("[TEST LLM] Using real Anthropic API");
      return createLLMClient({
        provider: "anthropic",
        model: process.env.LLM_MODEL ?? undefined,
        mode,
      });
    }
    
    if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
      console.log("[TEST LLM] Using real Google Gemini API");
      return createLLMClient({
        provider: "google",
        model: process.env.LLM_MODEL ?? undefined,
        mode,
      });
    }
    
    if (process.env.OPENAI_API_KEY) {
      console.log("[TEST LLM] Using real OpenAI API");
      return createLLMClient({
        provider: "openai",
        model: process.env.LLM_MODEL ?? undefined,
        mode,
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

/**
 * Recommended models for different modes (Nov 2025)
 * These are automatically selected by the UnifiedLLMClient based on mode
 */
export const RECOMMENDED_MODELS = {
  mechanic: {
    openai: "gpt-5-mini",
    anthropic: "claude-haiku-4-5",
    google: "gemini-2.5-flash-lite",
  },
  genius: {
    openai: "gpt-5.1",
    anthropic: "claude-sonnet-4-5",
    google: "gemini-3-pro-preview",
  },
} as const;

// Re-export unified client utilities
export { 
  UnifiedLLMClient, 
  createUnifiedClient, 
  createClientForMode,
  createClientWithModel,
  selectModel,
  getAvailableModels,
  MODELS,
  type UnifiedLLMConfig,
  type ProviderConfig,
  type ModelConfig,
} from "./unified";

