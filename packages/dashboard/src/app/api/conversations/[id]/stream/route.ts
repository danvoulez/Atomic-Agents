import { NextRequest } from "next/server";
import { pool } from "@ai-coding-team/db";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const conversationId = params.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const client = await pool.connect();
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(data)}\n\n`));
      };

      await client.query("LISTEN dashboard_events");

      client.on("notification", (msg) => {
        if (!msg.payload) return;
        const payload = JSON.parse(msg.payload);
        
        if (payload.conversation_id !== conversationId) return;

        if (payload.type === 'message' && payload.data.role === 'assistant') {
          send({
            type: 'message',
            data: {
              id: payload.data.id,
              role: 'assistant',
              content: payload.data.content,
              timestamp: payload.data.timestamp
            }
          });
        }
      });

      req.signal.addEventListener("abort", () => {
        client.query("UNLISTEN dashboard_events");
        client.release();
      });
    }
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream" }});
}
