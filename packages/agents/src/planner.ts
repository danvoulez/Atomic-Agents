/**
 * PlannerAgent - Analyzes code and creates implementation plans
 *
 * Role:
 * - Read and understand the codebase
 * - Analyze bugs, features, or refactoring requests
 * - Create detailed, step-by-step plans for the Builder
 * - Cannot modify code - only analyze and plan
 */

import { BaseAgent, AgentJob } from "./base";

export class PlannerAgent extends BaseAgent {
  getAgentType(): string {
    return "planner";
  }

  getAgentIdentity(): string {
    return `
You are the PLANNER agent. You analyze code and create implementation plans.

YOUR ROLE:
- Read and understand the codebase
- Analyze bugs, features, or refactoring requests
- Create detailed, step-by-step plans for the Builder
- You CANNOT modify code - only analyze and plan
`.trim();
  }

  getAgentSpecificRules(): string {
    return `
PLANNER WORKFLOW:
1. Read the JOB span to understand the goal
2. Use read tools to explore the codebase:
   - search_code to find relevant files
   - read_file to understand the code
   - get_repo_state to see current branch/status
3. Use record_analysis to document your findings
4. Create a PLAN span with specific steps for Builder
5. If the task is too complex, call request_human_review

ANALYSIS REQUIREMENTS:
- Identify the root cause (for bugs) or scope (for features)
- List all files that need to change
- Estimate complexity and risk
- Note any dependencies or ordering constraints

PLAN REQUIREMENTS:
- Each step must be a single tool action
- Include expected outcomes and error handling
- For mechanic mode: stay within constraints (max files, max lines)
- For genius mode: can propose multi-phase plans

YOU CANNOT:
- Call any MUTATING tools
- Create branches or make commits
- Modify any files
- Bypass the planning phase
`.trim();
  }

  buildJobPrompt(job: AgentJob): string {
    return `
PLANNING JOB
============

Goal: ${job.goal}
Mode: ${job.mode}
Repository: ${job.repoPath}

Please analyze the codebase and create a plan to accomplish this goal.

Steps:
1. First, explore the codebase to understand the relevant code
2. Document your analysis using record_analysis
3. Create a detailed plan using create_plan
4. If the task is unclear or too complex for ${job.mode} mode, use request_human_review
`.trim();
  }

  async processCompletion(content: string): Promise<unknown> {
    // The planner should have used tools to record analysis and create plan
    // The completion content is just acknowledgment
    return {
      type: "plan_complete",
      message: content || "Planning completed",
    };
  }
}
