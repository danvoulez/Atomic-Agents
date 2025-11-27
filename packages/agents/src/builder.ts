/**
 * BuilderAgent - Executes implementation plans
 *
 * Role:
 * - Receive plans from Planner with step-by-step instructions
 * - Execute each step using the appropriate tools
 * - Generate unified diff patches via LLM
 * - Handle errors and retry when tests fail (max 3 attempts)
 * - Create commits only when tests pass
 * - Track budget (steps, tokens, time)
 */

import { BaseAgent, AgentJob, AgentResult } from "./base";
import { LLMClient } from "./llm";
import { Tool } from "@ai-coding-team/types";
import { insertEvaluation } from "@ai-coding-team/db";

// ============================================================================
// TYPES
// ============================================================================

export interface PlanStep {
  action: string;
  target: string;
  reasoning: string;
}

export interface BuilderInput {
  jobId: string;
  plan: {
    steps: PlanStep[];
    constraints: {
      maxFiles: number;
      maxLines: number;
    };
  };
  repoPath: string;
  context: {
    files: string[];
    tests: string[];
  };
}

export interface FileChange {
  path: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface BuilderResult {
  success: boolean;
  changes: {
    files: FileChange[];
    commits: string[];
    diff?: string;
  };
  testsRun: {
    total: number;
    passed: number;
    failed: number;
  };
  budgetUsed: {
    steps: number;
    tokens: number;
    timeMs: number;
  };
  errors?: string[];
}

interface StepResult {
  success: boolean;
  filesChanged: FileChange[];
  testsPassed: boolean;
  commitHash?: string;
  error?: string;
}

// ============================================================================
// BUILDER AGENT
// ============================================================================

export class BuilderAgent extends BaseAgent {
  private static MAX_RETRIES = 3;

  getAgentType(): string {
    return "builder";
  }

  getAgentIdentity(): string {
    return `
You are the BUILDER agent. You execute implementation plans created by the Planner.

YOUR ROLE:
- Read the PLAN span to understand what to do
- Execute each step using the appropriate tools
- Generate unified diff patches for code changes
- Handle errors and retry when appropriate (max ${BuilderAgent.MAX_RETRIES} retries)
- Create commits only when tests pass
`.trim();
  }

  getAgentSpecificRules(): string {
    return `
BUILDER WORKFLOW:
1. Create a feature branch first
2. For each step in the plan:
   a. Read the relevant source files to understand current code
   b. Generate a unified diff patch for the change
   c. Apply the patch using apply_patch tool
   d. Run tests to verify changes work
   e. If tests fail: analyze error, generate fix patch, retry (max 3 times)
   f. If tests pass: commit with descriptive message
3. Record the final result

GENERATING PATCHES:
When generating patches, output ONLY valid unified diff format:
- Start with: --- a/path/to/file.ts
- Then: +++ b/path/to/file.ts
- Include @@ line numbers @@
- Lines starting with - are removed
- Lines starting with + are added
- Lines starting with space are context (unchanged)

Example patch:
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,7 +10,10 @@
 export function login(email: string) {
-  return fetch('/api/login', { body: email });
+  if (!email) {
+    throw new Error('Email required');
+  }
+  return fetch('/api/login', { body: { email } });
 }

CONSTRAINTS (MECHANIC MODE):
- Max 5 files changed
- Max 200 lines changed total
- MUST pass all tests before committing

CONSTRAINTS (GENIUS MODE):
- Max 20 files changed
- Max 1000 lines changed total
- MUST pass all tests before committing

ERROR HANDLING:
- If patch fails to apply: re-read file, generate new patch with fresh content
- If tests fail: analyze the error output, generate a fix patch
- If still failing after ${BuilderAgent.MAX_RETRIES} retries: call request_human_review
- Track all errors in the result

USING TOOLS:
- Use read_file to get current file content before generating patches
- Use apply_patch (not edit_file) for code modifications
- Use run_tests after every patch
- Use commit_changes only when tests pass
- Use request_human_review if stuck after retries
`.trim();
  }

  buildJobPrompt(job: AgentJob): string {
    return `
BUILD JOB
=========

Goal: ${job.goal}
Mode: ${job.mode}
Repository: ${job.repoPath}

Execute the plan to accomplish this goal.

WORKFLOW:
1. Create a feature branch with create_branch
2. For each step in the plan:
   - Read relevant files with read_file
   - Apply changes with apply_patch (generate unified diff)
   - Run tests with run_tests
   - If tests pass, commit with commit_changes
   - If tests fail, analyze and retry (max ${BuilderAgent.MAX_RETRIES} times)
3. Record the result with create_result

IMPORTANT:
- Always read files before generating patches (get fresh content)
- Generate valid unified diff format for apply_patch
- Run tests after every change
- Only commit when tests pass
- If stuck after ${BuilderAgent.MAX_RETRIES} retries, use request_human_review
`.trim();
  }

  async processCompletion(content: string): Promise<unknown> {
    return {
      type: "build_complete",
      message: content || "Build completed",
    };
  }

  // =========================================================================
  // BUILDER-SPECIFIC METHODS
  // =========================================================================

  /**
   * Execute the full build process with a plan
   * This is used by the worker to run a complete build
   */
  async executePlan(input: BuilderInput): Promise<BuilderResult> {
    const startTime = Date.now();
    const result: BuilderResult = {
      success: false,
      changes: {
        files: [],
        commits: [],
      },
      testsRun: {
        total: 0,
        passed: 0,
        failed: 0,
      },
      budgetUsed: {
        steps: 0,
        tokens: 0,
        timeMs: 0,
      },
      errors: [],
    };

    const { plan, repoPath, context } = input;

    try {
      // Execute each step in the plan
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        console.log(`[Builder] Executing step ${i + 1}/${plan.steps.length}: ${step.action}`);

        const stepResult = await this.executeStep(step, {
          repoPath,
          context,
          constraints: plan.constraints,
          stepIndex: i,
        });

        result.budgetUsed.steps++;

        if (stepResult.success) {
          result.changes.files.push(...stepResult.filesChanged);
          if (stepResult.commitHash) {
            result.changes.commits.push(stepResult.commitHash);
          }
          result.testsRun.passed++;
        } else {
          result.testsRun.failed++;
          if (stepResult.error) {
            result.errors!.push(`Step ${i + 1}: ${stepResult.error}`);
          }
        }

        result.testsRun.total++;
      }

      // Success if all steps completed without fatal errors
      result.success = result.testsRun.failed === 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors!.push(`Fatal error: ${errorMessage}`);
    }

    result.budgetUsed.timeMs = Date.now() - startTime;
    return result;
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStep(
    step: PlanStep,
    ctx: {
      repoPath: string;
      context: { files: string[]; tests: string[] };
      constraints: { maxFiles: number; maxLines: number };
      stepIndex: number;
    }
  ): Promise<StepResult> {
    // This method would be called by the LLM loop or directly
    // For now, we return a placeholder - the actual execution
    // happens through the BaseAgent.run() loop with tool calls
    return {
      success: true,
      filesChanged: [],
      testsPassed: true,
    };
  }

  /**
   * Generate the system prompt for patch generation
   */
  static getPatchGenerationPrompt(constraints: { maxFiles: number; maxLines: number }): string {
    return `You are an expert code editor. Generate ONLY a unified diff patch to implement the requested change.

RULES:
1. Output MUST be valid unified diff format (diff -u style)
2. Start with: --- a/path/to/file.ts
3. Then: +++ b/path/to/file.ts
4. Include @@ line numbers @@
5. Lines starting with - are removed
6. Lines starting with + are added
7. Lines starting with space are context
8. Maximum ${constraints.maxFiles} files
9. Maximum ${constraints.maxLines} lines changed

Example:
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,7 +10,10 @@
 export function login(email: string) {
-  return fetch('/api/login', { body: email });
+  if (!email) {
+    throw new Error('Email required');
+  }
+  return fetch('/api/login', { body: { email } });
 }

DO NOT include explanations. ONLY output the patch.`;
  }

  /**
   * Generate the user prompt for patch generation
   */
  static getPatchUserPrompt(step: PlanStep, fileContent: string): string {
    return `${step.action}

Target: ${step.target}
Reasoning: ${step.reasoning}

Current file content:
\`\`\`
${fileContent}
\`\`\`

Generate patch:`;
  }

  /**
   * Generate the system prompt for fixing failing tests
   */
  static getFixPrompt(error: string, originalPatch: string): string {
    return `The previous patch caused test failures. Analyze the error and generate a fix patch.

Original patch:
\`\`\`diff
${originalPatch}
\`\`\`

Test error:
\`\`\`
${error}
\`\`\`

Generate a new unified diff patch that fixes the issue. Output ONLY the patch, no explanations.`;
  }
}
