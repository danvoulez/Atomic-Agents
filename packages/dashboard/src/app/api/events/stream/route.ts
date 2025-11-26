import { NextRequest } from "next/server";
import { pool } from "@ai-coding-team/db";

/**
 * Server-Sent Events backed by Postgres LISTEN/NOTIFY on the "dashboard_events" channel.
 * Events should carry a conversation_id field so the stream can filter per client.
 */
export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return new Response("conversationId required", { status: 400 });
  }

  const client = await pool.connect();
  await client.query("LISTEN dashboard_events");

  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Initial heartbeat
      send({ type: "heartbeat", ts: Date.now() });

      const handler = (msg: any) => {
        try {
          const payload = JSON.parse(msg.payload);
          if (payload.conversation_id && payload.conversation_id !== conversationId) return;
          send(payload);
        } catch {
          // Ignore malformed payloads
        }
      };

      client.on("notification", handler);

      const heartbeat = setInterval(() => send({ type: "heartbeat", ts: Date.now() }), 10000);

      cleanup = () => {
        clearInterval(heartbeat);
        client.off("notification", handler);
        client.query("UNLISTEN dashboard_events").finally(() => client.release());
      };
    },
    cancel() {
      cleanup?.();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}
