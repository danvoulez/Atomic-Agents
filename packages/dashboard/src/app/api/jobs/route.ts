import { NextRequest, NextResponse } from "next/server";
import { listJobs, insertJob } from "@ai-coding-team/db";
import { Task, mapStatus } from "@/lib/types";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const search = searchParams.get("search")?.toLowerCase();
  const limit = parseInt(searchParams.get("limit") || "50");

  const dbStatus = statusParam === 'pending' ? 'queued' : statusParam;

  const rows = await listJobs({ 
    status: (dbStatus !== 'all' && dbStatus) ? (dbStatus as any) : undefined,
    limit 
  });

  // In-memory search (title/goal or repo)
  const filtered = search 
    ? rows.filter(r => r.goal.toLowerCase().includes(search) || r.repo_path.toLowerCase().includes(search))
    : rows;

  const tasks: Task[] = filtered.map(row => ({
    id: row.id,
    title: row.goal,
    status: mapStatus(row.status),
    repo: row.repo_path,
    createdAt: row.created_at,
    agent: row.agent_type,
    budget: {
      stepsUsed: row.steps_used,
      stepsMax: row.step_cap
    }
  }));

  return NextResponse.json({ jobs: tasks, total: tasks.length });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { conversationId, goal, mode, repoPath } = body;

    const job = await insertJob({
      goal,
      mode: mode || "mechanic",
      agent_type: "coordinator",
      repo_path: repoPath,
      conversation_id: conversationId,
      status: "queued",
      step_cap: mode === "mechanic" ? 20 : 100,
      token_cap: mode === "mechanic" ? 50000 : 200000,
    });

    return NextResponse.json({ jobId: job.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: { code: "CREATE_FAILED", message: e.message } }, { status: 500 });
  }
}
