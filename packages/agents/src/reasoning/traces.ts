/**
 * Structured Reasoning Traces
 * 
 * Implements Chain-of-Thought (CoT) reasoning with structured logging.
 * Enables better debugging, evaluation, and learning from agent behavior.
 */

import { insertEvent } from "@ai-coding-team/db";

export interface ReasoningStep {
  id: string;
  timestamp: string;
  type: "observation" | "thought" | "decision" | "action" | "reflection";
  content: string;
  confidence?: number; // 0-1
  evidence?: string[];
  alternatives?: string[];
  metadata?: Record<string, unknown>;
}

export interface ReasoningChain {
  traceId: string;
  jobId: string;
  steps: ReasoningStep[];
  outcome?: "success" | "failure" | "escalation" | "pending";
  summary?: string;
}

/**
 * Reasoning Trace Logger
 * 
 * Logs structured reasoning steps for analysis and debugging.
 */
export class ReasoningTracer {
  private chain: ReasoningChain;
  private stepCounter: number = 0;

  constructor(traceId: string, jobId: string) {
    this.chain = {
      traceId,
      jobId,
      steps: [],
    };
  }

  /**
   * Log an observation (input from tools or environment)
   */
  observe(content: string, evidence?: string[]): ReasoningStep {
    return this.addStep({
      type: "observation",
      content,
      evidence,
    });
  }

  /**
   * Log a thought (internal reasoning)
   */
  think(content: string, confidence?: number, alternatives?: string[]): ReasoningStep {
    return this.addStep({
      type: "thought",
      content,
      confidence,
      alternatives,
    });
  }

  /**
   * Log a decision (choice made based on reasoning)
   */
  decide(content: string, confidence: number, evidence: string[]): ReasoningStep {
    return this.addStep({
      type: "decision",
      content,
      confidence,
      evidence,
    });
  }

  /**
   * Log an action (tool call or output)
   */
  act(content: string, metadata?: Record<string, unknown>): ReasoningStep {
    return this.addStep({
      type: "action",
      content,
      metadata,
    });
  }

  /**
   * Log a reflection (post-action analysis)
   */
  reflect(content: string, wasSuccessful: boolean): ReasoningStep {
    return this.addStep({
      type: "reflection",
      content,
      confidence: wasSuccessful ? 1 : 0,
    });
  }

  /**
   * Add a step to the chain
   */
  private addStep(partial: Omit<ReasoningStep, "id" | "timestamp">): ReasoningStep {
    const step: ReasoningStep = {
      id: `step_${this.stepCounter++}`,
      timestamp: new Date().toISOString(),
      ...partial,
    };

    this.chain.steps.push(step);
    return step;
  }

  /**
   * Complete the reasoning chain
   */
  complete(outcome: ReasoningChain["outcome"], summary?: string): ReasoningChain {
    this.chain.outcome = outcome;
    this.chain.summary = summary ?? this.generateSummary();
    return this.chain;
  }

  /**
   * Generate a summary of the reasoning chain
   */
  private generateSummary(): string {
    const decisions = this.chain.steps.filter(s => s.type === "decision");
    const actions = this.chain.steps.filter(s => s.type === "action");
    const reflections = this.chain.steps.filter(s => s.type === "reflection");

    const parts: string[] = [];

    if (decisions.length > 0) {
      parts.push(`Made ${decisions.length} decisions`);
      const highConfidence = decisions.filter(d => (d.confidence ?? 0) >= 0.8);
      if (highConfidence.length > 0) {
        parts.push(`(${highConfidence.length} high confidence)`);
      }
    }

    if (actions.length > 0) {
      parts.push(`Took ${actions.length} actions`);
    }

    if (reflections.length > 0) {
      const successful = reflections.filter(r => (r.confidence ?? 0) > 0.5).length;
      parts.push(`${successful}/${reflections.length} successful outcomes`);
    }

    return parts.join(". ") || "Reasoning chain completed.";
  }

  /**
   * Get the current chain
   */
  getChain(): ReasoningChain {
    return this.chain;
  }

  /**
   * Get average confidence across decisions
   */
  getAverageConfidence(): number {
    const decisions = this.chain.steps.filter(s => s.type === "decision" && s.confidence !== undefined);
    if (decisions.length === 0) return 0;
    
    const sum = decisions.reduce((acc, d) => acc + (d.confidence ?? 0), 0);
    return sum / decisions.length;
  }

  /**
   * Check if reasoning shows signs of uncertainty
   */
  isUncertain(): boolean {
    const avgConfidence = this.getAverageConfidence();
    const hasAlternatives = this.chain.steps.some(s => s.alternatives && s.alternatives.length > 2);
    const hasLowConfidence = this.chain.steps.some(s => (s.confidence ?? 1) < 0.3);

    return avgConfidence < 0.5 || (hasAlternatives && hasLowConfidence);
  }

  /**
   * Persist the chain to the database
   */
  async persist(): Promise<void> {
    await insertEvent({
      job_id: this.chain.jobId,
      trace_id: this.chain.traceId,
      kind: "reasoning",
      summary: this.chain.summary ?? this.generateSummary(),
      params: {
        steps: this.chain.steps,
        outcome: this.chain.outcome,
        avgConfidence: this.getAverageConfidence(),
        uncertain: this.isUncertain(),
      },
    });
  }
}

/**
 * Parse reasoning from LLM output
 * 
 * Extracts structured reasoning from natural language responses.
 */
export function parseReasoningFromText(text: string): Partial<ReasoningStep>[] {
  const steps: Partial<ReasoningStep>[] = [];

  // Pattern: "I observe/notice/see that..."
  const observePattern = /I (?:observe|notice|see|found) (?:that )?(.+?)(?:\.|$)/gi;
  let match;
  while ((match = observePattern.exec(text)) !== null) {
    steps.push({
      type: "observation",
      content: match[1].trim(),
    });
  }

  // Pattern: "I think/believe/suspect..."
  const thinkPattern = /I (?:think|believe|suspect|reason) (?:that )?(.+?)(?:\.|$)/gi;
  while ((match = thinkPattern.exec(text)) !== null) {
    steps.push({
      type: "thought",
      content: match[1].trim(),
    });
  }

  // Pattern: "I will/should/must..."
  const decidePattern = /I (?:will|should|must|need to|decide to) (.+?)(?:\.|$)/gi;
  while ((match = decidePattern.exec(text)) !== null) {
    steps.push({
      type: "decision",
      content: match[1].trim(),
    });
  }

  // Pattern: Confidence markers
  const confidencePatterns = [
    { pattern: /(?:very |highly )?confident/i, score: 0.9 },
    { pattern: /fairly confident|probably/i, score: 0.7 },
    { pattern: /(?:un)?certain|might|may/i, score: 0.5 },
    { pattern: /unsure|unclear|not sure/i, score: 0.3 },
  ];

  for (const step of steps) {
    for (const { pattern, score } of confidencePatterns) {
      if (pattern.test(text)) {
        step.confidence = score;
        break;
      }
    }
  }

  return steps;
}

/**
 * Format reasoning chain for prompt injection
 * 
 * Creates a structured prompt section showing the agent's reasoning history.
 */
export function formatReasoningForPrompt(chain: ReasoningChain, maxSteps: number = 5): string {
  const recent = chain.steps.slice(-maxSteps);
  
  const formatted = recent.map(step => {
    const prefix = {
      observation: "👁️ Observed",
      thought: "💭 Thought",
      decision: "✅ Decided",
      action: "⚡ Action",
      reflection: "🔄 Reflected",
    }[step.type];

    let line = `${prefix}: ${step.content}`;
    
    if (step.confidence !== undefined) {
      line += ` (confidence: ${Math.round(step.confidence * 100)}%)`;
    }
    
    return line;
  }).join("\n");

  return `
═══════════════════════════════════════════════════════════════════════════════
REASONING TRACE (last ${recent.length} steps)
═══════════════════════════════════════════════════════════════════════════════

${formatted}

═══════════════════════════════════════════════════════════════════════════════
`.trim();
}

