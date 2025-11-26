/**
 * read_file - Read file contents with optional line ranges
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

const paramsSchema = z.object({
  path: z.string().describe("Path to the file (relative to repo root)"),
  startLine: z.number().optional().describe("Start reading from this line (1-indexed)"),
  endLine: z.number().optional().describe("Stop reading at this line (inclusive)"),
});

type ReadFileParams = z.infer<typeof paramsSchema>;

export interface ReadFileResult {
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export const readFileTool: Tool<ReadFileParams, ReadFileResult> = {
  name: "read_file",
  description:
    "Read the contents of a file. Can read specific line ranges for large files.",
  category: "READ_ONLY",
  paramsSchema,
  resultSchema: z.object({
    content: z.string(),
    totalLines: z.number(),
    startLine: z.number(),
    endLine: z.number(),
    truncated: z.boolean(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<ReadFileResult>> {
    try {
      const filePath = path.join(ctx.repoPath, params.path);

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: {
            code: "file_not_found",
            message: `File not found: ${params.path}`,
            recoverable: false,
          },
          eventId: crypto.randomUUID(),
        };
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return {
          success: false,
          error: {
            code: "is_directory",
            message: `Path is a directory, not a file: ${params.path}`,
            recoverable: false,
          },
          eventId: crypto.randomUUID(),
        };
      }

      // Check file size (limit to 1MB for safety)
      if (stat.size > 1024 * 1024) {
        return {
          success: false,
          error: {
            code: "file_too_large",
            message: `File is too large (${stat.size} bytes). Use startLine/endLine to read portions.`,
            recoverable: true,
          },
          eventId: crypto.randomUUID(),
        };
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const totalLines = lines.length;

      const startLine = params.startLine ?? 1;
      const maxLines = 500;
      const endLine = params.endLine ?? Math.min(totalLines, startLine + maxLines - 1);

      const selectedLines = lines.slice(startLine - 1, endLine);
      const truncated = endLine - startLine + 1 > maxLines;
      const outputLines = truncated ? selectedLines.slice(0, maxLines) : selectedLines;

      // Add line numbers for context
      const numberedContent = outputLines
        .map((line, i) => `${String(startLine + i).padStart(5)}| ${line}`)
        .join("\n");

      return {
        success: true,
        data: {
          content: numberedContent,
          totalLines,
          startLine,
          endLine: Math.min(endLine, startLine + outputLines.length - 1),
          truncated,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "read_failed",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};
