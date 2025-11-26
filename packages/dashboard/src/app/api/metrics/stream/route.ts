/**
 * Metrics Stream Endpoint (SSE)
 * 
 * Real-time metrics streaming via Server-Sent Events.
 */

import { NextRequest } from "next/server";
import { getEventBus, collectAllMetrics } from "@ai-coding-team/db";

// Force dynamic rendering for SSE
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial metrics snapshot
      try {
        const initial = await collectAllMetrics();
        controller.enqueue(
          encoder.encode(`event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`)
        );
      } catch (e) {
        console.error("Failed to collect initial metrics:", e);
      }

      // Subscribe to real-time events
      const bus = getEventBus();
      const unsubscribers: (() => void)[] = [];

      try {
        // Subscribe to all relevant channels
        const channels = ["metrics", "jobs", "insights", "alerts", "health"] as const;
        
        for (const channel of channels) {
          const unsub = await bus.subscribe(channel, (event) => {
            try {
              controller.enqueue(
                encoder.encode(`event: ${channel}\ndata: ${JSON.stringify(event)}\n\n`)
              );
            } catch {
              // Stream closed
            }
          });
          unsubscribers.push(unsub);
        }

        // Periodic full refresh every 30s
        const refreshInterval = setInterval(async () => {
          try {
            const metrics = await collectAllMetrics();
            controller.enqueue(
              encoder.encode(`event: refresh\ndata: ${JSON.stringify(metrics)}\n\n`)
            );
          } catch (e) {
            console.error("Failed to refresh metrics:", e);
          }
        }, 30000);

        // Heartbeat to keep connection alive
        const heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch {
            // Stream closed
          }
        }, 15000);

        // Cleanup on abort
        req.signal.addEventListener("abort", () => {
          clearInterval(refreshInterval);
          clearInterval(heartbeatInterval);
          for (const unsub of unsubscribers) {
            unsub();
          }
          controller.close();
        });
      } catch (e) {
        console.error("Failed to set up metrics stream:", e);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // For nginx
    },
  });
}

