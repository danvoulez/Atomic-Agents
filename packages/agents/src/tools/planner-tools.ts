/**
 * Planner-specific tools for code analysis and plan creation
 *
 * The Planner uses these tools to:
 * - Read and explore the codebase (READ_ONLY tools)
 * - Document analysis findings
 * - Create structured plans for the Builder
 * - Escalate when tasks are too complex
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { insertEvent } from "@ai-coding-team/db";
import { z } from "zod";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// search_code - Search codebase for patterns
// =============================================================================

const searchCodeParams = z.object({
  query: z.string().describe("Search query (regex pattern or text)"),
  path: z.string().optional().describe("Directory to search in (relative to repo root)"),
  filePattern: z.string().optional().describe("File glob pattern (e.g., '*.ts', '*.py')"),
  maxResults: z.number().optional().describe("Maximum results to return (default: 20)"),
});

type SearchCodeParams = z.infer<typeof searchCodeParams>;

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
  paramsSchema: searchCodeParams,
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
        output = execSync(
          `grep -rn "${params.query}" "${searchPath}" | head -${maxResults}`,
          { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, cwd: ctx.repoPath }
        );
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

// =============================================================================
// read_file - Read file contents
// =============================================================================

const readFileParams = z.object({
  path: z.string().describe("Path to the file (relative to repo root)"),
  startLine: z.number().optional().describe("Start reading from this line (1-indexed)"),
  endLine: z.number().optional().describe("Stop reading at this line (inclusive)"),
});

type ReadFileParams = z.infer<typeof readFileParams>;

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
  paramsSchema: readFileParams,
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

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const totalLines = lines.length;

      const startLine = params.startLine ?? 1;
      const endLine = params.endLine ?? Math.min(totalLines, startLine + 500);
      const maxLines = 500;

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

// =============================================================================
// list_files - List directory contents
// =============================================================================

const listFilesParams = z.object({
  path: z.string().optional().describe("Directory path (relative to repo root, default: '.')"),
  recursive: z.boolean().optional().describe("Include subdirectories (default: false)"),
  pattern: z.string().optional().describe("Glob pattern to filter files"),
});

type ListFilesParams = z.infer<typeof listFilesParams>;

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
  paramsSchema: listFilesParams,
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

      const files: FileInfo[] = [];

      const listDir = (dir: string, relativeTo: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          // Skip hidden files and common ignored directories
          if (entry.name.startsWith(".") || entry.name === "node_modules") {
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
            const stat = fs.statSync(fullPath);
            files.push({ path: relPath, type: "file", size: stat.size });
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

// =============================================================================
// get_repo_state - Get repository state
// =============================================================================

const getRepoStateParams = z.object({});

type GetRepoStateParams = z.infer<typeof getRepoStateParams>;

export interface RepoState {
  branch: string;
  status: string;
  uncommittedChanges: string[];
  recentCommits: Array<{ hash: string; message: string; author: string; date: string }>;
}

export const getRepoStateTool: Tool<GetRepoStateParams, RepoState> = {
  name: "get_repo_state",
  description:
    "Get the current state of the git repository: branch, uncommitted changes, recent commits.",
  category: "READ_ONLY",
  paramsSchema: getRepoStateParams,
  resultSchema: z.object({
    branch: z.string(),
    status: z.string(),
    uncommittedChanges: z.array(z.string()),
    recentCommits: z.array(
      z.object({
        hash: z.string(),
        message: z.string(),
        author: z.string(),
        date: z.string(),
      })
    ),
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
      } catch {}

      // Get status
      let status = "clean";
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

      return {
        success: true,
        data: {
          branch,
          status,
          uncommittedChanges,
          recentCommits,
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

// =============================================================================
// record_analysis - Document analysis findings (expanded schema)
// =============================================================================

const recordAnalysisParams = z.object({
  rootCause: z.string().optional().describe("Root cause of the bug (for bug fixes)"),
  scope: z.string().optional().describe("Scope of the feature or change"),
  affectedFiles: z.array(z.string()).describe("List of files that need to change"),
  complexity: z
    .enum(["trivial", "simple", "moderate", "complex"])
    .describe("Estimated complexity of the change"),
  risk: z.enum(["low", "medium", "high"]).describe("Risk level of the change"),
  evidence: z.array(z.string()).describe("Evidence supporting the analysis (code snippets, logs, etc.)"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence level in the analysis (0-1)"),
  dependencies: z
    .array(z.string())
    .optional()
    .describe("Dependencies or ordering constraints"),
  alternatives: z
    .array(z.string())
    .optional()
    .describe("Alternative approaches considered"),
});

type RecordAnalysisParams = z.infer<typeof recordAnalysisParams>;

export interface RecordAnalysisResult {
  recorded: boolean;
  analysisId: string;
}

export const recordAnalysisTool: Tool<RecordAnalysisParams, RecordAnalysisResult> = {
  name: "record_analysis",
  description:
    "Record your analysis findings. REQUIRED before creating a plan. Documents root cause, affected files, complexity, and risk.",
  category: "META",
  paramsSchema: recordAnalysisParams,
  resultSchema: z.object({
    recorded: z.boolean(),
    analysisId: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<RecordAnalysisResult>> {
    const analysisId = crypto.randomUUID();

    // Store analysis as an event
    await ctx.logEvent({
      kind: "analysis",
      summary: `Analysis complete: ${params.complexity} complexity, ${params.risk} risk, ${params.affectedFiles.length} files affected`,
      result: {
        analysisId,
        ...params,
      },
    });

    return {
      success: true,
      data: {
        recorded: true,
        analysisId,
      },
      eventId: analysisId,
    };
  },
};

// =============================================================================
// create_plan - Create structured plan for Builder (expanded schema)
// =============================================================================

const planStepSchema = z.object({
  stepNumber: z.number().describe("Step number in sequence"),
  action: z.string().describe("Tool name to call (e.g., apply_patch, run_tests)"),
  params: z.record(z.any()).describe("Parameters for the tool"),
  expectedOutcome: z.string().describe("What should happen when this step succeeds"),
  onFailure: z
    .enum(["retry", "escalate", "continue"])
    .optional()
    .describe("What to do if this step fails (default: retry)"),
});

const createPlanParams = z.object({
  title: z.string().describe("Brief title for the plan"),
  analysis: z.object({
    rootCause: z.string().optional().describe("Root cause (from record_analysis)"),
    location: z.string().describe("Primary location of the change"),
    confidence: z.number().describe("Confidence level (from record_analysis)"),
  }),
  steps: z.array(planStepSchema).describe("Ordered list of steps for the Builder"),
  constraints: z
    .object({
      maxFiles: z.number().optional(),
      maxLines: z.number().optional(),
      mustPassTests: z.boolean().optional(),
    })
    .optional()
    .describe("Constraints for mechanic mode"),
  rollbackPlan: z.string().optional().describe("How to rollback if things go wrong"),
});

type CreatePlanParams = z.infer<typeof createPlanParams>;

export interface CreatePlanResult {
  stored: boolean;
  planId: string;
  stepCount: number;
}

export const createPlanTool: Tool<CreatePlanParams, CreatePlanResult> = {
  name: "create_plan",
  description:
    "Create a PLAN span with specific steps for the Builder agent. Each step should be a single tool action.",
  category: "META",
  paramsSchema: createPlanParams,
  resultSchema: z.object({
    stored: z.boolean(),
    planId: z.string(),
    stepCount: z.number(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<CreatePlanResult>> {
    const planId = crypto.randomUUID();

    // Store plan as an event with kind: plan
    await ctx.logEvent({
      kind: "plan",
      summary: `Plan created: ${params.title} (${params.steps.length} steps)`,
      result: {
        planId,
        ...params,
      },
    });

    return {
      success: true,
      data: {
        stored: true,
        planId,
        stepCount: params.steps.length,
      },
      eventId: planId,
    };
  },
};

// =============================================================================
// request_human_review - Escalate to human
// =============================================================================

const requestHumanReviewParams = z.object({
  reason: z.string().describe("Why human review is needed"),
  context: z.string().describe("Relevant context for the reviewer"),
  options: z
    .array(z.string())
    .optional()
    .describe("Possible actions the human can choose"),
  blockedOn: z.string().optional().describe("What is blocking progress"),
});

type RequestHumanReviewParams = z.infer<typeof requestHumanReviewParams>;

export interface RequestHumanReviewResult {
  escalated: boolean;
  escalationId: string;
}

export const requestHumanReviewTool: Tool<RequestHumanReviewParams, RequestHumanReviewResult> = {
  name: "request_human_review",
  description:
    "Escalate to a human reviewer. Use when the task is too complex, risky, or unclear to proceed safely.",
  category: "META",
  paramsSchema: requestHumanReviewParams,
  resultSchema: z.object({
    escalated: z.boolean(),
    escalationId: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<RequestHumanReviewResult>> {
    const escalationId = crypto.randomUUID();

    await ctx.logEvent({
      kind: "escalation",
      summary: `Human review requested: ${params.reason}`,
      result: {
        escalationId,
        ...params,
      },
    });

    // Mark job as waiting for human
    const { markJobStatus } = await import("@ai-coding-team/db");
    await markJobStatus(ctx.jobId, "waiting_human");

    return {
      success: true,
      data: {
        escalated: true,
        escalationId,
      },
      eventId: escalationId,
    };
  },
};

// =============================================================================
// Export all planner tools
// =============================================================================

export const plannerTools = [
  // READ_ONLY tools
  searchCodeTool,
  readFileTool,
  listFilesTool,
  getRepoStateTool,
  // META tools
  recordAnalysisTool,
  createPlanTool,
  requestHumanReviewTool,
];

