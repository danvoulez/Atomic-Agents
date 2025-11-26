/**
 * Reviewer-specific tools for code review
 *
 * The Reviewer uses these tools to:
 * - Inspect code changes (diffs)
 * - Approve or request changes
 * - Document review findings
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { markJobStatus, insertEvent } from "@ai-coding-team/db";
import { z } from "zod";
import { execSync } from "child_process";

// Import read tools from planner (Reviewer needs them for inspection)
import {
  readFileTool,
  searchCodeTool,
  getRepoStateTool,
  recordAnalysisTool,
  requestHumanReviewTool,
} from "./planner-tools";

// =============================================================================
// get_diff - Get git diff for review
// =============================================================================

const getDiffParams = z.object({
  target: z
    .enum(["staged", "unstaged", "branch", "commit"])
    .describe("What to diff against"),
  branch: z.string().optional().describe("Branch name for branch diff"),
  commitRange: z.string().optional().describe("Commit range (e.g., HEAD~3..HEAD)"),
  files: z.array(z.string()).optional().describe("Specific files to include"),
});

type GetDiffParams = z.infer<typeof getDiffParams>;

export interface DiffResult {
  diff: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
}

export const getDiffTool: Tool<GetDiffParams, DiffResult> = {
  name: "get_diff",
  description: "Get git diff for review. Use to see what code has changed.",
  category: "READ_ONLY",
  paramsSchema: getDiffParams,
  resultSchema: z.object({
    diff: z.string(),
    filesChanged: z.number(),
    linesAdded: z.number(),
    linesRemoved: z.number(),
    files: z.array(
      z.object({
        path: z.string(),
        status: z.string(),
        additions: z.number(),
        deletions: z.number(),
      })
    ),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<DiffResult>> {
    try {
      const execOpts = { cwd: ctx.repoPath, encoding: "utf-8" as const, maxBuffer: 10 * 1024 * 1024 };

      // Build diff command based on target
      let diffCmd = "git diff";
      let statCmd = "git diff --stat";

      switch (params.target) {
        case "staged":
          diffCmd = "git diff --cached";
          statCmd = "git diff --cached --stat";
          break;
        case "unstaged":
          diffCmd = "git diff";
          statCmd = "git diff --stat";
          break;
        case "branch":
          if (!params.branch) {
            return {
              success: false,
              error: {
                code: "missing_branch",
                message: "Branch name required for branch diff",
                recoverable: true,
              },
              eventId: crypto.randomUUID(),
            };
          }
          diffCmd = `git diff ${params.branch}...HEAD`;
          statCmd = `git diff ${params.branch}...HEAD --stat`;
          break;
        case "commit":
          const range = params.commitRange ?? "HEAD~1..HEAD";
          diffCmd = `git diff ${range}`;
          statCmd = `git diff ${range} --stat`;
          break;
      }

      // Add file filters
      if (params.files && params.files.length > 0) {
        const fileList = params.files.join(" ");
        diffCmd += ` -- ${fileList}`;
        statCmd += ` -- ${fileList}`;
      }

      // Get the diff
      let diff: string;
      try {
        diff = execSync(diffCmd, execOpts);
      } catch (e: any) {
        diff = e.stdout || "";
      }

      // Get stats
      let linesAdded = 0;
      let linesRemoved = 0;
      const files: DiffResult["files"] = [];

      try {
        const numstatOutput = execSync(
          diffCmd.replace("git diff", "git diff --numstat"),
          execOpts
        );
        for (const line of numstatOutput.split("\n").filter(Boolean)) {
          const [added, removed, path] = line.split("\t");
          const additions = parseInt(added, 10) || 0;
          const deletions = parseInt(removed, 10) || 0;
          linesAdded += additions;
          linesRemoved += deletions;
          files.push({
            path,
            status: additions > 0 && deletions > 0 ? "modified" : additions > 0 ? "added" : "deleted",
            additions,
            deletions,
          });
        }
      } catch {}

      // Truncate large diffs
      const maxDiffLength = 50000;
      const truncatedDiff = diff.length > maxDiffLength
        ? diff.slice(0, maxDiffLength) + "\n... (truncated)"
        : diff;

      return {
        success: true,
        data: {
          diff: truncatedDiff,
          filesChanged: files.length,
          linesAdded,
          linesRemoved,
          files,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "diff_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// approve_changes - Approve the review
// =============================================================================

const approveChangesParams = z.object({
  summary: z.string().describe("Summary of the approval"),
  comments: z
    .array(
      z.object({
        file: z.string(),
        line: z.number().optional(),
        comment: z.string(),
        severity: z.enum(["info", "suggestion", "nitpick"]),
      })
    )
    .optional()
    .describe("Optional comments or suggestions"),
});

type ApproveChangesParams = z.infer<typeof approveChangesParams>;

export interface ApproveChangesResult {
  approved: boolean;
  reviewId: string;
}

export const approveChangesTool: Tool<ApproveChangesParams, ApproveChangesResult> = {
  name: "approve_changes",
  description: "Approve the code changes. Use when the code looks good and is ready to merge.",
  category: "META",
  paramsSchema: approveChangesParams,
  resultSchema: z.object({
    approved: z.boolean(),
    reviewId: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<ApproveChangesResult>> {
    const reviewId = crypto.randomUUID();

    // Log the approval event
    await ctx.logEvent({
      kind: "decision",
      summary: `Review APPROVED: ${params.summary}`,
      result: {
        reviewId,
        verdict: "approved",
        ...params,
      },
    });

    // Mark job as succeeded
    await markJobStatus(ctx.jobId, "succeeded");

    return {
      success: true,
      data: {
        approved: true,
        reviewId,
      },
      eventId: reviewId,
    };
  },
};

// =============================================================================
// request_changes - Request modifications
// =============================================================================

const requestChangesParams = z.object({
  summary: z.string().describe("Summary of changes needed"),
  blockers: z.array(
    z.object({
      file: z.string(),
      line: z.number().optional(),
      issue: z.string(),
      severity: z.enum(["critical", "major", "minor"]),
      suggestion: z.string().optional(),
    })
  ).describe("List of issues that need to be fixed"),
});

type RequestChangesParams = z.infer<typeof requestChangesParams>;

export interface RequestChangesResult {
  changesRequested: boolean;
  reviewId: string;
  blockerCount: number;
}

export const requestChangesTool: Tool<RequestChangesParams, RequestChangesResult> = {
  name: "request_changes",
  description: "Request changes to the code. Use when issues are found that need to be addressed.",
  category: "META",
  paramsSchema: requestChangesParams,
  resultSchema: z.object({
    changesRequested: z.boolean(),
    reviewId: z.string(),
    blockerCount: z.number(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<RequestChangesResult>> {
    const reviewId = crypto.randomUUID();

    // Count critical/major issues
    const criticalCount = params.blockers.filter(b => b.severity === "critical").length;
    const majorCount = params.blockers.filter(b => b.severity === "major").length;

    // Log the rejection event
    await ctx.logEvent({
      kind: "decision",
      summary: `Review CHANGES REQUESTED: ${params.summary} (${criticalCount} critical, ${majorCount} major)`,
      result: {
        reviewId,
        verdict: "changes_requested",
        ...params,
      },
    });

    // Don't mark job as failed - it needs rework
    // The coordinator will handle creating a new builder job

    return {
      success: true,
      data: {
        changesRequested: true,
        reviewId,
        blockerCount: params.blockers.length,
      },
      eventId: reviewId,
    };
  },
};

// =============================================================================
// Export all reviewer tools
// =============================================================================

export const reviewerTools = [
  // READ_ONLY (from planner)
  readFileTool,
  searchCodeTool,
  getRepoStateTool,
  // Reviewer-specific READ
  getDiffTool,
  // META (from planner)
  recordAnalysisTool,
  requestHumanReviewTool,
  // Reviewer-specific META
  approveChangesTool,
  requestChangesTool,
];

