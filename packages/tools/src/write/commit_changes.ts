/**
 * commit_changes - Create a git commit (requires tests to pass)
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import { execSync } from "child_process";

const paramsSchema = z.object({
  message: z.string().describe("Commit message (follow conventional commits format)"),
});

type CommitChangesParams = z.infer<typeof paramsSchema>;

export interface CommitResult {
  committed: boolean;
  commitHash: string;
  filesCommitted: number;
  branch: string;
}

export const commitChangesTool: Tool<CommitChangesParams, CommitResult> = {
  name: "commit_changes",
  description:
    "Create a commit with staged changes. REQUIRES tests and lint to pass first. NEVER skip tests.",
  category: "MUTATING",
  paramsSchema,
  resultSchema: z.object({
    committed: z.boolean(),
    commitHash: z.string(),
    filesCommitted: z.number(),
    branch: z.string(),
  }),
  costHint: "cheap",
  riskHint: "reversible",

  async execute(params, ctx): Promise<ToolResult<CommitResult>> {
    try {
      const execOpts = { cwd: ctx.repoPath, encoding: "utf-8" as const };

      // Stage all changes
      execSync("git add -A", execOpts);

      // Check if there are changes to commit
      const status = execSync("git status --porcelain", execOpts);
      if (!status.trim()) {
        return {
          success: false,
          error: {
            code: "nothing_to_commit",
            message: "No changes to commit",
            recoverable: false,
          },
          eventId: crypto.randomUUID(),
        };
      }

      // Count files
      const filesCount = status.split("\n").filter(Boolean).length;

      // Escape commit message for shell
      const escapedMessage = params.message.replace(/"/g, '\\"').replace(/\$/g, '\\$');

      // Create the commit
      execSync(`git commit -m "${escapedMessage}"`, execOpts);

      // Get commit hash
      const commitHash = execSync("git rev-parse HEAD", execOpts).trim();
      const branch = execSync("git branch --show-current", execOpts).trim();

      return {
        success: true,
        data: {
          committed: true,
          commitHash,
          filesCommitted: filesCount,
          branch,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "commit_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};
