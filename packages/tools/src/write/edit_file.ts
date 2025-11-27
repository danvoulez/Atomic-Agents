/**
 * edit_file - Simple search and replace in a file
 * 
 * This is easier for LLMs to use than unified diffs.
 * It finds a unique string in the file and replaces it.
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const paramsSchema = z.object({
  path: z.string().describe("Path to the file to edit, relative to repo root"),
  old_string: z.string().describe("The exact string to find and replace. Must be unique in the file."),
  new_string: z.string().describe("The string to replace it with"),
  description: z.string().describe("Brief description of the change"),
});

type EditFileParams = z.infer<typeof paramsSchema>;

export interface EditFileResult {
  success: boolean;
  path: string;
  linesChanged: number;
}

export const editFileTool: Tool<EditFileParams, EditFileResult> = {
  name: "edit_file",
  description:
    "Edit a file by replacing a specific string with another. The old_string must be unique in the file. " +
    "Use this for simple edits. For complex multi-location edits, use apply_patch.",
  category: "MUTATING",
  paramsSchema,
  resultSchema: z.object({
    success: z.boolean(),
    path: z.string(),
    linesChanged: z.number(),
  }),
  costHint: "cheap",
  riskHint: "reversible",

  async execute(params, ctx): Promise<ToolResult<EditFileResult>> {
    try {
      const filePath = path.join(ctx.repoPath, params.path);

      // Check file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: {
            code: "file_not_found",
            message: `File not found: ${params.path}`,
            recoverable: true,
          },
          eventId: crypto.randomUUID(),
        };
      }

      // Read file
      const content = fs.readFileSync(filePath, "utf-8");

      // Check old_string exists and is unique
      const occurrences = content.split(params.old_string).length - 1;

      if (occurrences === 0) {
        return {
          success: false,
          error: {
            code: "string_not_found",
            message: `The string to replace was not found in ${params.path}. Make sure it matches exactly including whitespace.`,
            recoverable: true,
          },
          eventId: crypto.randomUUID(),
        };
      }

      if (occurrences > 1) {
        return {
          success: false,
          error: {
            code: "string_not_unique",
            message: `The string to replace appears ${occurrences} times in ${params.path}. It must be unique. Include more context.`,
            recoverable: true,
          },
          eventId: crypto.randomUUID(),
        };
      }

      // Perform replacement
      const newContent = content.replace(params.old_string, params.new_string);

      // Check mechanic mode constraints
      if (ctx.mode === "mechanic") {
        const oldLines = params.old_string.split("\n").length;
        const newLines = params.new_string.split("\n").length;
        const linesChanged = Math.abs(newLines - oldLines) + Math.max(oldLines, newLines);
        
        if (linesChanged > 50) {
          return {
            success: false,
            error: {
              code: "too_many_lines",
              message: `Edit changes ${linesChanged} lines. In mechanic mode, use smaller edits or switch to genius mode.`,
              recoverable: false,
            },
            eventId: crypto.randomUUID(),
          };
        }
      }

      // Write file
      fs.writeFileSync(filePath, newContent);

      // Stage the change
      try {
        execSync(`git add "${params.path}"`, { cwd: ctx.repoPath });
      } catch {
        // Ignore git errors (repo might not be initialized)
      }

      const linesChanged = params.old_string.split("\n").length;

      return {
        success: true,
        data: {
          success: true,
          path: params.path,
          linesChanged,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "edit_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};



