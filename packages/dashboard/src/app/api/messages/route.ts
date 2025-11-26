import { NextRequest } from "next/server";
import { Message } from "@/types";
import { notifyDashboardEvent } from "@/lib/notify";
import {
  ensureConversation,
  insertJob,
  insertMessage,
  listMessages
} from "@ai-coding-team/db";

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return new Response(JSON.stringify({ error: "conversationId is required" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const rows = await listMessages(conversationId);
  const messages: Message[] = rows.map(row => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  }));
  return new Response(JSON.stringify({ messages }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { conversationId, content } = body as { conversationId?: string; content?: string };

  if (!conversationId || !content) {
    return new Response(JSON.stringify({ error: "conversationId and content are required" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  await ensureConversation(conversationId);

  // Persist user message
  const userMessage: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content,
    jobRefs: []
  };
  await insertMessage({
    id: userMessage.id,
    conversation_id: conversationId,
    role: "user",
    content: content,
    created_at: new Date().toISOString()
  });

  // Create job record for this request (mechanic by default)
  const jobId = crypto.randomUUID();
  await insertJob({
    id: jobId,
    goal: content,
    mode: "mechanic",
    agent_type: "coordinator",
    repo_path: process.cwd(),
    status: "queued",
    conversation_id: conversationId,
    step_cap: 20,
    token_cap: 50000,
    cost_cap_cents: 1000,
    created_by: "dashboard",
  });

  // Create assistant acknowledgement message
  const assistantMessage: Message = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: `Working on it... Job queued for "${content.slice(0, 64)}"`,
    jobRefs: [{ jobId, status: "queued" }]
  };
  await insertMessage({
    id: assistantMessage.id,
    conversation_id: conversationId,
    role: "assistant",
    content: assistantMessage.content,
    created_at: new Date().toISOString()
  });

  // Emit messages and job update to SSE consumers
  await notifyDashboardEvent({ conversation_id: conversationId, type: "message", message: userMessage });
  await notifyDashboardEvent({ conversation_id: conversationId, type: "message", message: assistantMessage });
  await notifyDashboardEvent({
    conversation_id: conversationId,
    type: "job_update",
    job: {
      id: jobId,
      status: "queued",
      stepCap: 20,
      stepsUsed: 0,
      startedAt: null
    }
  });

  return new Response(
    JSON.stringify({
      messageId: assistantMessage.id,
      immediateResponse: assistantMessage.content,
      jobIds: [jobId]
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}
