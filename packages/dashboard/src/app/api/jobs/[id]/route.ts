import { NextRequest, NextResponse } from "next/server";
import { getJob, listEvents, getEvaluation } from "@ai-coding-team/db";
import { Job, JobEvent, mapStatus } from "@/lib/types";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const jobRow = await getJob(params.id);
  if (!jobRow) {
    return NextResponse.json({ 
      error: { code: "JOB_NOT_FOUND", message: "Job not found" } 
    }, { status: 404 });
  }

  const eventsRow = await listEvents(params.id);
  const evalRow = await getEvaluation(params.id);

  // Calculate percentages
  const stepsMax = jobRow.step_cap || 1;
  const stepsUsed = jobRow.steps_used || 0;
  const tokensMax = jobRow.token_cap || 1;
  const tokensUsed = jobRow.tokens_used || 0;

  // Calculate uptime string (simple version)
  let uptime = "0s";
  if (jobRow.started_at) {
    const end = jobRow.finished_at ? new Date(jobRow.finished_at).getTime() : Date.now();
    const start = new Date(jobRow.started_at).getTime();
    const diffSec = Math.floor((end - start) / 1000);
    const m = Math.floor(diffSec / 60);
    const s = diffSec % 60;
    uptime = `${m}m ${s}s`;
  }

  const job: Job = {
    id: jobRow.id,
    mode: jobRow.mode,
    goal: jobRow.goal,
    status: mapStatus(jobRow.status),
    worker: jobRow.assigned_to || "unassigned",
    budget: {
      steps: { 
        used: stepsUsed, 
        max: stepsMax, 
        percent: Math.round((stepsUsed / stepsMax) * 100) 
      },
      tokens: { 
        used: tokensUsed, 
        max: tokensMax, 
        percent: Math.round((tokensUsed / tokensMax) * 100) 
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

  return NextResponse.json({ 
    job, 
    events,
    uptime,
    queueDepth: 0, // Placeholder until queue metric implemented
    workerStatus: jobRow.assigned_to ? 'alive' : 'idle'
  });
}
