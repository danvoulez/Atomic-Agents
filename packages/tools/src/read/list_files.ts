/**
 * list_files - List directory contents
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

const paramsSchema = z.object({
  path: z.string().optional().describe("Directory path (relative to repo root, default: '.')"),
  recursive: z.boolean().optional().describe("Include subdirectories (default: false)"),
  pattern: z.string().optional().describe("Glob pattern to filter files"),
});

type ListFilesParams = z.infer<typeof paramsSchema>;

export interface FileInfo {
  path: string;
  type: "file" | "directory";
  size?: number;
}

export interface ListFilesResult {
  files: FileInfo[];
  totalCount: number;
}

export const listFilesTool: Tool<ListFilesParams, ListFilesResult> = {
  name: "list_files",
  description: "List files and directories in a path. Use to explore the codebase structure.",
  category: "READ_ONLY",
  paramsSchema,
  resultSchema: z.object({
    files: z.array(
      z.object({
        path: z.string(),
        type: z.enum(["file", "directory"]),
        size: z.number().optional(),
      })
    ),
    totalCount: z.number(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<ListFilesResult>> {
    try {
      const dirPathParam = params.path ?? ".";
      const recursive = params.recursive ?? false;
      const dirPath = path.join(ctx.repoPath, dirPathParam);

      if (!fs.existsSync(dirPath)) {
        return {
          success: false,
          error: {
            code: "path_not_found",
            message: `Path not found: ${dirPathParam}`,
            recoverable: false,
          },
          eventId: crypto.randomUUID(),
        };
      }

      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) {
        return {
          success: false,
          error: {
            code: "not_a_directory",
            message: `Path is not a directory: ${dirPathParam}`,
            recoverable: false,
          },
          eventId: crypto.randomUUID(),
        };
      }

      const files: FileInfo[] = [];

      const listDir = (dir: string, relativeTo: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          // Skip hidden files and common ignored directories
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target" || entry.name === "dist") {
            continue;
          }

          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(relativeTo, fullPath);

          if (entry.isDirectory()) {
            files.push({ path: relPath, type: "directory" });
            if (recursive && files.length < 500) {
              listDir(fullPath, relativeTo);
            }
          } else {
            const fileStat = fs.statSync(fullPath);
            files.push({ path: relPath, type: "file", size: fileStat.size });
          }

          if (files.length >= 500) break;
        }
      };

      listDir(dirPath, dirPath);

      // Filter by pattern if provided
      let filteredFiles = files;
      if (params.pattern) {
        const regex = new RegExp(
          params.pattern.replace(/\*/g, ".*").replace(/\?/g, ".")
        );
        filteredFiles = files.filter((f) => regex.test(f.path));
      }

      return {
        success: true,
        data: {
          files: filteredFiles,
          totalCount: filteredFiles.length,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "list_failed",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};
