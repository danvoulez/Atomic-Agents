/**
 * Agent Tool Loader
 *
 * Provides tools appropriate for each agent type:
 * - Coordinator: delegation, monitoring, clarification
 * - Planner: code reading, analysis, plan creation
 * - Builder: branching, patching, testing, committing
 * - Reviewer: diff inspection, approval/rejection
 * - Evaluator: job analysis, quality scoring
 */

import { Tool } from "@ai-coding-team/types";
import { coordinatorTools } from "./coordinator-tools";
import { plannerTools } from "./planner-tools";
import { builderTools } from "./builder-tools";
import { reviewerTools } from "./reviewer-tools";
import { evaluatorTools } from "./evaluator-tools";

/**
 * Get the appropriate tools for an agent type
 */
export function getToolsForAgent(agentType: string): Tool<unknown, unknown>[] {
  switch (agentType) {
    case "coordinator":
      return coordinatorTools as Tool<unknown, unknown>[];
    case "planner":
      return plannerTools as Tool<unknown, unknown>[];
    case "builder":
      return builderTools as Tool<unknown, unknown>[];
    case "reviewer":
      return reviewerTools as Tool<unknown, unknown>[];
    case "evaluator":
      return evaluatorTools as Tool<unknown, unknown>[];
    default:
      console.warn(`Unknown agent type: ${agentType}, returning empty tool set`);
      return [];
  }
}

/**
 * Get all tools (useful for testing/validation)
 */
export function getAllTools(): Tool<unknown, unknown>[] {
  return [
    ...coordinatorTools,
    ...plannerTools,
    ...builderTools,
    ...reviewerTools,
    ...evaluatorTools,
  ] as Tool<unknown, unknown>[];
}

// Export tool sets
export { coordinatorTools } from "./coordinator-tools";
export { plannerTools } from "./planner-tools";
export { builderTools } from "./builder-tools";
export { reviewerTools } from "./reviewer-tools";
export { evaluatorTools } from "./evaluator-tools";
