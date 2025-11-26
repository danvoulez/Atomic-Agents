import { NextRequest } from "next/server";
import { ActiveJob } from "@/types";
import { listJobs, insertJob, JobStatus } from "@ai-coding-team/db";

// GET /api/jobs - List jobs
export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  const status = req.nextUrl.searchParams.get("status") as JobStatus | null;
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);

  const rows = await listJobs({
    conversationId: conversationId ?? undefined,
    status: status ?? undefined,
    limit,
  });

  const jobs: ActiveJob[] = rows.map(row => ({
    id: row.id,
    status: row.status,
    goal: row.goal,
    mode: row.mode,
    agentType: row.agent_type ?? "coordinator",
    stepCap: row.step_cap ?? 20,
    stepsUsed: row.steps_used ?? 0,
    tokenCap: row.token_cap ?? 100000,
    tokensUsed: row.tokens_used ?? 0,
    startedAt: row.started_at ?? row.created_at,
    finishedAt: row.finished_at,
  }));

  return Response.json({ jobs, total: rows.length });
}

// POST /api/jobs - Create a new job
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required fields
    const { goal, mode, conversationId, repoPath, agentType } = body;
    if (!goal) {
      return Response.json({ error: "Goal is required" }, { status: 400 });
    }

    // Validate mode
    const validModes = ["mechanic", "genius"];
    const jobMode = validModes.includes(mode) ? mode : "mechanic";

    // Create job
    const job = await insertJob({
      goal,
      mode: jobMode,
      agent_type: agentType ?? "coordinator",
      status: "queued",
      conversation_id: conversationId ?? null,
      repo_path: repoPath ?? process.env.DEFAULT_REPO_PATH ?? "/tmp/repo",
      step_cap: jobMode === "mechanic" ? 20 : 100,
      token_cap: jobMode === "mechanic" ? 50000 : 200000,
      cost_cap_cents: jobMode === "mechanic" ? 100 : 500,
      created_by: "api",
    });

    return Response.json({ job }, { status: 201 });
  } catch (error: any) {
    console.error("Failed to create job:", error);
    return Response.json(
      { error: "Failed to create job", details: error.message },
      { status: 500 }
    );
  }
}
