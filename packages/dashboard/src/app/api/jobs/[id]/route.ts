import { NextRequest } from "next/server";
import { getJob, listEvents, updateJob, getEvaluation, requestJobCancel } from "@ai-coding-team/db";

interface RouteParams {
  params: { id: string };
}

// GET /api/jobs/[id] - Get job details with events and evaluation
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = params;
  
  const job = await getJob(id);
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const events = await listEvents(id);
  const evaluation = await getEvaluation(id);

  // Compute derived fields
  let duration: number | null = null;
  if (job.started_at && job.finished_at) {
    duration = new Date(job.finished_at).getTime() - new Date(job.started_at).getTime();
  }

  // Calculate progress
  const stepsUsed = job.steps_used ?? 0;
  const stepCap = job.step_cap ?? 20;
  const tokensUsed = job.tokens_used ?? 0;
  const tokenCap = job.token_cap ?? 100000;

  return Response.json({
    job: {
      ...job,
      duration,
      progress: {
        steps: { used: stepsUsed, cap: stepCap, percent: (stepsUsed / stepCap) * 100 },
        tokens: { used: tokensUsed, cap: tokenCap, percent: (tokensUsed / tokenCap) * 100 },
      },
    },
    events: events.map(e => ({
      id: e.id,
      kind: e.kind,
      toolName: e.tool_name,
      summary: e.summary,
      createdAt: e.created_at,
      durationMs: e.duration_ms,
    })),
    evaluation: evaluation ? {
      id: evaluation.id,
      correctness: evaluation.correctness,
      efficiency: evaluation.efficiency,
      honesty: evaluation.honesty,
      safety: evaluation.safety,
      flags: evaluation.flags,
      feedback: evaluation.feedback,
      createdAt: evaluation.created_at,
    } : null,
  });
}

// POST /api/jobs/[id]/cancel - Request job cancellation
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = params;
  const url = new URL(req.url);
  const action = url.pathname.split("/").pop();

  if (action === "cancel") {
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

    await requestJobCancel(id);

    return Response.json({ status: "cancelling", message: "Cancellation requested" });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

