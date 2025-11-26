/**
 * OpenAI LLM Client
 */

import OpenAI from "openai";
import type {
  LLMClient,
  Message,
  ChatOptions,
  ChatResponse,
  ToolSchema,
  ToolCall,
} from "./index";

export interface OpenAIClientConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
}

export class OpenAIClient implements LLMClient {
  readonly provider = "openai" as const;
  readonly model: string;

  private client: OpenAI;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(config: OpenAIClientConfig = {}) {
    this.model = config.model ?? "gpt-4o";
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
    this.defaultTemperature = config.defaultTemperature ?? 0.1;

    this.client = new OpenAI({
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: config.baseUrl,
    });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const openaiMessages = this.convertMessages(messages);
    const tools = options?.tools ? this.convertTools(options.tools) : undefined;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools,
      max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
      temperature: options?.temperature ?? this.defaultTemperature,
      stop: options?.stopSequences,
    });

    const choice = response.choices[0];
    const message = choice.message;

    // Extract tool calls if present
    let toolCalls: ToolCall[] | undefined;
    if (message.tool_calls && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
    }

    // Map finish reason
    let finishReason: ChatResponse["finishReason"];
    switch (choice.finish_reason) {
      case "stop":
        finishReason = "stop";
        break;
      case "tool_calls":
        finishReason = "tool_calls";
        break;
      case "length":
        finishReason = "length";
        break;
      case "content_filter":
        finishReason = "content_filter";
        break;
      default:
        finishReason = "stop";
    }

    return {
      content: message.content ?? "",
      toolCalls,
      finishReason,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  }

  private convertMessages(
    messages: Message[]
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (msg.role === "tool") {
        return {
          role: "tool" as const,
          content: msg.content,
          tool_call_id: msg.tool_call_id ?? "",
        };
      }

      if (msg.role === "assistant") {
        return {
          role: "assistant" as const,
          content: msg.content,
        };
      }

      if (msg.role === "system") {
        return {
          role: "system" as const,
          content: msg.content,
        };
      }

      return {
        role: "user" as const,
        content: msg.content,
      };
    });
  }

  private convertTools(tools: ToolSchema[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
      },
    }));
  }
}

