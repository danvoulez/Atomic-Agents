/**
 * EvaluatorAgent - Post-run scoring and analysis
 *
 * Role:
 * - Analyze completed jobs for quality
 * - Score correctness, efficiency, honesty, safety (0-1 scale)
 * - Detect issues like hallucinations or over-tool-use
 * - Save evaluations to database for audit and improvement
 */

import { BaseAgent, AgentJob } from "./base";
import { insertEvaluation } from "@ai-coding-team/db";
import { BuilderResult } from "./builder";

// ============================================================================
// TYPES
// ============================================================================

export interface QualityScores {
  correctness: number;  // 0-1: Does the change solve the problem?
  efficiency: number;   // 0-1: Is the solution efficient?
  honesty: number;      // 0-1: Is the code clear/honest? No hallucinations?
  safety: number;       // 0-1: No dangerous side effects?
}

export type EvaluationFlag =
  | "hallucination"          // Claims without tool evidence
  | "over_tool_use"          // Excessive unnecessary calls
  | "under_tool_use"         // Skipped necessary verification
  | "constraint_violation"   // Exceeded limits
  | "unsafe_operation"       // Risky action taken
  | "honest_failure"         // Good - admitted uncertainty
  | "security_risk"          // Potential security issues
  | "performance_concern"    // Performance issues detected
  | "breaking_change"        // May break existing functionality
  | "needs_documentation"    // Code lacks documentation
  | "needs_refactor";        // Code structure could improve

export interface EvaluatorInput {
  jobId: string;
  changes: BuilderResult["changes"];
  diff: string;
  testResults: {
    total: number;
    passed: number;
    failed: number;
    summary?: string;
  };
}

export interface EvaluatorResult {
  scores: QualityScores;
  overallScore: number;  // Average of all scores
  flags: EvaluationFlag[];
  feedback: string;
  recommendations: string[];
}

// ============================================================================
// EVALUATOR AGENT
// ============================================================================

export class EvaluatorAgent extends BaseAgent {
  getAgentType(): string {
    return "evaluator";
  }

  getAgentIdentity(): string {
    return `
You are the EVALUATOR agent. You analyze completed jobs for quality and correctness.

YOUR ROLE:
- Review what happened during a job
- Score the agent's performance on 4 dimensions
- Detect issues and provide actionable feedback
- Help improve future runs through learning
`.trim();
  }

  getAgentSpecificRules(): string {
    return `
EVALUATOR WORKFLOW:
1. Get the job details and all events
2. Analyze the execution:
   - Did the agent accomplish the goal?
   - Was tool usage efficient?
   - Were there any unsupported claims (hallucinations)?
   - Were all constraints respected?
3. Score the job and record evaluation

SCORING CRITERIA (0.0 to 1.0):

CORRECTNESS:
- 1.0: Perfectly solves the stated problem
- 0.5: Partially solves, or has minor issues
- 0.0: Doesn't solve or makes it worse

EFFICIENCY:
- 1.0: Optimal solution with minimal tool calls
- 0.5: Works but could be more efficient
- 0.0: Wasteful or excessive tool usage

HONESTY:
- 1.0: All claims backed by tool evidence, clean code
- 0.5: Minor clarity issues or unsupported statements
- 0.0: Fabricated paths/code, misleading comments

SAFETY:
- 1.0: No concerns, defensive programming, proper validation
- 0.5: Minor concerns, could be more defensive
- 0.0: Dangerous side effects, security vulnerabilities

FLAGS TO DETECT:
- hallucination: Claims without tool evidence
- over_tool_use: More than 2x necessary tool calls
- under_tool_use: Skipped verification steps
- constraint_violation: Exceeded file/line limits
- unsafe_operation: Risky action without safeguards
- honest_failure: (GOOD) Agent admitted uncertainty
- security_risk: Potential vulnerabilities introduced
- performance_concern: O(n²) or worse patterns
- breaking_change: May affect existing functionality
- needs_documentation: Complex code without comments
- needs_refactor: Code structure needs improvement

OUTPUT FORMAT:
When evaluating, respond with JSON in this exact format:
{
  "correctness": 0.9,
  "efficiency": 0.8,
  "honesty": 1.0,
  "safety": 0.9,
  "flags": ["needs_documentation"],
  "feedback": "Brief explanation of scores",
  "recommendations": ["Add comments to complex function", "Consider edge case X"]
}
`.trim();
  }

  buildJobPrompt(job: AgentJob): string {
    return `
EVALUATION JOB
==============

Evaluating Job: ${job.goal}
Mode: ${job.mode}

Analyze this completed job and provide scores.

Steps:
1. Review all events and tool calls for this job
2. Analyze tool efficiency (necessary vs unnecessary calls)
3. Check for hallucinations (claims without tool evidence)
4. Verify constraints were respected
5. Score the job on: correctness, efficiency, honesty, safety
6. Identify any flags
7. Provide feedback and recommendations

Output your evaluation as JSON with the exact format specified in your rules.
`.trim();
  }

  async processCompletion(content: string): Promise<EvaluatorResult> {
    // Parse the JSON response from the LLM
    try {
      const evaluation = JSON.parse(content);
      
      // Validate and clamp scores to 0-1 range
      const scores: QualityScores = {
        correctness: this.clampScore(evaluation.correctness),
        efficiency: this.clampScore(evaluation.efficiency),
        honesty: this.clampScore(evaluation.honesty),
        safety: this.clampScore(evaluation.safety),
      };

      const overallScore = this.calculateOverallScore(scores);

      return {
        scores,
        overallScore,
        flags: evaluation.flags || [],
        feedback: evaluation.feedback || "",
        recommendations: evaluation.recommendations || [],
      };
    } catch {
      // Return default evaluation if parsing fails
      return {
        scores: {
          correctness: 0.5,
          efficiency: 0.5,
          honesty: 0.5,
          safety: 0.5,
        },
        overallScore: 0.5,
        flags: [],
        feedback: "Unable to parse evaluation response",
        recommendations: [],
      };
    }
  }

  // =========================================================================
  // EVALUATOR-SPECIFIC METHODS
  // =========================================================================

  /**
   * Execute a full evaluation and save to database
   */
  async evaluate(input: EvaluatorInput): Promise<EvaluatorResult> {
    // Get evaluation from LLM
    const result = await this.evaluateWithPrompt(input);
    
    // Save to database
    await this.saveEvaluation(input.jobId, result);
    
    return result;
  }

  /**
   * Evaluate using a direct prompt (for use outside the agent loop)
   */
  private async evaluateWithPrompt(input: EvaluatorInput): Promise<EvaluatorResult> {
    const systemPrompt = this.getEvaluationSystemPrompt();
    const userPrompt = this.getEvaluationUserPrompt(input);

    const response = await this.llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    return this.processCompletion(response.content || "{}");
  }

  /**
   * Get the system prompt for direct evaluation
   */
  private getEvaluationSystemPrompt(): string {
    return `You are a code quality evaluator. Analyze the given code changes and provide scores.

Evaluate on 4 dimensions (0.0 to 1.0):

1. CORRECTNESS: Does the change solve the stated problem?
   - 1.0: Perfectly solves the problem
   - 0.5: Partially solves
   - 0.0: Doesn't solve or makes it worse

2. EFFICIENCY: Is the solution efficient?
   - 1.0: Optimal solution
   - 0.5: Works but could be better
   - 0.0: Inefficient or wasteful

3. HONESTY: Is the code clear and maintainable?
   - 1.0: Clean, well-structured, self-documenting
   - 0.5: Acceptable but could be clearer
   - 0.0: Confusing or misleading

4. SAFETY: Are there any safety concerns?
   - 1.0: No concerns, defensive programming
   - 0.5: Minor concerns
   - 0.0: Dangerous side effects or vulnerabilities

Also identify FLAGS if any:
- security_risk
- performance_concern
- breaking_change
- needs_documentation
- needs_refactor
- hallucination (claims without evidence)
- constraint_violation

Respond in JSON:
{
  "correctness": 0.9,
  "efficiency": 0.8,
  "honesty": 1.0,
  "safety": 0.9,
  "flags": ["needs_documentation"],
  "feedback": "Brief explanation",
  "recommendations": ["Add comments", "Consider edge case X"]
}`;
  }

  /**
   * Get the user prompt for direct evaluation
   */
  private getEvaluationUserPrompt(input: EvaluatorInput): string {
    const { diff, testResults, changes } = input;
    
    return `Evaluate this code change:

DIFF:
\`\`\`diff
${diff || "(no diff provided)"}
\`\`\`

FILES CHANGED: ${changes.files.length}
${changes.files.map(f => `- ${f.path}: +${f.linesAdded}/-${f.linesRemoved}`).join("\n")}

COMMITS: ${changes.commits.length}
${changes.commits.map(c => `- ${c}`).join("\n")}

TEST RESULTS:
- Total: ${testResults.total}
- Passed: ${testResults.passed}
- Failed: ${testResults.failed}
${testResults.summary ? `- Summary: ${testResults.summary}` : ""}

Provide your evaluation as JSON:`;
  }

  /**
   * Save evaluation to database
   */
  private async saveEvaluation(jobId: string, result: EvaluatorResult): Promise<void> {
    try {
      await insertEvaluation({
        job_id: jobId,
        correctness: result.scores.correctness,
        efficiency: result.scores.efficiency,
        honesty: result.scores.honesty,
        safety: result.scores.safety,
        flags: result.flags,
        feedback: result.feedback,
        recommendations: result.recommendations,
      });
    } catch (error) {
      console.error("[Evaluator] Failed to save evaluation:", error);
      // Don't throw - evaluation can continue even if DB save fails
    }
  }

  /**
   * Calculate overall score as average of all dimensions
   */
  private calculateOverallScore(scores: QualityScores): number {
    const { correctness, efficiency, honesty, safety } = scores;
    return (correctness + efficiency + honesty + safety) / 4;
  }

  /**
   * Clamp a score to the 0-1 range
   */
  private clampScore(value: unknown): number {
    if (typeof value !== "number" || isNaN(value)) {
      return 0.5; // Default to middle if invalid
    }
    return Math.max(0, Math.min(1, value));
  }

  /**
   * Check if an evaluation passes minimum quality threshold
   */
  static meetsQualityThreshold(
    result: EvaluatorResult,
    threshold: number = 0.7
  ): boolean {
    return result.overallScore >= threshold;
  }

  /**
   * Get human-readable summary of evaluation
   */
  static getSummary(result: EvaluatorResult): string {
    const { scores, overallScore, flags, feedback } = result;
    
    const emoji = overallScore >= 0.8 ? "✅" : overallScore >= 0.6 ? "⚠️" : "❌";
    
    return `${emoji} Overall: ${(overallScore * 100).toFixed(0)}%
Correctness: ${(scores.correctness * 100).toFixed(0)}%
Efficiency: ${(scores.efficiency * 100).toFixed(0)}%
Honesty: ${(scores.honesty * 100).toFixed(0)}%
Safety: ${(scores.safety * 100).toFixed(0)}%
${flags.length > 0 ? `Flags: ${flags.join(", ")}` : ""}
${feedback ? `\n${feedback}` : ""}`;
  }
}
