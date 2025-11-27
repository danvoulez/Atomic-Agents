/**
 * Builder-specific tools for code modification and testing
 *
 * The Builder uses these tools to:
 * - Create feature branches
 * - Apply patches (the ONLY way to modify code)
 * - Run tests and linting
 * - Create commits (only when tests pass)
 * - Document results
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { listEvents, markJobStatus } from "@ai-coding-team/db";
import { z } from "zod";
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Import read tools from planner (Builder needs them for verification)
import { readFileTool, searchCodeTool, getRepoStateTool, requestHumanReviewTool } from "./planner-tools";

// =============================================================================
// create_branch - Create a feature branch
// =============================================================================

const createBranchParams = z.object({
  name: z.string().describe("Branch name (will be prefixed with job ID)"),
  baseBranch: z.string().optional().describe("Branch to base off of (default: main)"),
});

type CreateBranchParams = z.infer<typeof createBranchParams>;

interface CreateBranchResult {
  branchName: string;
  basedOn: string;
  created: boolean;
}

export const createBranchTool: Tool<CreateBranchParams, CreateBranchResult> = {
  name: "create_branch",
  description:
    "Create a new branch for this work. ALWAYS call this first before making any code changes.",
  category: "MUTATING",
  paramsSchema: createBranchParams,
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

      // Ensure we're on the base branch first
      execSync(`git checkout ${baseBranch}`, execOpts);
      execSync(`git pull --ff-only origin ${baseBranch} || true`, execOpts);

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

// =============================================================================
// apply_patch - Apply a unified diff (THE ONLY way to modify code)
// =============================================================================

const applyPatchParams = z.object({
  patch: z.string().describe("Unified diff format patch"),
  description: z.string().describe("Human-readable description of the change"),
  expectedFilesChanged: z.number().optional().describe("Expected number of files changed"),
});

type ApplyPatchParams = z.infer<typeof applyPatchParams>;

interface PatchAnalysis {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  files: string[];
}

interface ApplyPatchResult {
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
  // Must have at least one diff header
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
    // Match file headers
    if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
      const filePath = line.replace("+++ b/", "").replace("+++ ", "").trim();
      if (filePath !== "/dev/null") {
        files.add(filePath);
      }
    }
    // Count added/removed lines (skip headers)
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
  paramsSchema: applyPatchParams,
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
        // Try to provide helpful error message
        let errorMsg = gitError.message;
        if (gitError.stderr) {
          errorMsg = gitError.stderr;
        }

        // Check for common issues
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
        // Clean up temp file
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

// =============================================================================
// edit_file - Simple search and replace (easier than patches for LLMs)
// =============================================================================

const editFileParams = z.object({
  path: z.string().describe("Path to the file to edit, relative to repo root"),
  old_string: z.string().describe("The exact string to find and replace. Must be unique in the file."),
  new_string: z.string().describe("The string to replace it with"),
  description: z.string().describe("Brief description of the change"),
});

type EditFileParams = z.infer<typeof editFileParams>;

interface EditFileResult {
  success: boolean;
  path: string;
  linesChanged: number;
}

export const editFileTool: Tool<EditFileParams, EditFileResult> = {
  name: "edit_file",
  description:
    "Edit a file by replacing a specific string with another. The old_string must be unique in the file. " +
    "Include enough context (surrounding lines) to make old_string unique. Use this for simple edits.",
  category: "MUTATING",
  paramsSchema: editFileParams,
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
            message: `The string appears ${occurrences} times in ${params.path}. Include more surrounding lines to make it unique.`,
            recoverable: true,
          },
          eventId: crypto.randomUUID(),
        };
      }

      // Perform replacement
      const newContent = content.replace(params.old_string, params.new_string);

      // Write file
      fs.writeFileSync(filePath, newContent);

      // Stage the change
      try {
        execSync(`git add "${params.path}"`, { cwd: ctx.repoPath, encoding: "utf-8" });
      } catch {
        // Ignore git errors
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

// =============================================================================
// run_tests - Run the test suite
// =============================================================================

const runTestsParams = z.object({
  scope: z
    .enum(["all", "affected", "specific"])
    .optional()
    .describe("Which tests to run (default: affected)"),
  pattern: z.string().optional().describe("Test file pattern for 'specific' scope"),
  timeout: z.number().optional().describe("Timeout in milliseconds (default: 60000)"),
});

type RunTestsParams = z.infer<typeof runTestsParams>;

interface TestResult {
  status: "pass" | "fail" | "error";
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: Array<{ name: string; message: string }>;
  output: string;
}

/**
 * Detect the test runner used in the project
 */
function detectTestRunner(repoPath: string): { command: string; runner: string } {
  // Check package.json for test script
  const pkgPath = path.join(repoPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const testScript = pkg.scripts?.test;
    
    if (testScript) {
      // Detect runner from test script
      if (testScript.includes("vitest")) {
        return { command: "npx vitest run", runner: "vitest" };
      }
      if (testScript.includes("jest")) {
        return { command: "npx jest", runner: "jest" };
      }
      if (testScript.includes("mocha")) {
        return { command: "npx mocha", runner: "mocha" };
      }
      // Use the test script directly
      return { command: "npm test", runner: "npm" };
    }

    // Check for test runner dependencies
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vitest) return { command: "npx vitest run", runner: "vitest" };
    if (deps.jest) return { command: "npx jest", runner: "jest" };
    if (deps.mocha) return { command: "npx mocha", runner: "mocha" };
  }

  // Check for Python pytest
  if (fs.existsSync(path.join(repoPath, "pytest.ini")) ||
      fs.existsSync(path.join(repoPath, "pyproject.toml"))) {
    return { command: "pytest", runner: "pytest" };
  }

  // Check for Cargo/Rust
  if (fs.existsSync(path.join(repoPath, "Cargo.toml"))) {
    return { command: "cargo test", runner: "cargo" };
  }

  // Default to npm test
  return { command: "npm test", runner: "npm" };
}

export const runTestsTool: Tool<RunTestsParams, TestResult> = {
  name: "run_tests",
  description:
    "Run the test suite. ALWAYS run tests after applying patches and before committing.",
  category: "MUTATING", // Creates test artifacts
  paramsSchema: runTestsParams,
  resultSchema: z.object({
    status: z.enum(["pass", "fail", "error"]),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    duration: z.number(),
    failures: z.array(z.object({ name: z.string(), message: z.string() })),
    output: z.string(),
  }),
  costHint: "expensive",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<TestResult>> {
    const startTime = Date.now();

    try {
      const { command, runner } = detectTestRunner(ctx.repoPath);

      // Build the test command
      let testCmd = command;
      if (params.scope === "specific" && params.pattern) {
        testCmd += ` ${params.pattern}`;
      }
      // For affected, most runners have built-in detection
      if (params.scope === "affected") {
        if (runner === "jest") testCmd += " --changedSince=HEAD~1";
        if (runner === "vitest") testCmd += " --changed";
      }

      // Run with timeout
      return new Promise((resolve) => {
        let output = "";
        let timedOut = false;

        const proc = spawn("sh", ["-c", testCmd], {
          cwd: ctx.repoPath,
          timeout: params.timeout,
          env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
        });

        proc.stdout?.on("data", (data) => {
          output += data.toString();
        });

        proc.stderr?.on("data", (data) => {
          output += data.toString();
        });

        const timeoutId = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, params.timeout);

        proc.on("close", (code) => {
          clearTimeout(timeoutId);
          const duration = Date.now() - startTime;

          if (timedOut) {
            resolve({
              success: true,
              data: {
                status: "error",
                passed: 0,
                failed: 0,
                skipped: 0,
                duration,
                failures: [{ name: "timeout", message: `Tests timed out after ${params.timeout}ms` }],
                output: output.slice(-5000), // Last 5KB
              },
              eventId: crypto.randomUUID(),
            });
            return;
          }

          // Parse test output for results
          const { passed, failed, skipped, failures } = parseTestOutput(output, runner);

          resolve({
            success: true,
            data: {
              status: code === 0 ? "pass" : "fail",
              passed,
              failed,
              skipped,
              duration,
              failures,
              output: output.slice(-5000),
            },
            eventId: crypto.randomUUID(),
          });
        });

        proc.on("error", (err) => {
          clearTimeout(timeoutId);
          resolve({
            success: false,
            error: {
              code: "test_error",
              message: err.message,
              recoverable: true,
            },
            eventId: crypto.randomUUID(),
          });
        });
      });
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "test_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

/**
 * Parse test output to extract pass/fail counts
 */
function parseTestOutput(
  output: string,
  runner: string
): { passed: number; failed: number; skipped: number; failures: Array<{ name: string; message: string }> } {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: Array<{ name: string; message: string }> = [];

  // Common patterns
  if (runner === "jest" || runner === "vitest") {
    // Jest/Vitest: "Tests: 5 passed, 2 failed, 7 total"
    const match = output.match(/Tests:\s+(\d+)\s+passed.*?(\d+)\s+failed/i);
    if (match) {
      passed = parseInt(match[1], 10);
      failed = parseInt(match[2], 10);
    }
    // Extract failure messages
    const failMatches = output.matchAll(/FAIL\s+(.+?)\n([\s\S]*?)(?=\n\s*FAIL|\n\s*PASS|$)/g);
    for (const fm of failMatches) {
      failures.push({ name: fm[1].trim(), message: fm[2].slice(0, 500) });
    }
  } else if (runner === "pytest") {
    // Pytest: "5 passed, 2 failed"
    const match = output.match(/(\d+)\s+passed.*?(\d+)\s+failed/i);
    if (match) {
      passed = parseInt(match[1], 10);
      failed = parseInt(match[2], 10);
    }
  } else if (runner === "cargo") {
    // Cargo: "test result: ok. 5 passed; 0 failed"
    const match = output.match(/(\d+)\s+passed;\s+(\d+)\s+failed/);
    if (match) {
      passed = parseInt(match[1], 10);
      failed = parseInt(match[2], 10);
    }
  } else {
    // Generic: look for common patterns
    const passMatch = output.match(/(\d+)\s+(?:passing|passed|✓)/i);
    const failMatch = output.match(/(\d+)\s+(?:failing|failed|✗)/i);
    if (passMatch) passed = parseInt(passMatch[1], 10);
    if (failMatch) failed = parseInt(failMatch[1], 10);
  }

  return { passed, failed, skipped, failures: failures.slice(0, 5) };
}

// =============================================================================
// run_lint - Run linter
// =============================================================================

const runLintParams = z.object({
  fix: z.boolean().optional().describe("Attempt to auto-fix issues (default: false)"),
  paths: z.array(z.string()).optional().describe("Specific paths to lint"),
});

type RunLintParams = z.infer<typeof runLintParams>;

interface LintResult {
  status: "pass" | "fail";
  errorCount: number;
  warningCount: number;
  issues: Array<{ file: string; line: number; message: string; severity: string }>;
  output: string;
}

export const runLintTool: Tool<RunLintParams, LintResult> = {
  name: "run_lint",
  description: "Run the linter. ALWAYS run lint before committing to ensure code quality.",
  category: "READ_ONLY", // Doesn't modify files unless fix=true
  paramsSchema: runLintParams,
  resultSchema: z.object({
    status: z.enum(["pass", "fail"]),
    errorCount: z.number(),
    warningCount: z.number(),
    issues: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        message: z.string(),
        severity: z.string(),
      })
    ),
    output: z.string(),
  }),
  costHint: "moderate",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<LintResult>> {
    try {
      const execOpts = { cwd: ctx.repoPath, encoding: "utf-8" as const };

      // Detect linter
      let lintCmd = "";
      const pkgPath = path.join(ctx.repoPath, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.scripts?.lint) {
          lintCmd = `npm run lint${params.fix ? " -- --fix" : ""}`;
        } else {
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.eslint) {
            lintCmd = `npx eslint . ${params.fix ? "--fix" : ""} --format json`;
          } else if (deps.biome) {
            lintCmd = `npx biome lint ${params.fix ? "--apply" : ""}`;
          }
        }
      }

      // Python
      if (!lintCmd && fs.existsSync(path.join(ctx.repoPath, "pyproject.toml"))) {
        lintCmd = `ruff check . ${params.fix ? "--fix" : ""} --output-format json`;
      }

      // Rust
      if (!lintCmd && fs.existsSync(path.join(ctx.repoPath, "Cargo.toml"))) {
        lintCmd = "cargo clippy --message-format=json";
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
        output = execSync(lintCmd, { ...execOpts, maxBuffer: 10 * 1024 * 1024 });
      } catch (e: any) {
        output = e.stdout || e.stderr || e.message;
        exitCode = e.status || 1;
      }

      // Parse lint output
      const { errorCount, warningCount, issues } = parseLintOutput(output);

      return {
        success: true,
        data: {
          status: exitCode === 0 && errorCount === 0 ? "pass" : "fail",
          errorCount,
          warningCount,
          issues: issues.slice(0, 20),
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

function parseLintOutput(output: string): {
  errorCount: number;
  warningCount: number;
  issues: Array<{ file: string; line: number; message: string; severity: string }>;
} {
  let errorCount = 0;
  let warningCount = 0;
  const issues: Array<{ file: string; line: number; message: string; severity: string }> = [];

  // Try parsing as JSON (ESLint, Ruff)
  try {
    const json = JSON.parse(output);
    if (Array.isArray(json)) {
      for (const file of json) {
        for (const msg of file.messages || []) {
          if (msg.severity === 2) errorCount++;
          else warningCount++;
          issues.push({
            file: file.filePath || file.filename || "unknown",
            line: msg.line || 0,
            message: msg.message || "",
            severity: msg.severity === 2 ? "error" : "warning",
          });
        }
      }
    }
  } catch {
    // Parse text output
    const errorMatch = output.match(/(\d+)\s+error/i);
    const warnMatch = output.match(/(\d+)\s+warning/i);
    if (errorMatch) errorCount = parseInt(errorMatch[1], 10);
    if (warnMatch) warningCount = parseInt(warnMatch[1], 10);
  }

  return { errorCount, warningCount, issues };
}

// =============================================================================
// commit_changes - Create a commit (requires tests to pass)
// =============================================================================

const commitChangesParams = z.object({
  message: z.string().describe("Commit message (follow conventional commits format)"),
});

type CommitChangesParams = z.infer<typeof commitChangesParams>;

interface CommitResult {
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
  paramsSchema: commitChangesParams,
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
      // Verify tests have passed recently
      const events = await listEvents(ctx.jobId);
      const testEvents = events.filter((e) => e.tool_name === "run_tests");
      const lastTestEvent = testEvents[testEvents.length - 1];

      if (!lastTestEvent) {
        return {
          success: false,
          error: {
            code: "tests_not_run",
            message: "Cannot commit: No test run found. Run run_tests first.",
            recoverable: true,
          },
          eventId: crypto.randomUUID(),
        };
      }

      const testResult = lastTestEvent.result as { status?: string } | null;
      if (!testResult || testResult.status !== "pass") {
        return {
          success: false,
          error: {
            code: "tests_not_passed",
            message: "Cannot commit: Tests have not passed. Fix failing tests first.",
            recoverable: true,
          },
          eventId: crypto.randomUUID(),
        };
      }

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

      // Create the commit
      const filesCount = status.split("\n").filter(Boolean).length;
      execSync(`git commit -m "${params.message.replace(/"/g, '\\"')}"`, execOpts);

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

// =============================================================================
// create_result - Document the execution result
// =============================================================================

const createResultParams = z.object({
  status: z.enum(["complete", "partial", "failed"]).describe("Overall status"),
  changes: z.object({
    branch: z.string(),
    files: z.array(
      z.object({
        path: z.string(),
        linesAdded: z.number(),
        linesRemoved: z.number(),
      })
    ),
    commits: z.array(
      z.object({
        hash: z.string(),
        message: z.string(),
      })
    ),
  }),
  tests: z.object({
    status: z.enum(["pass", "fail", "skipped"]),
    passed: z.number(),
    failed: z.number(),
  }),
  qualityCheck: z.object({
    verdict: z.enum(["OK", "WARN", "BLOCK"]),
    checks: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["OK", "WARN", "FAIL"]),
        message: z.string().optional(),
      })
    ),
  }),
  summary: z.string().describe("Human-readable summary of what was done"),
});

type CreateResultParams = z.infer<typeof createResultParams>;

interface CreateResultResult {
  recorded: boolean;
  resultId: string;
}

export const createResultTool: Tool<CreateResultParams, CreateResultResult> = {
  name: "create_result",
  description:
    "Create a RESULT span documenting the execution. Use this to conclude a build job.",
  category: "META",
  paramsSchema: createResultParams,
  resultSchema: z.object({
    recorded: z.boolean(),
    resultId: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<CreateResultResult>> {
    const resultId = crypto.randomUUID();

    await ctx.logEvent({
      kind: "decision",
      summary: params.summary,
      result: {
        resultId,
        ...params,
      },
    });

    // Mark job status based on result
    if (params.status === "complete" && params.tests.status === "pass") {
      await markJobStatus(ctx.jobId, "succeeded");
    } else if (params.status === "failed") {
      await markJobStatus(ctx.jobId, "failed");
    }

    return {
      success: true,
      data: {
        recorded: true,
        resultId,
      },
      eventId: resultId,
    };
  },
};

// =============================================================================
// Export all builder tools
// =============================================================================

export const builderTools = [
  // READ_ONLY (for verification)
  readFileTool,
  searchCodeTool,
  getRepoStateTool,
  // MUTATING
  createBranchTool,
  editFileTool,      // Preferred for simple edits
  applyPatchTool,    // For complex multi-location edits
  runTestsTool,
  runLintTool,
  commitChangesTool,
  // META
  createResultTool,
  requestHumanReviewTool,
];

