/**
 * Context Window Manager
 * 
 * Manages conversation context to fit within LLM token limits.
 * Implements intelligent summarization and compression strategies.
 */

import type { Message } from "../llm";

export interface ContextConfig {
  maxTokens: number;
  reserveTokens: number; // Reserve for response
  summaryThreshold: number; // Summarize when above this
  keepSystemPrompt: boolean;
  keepRecentMessages: number;
}

export interface TokenEstimate {
  total: number;
  byRole: { system: number; user: number; assistant: number; tool: number };
  messageCount: number;
}

export class ContextManager {
  private config: ContextConfig;

  constructor(config: Partial<ContextConfig> = {}) {
    this.config = {
      maxTokens: config.maxTokens ?? 128000, // GPT-4 Turbo default
      reserveTokens: config.reserveTokens ?? 4096,
      summaryThreshold: config.summaryThreshold ?? 0.75, // 75% of max
      keepSystemPrompt: config.keepSystemPrompt ?? true,
      keepRecentMessages: config.keepRecentMessages ?? 10,
    };
  }

  /**
   * Estimate token count for messages
   * Uses ~4 chars per token heuristic (rough but fast)
   */
  estimateTokens(messages: Message[]): TokenEstimate {
    const byRole = { system: 0, user: 0, assistant: 0, tool: 0 };
    
    for (const msg of messages) {
      const tokens = Math.ceil(msg.content.length / 4);
      byRole[msg.role] += tokens;
    }

    return {
      total: byRole.system + byRole.user + byRole.assistant + byRole.tool,
      byRole,
      messageCount: messages.length,
    };
  }

  /**
   * Check if context needs compression
   */
  needsCompression(messages: Message[]): boolean {
    const estimate = this.estimateTokens(messages);
    const threshold = this.config.maxTokens * this.config.summaryThreshold;
    return estimate.total > threshold;
  }

  /**
   * Get available tokens for response
   */
  availableTokens(messages: Message[]): number {
    const estimate = this.estimateTokens(messages);
    return Math.max(0, this.config.maxTokens - estimate.total - this.config.reserveTokens);
  }

  /**
   * Compress context to fit within limits
   * Strategy:
   * 1. Keep system prompt
   * 2. Summarize old tool results
   * 3. Keep recent messages intact
   * 4. Truncate very long messages
   */
  async compress(messages: Message[]): Promise<Message[]> {
    if (!this.needsCompression(messages)) {
      return messages;
    }

    const result: Message[] = [];
    
    // 1. Keep system prompt
    const systemMessages = messages.filter(m => m.role === "system");
    if (this.config.keepSystemPrompt && systemMessages.length > 0) {
      result.push(systemMessages[0]);
    }

    // 2. Get non-system messages
    const nonSystem = messages.filter(m => m.role !== "system");
    const keepRecent = this.config.keepRecentMessages;
    
    // Split into old and recent
    const oldMessages = nonSystem.slice(0, -keepRecent);
    const recentMessages = nonSystem.slice(-keepRecent);

    // 3. Summarize old messages
    if (oldMessages.length > 0) {
      const summary = this.summarizeMessages(oldMessages);
      result.push({
        role: "assistant",
        content: `[Context Summary]\n${summary}`,
      });
    }

    // 4. Add recent messages (with truncation if needed)
    for (const msg of recentMessages) {
      result.push(this.truncateMessage(msg));
    }

    return result;
  }

  /**
   * Summarize a batch of messages into a compact form
   */
  private summarizeMessages(messages: Message[]): string {
    const toolCalls: string[] = [];
    const decisions: string[] = [];
    const findings: string[] = [];

    for (const msg of messages) {
      if (msg.role === "tool") {
        // Summarize tool results
        const summary = this.summarizeToolResult(msg);
        if (summary) toolCalls.push(summary);
      } else if (msg.role === "assistant") {
        // Extract key decisions/findings
        const extracted = this.extractKeyPoints(msg.content);
        decisions.push(...extracted.decisions);
        findings.push(...extracted.findings);
      }
    }

    const parts: string[] = [];
    
    if (toolCalls.length > 0) {
      parts.push(`Tools called: ${toolCalls.slice(0, 10).join(", ")}`);
    }
    
    if (findings.length > 0) {
      parts.push(`Key findings:\n${findings.slice(0, 5).map(f => `- ${f}`).join("\n")}`);
    }
    
    if (decisions.length > 0) {
      parts.push(`Decisions made:\n${decisions.slice(0, 5).map(d => `- ${d}`).join("\n")}`);
    }

    return parts.join("\n\n") || "Previous context summarized.";
  }

  /**
   * Summarize a tool result message
   */
  private summarizeToolResult(msg: Message): string | null {
    if (!msg.name) return null;
    
    // Try to extract success/failure from content
    const content = msg.content.toLowerCase();
    const success = content.includes('"success":true') || content.includes('"success": true');
    const status = success ? "✓" : "✗";
    
    return `${msg.name}${status}`;
  }

  /**
   * Extract key points from assistant message
   */
  private extractKeyPoints(content: string): { decisions: string[]; findings: string[] } {
    const decisions: string[] = [];
    const findings: string[] = [];

    // Look for decision patterns
    const decisionPatterns = [
      /I (?:will|should|need to|must) (.+?)(?:\.|$)/gi,
      /(?:Decision|Plan|Next step): (.+?)(?:\.|$)/gi,
    ];

    for (const pattern of decisionPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        decisions.push(match[1].trim().slice(0, 100));
      }
    }

    // Look for finding patterns
    const findingPatterns = [
      /(?:Found|Discovered|Identified|Located): (.+?)(?:\.|$)/gi,
      /The (?:bug|issue|problem|error) (?:is|was) (.+?)(?:\.|$)/gi,
    ];

    for (const pattern of findingPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        findings.push(match[1].trim().slice(0, 100));
      }
    }

    return { decisions, findings };
  }

  /**
   * Truncate a single message if too long
   */
  private truncateMessage(msg: Message, maxLength: number = 8000): Message {
    if (msg.content.length <= maxLength) {
      return msg;
    }

    // Try to truncate intelligently
    if (msg.role === "tool") {
      // For tool results, keep structure but truncate data
      try {
        const parsed = JSON.parse(msg.content);
        return {
          ...msg,
          content: JSON.stringify(this.truncateObject(parsed, maxLength), null, 2),
        };
      } catch {
        // Not JSON, simple truncation
      }
    }

    // Simple truncation with marker
    return {
      ...msg,
      content: msg.content.slice(0, maxLength) + "\n\n[...truncated...]",
    };
  }

  /**
   * Truncate nested objects/arrays
   */
  private truncateObject(obj: unknown, budget: number): unknown {
    const json = JSON.stringify(obj);
    if (json.length <= budget) return obj;

    if (Array.isArray(obj)) {
      // Keep first few items
      const truncated = obj.slice(0, 5);
      return [...truncated, `[...${obj.length - 5} more items]`];
    }

    if (typeof obj === "object" && obj !== null) {
      const result: Record<string, unknown> = {};
      let currentSize = 2; // {}
      
      for (const [key, value] of Object.entries(obj)) {
        const valueJson = JSON.stringify(value);
        if (currentSize + key.length + valueJson.length + 4 < budget) {
          result[key] = value;
          currentSize += key.length + valueJson.length + 4;
        } else {
          result[key] = typeof value === "string" 
            ? value.slice(0, 100) + "..."
            : "[truncated]";
        }
      }
      
      return result;
    }

    return obj;
  }
}

/**
 * Summarize conversation history for context compression
 *
 * Algorithm (per spec):
 * 1. Keep System Prompt
 * 2. Keep Last 5 messages (User/Assistant)
 * 3. For messages 6-100 (Middle), replace Tool Outputs with:
 *    `[Tool 'read_file' executed successfully. Output size: 500 chars]`
 *
 * This reduces context size while preserving the conversation flow.
 */
export function summarizeHistory(messages: Message[], keepLast: number = 5): Message[] {
  const result: Message[] = [];

  // 1. Keep system prompt(s)
  const systemMessages = messages.filter(m => m.role === "system");
  result.push(...systemMessages);

  // 2. Get non-system messages
  const nonSystem = messages.filter(m => m.role !== "system");

  if (nonSystem.length <= keepLast) {
    // Not enough messages to compress
    return messages;
  }

  // Split into middle (to compress) and recent (to keep)
  const middleMessages = nonSystem.slice(0, -keepLast);
  const recentMessages = nonSystem.slice(-keepLast);

  // 3. Compress middle messages - replace tool outputs with summaries
  for (const msg of middleMessages) {
    if (msg.role === "tool") {
      // Replace tool output with compact summary
      const toolName = msg.name ?? "unknown_tool";
      const outputSize = msg.content.length;
      const success = msg.content.includes('"success":true') || msg.content.includes('"success": true');
      const status = success ? "successfully" : "with error";

      result.push({
        ...msg,
        content: `[Tool '${toolName}' executed ${status}. Output size: ${outputSize} chars]`,
      });
    } else if (msg.role === "assistant" && msg.tool_calls?.length) {
      // Keep assistant messages with tool calls but truncate content
      result.push({
        ...msg,
        content: msg.content ? msg.content.slice(0, 200) + (msg.content.length > 200 ? "..." : "") : "",
      });
    } else {
      // Keep user and regular assistant messages but truncate if long
      const maxLen = 500;
      result.push({
        ...msg,
        content: msg.content.length > maxLen
          ? msg.content.slice(0, maxLen) + `... [${msg.content.length - maxLen} chars truncated]`
          : msg.content,
      });
    }
  }

  // 4. Keep recent messages intact (last 5)
  result.push(...recentMessages);

  return result;
}

/**
 * Create a context manager with preset configurations
 */
export function createContextManager(preset: "small" | "medium" | "large" = "medium"): ContextManager {
  const presets: Record<typeof preset, Partial<ContextConfig>> = {
    small: {
      maxTokens: 4096,
      reserveTokens: 1024,
      keepRecentMessages: 4,
    },
    medium: {
      maxTokens: 32000,
      reserveTokens: 4096,
      keepRecentMessages: 10,
    },
    large: {
      maxTokens: 128000,
      reserveTokens: 8192,
      keepRecentMessages: 20,
    },
  };

  return new ContextManager(presets[preset]);
}

