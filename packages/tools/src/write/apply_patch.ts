/**
 * apply_patch - Apply a unified diff to modify files
 * 
 * This is THE ONLY way agents should modify code.
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const paramsSchema = z.object({
  patch: z.string().describe("Unified diff format patch"),
  description: z.string().describe("Human-readable description of the change"),
  expectedFilesChanged: z.number().optional().describe("Expected number of files changed"),
});

type ApplyPatchParams = z.infer<typeof paramsSchema>;

interface PatchAnalysis {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  files: string[];
}

export interface ApplyPatchResult {
  applied: boolean;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  files: string[];
}

/**
 * Validate that a string is a valid unified diff
 */
function isValidUnifiedDiff(patch: string): boolean {
  return patch.includes("---") && patch.includes("+++") && patch.includes("@@");
}

/**
 * Analyze a patch to extract stats
 */
function analyzePatch(patch: string): PatchAnalysis {
  const files = new Set<string>();
  let linesAdded = 0;
  let linesRemoved = 0;

  const lines = patch.split("\n");
  for (const line of lines) {
    if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
      const filePath = line.replace("+++ b/", "").replace("+++ ", "").trim();
      if (filePath !== "/dev/null") {
        files.add(filePath);
      }
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      linesAdded++;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      linesRemoved++;
    }
  }

  return {
    filesChanged: files.size,
    linesAdded,
    linesRemoved,
    files: Array.from(files),
  };
}

export const applyPatchTool: Tool<ApplyPatchParams, ApplyPatchResult> = {
  name: "apply_patch",
  description:
    "Apply a unified diff to modify files. This is THE ONLY way to change code. NEVER write files directly.",
  category: "MUTATING",
  paramsSchema,
  resultSchema: z.object({
    applied: z.boolean(),
    filesChanged: z.number(),
    linesAdded: z.number(),
    linesRemoved: z.number(),
    files: z.array(z.string()),
  }),
  costHint: "moderate",
  riskHint: "reversible",

  async execute(params, ctx): Promise<ToolResult<ApplyPatchResult>> {
    try {
      // Validate patch format
      if (!isValidUnifiedDiff(params.patch)) {
        return {
          success: false,
          error: {
            code: "invalid_patch",
            message:
              "Patch is not valid unified diff format. Must include ---, +++, and @@ headers.",
            recoverable: true,
          },
          eventId: crypto.randomUUID(),
        };
      }

      // Analyze the patch
      const analysis = analyzePatch(params.patch);

      // Check mechanic mode constraints
      if (ctx.mode === "mechanic") {
        if (analysis.filesChanged > 5) {
          return {
            success: false,
            error: {
              code: "too_many_files",
              message: `Patch changes ${analysis.filesChanged} files, but mechanic mode allows max 5 files.`,
              recoverable: false,
            },
            eventId: crypto.randomUUID(),
          };
        }
        const totalLines = analysis.linesAdded + analysis.linesRemoved;
        if (totalLines > 200) {
          return {
            success: false,
            error: {
              code: "too_many_lines",
              message: `Patch changes ${totalLines} lines, but mechanic mode allows max 200 lines.`,
              recoverable: false,
            },
            eventId: crypto.randomUUID(),
          };
        }
      }

      // Write patch to temp file
      const patchFile = path.join(os.tmpdir(), `patch-${ctx.jobId}-${Date.now()}.patch`);
      fs.writeFileSync(patchFile, params.patch);

      const execOpts = { cwd: ctx.repoPath, encoding: "utf-8" as const };

      try {
        // Dry run first to check if patch applies cleanly
        execSync(`git apply --check "${patchFile}"`, execOpts);

        // Apply the patch
        execSync(`git apply "${patchFile}"`, execOpts);

        // Stage the changes
        execSync("git add -A", execOpts);

        return {
          success: true,
          data: {
            applied: true,
            filesChanged: analysis.filesChanged,
            linesAdded: analysis.linesAdded,
            linesRemoved: analysis.linesRemoved,
            files: analysis.files,
          },
          eventId: crypto.randomUUID(),
        };
      } catch (gitError: any) {
        let errorMsg = gitError.message;
        if (gitError.stderr) {
          errorMsg = gitError.stderr;
        }

        if (errorMsg.includes("patch does not apply")) {
          errorMsg =
            "Patch does not apply cleanly. The target files may have changed. Re-read the files and generate a new patch.";
        }

        return {
          success: false,
          error: {
            code: "patch_failed",
            message: errorMsg,
            recoverable: true,
          },
          eventId: crypto.randomUUID(),
        };
      } finally {
        try {
          fs.unlinkSync(patchFile);
        } catch {}
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "apply_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};
