/**
 * Tasks API - Fusion of Vercel Template + Atomic Agents
 * 
 * POST /api/tasks - Create new task (creates both task + job)
 * GET /api/tasks - List tasks for user
 */

import { NextRequest, NextResponse } from "next/server";
import { atomicAdapter } from "../../../lib/atomic-adapter";

// POST /api/tasks - Create task
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, prompt, repoUrl, selectedAgent, selectedModel, title } = body;

    // Validation
    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    if (!prompt || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 }
      );
    }

    // Create task via adapter (creates both task + job)
    const result = await atomicAdapter.createTask({
      userId,
      prompt: prompt.trim(),
      repoUrl,
      selectedAgent,
      selectedModel,
      title,
    });

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      jobId: result.jobId,
    });
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create task" },
      { status: 500 }
    );
  }
}

// GET /api/tasks - List tasks
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const limit = parseInt(searchParams.get("limit") || "50");

    if (!userId) {
      return NextResponse.json(
        { error: "userId query parameter is required" },
        { status: 400 }
      );
    }

    const tasks = await atomicAdapter.listTasks(userId, limit);

    return NextResponse.json({
      success: true,
      tasks,
      count: tasks.length,
    });
  } catch (error) {
    console.error("Error listing tasks:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list tasks" },
      { status: 500 }
    );
  }
}

