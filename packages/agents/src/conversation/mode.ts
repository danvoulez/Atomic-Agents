/**
 * Conversation Mode
 * 
 * Enables back-and-forth discussion with TDLN mediation before
 * committing to a production workflow. Like chatting with a colleague
 * about code before deciding what to build.
 * 
 * Key concepts:
 * - Lightweight: No heavy job creation until idea is mature
 * - Context-aware: Tracks project_id, conversation history
 * - TDLN-mediated: All messages go through TDLN-IN/OUT for structure
 * - Transition trigger: Explicit "do it" or detected execution intent
 */

import { translateToLogLine, type TranslateResult } from "@ai-coding-team/machinery";
import type { LLMClient, Message, ChatResponse } from "../llm";
import { insertEvent, insertMessage, listMessages } from "@ai-coding-team/db";

export interface ConversationContext {
  conversationId: string;
  projectId?: string;
  projectName?: string;
  repoPath?: string;
  mode: "mechanic" | "genius";
  userId?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  tdlnSpan?: TranslateResult["span"];
  intent?: ConversationIntent;
}

export type ConversationIntent = 
  | "question"       // Asking about code/architecture
  | "exploration"    // Discussing ideas, comparing approaches
  | "clarification"  // Asking for more details
  | "confirmation"   // Confirming understanding
  | "execution"      // Ready to execute (triggers job creation)
  | "reference"      // Referencing another project/conversation
  | "unknown";

export interface ConversationTurn {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  shouldTransitionToJob: boolean;
  suggestedJob?: {
    goal: string;
    mode: "mechanic" | "genius";
    agentType: string;
  };
}

/**
 * Conversation Agent
 * 
 * Handles the ideation/discussion phase before production workflow.
 */
export class ConversationAgent {
  private llm: LLMClient;
  private context: ConversationContext;
  private history: ConversationMessage[] = [];

  constructor(llm: LLMClient, context: ConversationContext) {
    this.llm = llm;
    this.context = context;
  }

  /**
   * Process a user message in conversation mode
   */
  async chat(userText: string): Promise<ConversationTurn> {
    // 1. Translate through TDLN-IN to understand intent
    const translation = translateToLogLine({ text: userText });
    const intent = this.classifyIntent(userText, translation);

    // 2. Create user message record
    const userMessage: ConversationMessage = {
      role: "user",
      content: userText,
      timestamp: new Date().toISOString(),
      tdlnSpan: translation.span,
      intent,
    };

    // 3. Check if this is an execution trigger
    const isExecutionIntent = intent === "execution" || this.isExecutionTrigger(userText, translation);

    // 4. Build context-aware prompt
    const systemPrompt = this.buildSystemPrompt();
    const messages = this.buildMessages(userMessage);

    // 5. Call LLM for response
    const response = await this.llm.chat(messages, {
      maxTokens: 2000,
      temperature: 0.7,
    });

    // 6. Create assistant message
    const assistantMessage: ConversationMessage = {
      role: "assistant",
      content: response.content ?? "",
      timestamp: new Date().toISOString(),
      intent: isExecutionIntent ? "execution" : "exploration",
    };

    // 7. Update history
    this.history.push(userMessage);
    this.history.push(assistantMessage);

    // 8. Persist to database
    await this.persistTurn(userMessage, assistantMessage, response);

    // 9. Build response
    const turn: ConversationTurn = {
      userMessage,
      assistantMessage,
      shouldTransitionToJob: isExecutionIntent,
    };

    // 10. If execution intent, extract job details
    if (isExecutionIntent) {
      turn.suggestedJob = this.extractJobFromConversation(userText, translation);
    }

    return turn;
  }

  /**
   * Load conversation history from database
   */
  async loadHistory(): Promise<void> {
    const messages = await listMessages(this.context.conversationId);
    
    this.history = messages.map(msg => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
      timestamp: msg.created_at,
    }));
  }

  /**
   * Get current conversation history
   */
  getHistory(): ConversationMessage[] {
    return [...this.history];
  }

  /**
   * Classify the intent of a user message
   */
  private classifyIntent(text: string, translation: TranslateResult): ConversationIntent {
    const lower = text.toLowerCase();

    // Execution triggers
    const executionPatterns = [
      /^(do it|go ahead|execute|run|start|begin|proceed|implement|build|create|make it)/i,
      /let'?s (do|start|begin|implement|build)/i,
      /please (do|implement|build|create|fix)/i,
      /^yes,?\s*(do|go|proceed|implement)/i,
      /sounds good,?\s*(do|go|proceed|implement)/i,
    ];
    if (executionPatterns.some(p => p.test(lower))) {
      return "execution";
    }

    // Question patterns
    const questionPatterns = [
      /^(what|how|why|where|when|who|which|can you explain)/i,
      /\?$/,
      /tell me about/i,
      /i don'?t understand/i,
    ];
    if (questionPatterns.some(p => p.test(lower))) {
      return "question";
    }

    // Reference patterns
    const referencePatterns = [
      /like (in|on|at) project/i,
      /similar to/i,
      /remember when/i,
      /we did (this|that|something similar)/i,
      /in project [a-z0-9_-]+/i,
    ];
    if (referencePatterns.some(p => p.test(lower))) {
      return "reference";
    }

    // Exploration patterns
    const explorationPatterns = [
      /what if/i,
      /could we/i,
      /should we/i,
      /maybe we/i,
      /i think/i,
      /i was thinking/i,
      /how about/i,
      /alternatively/i,
    ];
    if (explorationPatterns.some(p => p.test(lower))) {
      return "exploration";
    }

    // Clarification patterns
    const clarificationPatterns = [
      /what do you mean/i,
      /can you clarify/i,
      /i'?m not sure/i,
      /elaborate/i,
    ];
    if (clarificationPatterns.some(p => p.test(lower))) {
      return "clarification";
    }

    // Confirmation patterns
    const confirmationPatterns = [
      /^(yes|yeah|yep|correct|right|exactly|ok|okay|i see|got it|understood)/i,
    ];
    if (confirmationPatterns.some(p => p.test(lower))) {
      return "confirmation";
    }

    // If TDLN translated to an operation, might be execution
    if (translation.verdict === "Translated" && translation.span.name) {
      const operationType = translation.span.name;
      if (["bug_fix", "feature", "refactor"].includes(operationType)) {
        // Could be execution, but check if it's phrased as a command
        if (/^(fix|add|create|implement|build|refactor)/i.test(lower)) {
          return "execution";
        }
      }
    }

    return "unknown";
  }

  /**
   * Check if message is an execution trigger
   */
  private isExecutionTrigger(text: string, translation: TranslateResult): boolean {
    const lower = text.toLowerCase().trim();

    // Explicit execution commands
    const triggers = [
      "do it",
      "go ahead",
      "proceed",
      "execute",
      "run it",
      "start",
      "let's do it",
      "let's go",
      "make it happen",
      "implement it",
      "build it",
    ];

    if (triggers.some(t => lower.includes(t))) {
      return true;
    }

    // If history shows we were discussing something and this confirms
    if (this.history.length > 0) {
      const lastAssistant = this.history.filter(m => m.role === "assistant").pop();
      if (lastAssistant?.content.includes("Would you like me to") ||
          lastAssistant?.content.includes("Should I proceed") ||
          lastAssistant?.content.includes("Ready to")) {
        if (/^(yes|yeah|yep|ok|okay|sure|go|do it)/i.test(lower)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Build system prompt for conversation mode
   */
  private buildSystemPrompt(): string {
    const projectContext = this.context.projectName 
      ? `Current project: ${this.context.projectName} (${this.context.projectId})`
      : "No specific project context";

    return `
You are a collaborative AI coding assistant in CONVERSATION MODE.

CONTEXT:
${projectContext}
Repository: ${this.context.repoPath || "not specified"}
Mode preference: ${this.context.mode}

YOUR ROLE IN CONVERSATION MODE:
- Help the user think through their ideas
- Answer questions about code, architecture, approaches
- Reference knowledge from other projects when relevant
- Clarify requirements and constraints
- When the idea seems mature, ask if they want to proceed

IMPORTANT RULES:
1. This is a discussion, not execution. No code changes happen in this mode.
2. Be helpful and collaborative, like a senior engineer pair programming.
3. If you don't know something, say so. Don't guess.
4. When discussing approaches, consider tradeoffs.
5. Reference specific files/functions when discussing code.
6. If the user seems ready to execute, ask for confirmation:
   "This sounds like a plan. Would you like me to create a job to [summary]?"

CONVERSATION FLOW:
- Questions → Answer with context and examples
- Ideas → Explore pros/cons, suggest alternatives
- Comparisons → Reference similar patterns in other projects
- Decisions → Summarize and confirm before execution
- Execution intent → Create job suggestion

RESPONSE FORMAT:
- Keep responses concise but informative
- Use code examples when helpful
- Ask clarifying questions when needed
- At the end of exploration, summarize the plan
`.trim();
  }

  /**
   * Build messages array for LLM
   */
  private buildMessages(currentMessage: ConversationMessage): Message[] {
    const messages: Message[] = [
      { role: "system", content: this.buildSystemPrompt() },
    ];

    // Add conversation history (last N turns)
    const recentHistory = this.history.slice(-20); // Keep last 10 turns
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Add current user message
    messages.push({
      role: "user",
      content: this.formatUserMessage(currentMessage),
    });

    return messages;
  }

  /**
   * Format user message with TDLN context
   */
  private formatUserMessage(msg: ConversationMessage): string {
    let content = msg.content;

    // Add intent hint if useful
    if (msg.intent && msg.intent !== "unknown") {
      content = `[Intent: ${msg.intent}]\n${content}`;
    }

    // Add TDLN span info if it translated to something useful
    if (msg.tdlnSpan && msg.tdlnSpan.name) {
      content += `\n\n[TDLN detected operation: ${msg.tdlnSpan.name}]`;
    }

    return content;
  }

  /**
   * Extract job details from conversation context
   */
  private extractJobFromConversation(
    triggerText: string,
    translation: TranslateResult
  ): ConversationTurn["suggestedJob"] {
    // If TDLN translated successfully, use that
    if (translation.verdict === "Translated" && translation.span.name) {
      const operationType = translation.span.name;
      const mode = this.getModeForOperation(operationType);
      const agentType = this.getAgentForOperation(operationType);

      // Try to extract a goal from conversation
      const goal = this.summarizeConversationGoal() || triggerText;

      return { goal, mode, agentType };
    }

    // Fallback: summarize from conversation
    const goal = this.summarizeConversationGoal() || triggerText;
    return {
      goal,
      mode: this.context.mode,
      agentType: "coordinator",
    };
  }

  /**
   * Summarize the goal from conversation history
   */
  private summarizeConversationGoal(): string | null {
    if (this.history.length === 0) return null;

    // Look for the main topic from early messages
    const userMessages = this.history.filter(m => m.role === "user");
    if (userMessages.length === 0) return null;

    // First substantial user message is often the main topic
    const firstSubstantial = userMessages.find(m => m.content.length > 20);
    if (firstSubstantial) {
      // Clean up and truncate
      return firstSubstantial.content.slice(0, 200);
    }

    return null;
  }

  /**
   * Get mode for operation type
   */
  private getModeForOperation(operation: string): "mechanic" | "genius" {
    const geniusOps = ["feature", "refactor"];
    return geniusOps.includes(operation) ? "genius" : "mechanic";
  }

  /**
   * Get agent type for operation
   */
  private getAgentForOperation(operation: string): string {
    const routing: Record<string, string> = {
      bug_fix: "planner",
      feature: "planner",
      analyze: "planner",
      review: "reviewer",
      refactor: "planner",
    };
    return routing[operation] || "coordinator";
  }

  /**
   * Persist turn to database
   */
  private async persistTurn(
    userMsg: ConversationMessage,
    assistantMsg: ConversationMessage,
    response: ChatResponse
  ): Promise<void> {
    // Store messages
    await insertMessage({
      id: crypto.randomUUID(),
      conversation_id: this.context.conversationId,
      role: "user",
      content: userMsg.content,
      created_at: userMsg.timestamp,
    });

    await insertMessage({
      id: crypto.randomUUID(),
      conversation_id: this.context.conversationId,
      role: "assistant",
      content: assistantMsg.content,
      created_at: assistantMsg.timestamp,
    });

    // Store event for tracking
    await insertEvent({
      job_id: this.context.conversationId, // Use conversation as pseudo-job
      trace_id: this.context.conversationId,
      kind: "info",
      summary: `Conversation turn: ${userMsg.intent || "chat"}`,
      params: {
        projectId: this.context.projectId,
        intent: userMsg.intent,
        tdlnSpan: userMsg.tdlnSpan,
        tokensUsed: response.usage.totalTokens,
      },
    });
  }
}

/**
 * Create a conversation agent
 */
export function createConversation(
  llm: LLMClient,
  context: ConversationContext
): ConversationAgent {
  return new ConversationAgent(llm, context);
}

