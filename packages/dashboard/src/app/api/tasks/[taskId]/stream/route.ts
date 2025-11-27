/**
 * Task Events Stream API (SSE)
 * 
 * GET /api/tasks/:taskId/stream - Stream real-time events
 */

import { NextRequest } from "next/server";
import { atomicAdapter } from "../../../../../lib/atomic-adapter";

interface RouteParams {
  params: { taskId: string };
}

// GET /api/tasks/:taskId/stream - SSE stream of events
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { taskId } = params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial ping
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "ping", message: "Connected" })}\n\n`)
        );

        // Stream events from Atomic Agents
        for await (const log of atomicAdapter.streamTaskEvents(taskId)) {
          const data = `data: ${JSON.stringify(log)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }

        // Send completion event
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done", message: "Stream complete" })}\n\n`)
        );
      } catch (error) {
        console.error("Stream error:", error);
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

