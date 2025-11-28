import { NextRequest, NextResponse } from "next/server";
import { getJob, listEvents, getEvaluation } from "@ai-coding-team/db";
import { Job, JobEvent, mapStatus } from "@/lib/types";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const jobRow = await getJob(params.id);
  if (!jobRow) {
    return NextResponse.json({ error: { code: "JOB_NOT_FOUND", message: "Job not found" } }, { status: 404 });
  }

  const eventsRow = await listEvents(params.id);
  const evalRow = await getEvaluation(params.id);

  const job: Job = {
    id: jobRow.id,
    mode: jobRow.mode,
    goal: jobRow.goal,
    status: mapStatus(jobRow.status),
    worker: jobRow.assigned_to || "waiting...",
    budget: {
      steps: {
        used: jobRow.steps_used,
        max: jobRow.step_cap,
        percent: Math.round((jobRow.steps_used / jobRow.step_cap) * 100)
      },
      tokens: {
        used: jobRow.tokens_used || 0,
        max: jobRow.token_cap || 0,
        percent: Math.round(((jobRow.tokens_used || 0) / (jobRow.token_cap || 1)) * 100)
      },
      costCents: jobRow.cost_used_cents || 0
    },
    evaluation: {
      correctness: (evalRow?.correctness || 0) * 100,
      efficiency: (evalRow?.efficiency || 0) * 100,
      honesty: (evalRow?.honesty || 0) * 100,
      safety: (evalRow?.safety || 0) * 100,
      flags: evalRow?.flags || []
    }
  };

  const events: JobEvent[] = eventsRow.map(e => ({
    id: e.id,
    timestamp: e.created_at,
    kind: (['tool_call', 'decision', 'error', 'info'].includes(e.kind) ? e.kind : 'info') as any,
    summary: e.summary || "",
    toolName: e.tool_name || undefined
  }));

  return NextResponse.json({ job, events });
}
