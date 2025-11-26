/**
 * Metrics API Endpoint
 * 
 * Provides comprehensive metrics from the ledger.
 */

import { NextRequest, NextResponse } from "next/server";
import { 
  collectAllMetrics, 
  collectJobMetrics, 
  collectAgentMetrics,
  collectTimeseries,
  type FullMetrics,
} from "@ai-coding-team/db";
import { withMiddleware, createErrorResponse, API_ERRORS } from "../../../lib/middleware";

// Force dynamic rendering
export const dynamic = "force-dynamic";

/**
 * GET /api/metrics
 * 
 * Query params:
 * - since: ISO timestamp for filtering (default: 24h ago)
 * - section: specific section (jobs, agents, budget, conversations, system, insights)
 */
export const GET = withMiddleware(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const since = searchParams.get("since") || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const section = searchParams.get("section");

    // If specific section requested
    if (section) {
      let data: unknown;
      switch (section) {
        case "jobs":
          data = await collectJobMetrics(since);
          break;
        case "agents":
          data = await collectAgentMetrics(since);
          break;
        case "timeseries":
          const interval = searchParams.get("interval") as "hour" | "day" || "hour";
          const points = parseInt(searchParams.get("points") || "24");
          data = await collectTimeseries(interval, points);
          break;
        default:
          return createErrorResponse(API_ERRORS.BAD_REQUEST, {
            message: `Unknown section: ${section}`,
            validSections: ["jobs", "agents", "timeseries"],
          });
      }
      return NextResponse.json({ data });
    }

    // Full metrics
    const metrics = await collectAllMetrics(since);
    
    return NextResponse.json({ 
      data: metrics,
      meta: {
        since,
        collectedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[Metrics API Error]", error);
    return createErrorResponse(API_ERRORS.INTERNAL_ERROR, {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

