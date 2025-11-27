/**
 * Model Selection Matrix
 * 
 * Simplified rating system (1-3 ⭐) for quick model selection.
 * Designed to be fast - no complex calculations, just lookup tables.
 * 
 * WORKFLOW PHASES:
 * ================
 * 
 * 1. INTAKE      → User submits goal (NL text)
 * 2. TRANSLATE   → TDLN-IN converts to LogLine (Coordinator)
 * 3. PLAN        → Planner reads code, creates execution plan
 * 4. EXECUTE     → Builder writes code, applies patches
 * 5. VALIDATE    → Run tests, linting, verification
 * 6. REVIEW      → (Optional) Code review before commit
 * 7. FINALIZE    → Commit, push, create PR
 * 
 * MODEL SELECTION HAPPENS AT:
 * - Phase 2-3: Coordinator + Planner (can use same or different model)
 * - Phase 4: Builder (main work, most tokens consumed here)
 * - Phase 5-6: Validation/Review (can use cheaper model)
 */

// =============================================================================
// Rating Types
// =============================================================================

export type Rating = 1 | 2 | 3; // ⭐ ⭐⭐ ⭐⭐⭐

export interface ModelRatings {
  speed: Rating;           // Response latency
  cost: Rating;            // Price efficiency (3 = cheapest)
  reasoning: Rating;       // Complex problem solving
  coding: Rating;          // Code generation quality
  accuracy: Rating;        // Low hallucination rate
  context: Rating;         // Long context handling
  instructions: Rating;    // Following complex instructions
}

export interface ModelProfile {
  id: string;
  provider: "openai" | "anthropic" | "google";
  ratings: ModelRatings;
  costPer1KTokens: number; // Average (input + output) / 2 for quick calc
  maxContext: number;
}

// =============================================================================
// Model Profiles - Simple Ratings (1-3 stars)
// =============================================================================

export const MODEL_PROFILES: ModelProfile[] = [
  // OpenAI
  {
    id: "gpt-5.1",
    provider: "openai",
    ratings: { speed: 2, cost: 1, reasoning: 3, coding: 3, accuracy: 3, context: 2, instructions: 3 },
    costPer1KTokens: 0.00625, // ($2.50 + $10) / 2 / 1000
    maxContext: 128000,
  },
  {
    id: "gpt-5",
    provider: "openai",
    ratings: { speed: 2, cost: 2, reasoning: 3, coding: 3, accuracy: 3, context: 2, instructions: 3 },
    costPer1KTokens: 0.005625,
    maxContext: 128000,
  },
  {
    id: "gpt-5-pro",
    provider: "openai",
    ratings: { speed: 1, cost: 1, reasoning: 3, coding: 3, accuracy: 3, context: 2, instructions: 3 },
    costPer1KTokens: 0.0125,
    maxContext: 128000,
  },
  {
    id: "gpt-5-mini",
    provider: "openai",
    ratings: { speed: 3, cost: 3, reasoning: 2, coding: 2, accuracy: 2, context: 2, instructions: 2 },
    costPer1KTokens: 0.001,
    maxContext: 128000,
  },
  {
    id: "gpt-5-nano",
    provider: "openai",
    ratings: { speed: 3, cost: 3, reasoning: 1, coding: 1, accuracy: 1, context: 1, instructions: 1 },
    costPer1KTokens: 0.00025,
    maxContext: 32000,
  },

  // Anthropic
  {
    id: "claude-opus-4-5",
    provider: "anthropic",
    ratings: { speed: 1, cost: 1, reasoning: 3, coding: 3, accuracy: 3, context: 3, instructions: 3 },
    costPer1KTokens: 0.045, // ($15 + $75) / 2 / 1000
    maxContext: 200000,
  },
  {
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    ratings: { speed: 2, cost: 2, reasoning: 3, coding: 3, accuracy: 3, context: 3, instructions: 3 },
    costPer1KTokens: 0.009,
    maxContext: 200000,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    ratings: { speed: 3, cost: 3, reasoning: 2, coding: 2, accuracy: 2, context: 3, instructions: 2 },
    costPer1KTokens: 0.003,
    maxContext: 200000,
  },

  // Google
  {
    id: "gemini-3-pro-preview",
    provider: "google",
    ratings: { speed: 2, cost: 2, reasoning: 3, coding: 3, accuracy: 2, context: 3, instructions: 3 },
    costPer1KTokens: 0.00875,
    maxContext: 1000000,
  },
  {
    id: "gemini-3-pro-image-preview",
    provider: "google",
    ratings: { speed: 2, cost: 2, reasoning: 3, coding: 2, accuracy: 2, context: 3, instructions: 3 },
    costPer1KTokens: 0.00875,
    maxContext: 1000000,
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    ratings: { speed: 3, cost: 3, reasoning: 2, coding: 2, accuracy: 2, context: 3, instructions: 2 },
    costPer1KTokens: 0.000375,
    maxContext: 1000000,
  },
  {
    id: "gemini-2.5-flash-lite",
    provider: "google",
    ratings: { speed: 3, cost: 3, reasoning: 1, coding: 1, accuracy: 1, context: 3, instructions: 1 },
    costPer1KTokens: 0.0001875,
    maxContext: 1000000,
  },
];

// =============================================================================
// Phase Requirements
// =============================================================================

export type JobPhase = 
  | "translate"   // TDLN-IN translation (Coordinator)
  | "plan"        // Read code, create plan (Planner)
  | "execute"     // Write code, apply patches (Builder)
  | "validate"    // Run tests, verify (Builder/Validator)
  | "review"      // Code review (Reviewer)
  | "finalize";   // Commit, push (Builder)

export interface PhaseRequirements {
  phase: JobPhase;
  minRatings: Partial<ModelRatings>;
  priority: (keyof ModelRatings)[]; // Which ratings matter most
  typicalTokens: number;            // Estimated tokens for this phase
  canUseCheaper: boolean;           // Can downgrade model for cost savings
}

export const PHASE_REQUIREMENTS: PhaseRequirements[] = [
  {
    phase: "translate",
    minRatings: { instructions: 2 },
    priority: ["speed", "instructions"],
    typicalTokens: 500,
    canUseCheaper: true, // Simple translation task
  },
  {
    phase: "plan",
    minRatings: { reasoning: 2, coding: 2 },
    priority: ["reasoning", "coding", "context"],
    typicalTokens: 5000,
    canUseCheaper: false, // Planning quality is critical
  },
  {
    phase: "execute",
    minRatings: { coding: 2, instructions: 2 },
    priority: ["coding", "accuracy", "instructions"],
    typicalTokens: 20000, // Bulk of the work
    canUseCheaper: false,
  },
  {
    phase: "validate",
    minRatings: { accuracy: 1 },
    priority: ["speed", "cost"],
    typicalTokens: 2000,
    canUseCheaper: true, // Just checking results
  },
  {
    phase: "review",
    minRatings: { reasoning: 2, accuracy: 2 },
    priority: ["accuracy", "reasoning"],
    typicalTokens: 3000,
    canUseCheaper: true, // Can use smaller model for review
  },
  {
    phase: "finalize",
    minRatings: {},
    priority: ["speed", "cost"],
    typicalTokens: 500,
    canUseCheaper: true, // Just git operations
  },
];

// =============================================================================
// Task Type Profiles
// =============================================================================

export type TaskType = 
  | "bug_fix_simple"    // Single-line or obvious fix
  | "bug_fix_complex"   // Multi-file, needs investigation
  | "feature_small"     // Add a function or endpoint
  | "feature_large"     // New module or subsystem
  | "refactor"          // Code restructuring
  | "security_fix"      // Security vulnerability
  | "performance"       // Optimization
  | "test_coverage"     // Add tests
  | "documentation";    // Write docs

export interface TaskProfile {
  type: TaskType;
  recommendedMode: "mechanic" | "genius";
  priorityRatings: (keyof ModelRatings)[];
  estimatedPhases: JobPhase[];
  budgetMultiplier: number; // 1.0 = normal, 2.0 = double budget
}

export const TASK_PROFILES: Record<TaskType, TaskProfile> = {
  bug_fix_simple: {
    type: "bug_fix_simple",
    recommendedMode: "mechanic",
    priorityRatings: ["speed", "cost", "coding"],
    estimatedPhases: ["translate", "execute", "validate", "finalize"],
    budgetMultiplier: 0.5,
  },
  bug_fix_complex: {
    type: "bug_fix_complex",
    recommendedMode: "genius",
    priorityRatings: ["reasoning", "coding", "accuracy"],
    estimatedPhases: ["translate", "plan", "execute", "validate", "review", "finalize"],
    budgetMultiplier: 1.5,
  },
  feature_small: {
    type: "feature_small",
    recommendedMode: "mechanic",
    priorityRatings: ["coding", "instructions", "speed"],
    estimatedPhases: ["translate", "plan", "execute", "validate", "finalize"],
    budgetMultiplier: 1.0,
  },
  feature_large: {
    type: "feature_large",
    recommendedMode: "genius",
    priorityRatings: ["reasoning", "coding", "context"],
    estimatedPhases: ["translate", "plan", "execute", "validate", "review", "finalize"],
    budgetMultiplier: 2.0,
  },
  refactor: {
    type: "refactor",
    recommendedMode: "genius",
    priorityRatings: ["reasoning", "coding", "context"],
    estimatedPhases: ["translate", "plan", "execute", "validate", "review", "finalize"],
    budgetMultiplier: 1.5,
  },
  security_fix: {
    type: "security_fix",
    recommendedMode: "genius",
    priorityRatings: ["accuracy", "reasoning", "coding"],
    estimatedPhases: ["translate", "plan", "execute", "validate", "review", "finalize"],
    budgetMultiplier: 2.0, // Extra careful
  },
  performance: {
    type: "performance",
    recommendedMode: "genius",
    priorityRatings: ["reasoning", "coding", "accuracy"],
    estimatedPhases: ["translate", "plan", "execute", "validate", "finalize"],
    budgetMultiplier: 1.5,
  },
  test_coverage: {
    type: "test_coverage",
    recommendedMode: "mechanic",
    priorityRatings: ["coding", "speed", "cost"],
    estimatedPhases: ["translate", "plan", "execute", "validate", "finalize"],
    budgetMultiplier: 1.0,
  },
  documentation: {
    type: "documentation",
    recommendedMode: "mechanic",
    priorityRatings: ["speed", "cost", "instructions"],
    estimatedPhases: ["translate", "execute", "finalize"],
    budgetMultiplier: 0.5,
  },
};

// =============================================================================
// Quick Selection Functions
// =============================================================================

/**
 * Get the best model for a task type (simple lookup, no complex logic)
 */
export function getModelForTask(
  taskType: TaskType,
  preferredProvider?: "openai" | "anthropic" | "google"
): ModelProfile {
  const profile = TASK_PROFILES[taskType];
  const mode = profile.recommendedMode;
  
  // Filter by provider if specified
  let candidates = preferredProvider 
    ? MODEL_PROFILES.filter(m => m.provider === preferredProvider)
    : MODEL_PROFILES;
  
  // For mechanic mode: prioritize speed and cost
  // For genius mode: prioritize reasoning and accuracy
  if (mode === "mechanic") {
    candidates = candidates.filter(m => 
      m.ratings.speed >= 2 && m.ratings.cost >= 2
    );
  } else {
    candidates = candidates.filter(m => 
      m.ratings.reasoning >= 2 && m.ratings.coding >= 2
    );
  }
  
  // Sort by priority ratings
  candidates.sort((a, b) => {
    let scoreA = 0, scoreB = 0;
    for (const rating of profile.priorityRatings) {
      scoreA += a.ratings[rating];
      scoreB += b.ratings[rating];
    }
    return scoreB - scoreA;
  });
  
  return candidates[0] ?? MODEL_PROFILES.find(m => m.id === "claude-sonnet-4-5")!;
}

/**
 * Get the optimal model for a specific phase
 */
export function getModelForPhase(
  phase: JobPhase,
  mode: "mechanic" | "genius",
  preferredProvider?: "openai" | "anthropic" | "google"
): ModelProfile {
  const req = PHASE_REQUIREMENTS.find(p => p.phase === phase)!;
  
  let candidates = preferredProvider 
    ? MODEL_PROFILES.filter(m => m.provider === preferredProvider)
    : MODEL_PROFILES;
  
  // Filter by minimum ratings
  candidates = candidates.filter(m => {
    for (const [key, minVal] of Object.entries(req.minRatings)) {
      if (m.ratings[key as keyof ModelRatings] < minVal) return false;
    }
    return true;
  });
  
  // For phases that can use cheaper models, prefer cost
  if (req.canUseCheaper && mode === "mechanic") {
    candidates.sort((a, b) => b.ratings.cost - a.ratings.cost);
  } else {
    // Sort by priority ratings
    candidates.sort((a, b) => {
      let scoreA = 0, scoreB = 0;
      for (const rating of req.priority) {
        scoreA += a.ratings[rating];
        scoreB += b.ratings[rating];
      }
      return scoreB - scoreA;
    });
  }
  
  return candidates[0] ?? MODEL_PROFILES.find(m => m.id === "claude-sonnet-4-5")!;
}

// =============================================================================
// Cost Estimation
// =============================================================================

export interface CostEstimate {
  totalTokens: number;
  estimatedCost: number;
  breakdown: { phase: JobPhase; tokens: number; cost: number; model: string }[];
}

/**
 * Estimate total cost for a task
 */
export function estimateTaskCost(
  taskType: TaskType,
  preferredProvider?: "openai" | "anthropic" | "google"
): CostEstimate {
  const profile = TASK_PROFILES[taskType];
  const mode = profile.recommendedMode;
  
  let totalTokens = 0;
  let totalCost = 0;
  const breakdown: CostEstimate["breakdown"] = [];
  
  for (const phase of profile.estimatedPhases) {
    const phaseReq = PHASE_REQUIREMENTS.find(p => p.phase === phase)!;
    const model = getModelForPhase(phase, mode, preferredProvider);
    const tokens = Math.round(phaseReq.typicalTokens * profile.budgetMultiplier);
    const cost = tokens * model.costPer1KTokens / 1000;
    
    totalTokens += tokens;
    totalCost += cost;
    breakdown.push({ phase, tokens, cost, model: model.id });
  }
  
  return { totalTokens, estimatedCost: totalCost, breakdown };
}

/**
 * Format cost for display
 */
export function formatCostEstimate(estimate: CostEstimate): string {
  const lines = [
    `📊 Estimated Cost: $${estimate.estimatedCost.toFixed(4)}`,
    `📝 Total Tokens: ~${estimate.totalTokens.toLocaleString()}`,
    "",
    "Phase Breakdown:",
  ];
  
  for (const { phase, tokens, cost, model } of estimate.breakdown) {
    lines.push(`  ${phase}: ${tokens.toLocaleString()} tokens → $${cost.toFixed(4)} (${model})`);
  }
  
  return lines.join("\n");
}

// =============================================================================
// Quick Recommendation API
// =============================================================================

export interface ModelRecommendation {
  model: ModelProfile;
  reason: string;
  estimatedCost: CostEstimate;
  alternatives: { model: ModelProfile; tradeoff: string }[];
}

/**
 * Get a quick recommendation with alternatives
 */
export function recommend(
  taskType: TaskType,
  preferredProvider?: "openai" | "anthropic" | "google"
): ModelRecommendation {
  const primary = getModelForTask(taskType, preferredProvider);
  const profile = TASK_PROFILES[taskType];
  const estimate = estimateTaskCost(taskType, preferredProvider);
  
  // Find alternatives
  const alternatives: ModelRecommendation["alternatives"] = [];
  
  // Cheaper alternative
  const cheaper = MODEL_PROFILES
    .filter(m => m.costPer1KTokens < primary.costPer1KTokens && m.ratings.coding >= 2)
    .sort((a, b) => a.costPer1KTokens - b.costPer1KTokens)[0];
  if (cheaper) {
    alternatives.push({ model: cheaper, tradeoff: "Cheaper but slower/less accurate" });
  }
  
  // Faster alternative
  const faster = MODEL_PROFILES
    .filter(m => m.ratings.speed > primary.ratings.speed && m.ratings.coding >= 1)
    .sort((a, b) => b.ratings.speed - a.ratings.speed)[0];
  if (faster && faster.id !== primary.id) {
    alternatives.push({ model: faster, tradeoff: "Faster but may be less capable" });
  }
  
  // More accurate alternative
  const accurate = MODEL_PROFILES
    .filter(m => m.ratings.accuracy > primary.ratings.accuracy)
    .sort((a, b) => b.ratings.accuracy - a.ratings.accuracy)[0];
  if (accurate && accurate.id !== primary.id) {
    alternatives.push({ model: accurate, tradeoff: "More accurate but more expensive" });
  }
  
  return {
    model: primary,
    reason: `Best for ${taskType.replace(/_/g, " ")} (${profile.recommendedMode} mode)`,
    estimatedCost: estimate,
    alternatives: alternatives.slice(0, 3),
  };
}

// =============================================================================
// Print Summary (for debugging/display)
// =============================================================================

export function printModelMatrix(): string {
  const lines = [
    "╔══════════════════════════════════════════════════════════════════════════╗",
    "║                        MODEL SELECTION MATRIX                            ║",
    "╠══════════════════════════════════════════════════════════════════════════╣",
    "║ Model                │ Speed │ Cost │ Code │ Reason │ Accur │ $/1K tok  ║",
    "╠══════════════════════════════════════════════════════════════════════════╣",
  ];
  
  for (const m of MODEL_PROFILES) {
    const stars = (n: Rating) => "⭐".repeat(n) + "  ".repeat(3 - n);
    lines.push(
      `║ ${m.id.padEnd(20)} │ ${stars(m.ratings.speed)} │ ${stars(m.ratings.cost)} │ ${stars(m.ratings.coding)} │ ${stars(m.ratings.reasoning)} │ ${stars(m.ratings.accuracy)} │ $${m.costPer1KTokens.toFixed(5).padStart(7)} ║`
    );
  }
  
  lines.push("╚══════════════════════════════════════════════════════════════════════════╝");
  
  return lines.join("\n");
}



