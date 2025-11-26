/**
 * create_branch - Create a feature branch for changes
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import { execSync } from "child_process";

const paramsSchema = z.object({
  name: z.string().describe("Branch name (will be prefixed with job ID)"),
  baseBranch: z.string().optional().describe("Branch to base off of (default: main)"),
});

type CreateBranchParams = z.infer<typeof paramsSchema>;

export interface CreateBranchResult {
  branchName: string;
  basedOn: string;
  created: boolean;
}

export const createBranchTool: Tool<CreateBranchParams, CreateBranchResult> = {
  name: "create_branch",
  description:
    "Create a new branch for this work. ALWAYS call this first before making any code changes.",
  category: "MUTATING",
  paramsSchema,
  resultSchema: z.object({
    branchName: z.string(),
    basedOn: z.string(),
    created: z.boolean(),
  }),
  costHint: "cheap",
  riskHint: "reversible",
  idempotencyKey: (params) => `branch:${params.name}`,

  async execute(params, ctx): Promise<ToolResult<CreateBranchResult>> {
    try {
      const execOpts = { cwd: ctx.repoPath, encoding: "utf-8" as const };
      const baseBranch = params.baseBranch ?? "main";

      // Generate branch name with job prefix for traceability
      const branchName = `ai/${ctx.jobId.slice(0, 8)}/${params.name}`;

      // Check if branch already exists
      try {
        execSync(`git rev-parse --verify ${branchName}`, execOpts);
        // Branch exists, just switch to it
        execSync(`git checkout ${branchName}`, execOpts);
        return {
          success: true,
          data: {
            branchName,
            basedOn: baseBranch,
            created: false,
          },
          eventId: crypto.randomUUID(),
        };
      } catch {
        // Branch doesn't exist, create it
      }

      // Verify base branch exists
      try {
        execSync(`git rev-parse --verify ${baseBranch}`, execOpts);
      } catch {
        return {
          success: false,
          error: {
            code: "branch_not_found",
            message: `Base branch '${baseBranch}' does not exist`,
            recoverable: true,
          },
          eventId: crypto.randomUUID(),
        };
      }

      // Ensure we're on the base branch first
      try {
        execSync(`git checkout ${baseBranch}`, execOpts);
        execSync(`git pull --ff-only origin ${baseBranch} 2>/dev/null || true`, execOpts);
      } catch {
        // May fail if not tracking remote, that's okay
      }

      // Create and checkout new branch
      execSync(`git checkout -b ${branchName}`, execOpts);

      return {
        success: true,
        data: {
          branchName,
          basedOn: baseBranch,
          created: true,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "git_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};
