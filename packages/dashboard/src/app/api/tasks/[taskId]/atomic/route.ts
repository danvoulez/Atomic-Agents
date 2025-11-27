/**
 * Atomic Insights API
 * 
 * GET /api/tasks/:taskId/atomic - Get Atomic Agents insights (mode, budget, quality, TDLN)
 */

import { NextRequest, NextResponse } from "next/server";
import { atomicAdapter } from "../../../../../lib/atomic-adapter";

interface RouteParams {
  params: { taskId: string };
}

// GET /api/tasks/:taskId/atomic - Get Atomic Agents insights
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = params;

    const insights = await atomicAdapter.getAtomicInsights(taskId);

    if (!insights) {
      return NextResponse.json(
        { error: "No Atomic Agents data for this task" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      ...insights,
    });
  } catch (error) {
    console.error("Error getting atomic insights:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get insights" },
      { status: 500 }
    );
  }
}

