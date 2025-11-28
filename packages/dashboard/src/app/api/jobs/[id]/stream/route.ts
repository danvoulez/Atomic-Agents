import { NextRequest } from "next/server";
import { pool, getJob } from "@ai-coding-team/db";
import { mapStatus } from "@/lib/types";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const jobId = params.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const client = await pool.connect();
      const send = (type: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      await client.query("LISTEN dashboard_events");

      client.on("notification", async (msg) => {
        if (!msg.payload) return;
        const payload = JSON.parse(msg.payload);
        
        if (payload.job_id !== jobId) return;

        if (payload.type === 'event') {
          send('event', {
            id: payload.data.id,
            timestamp: payload.data.created_at,
            kind: payload.data.kind,
            summary: payload.data.summary,
            toolName: payload.data.tool_name
          });
        } 
        
        const freshJob = await getJob(jobId);
        if (freshJob) {
          send('status', {
            status: mapStatus(freshJob.status),
            budget: {
              steps: { used: freshJob.steps_used, max: freshJob.step_cap, percent: Math.round((freshJob.steps_used/freshJob.step_cap)*100) },
              tokens: { used: freshJob.tokens_used || 0, max: freshJob.token_cap || 0, percent: 0 },
              costCents: freshJob.cost_used_cents || 0
            },
            workerStatus: 'alive'
          });

          if (freshJob.status === 'succeeded' || freshJob.status === 'failed') {
             setTimeout(() => {
               controller.close();
               client.release();
             }, 2000);
          }
        }
      });

      req.signal.addEventListener("abort", () => {
        client.query("UNLISTEN dashboard_events");
        client.release();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
