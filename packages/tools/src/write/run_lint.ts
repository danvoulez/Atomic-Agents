/**
 * run_lint - Run linter on the codebase
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const paramsSchema = z.object({
  fix: z.boolean().optional().describe("Attempt to auto-fix issues (default: false)"),
  paths: z.array(z.string()).optional().describe("Specific paths to lint"),
});

type RunLintParams = z.infer<typeof paramsSchema>;

export interface LintIssue {
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface LintResult {
  status: "pass" | "fail";
  errorCount: number;
  warningCount: number;
  issues: LintIssue[];
  output: string;
}

function parseLintOutput(output: string): {
  errorCount: number;
  warningCount: number;
  issues: LintIssue[];
} {
  let errorCount = 0;
  let warningCount = 0;
  const issues: LintIssue[] = [];

  // Try parsing as JSON (ESLint, Ruff)
  try {
    const json = JSON.parse(output);
    if (Array.isArray(json)) {
      for (const file of json) {
        for (const msg of file.messages || []) {
          const severity = msg.severity === 2 ? "error" : "warning";
          if (severity === "error") errorCount++;
          else warningCount++;
          issues.push({
            file: file.filePath || file.filename || "unknown",
            line: msg.line || 0,
            message: msg.message || "",
            severity,
          });
        }
      }
    }
    return { errorCount, warningCount, issues: issues.slice(0, 20) };
  } catch {
    // Parse text output
    const errorMatch = output.match(/(\d+)\s+error/i);
    const warnMatch = output.match(/(\d+)\s+warning/i);
    if (errorMatch) errorCount = parseInt(errorMatch[1], 10);
    if (warnMatch) warningCount = parseInt(warnMatch[1], 10);
    return { errorCount, warningCount, issues };
  }
}

export const runLintTool: Tool<RunLintParams, LintResult> = {
  name: "run_lint",
  description: "Run the linter. ALWAYS run lint before committing to ensure code quality.",
  category: "READ_ONLY",
  paramsSchema,
  resultSchema: z.object({
    status: z.enum(["pass", "fail"]),
    errorCount: z.number(),
    warningCount: z.number(),
    issues: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        message: z.string(),
        severity: z.enum(["error", "warning"]),
      })
    ),
    output: z.string(),
  }),
  costHint: "moderate",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<LintResult>> {
    try {
      const fix = params.fix ?? false;
      const execOpts = { cwd: ctx.repoPath, encoding: "utf-8" as const, maxBuffer: 10 * 1024 * 1024 };

      // Detect linter
      let lintCmd = "";
      const pkgPath = path.join(ctx.repoPath, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.scripts?.lint) {
          lintCmd = `npm run lint${fix ? " -- --fix" : ""}`;
        } else {
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.eslint) {
            lintCmd = `npx eslint . ${fix ? "--fix" : ""} --format json`;
          } else if (deps.biome || deps["@biomejs/biome"]) {
            lintCmd = `npx biome lint ${fix ? "--apply" : ""} .`;
          }
        }
      }

      // Python
      if (!lintCmd && (fs.existsSync(path.join(ctx.repoPath, "pyproject.toml")) ||
                       fs.existsSync(path.join(ctx.repoPath, "setup.py")))) {
        lintCmd = `ruff check . ${fix ? "--fix" : ""} --output-format json`;
      }

      // Rust
      if (!lintCmd && fs.existsSync(path.join(ctx.repoPath, "Cargo.toml"))) {
        lintCmd = "cargo clippy --message-format=json 2>&1";
      }

      if (!lintCmd) {
        return {
          success: true,
          data: {
            status: "pass",
            errorCount: 0,
            warningCount: 0,
            issues: [],
            output: "No linter detected",
          },
          eventId: crypto.randomUUID(),
        };
      }

      let output: string;
      let exitCode = 0;
      try {
        output = execSync(lintCmd, execOpts);
      } catch (e: any) {
        output = e.stdout || e.stderr || e.message;
        exitCode = e.status || 1;
      }

      const { errorCount, warningCount, issues } = parseLintOutput(output);

      return {
        success: true,
        data: {
          status: exitCode === 0 && errorCount === 0 ? "pass" : "fail",
          errorCount,
          warningCount,
          issues,
          output: output.slice(-5000),
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "lint_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};
