/**
 * get_repo_state - Get current git repository state
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import { execSync } from "child_process";

const paramsSchema = z.object({});

type GetRepoStateParams = z.infer<typeof paramsSchema>;

export interface RepoState {
  branch: string;
  status: "clean" | "dirty";
  uncommittedChanges: string[];
  recentCommits: Array<{ hash: string; message: string; author: string; date: string }>;
  remoteUrl?: string;
}

export const getRepoStateTool: Tool<GetRepoStateParams, RepoState> = {
  name: "get_repo_state",
  description:
    "Get the current state of the git repository: branch, uncommitted changes, recent commits.",
  category: "READ_ONLY",
  paramsSchema,
  resultSchema: z.object({
    branch: z.string(),
    status: z.enum(["clean", "dirty"]),
    uncommittedChanges: z.array(z.string()),
    recentCommits: z.array(
      z.object({
        hash: z.string(),
        message: z.string(),
        author: z.string(),
        date: z.string(),
      })
    ),
    remoteUrl: z.string().optional(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<RepoState>> {
    try {
      const execOpts = { cwd: ctx.repoPath, encoding: "utf-8" as const };

      // Get current branch
      let branch = "unknown";
      try {
        branch = execSync("git branch --show-current", execOpts).trim();
        if (!branch) {
          // Detached HEAD state
          branch = execSync("git rev-parse --short HEAD", execOpts).trim();
        }
      } catch {}

      // Get status
      let status: "clean" | "dirty" = "clean";
      let uncommittedChanges: string[] = [];
      try {
        const statusOutput = execSync("git status --porcelain", execOpts);
        uncommittedChanges = statusOutput
          .split("\n")
          .filter(Boolean)
          .map((line) => line.trim());
        status = uncommittedChanges.length > 0 ? "dirty" : "clean";
      } catch {}

      // Get recent commits
      let recentCommits: RepoState["recentCommits"] = [];
      try {
        const logOutput = execSync(
          'git log --oneline -10 --format="%h|%s|%an|%as"',
          execOpts
        );
        recentCommits = logOutput
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [hash, message, author, date] = line.split("|");
            return { hash, message, author, date };
          });
      } catch {}

      // Get remote URL
      let remoteUrl: string | undefined;
      try {
        remoteUrl = execSync("git remote get-url origin", execOpts).trim();
      } catch {}

      return {
        success: true,
        data: {
          branch,
          status,
          uncommittedChanges,
          recentCommits,
          remoteUrl,
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
