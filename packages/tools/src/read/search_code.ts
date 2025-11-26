/**
 * search_code - Search codebase for text patterns
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import { execSync } from "child_process";
import * as path from "path";

const paramsSchema = z.object({
  query: z.string().describe("Search query (regex pattern or text)"),
  path: z.string().optional().describe("Directory to search in (relative to repo root)"),
  filePattern: z.string().optional().describe("File glob pattern (e.g., '*.ts', '*.py')"),
  maxResults: z.number().optional().describe("Maximum results to return (default: 20)"),
});

type SearchCodeParams = z.infer<typeof paramsSchema>;

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export interface SearchCodeResult {
  matches: SearchMatch[];
  totalMatches: number;
  truncated: boolean;
}

export const searchCodeTool: Tool<SearchCodeParams, SearchCodeResult> = {
  name: "search_code",
  description:
    "Search the codebase for text patterns or regex. Use to find relevant files, function definitions, or usages.",
  category: "READ_ONLY",
  paramsSchema,
  resultSchema: z.object({
    matches: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        content: z.string(),
      })
    ),
    totalMatches: z.number(),
    truncated: z.boolean(),
  }),
  costHint: "moderate",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<SearchCodeResult>> {
    try {
      const maxResults = params.maxResults ?? 20;
      const searchPath = params.path
        ? path.join(ctx.repoPath, params.path)
        : ctx.repoPath;

      // Build ripgrep command
      let cmd = `rg --json --max-count ${maxResults * 2} "${params.query}"`;
      if (params.filePattern) {
        cmd += ` --glob "${params.filePattern}"`;
      }
      cmd += ` "${searchPath}"`;

      let output: string;
      try {
        output = execSync(cmd, {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          cwd: ctx.repoPath,
        });
      } catch (e: any) {
        // rg returns exit code 1 when no matches found
        if (e.status === 1) {
          return {
            success: true,
            data: { matches: [], totalMatches: 0, truncated: false },
            eventId: crypto.randomUUID(),
          };
        }
        // Try grep as fallback
        try {
          output = execSync(
            `grep -rn "${params.query}" "${searchPath}" | head -${maxResults}`,
            { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, cwd: ctx.repoPath }
          );
        } catch {
          return {
            success: true,
            data: { matches: [], totalMatches: 0, truncated: false },
            eventId: crypto.randomUUID(),
          };
        }
      }

      const matches: SearchMatch[] = [];
      const lines = output.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          // Try parsing as ripgrep JSON
          const json = JSON.parse(line);
          if (json.type === "match") {
            matches.push({
              file: path.relative(ctx.repoPath, json.data.path.text),
              line: json.data.line_number,
              content: json.data.lines.text.trim().slice(0, 200),
            });
          }
        } catch {
          // Parse grep output format: file:line:content
          const match = line.match(/^(.+?):(\d+):(.*)$/);
          if (match) {
            matches.push({
              file: path.relative(ctx.repoPath, match[1]),
              line: parseInt(match[2], 10),
              content: match[3].trim().slice(0, 200),
            });
          }
        }

        if (matches.length >= maxResults) break;
      }

      return {
        success: true,
        data: {
          matches: matches.slice(0, maxResults),
          totalMatches: matches.length,
          truncated: matches.length > maxResults,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "search_failed",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};
