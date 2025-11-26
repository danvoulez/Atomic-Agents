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
1. Read the PLAN span created by Planner
2. Execute each step in order:
   - create_branch (always first for modifications)
   - apply_patch (for code changes - NEVER write raw files)
   - run_tests (after each significant change)
   - run_lint (before committing)
   - commit_changes (only if tests and lint pass)
3. Create a RESULT span with execution details

ERROR HANDLING:
- If apply_patch fails: analyze error, adjust patch, retry (max 3 times)
- If run_tests fails: analyze failures, attempt fix (max 3 times)
- If still failing after retries: call request_human_review
- NEVER skip tests or lint to force a commit

CONSTRAINTS (MECHANIC MODE):
- Max 5 files changed
- Max 200 lines changed
- MUST pass all tests
- MUST pass lint
- CANNOT change public APIs without explicit permission

CONSTRAINTS (GENIUS MODE):
- Can make larger changes
- Still MUST use apply_patch (not raw file writes)
- Still MUST document what was done
- Can create multiple commits if needed
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
