/**
 * Async Chat API - WhatsApp-style continuous conversation
 * 
 * POST /api/chat - Send a message (returns immediately with status)
 * GET /api/chat/stream?conversationId=xxx - SSE stream for responses
 * 
 * The conversation layer is ALWAYS active and non-blocking.
 * Jobs queue up in the background - conversation continues.
 */

import { NextRequest } from "next/server";
import {
  insertJob,
  ensureConversation,
  getJob,
  appendMessageToLedger,
  appendEventToLedger,
  getConversationMessages,
} from "@ai-coding-team/db";
import {
  conversationStates,
  broadcastToConversation,
  type ChatMessage,
  type ConversationState,
} from "@/lib/chat-state";

// ============================================================================
// POST /api/chat - Send a message
// ============================================================================

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

    if (!conversationId || !message) {
      return Response.json({ error: "conversationId and message required" }, { status: 400 });
    }

    // Ensure conversation exists
    await ensureConversation(conversationId);

    // Get or create state
    let state = conversationStates.get(conversationId);
    if (!state) {
      state = {
        conversationId,
        projectId,
        projectName,
        repoPath: repoPath ?? process.env.DEFAULT_REPO_PATH,
        mode,
        queuedJobs: [],
      };
      conversationStates.set(conversationId, state);
    }

    // Update project context if provided
    if (projectId) state.projectId = projectId;
    if (projectName) state.projectName = projectName;
    if (repoPath) state.repoPath = repoPath;

    // Create user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
      status: "sent",
    };

    // Persist user message to append-only ledger
    await appendMessageToLedger(conversationId, "user", message, state.projectId);

    // Immediately return - response will come via SSE
    // But first, broadcast "thinking" status
    broadcastToConversation(conversationId, {
      type: "status",
      status: "thinking",
      timestamp: new Date().toISOString(),
    });

    // Process in background (non-blocking)
    processMessageAsync(conversationId, message, state).catch(console.error);

    return Response.json({
      messageId: userMsg.id,
      status: "received",
      conversationId,
    });
  } catch (error: any) {
    console.error("Chat error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// ============================================================================
// GET /api/chat - Get recent messages
// ============================================================================

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);

  if (!conversationId) {
    return Response.json({ error: "conversationId required" }, { status: 400 });
  }

  const messages = await getConversationMessages(conversationId, limit);
  const state = conversationStates.get(conversationId);

  return Response.json({
    conversationId,
    messages: messages.map(m => ({
      id: crypto.randomUUID(),
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    state: state ? {
      projectId: state.projectId,
      projectName: state.projectName,
      activeJobId: state.activeJobId,
      queuedJobs: state.queuedJobs,
    } : null,
  });
}

// ============================================================================
// BACKGROUND PROCESSING
// ============================================================================

async function processMessageAsync(
  conversationId: string,
  message: string,
  state: ConversationState
): Promise<void> {
  try {
    // Analyze intent (hidden from user - no TDLN mention)
    const intent = analyzeIntent(message);

    // Show "typing" after brief delay
    await sleep(300);
    broadcastToConversation(conversationId, {
      type: "status",
      status: "typing",
      timestamp: new Date().toISOString(),
    });

    // Generate response based on intent
    let response: string;
    let action: string | undefined;
    let jobId: string | undefined;

    switch (intent.type) {
      case "job_request":
        // User wants something done - queue it
        const job = await queueJob(state, intent.goal!, intent.mode);
        jobId = job.id;
        action = state.activeJobId ? "queued" : "started";
        response = state.activeJobId
          ? `Got it! I've added that to the queue. There's ${state.queuedJobs.length} job(s) ahead of it.`
          : `On it! I've started working on that.`;
        
        broadcastToConversation(conversationId, {
          type: "status",
          status: action === "queued" ? "queueing" : "working",
          jobId,
          timestamp: new Date().toISOString(),
        });
        break;

      case "status_check":
        // User asking about job status
        response = await getStatusResponse(state);
        break;

      case "pause_request":
        // User wants to pause current work
        if (state.activeJobId) {
          await pauseCurrentJob(state);
          response = "Pausing the current task. What would you like to focus on instead?";
          action = "paused";
        } else {
          response = "Nothing is running right now. What would you like me to work on?";
        }
        break;

      case "project_switch":
        // User wants to switch projects
        const newProject = intent.projectName;
        response = `Switching context to ${newProject}. What would you like to do there?`;
        state.projectName = newProject;
        action = "switched_project";
        break;

      case "question":
      case "discussion":
      default:
        // Just chatting - call LLM
        response = await generateConversationResponse(conversationId, message, state);
        break;
    }

    // Send response
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: response,
      timestamp: new Date().toISOString(),
      status: "delivered",
      metadata: { action, jobId, projectId: state.projectId },
    };

    // Persist to append-only ledger
    await appendMessageToLedger(conversationId, "assistant", response, state.projectId);

    // Log event
    await appendEventToLedger(
      conversationId,
      conversationId,
      "conversation",
      `Chat: ${intent.type}`,
      { intent: intent.type, action, jobId },
      "coordinator"
    );

    // Broadcast response
    broadcastToConversation(conversationId, {
      type: "message",
      message: assistantMsg,
      timestamp: new Date().toISOString(),
    });

    // Clear typing status
    broadcastToConversation(conversationId, {
      type: "status",
      status: "idle",
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error("Process message error:", error);
    broadcastToConversation(conversationId, {
      type: "error",
      error: "Sorry, something went wrong. Please try again.",
      timestamp: new Date().toISOString(),
    });
  }
}

// ============================================================================
// INTENT ANALYSIS (Hidden from user - no TDLN exposure)
// ============================================================================

interface Intent {
  type: "job_request" | "status_check" | "pause_request" | "project_switch" | "question" | "discussion";
  goal?: string;
  mode?: "mechanic" | "genius";
  projectName?: string;
  confidence: number;
}

function analyzeIntent(message: string): Intent {
  const lower = message.toLowerCase().trim();

  // Pause/stop requests
  if (/^(pause|stop|wait|hold on|hold up|one sec)/i.test(lower)) {
    return { type: "pause_request", confidence: 0.9 };
  }

  // Status checks
  if (/^(status|how'?s it going|progress|what'?s happening|update)/i.test(lower) ||
      /how (is|are) (the|my) (job|task|work)/i.test(lower)) {
    return { type: "status_check", confidence: 0.9 };
  }

  // Project switch
  const switchMatch = lower.match(/(?:switch to|go to|open|work on) (?:project )?([a-z0-9_-]+)/i);
  if (switchMatch) {
    return { type: "project_switch", projectName: switchMatch[1], confidence: 0.8 };
  }

  // Job requests (commands)
  const jobPatterns = [
    { pattern: /^(fix|debug|repair|solve)/i, mode: "mechanic" as const },
    { pattern: /^(add|create|implement|build|make)/i, mode: "genius" as const },
    { pattern: /^(refactor|clean|improve|optimize)/i, mode: "genius" as const },
    { pattern: /^(review|check|audit)/i, mode: "mechanic" as const },
    { pattern: /^(explain|analyze|understand)/i, mode: "mechanic" as const },
  ];

  for (const { pattern, mode } of jobPatterns) {
    if (pattern.test(lower)) {
      return {
        type: "job_request",
        goal: message,
        mode,
        confidence: 0.8,
      };
    }
  }

  // Explicit execution after discussion
  if (/^(do it|go ahead|proceed|yes|ok|let'?s go|make it happen|start)/i.test(lower)) {
    return {
      type: "job_request",
      goal: "Execute the discussed plan",
      mode: "mechanic",
      confidence: 0.7,
    };
  }

  // Questions
  if (lower.includes("?") || /^(what|how|why|where|when|who|which|can|could|would)/i.test(lower)) {
    return { type: "question", confidence: 0.8 };
  }

  // Default: discussion
  return { type: "discussion", confidence: 0.5 };
}

// ============================================================================
// JOB MANAGEMENT
// ============================================================================

async function queueJob(
  state: ConversationState,
  goal: string,
  mode: "mechanic" | "genius" = "mechanic"
): Promise<{ id: string }> {
  const job = await insertJob({
    goal,
    mode,
    agent_type: "coordinator",
    status: "queued",
    conversation_id: state.conversationId,
    repo_path: state.repoPath ?? "/tmp/repo",
    step_cap: mode === "mechanic" ? 20 : 100,
    token_cap: mode === "mechanic" ? 50000 : 200000,
    cost_cap_cents: mode === "mechanic" ? 100 : 500,
    created_by: "chat",
  });

  state.queuedJobs.push(job.id);

  // If nothing running, this becomes active
  if (!state.activeJobId) {
    state.activeJobId = job.id;
    state.queuedJobs = state.queuedJobs.filter(id => id !== job.id);
  }

  return { id: job.id };
}

async function pauseCurrentJob(state: ConversationState): Promise<void> {
  if (state.activeJobId) {
    // Mark for pause (append to ledger)
    await appendEventToLedger(
      state.activeJobId,
      state.activeJobId,
      "job_paused",
      "Job paused by user request",
      { reason: "user_request" },
      "coordinator"
    );

    // Move to front of queue for resumption
    state.queuedJobs.unshift(state.activeJobId);
    state.activeJobId = undefined;
  }
}

async function getStatusResponse(state: ConversationState): Promise<string> {
  if (!state.activeJobId && state.queuedJobs.length === 0) {
    return "All clear! No tasks running or queued. What would you like to work on?";
  }

  const parts: string[] = [];

  if (state.activeJobId) {
    const job = await getJob(state.activeJobId);
    if (job) {
      const progress = job.steps_used && job.step_cap
        ? Math.round((job.steps_used / job.step_cap) * 100)
        : 0;
      parts.push(`Currently working on: "${job.goal.slice(0, 50)}..." (${progress}% complete)`);
    }
  }

  if (state.queuedJobs.length > 0) {
    parts.push(`${state.queuedJobs.length} task(s) in queue`);
  }

  return parts.join("\n") || "Everything is running smoothly!";
}

// ============================================================================
// LLM CONVERSATION
// ============================================================================

async function generateConversationResponse(
  conversationId: string,
  message: string,
  state: ConversationState
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  const provider = process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai";

  if (!apiKey) {
    return "I'd love to help, but I'm not configured with an API key yet. Please set OPENAI_API_KEY or ANTHROPIC_API_KEY.";
  }

  // Load recent history from ledger
  const history = await getConversationMessages(conversationId, 10);
  const recentHistory = history;

  const systemPrompt = `You are a helpful AI coding assistant having a natural conversation.

CONTEXT:
- Project: ${state.projectName || "Not specified"}
- Current work: ${state.activeJobId ? "A task is running" : "Idle"}
- Queue: ${state.queuedJobs.length} tasks waiting

YOUR STYLE:
- Be conversational and friendly, like a colleague on Slack
- Keep responses concise - this is a chat, not an essay
- If the user seems to want something done, ask if they'd like you to start working on it
- Never mention internal systems, TDLN, or technical infrastructure
- If discussing code, be specific about files and functions
- If you don't know something, say so

CAPABILITIES:
- You can discuss code, architecture, ideas
- When the user wants action, you can queue tasks (they'll see the status)
- You can pause, prioritize, or switch between projects
- You're always here - the conversation never ends`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  try {
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
          max_tokens: 500,
          system: systemPrompt,
          messages: messages.slice(1),
        }),
      });
      const data = await response.json();
      return data.content?.[0]?.text || "Hmm, I'm having trouble responding. Try again?";
    } else {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || "gpt-4o",
          messages,
          max_tokens: 500,
          temperature: 0.7,
        }),
      });
      const data = await response.json();
      return data.choices?.[0]?.message?.content || "Hmm, I'm having trouble responding. Try again?";
    }
  } catch (error) {
    console.error("LLM error:", error);
    return "I'm having a moment - could you say that again?";
  }
}

// Helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
