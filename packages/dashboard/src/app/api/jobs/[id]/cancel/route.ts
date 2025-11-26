import { NextRequest } from "next/server";
import { getJob, requestJobCancel, insertEvent } from "@ai-coding-team/db";

interface RouteParams {
  params: { id: string };
}

// POST /api/jobs/[id]/cancel - Request job cancellation
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = params;

  const job = await getJob(id);
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "running" && job.status !== "queued") {
    return Response.json(
      { error: `Cannot cancel job in status: ${job.status}` },
      { status: 400 }
    );
  }

  // Request cancellation
  await requestJobCancel(id);

  // Log cancellation event
  await insertEvent({
    job_id: id,
    trace_id: job.trace_id,
    kind: "info",
    summary: "Cancellation requested by user",
  });

  return Response.json({
    status: "cancelling",
    message: "Cancellation requested. The job will stop at the next safe point.",
  });
}

