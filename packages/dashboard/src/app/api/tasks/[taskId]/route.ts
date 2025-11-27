/**
 * Task Detail API
 * 
 * GET /api/tasks/:taskId - Get task with full job details
 * DELETE /api/tasks/:taskId - Cancel/delete task
 */

import { NextRequest, NextResponse } from "next/server";
import { atomicAdapter } from "../../../../lib/atomic-adapter";

interface RouteParams {
  params: { taskId: string };
}

// GET /api/tasks/:taskId - Get task details
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = params;

    const task = await atomicAdapter.getTaskWithJob(taskId);

    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      task,
    });
  } catch (error) {
    console.error("Error getting task:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get task" },
      { status: 500 }
    );
  }
}

// DELETE /api/tasks/:taskId - Cancel task
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = params;

    await atomicAdapter.cancelTask(taskId);

    return NextResponse.json({
      success: true,
      message: "Task cancelled",
    });
  } catch (error) {
    console.error("Error cancelling task:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel task" },
      { status: 500 }
    );
  }
}

