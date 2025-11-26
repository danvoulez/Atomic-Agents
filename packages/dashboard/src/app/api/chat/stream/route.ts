/**
 * Chat SSE Stream
 * 
 * GET /api/chat/stream?conversationId=xxx
 * 
 * Streams real-time updates to the client:
 * - status: thinking, typing, working, queueing, idle
 * - message: new assistant message
 * - job_update: job status change
 * - error: something went wrong
 */

import { NextRequest } from "next/server";
import { streamClients } from "@/lib/chat-state";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  if (!conversationId) {
    return Response.json({ error: "conversationId required" }, { status: 400 });
  }

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Register this client
      let clients = streamClients.get(conversationId);
      if (!clients) {
        clients = new Set();
        streamClients.set(conversationId, clients);
      }

      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch (e) {
          // Stream closed
          cleanup();
        }
      };

      clients.add(send);

      // Send initial connection message
      send(`data: ${JSON.stringify({
        type: "connected",
        conversationId,
        timestamp: new Date().toISOString(),
      })}\n\n`);

      // Cleanup on close
      const cleanup = () => {
        clients?.delete(send);
        if (clients?.size === 0) {
          streamClients.delete(conversationId);
        }
      };

      // Keep connection alive with heartbeat
      const heartbeat = setInterval(() => {
        try {
          send(`: heartbeat\n\n`);
        } catch {
          clearInterval(heartbeat);
          cleanup();
        }
      }, 30000);

      // Handle client disconnect
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

