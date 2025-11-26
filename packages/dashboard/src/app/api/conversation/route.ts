/**
 * Conversation Mode API
 * 
 * Enables back-and-forth discussion before creating production jobs.
 * 
 * POST /api/conversation - Send a message in conversation mode
 * GET /api/conversation?conversationId=xxx - Get conversation history
 * 
 * Note: This uses OpenAI/Anthropic directly without the full agents package
 * to avoid bundling issues with Playwright and other heavy dependencies.
 */

import { NextRequest } from "next/server";
import { listMessages, insertJob, ensureConversation, insertMessage, insertEvent } from "@ai-coding-team/db";

// Inline TDLN translation to avoid native binding issues in Next.js
interface TranslateResult {
  span: { type: string; name?: string; params?: Array<[string, unknown]> };
  verdict: "Translated" | "Abstain";
  abstainReason?: string;
  clarification?: string;
}

function translateToLogLine(input: { text: string }): TranslateResult {
  const normalized = input.text.toLowerCase().trim();

  // Bug fix patterns
  if (normalized.includes("fix") || normalized.includes("bug") || normalized.includes("broken")) {
    return {
      span: { type: "operation", name: "bug_fix", params: [["description", input.text]] },
      verdict: "Translated",
    };
  }

  // Feature patterns
  if (normalized.includes("add") || normalized.includes("create") || normalized.includes("implement")) {
    return {
      span: { type: "operation", name: "feature", params: [["description", input.text]] },
      verdict: "Translated",
    };
  }

  // Analysis patterns
  if (normalized.includes("explain") || normalized.includes("how does") || normalized.includes("what is")) {
    return {
      span: { type: "operation", name: "analyze", params: [["subject", input.text]] },
      verdict: "Translated",
    };
  }

  // Review patterns
  if (normalized.includes("review") || normalized.includes("check")) {
    return {
      span: { type: "operation", name: "review", params: [] },
      verdict: "Translated",
    };
  }

  // Refactor patterns
  if (normalized.includes("refactor") || normalized.includes("clean up") || normalized.includes("improve")) {
    return {
      span: { type: "operation", name: "refactor", params: [["target", input.text]] },
      verdict: "Translated",
    };
  }

  // No match
  return {
    span: { type: "unknown", params: [] },
    verdict: "Abstain",
    abstainReason: "unclear_intent",
    clarification: "I'm not sure what you'd like me to do.",
  };
}

interface ConversationContext {
  conversationId: string;
  projectId?: string;
  projectName?: string;
  repoPath?: string;
  mode: "mechanic" | "genius";
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  intent?: string;
}

// In-memory conversation history cache
const historyCache = new Map<string, ConversationMessage[]>();

// POST /api/conversation - Send a message
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      conversationId,
      message,
      projectId,
      projectName,
      repoPath,
      mode = "mechanic",
    } = body;

    if (!conversationId) {
      return Response.json({ error: "conversationId is required" }, { status: 400 });
    }

    if (!message) {
      return Response.json({ error: "message is required" }, { status: 400 });
    }

    // Ensure conversation exists in DB
    await ensureConversation(conversationId);

    // Get or load history
    let history = historyCache.get(conversationId) || [];
    if (history.length === 0) {
      const dbMessages = await listMessages(conversationId);
      history = dbMessages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: m.created_at,
      }));
      historyCache.set(conversationId, history);
    }

    // Translate through TDLN-IN
    const translation = translateToLogLine({ text: message });
    const intent = classifyIntent(message, translation);
    const isExecutionIntent = intent === "execution" || isExecutionTrigger(message, history);

    // Create user message
    const userMessage: ConversationMessage = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
      intent,
    };

    // Call LLM
    const response = await callLLM(history, userMessage, {
      projectName,
      projectId,
      repoPath,
      mode,
    });

    // Create assistant message
    const assistantMessage: ConversationMessage = {
      role: "assistant",
      content: response.content,
      timestamp: new Date().toISOString(),
      intent: isExecutionIntent ? "execution" : "exploration",
    };

    // Update history
    history.push(userMessage);
    history.push(assistantMessage);
    historyCache.set(conversationId, history);

    // Persist to DB
    await insertMessage({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: "user",
      content: message,
      created_at: userMessage.timestamp,
    });

    await insertMessage({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: "assistant",
      content: response.content,
      created_at: assistantMessage.timestamp,
    });

    await insertEvent({
      job_id: conversationId,
      trace_id: conversationId,
      kind: "info",
      summary: `Conversation: ${intent}`,
      params: {
        projectId,
        intent,
        tokensUsed: response.tokensUsed,
      },
    });

    // If execution intent, create job
    let job = null;
    if (isExecutionIntent) {
      const suggestedJob = extractJobFromConversation(message, translation, history, mode);
      job = await insertJob({
        goal: suggestedJob.goal,
        mode: suggestedJob.mode,
        agent_type: suggestedJob.agentType as any,
        status: "queued",
        conversation_id: conversationId,
        repo_path: repoPath ?? process.env.DEFAULT_REPO_PATH ?? "/tmp/repo",
        step_cap: suggestedJob.mode === "mechanic" ? 20 : 100,
        token_cap: suggestedJob.mode === "mechanic" ? 50000 : 200000,
        cost_cap_cents: suggestedJob.mode === "mechanic" ? 100 : 500,
        created_by: "conversation",
      });
    }

    return Response.json({
      turn: {
        userMessage,
        assistantMessage,
        shouldTransitionToJob: isExecutionIntent,
        suggestedJob: isExecutionIntent ? extractJobFromConversation(message, translation, history, mode) : null,
      },
      job: job ? { id: job.id, status: job.status } : null,
    });
  } catch (error: any) {
    console.error("Conversation error:", error);
    return Response.json(
      { error: "Conversation failed", details: error.message },
      { status: 500 }
    );
  }
}

// GET /api/conversation - Get history
export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  if (!conversationId) {
    return Response.json({ error: "conversationId is required" }, { status: 400 });
  }

  try {
    const messages = await listMessages(conversationId);
    return Response.json({
      conversationId,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.created_at,
      })),
      total: messages.length,
    });
  } catch (error: any) {
    return Response.json(
      { error: "Failed to get conversation", details: error.message },
      { status: 500 }
    );
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function classifyIntent(text: string, translation: TranslateResult): string {
  const lower = text.toLowerCase();

  // Execution triggers
  if (/^(do it|go ahead|execute|proceed|implement|build|let'?s do)/i.test(lower)) {
    return "execution";
  }

  // Questions
  if (/^(what|how|why|where|when|who|which|can you explain)/i.test(lower) || lower.includes("?")) {
    return "question";
  }

  // References to other projects
  if (/like (in|on) project|similar to|we did/i.test(lower)) {
    return "reference";
  }

  // Exploration
  if (/what if|could we|should we|maybe we|how about/i.test(lower)) {
    return "exploration";
  }

  // If TDLN translated to an action and phrased as command
  if (translation.verdict === "Translated" && /^(fix|add|create|implement)/i.test(lower)) {
    return "execution";
  }

  return "unknown";
}

function isExecutionTrigger(text: string, history: ConversationMessage[]): boolean {
  const lower = text.toLowerCase().trim();
  const triggers = ["do it", "go ahead", "proceed", "execute", "let's do it", "make it happen"];

  if (triggers.some(t => lower.includes(t))) {
    return true;
  }

  // Check if confirming after assistant asked
  if (history.length > 0) {
    const lastAssistant = history.filter(m => m.role === "assistant").pop();
    if (lastAssistant?.content.includes("Would you like me to") ||
        lastAssistant?.content.includes("Should I proceed")) {
      if (/^(yes|yeah|ok|sure|go|do it)/i.test(lower)) {
        return true;
      }
    }
  }

  return false;
}

function extractJobFromConversation(
  trigger: string,
  translation: TranslateResult,
  history: ConversationMessage[],
  defaultMode: "mechanic" | "genius"
): { goal: string; mode: "mechanic" | "genius"; agentType: string } {
  if (translation.verdict === "Translated" && translation.span.name) {
    const op = translation.span.name;
    return {
      goal: summarizeGoal(history) || trigger,
      mode: ["feature", "refactor"].includes(op) ? "genius" : "mechanic",
      agentType: op === "review" ? "reviewer" : "planner",
    };
  }

  return {
    goal: summarizeGoal(history) || trigger,
    mode: defaultMode,
    agentType: "coordinator",
  };
}

function summarizeGoal(history: ConversationMessage[]): string | null {
  const userMessages = history.filter(m => m.role === "user");
  const first = userMessages.find(m => m.content.length > 20);
  return first ? first.content.slice(0, 200) : null;
}

async function callLLM(
  history: ConversationMessage[],
  current: ConversationMessage,
  context: { projectName?: string; projectId?: string; repoPath?: string; mode: string }
): Promise<{ content: string; tokensUsed: number }> {
  const provider = process.env.LLM_PROVIDER || "openai";
  const apiKey = provider === "anthropic" 
    ? process.env.ANTHROPIC_API_KEY 
    : process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      content: "I'm sorry, but no LLM API key is configured. Please set OPENAI_API_KEY or ANTHROPIC_API_KEY.",
      tokensUsed: 0,
    };
  }

  const systemPrompt = `You are a collaborative AI coding assistant in CONVERSATION MODE.

CONTEXT:
Project: ${context.projectName || "Not specified"} (${context.projectId || "no ID"})
Repository: ${context.repoPath || "not specified"}
Mode: ${context.mode}

YOUR ROLE:
- Help the user think through their ideas about code
- Answer questions about architecture, approaches, best practices
- Reference knowledge from other projects when relevant
- When the idea seems mature, ask: "Would you like me to create a job to [summary]?"

RULES:
1. This is a discussion, not execution. No code changes happen in this mode.
2. Be collaborative, like a senior engineer pair programming.
3. If you don't know, say so.
4. Keep responses concise but informative.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-20).map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: `[Intent: ${current.intent}]\n${current.content}` },
  ];

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        messages: messages.slice(1).map(m => ({
          role: m.role === "system" ? "user" : m.role,
          content: m.content,
        })),
      }),
    });

    const data = await response.json();
    return {
      content: data.content?.[0]?.text || "I couldn't generate a response.",
      tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  } else {
    // OpenAI
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || "gpt-4o",
        messages,
        max_tokens: 2000,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content || "I couldn't generate a response.",
      tokensUsed: data.usage?.total_tokens || 0,
    };
  }
}
