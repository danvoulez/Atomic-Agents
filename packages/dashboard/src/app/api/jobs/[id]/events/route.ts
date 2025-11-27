import { NextRequest } from "next/server";
import { listEvents, getJob } from "@ai-coding-team/db";

interface RouteParams {
  params: { id: string };
}

// GET /api/jobs/[id]/events - Return event log for a job
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = params;
  const job = await getJob(id);
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const events = await listEvents(id);
  return Response.json({
    jobId: id,
    events: events.map(e => ({
      id: e.id,
      kind: e.kind,
      toolName: e.tool_name,
      summary: e.summary,
      params: e.params,
      result: e.result,
      durationMs: e.duration_ms,
      tokensUsed: e.tokens_used,
      costCents: e.cost_cents,
      createdAt: e.created_at,
    })),
    total: events.length,
  });
}

