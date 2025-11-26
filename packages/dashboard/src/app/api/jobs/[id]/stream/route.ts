import { NextRequest } from "next/server";
import { getJob, listEvents } from "@ai-coding-team/db";

interface RouteParams {
  params: { id: string };
}

// GET /api/jobs/[id]/stream - SSE stream for job updates
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = params;

  // Verify job exists
  const job = await getJob(id);
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  let lastEventCount = 0;
  let isActive = true;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial state
      const sendEvent = (type: string, data: unknown) => {
        const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(event));
      };

      // Send initial job state
      sendEvent("job", {
        id: job.id,
        status: job.status,
        stepsUsed: job.steps_used ?? 0,
        tokensUsed: job.tokens_used ?? 0,
        currentAction: job.current_action,
      });

      // Poll for updates
      const pollInterval = setInterval(async () => {
        if (!isActive) {
          clearInterval(pollInterval);
          return;
        }

        try {
          const currentJob = await getJob(id);
          if (!currentJob) {
            clearInterval(pollInterval);
            controller.close();
            return;
          }

          // Check for new events
          const events = await listEvents(id);
          if (events.length > lastEventCount) {
            const newEvents = events.slice(lastEventCount);
            for (const event of newEvents) {
              sendEvent("event", {
                id: event.id,
                kind: event.kind,
                toolName: event.tool_name,
                summary: event.summary,
                createdAt: event.created_at,
              });
            }
            lastEventCount = events.length;
          }

          // Send job update
          sendEvent("job", {
            id: currentJob.id,
            status: currentJob.status,
            stepsUsed: currentJob.steps_used ?? 0,
            tokensUsed: currentJob.tokens_used ?? 0,
            currentAction: currentJob.current_action,
          });

          // Close stream if job is complete
          if (["succeeded", "failed", "aborted"].includes(currentJob.status)) {
            sendEvent("complete", { status: currentJob.status });
            clearInterval(pollInterval);
            controller.close();
          }
        } catch (error) {
          console.error("SSE poll error:", error);
        }
      }, 1000); // Poll every second

      // Cleanup on abort
      req.signal.addEventListener("abort", () => {
        isActive = false;
        clearInterval(pollInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

