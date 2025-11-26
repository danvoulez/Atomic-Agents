/**
 * Anthropic LLM Client
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMClient,
  Message,
  ChatOptions,
  ChatResponse,
  ToolSchema,
  ToolCall,
} from "./index";

export interface AnthropicClientConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
}

export class AnthropicClient implements LLMClient {
  readonly provider = "anthropic" as const;
  readonly model: string;

  private client: Anthropic;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(config: AnthropicClientConfig = {}) {
    this.model = config.model ?? "claude-sonnet-4-20250514";
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
    this.defaultTemperature = config.defaultTemperature ?? 0.1;

    this.client = new Anthropic({
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
      baseURL: config.baseUrl,
    });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    // Extract system message if present
    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const anthropicMessages = this.convertMessages(nonSystemMessages);
    const tools = options?.tools ? this.convertTools(options.tools) : undefined;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
      temperature: options?.temperature ?? this.defaultTemperature,
      system: systemMessage?.content,
      messages: anthropicMessages,
      tools,
      stop_sequences: options?.stopSequences,
    });

    // Extract content and tool calls
    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    // Map stop reason
    let finishReason: ChatResponse["finishReason"];
    switch (response.stop_reason) {
      case "end_turn":
        finishReason = toolCalls.length > 0 ? "tool_calls" : "stop";
        break;
      case "tool_use":
        finishReason = "tool_calls";
        break;
      case "max_tokens":
        finishReason = "length";
        break;
      case "stop_sequence":
        finishReason = "stop";
        break;
      default:
        finishReason = "stop";
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  private convertMessages(messages: Message[]): Anthropic.Messages.MessageParam[] {
    const result: Anthropic.Messages.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        result.push({
          role: "user",
          content: msg.content,
        });
      } else if (msg.role === "assistant") {
        result.push({
          role: "assistant",
          content: msg.content,
        });
      } else if (msg.role === "tool") {
        // Tool results in Anthropic are sent as user messages with tool_result blocks
        result.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id ?? "",
              content: msg.content,
            },
          ],
        });
      }
    }

    return result;
  }

  private convertTools(tools: ToolSchema[]): Anthropic.Messages.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object" as const,
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }
}

