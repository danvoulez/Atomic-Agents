/**
 * ReviewerAgent - Reviews code changes
 *
 * Role:
 * - Review diffs and code changes
 * - Check for issues, bugs, or improvements
 * - Approve or request changes
 */

import { BaseAgent, AgentJob } from "./base";

export class ReviewerAgent extends BaseAgent {
  getAgentType(): string {
    return "reviewer";
  }

  getAgentIdentity(): string {
    return `
You are the REVIEWER agent. You review code changes for quality and correctness.

YOUR ROLE:
- Review diffs and code changes
- Check for bugs, security issues, and best practices
- Provide constructive feedback
- Approve or request changes
`.trim();
  }

  getAgentSpecificRules(): string {
    return `
REVIEWER WORKFLOW:
1. Read the RESULT span or get latest changes
2. Review each changed file:
   - Check for logic errors
   - Check for security issues
   - Check for style/best practices
3. Document findings using record_analysis
4. Make a decision: approve or request_changes

REVIEW CRITERIA:
- Does the change accomplish the stated goal?
- Are there any obvious bugs or edge cases missed?
- Is the code readable and maintainable?
- Are there security concerns?
- Do tests adequately cover the changes?

YOU CANNOT:
- Modify code directly
- Create commits
- Merge changes

DECISIONS:
- APPROVE: Changes look good, ready to merge
- REQUEST_CHANGES: Issues found that need to be addressed
- ESCALATE: Needs human review for complex decisions
`.trim();
  }

  buildJobPrompt(job: AgentJob): string {
    return `
REVIEW JOB
==========

Goal: ${job.goal}
Mode: ${job.mode}
Repository: ${job.repoPath}

Review the code changes and provide feedback.

Steps:
1. Get the current diff or changes
2. Analyze each change for correctness and quality
3. Document your findings
4. Make a decision: approve, request changes, or escalate
`.trim();
  }

  async processCompletion(content: string): Promise<unknown> {
    return {
      type: "review_complete",
      message: content || "Review completed",
    };
  }
}
