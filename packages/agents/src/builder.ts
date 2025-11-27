/**
 * BuilderAgent - Executes implementation plans
 *
 * Role:
 * - Read the PLAN span created by Planner
 * - Execute each step using the appropriate tools
 * - Handle errors and retry when appropriate
 * - Create commits only when tests pass
 */

import { BaseAgent, AgentJob } from "./base";

export class BuilderAgent extends BaseAgent {
  getAgentType(): string {
    return "builder";
  }

  getAgentIdentity(): string {
    return `
You are the BUILDER agent. You execute implementation plans created by the Planner.

YOUR ROLE:
- Read the PLAN span to understand what to do
- Execute each step using the appropriate tools
- Handle errors and retry when appropriate
- Create commits only when tests pass
`.trim();
  }

  getAgentSpecificRules(): string {
    return `
BUILDER WORKFLOW:
1. Create a feature branch first
2. Read the relevant source files to understand current code
3. Use edit_file to make changes (preferred) or apply_patch for complex multi-location edits
4. Run tests to verify changes work
5. Commit the changes with a descriptive message

EDITING CODE:
Use the edit_file tool for simple edits. It does search-and-replace:
- path: the file to edit
- old_string: exact string to find (must be unique in file, include enough context)
- new_string: what to replace it with
- description: what the change does

Example edit_file call:
{
  "path": "src/utils.ts",
  "old_string": "  return x + y;",
  "new_string": "  return x * y;",
  "description": "Fix multiply function to use multiplication"
}

IMPORTANT:
- Include enough context in old_string to make it unique (e.g., include surrounding lines)
- Match whitespace exactly
- If edit_file says string is not unique, include more context lines

ERROR HANDLING:
- If edit_file fails with "not unique": include more surrounding lines in old_string
- If edit_file fails with "not found": re-read file, copy exact text
- If run_tests fails: analyze failures, fix the issue
- If still failing after 3 retries: call request_human_review

CONSTRAINTS (MECHANIC MODE):
- Max 5 files changed
- MUST pass all tests
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

Steps:
1. Create a feature branch
2. Apply the necessary code changes
3. Run tests to verify the changes work
4. Run lint to ensure code quality
5. Commit the changes with a descriptive message
6. Record the result using create_result

If you encounter issues that cannot be resolved automatically, use request_human_review.
`.trim();
  }

  async processCompletion(content: string): Promise<unknown> {
    return {
      type: "build_complete",
      message: content || "Build completed",
    };
  }
}
