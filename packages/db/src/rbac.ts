/**
 * Role-Based Access Control for Agents
 * 
 * Agents have restricted database access:
 * - READ: Can read ledger entries, knowledge, job state
 * - APPEND: Can append to ledger (events, messages, knowledge)
 * - NO UPDATE: Cannot modify existing data
 * - NO DELETE: Cannot remove data
 * 
 * This is enforced at:
 * 1. Database level (triggers prevent UPDATE/DELETE on ledger)
 * 2. Application level (AgentDBClient only exposes safe methods)
 */

import {
  appendToLedger,
  appendMessage,
  appendJobStatus,
  appendEvent,
  appendKnowledge,
  queryLedger,
  getJobState,
  getConversationMessages,
  searchKnowledge,
  findSimilarWork,
  type LedgerEntry,
  type LedgerQuery,
} from "./ledger";

// ============================================================================
// AGENT ROLES
// ============================================================================

export type AgentRole = 
  | "coordinator"    // Can read all, append messages/events/job_status
  | "planner"        // Can read all, append analysis/plans
  | "builder"        // Can read all, append patches/events
  | "reviewer"       // Can read all, append reviews
  | "evaluator";     // Can read all, append evaluations

export interface AgentIdentity {
  role: AgentRole;
  jobId: string;
  traceId: string;
  projectId?: string;
}

// ============================================================================
// AGENT DB CLIENT (restricted access)
// ============================================================================

export class AgentDBClient {
  private identity: AgentIdentity;

  constructor(identity: AgentIdentity) {
    this.identity = identity;
  }

  // =========================================================================
  // READ OPERATIONS (all agents can read)
  // =========================================================================

  /**
   * Query the ledger with filters
   */
  async query(query: Omit<LedgerQuery, "limit"> & { limit?: number }): Promise<LedgerEntry[]> {
    return queryLedger({ ...query, limit: query.limit ?? 50 });
  }

  /**
   * Get current job state (derived from latest entries)
   */
  async getJobState(jobId?: string): Promise<{
    status: string;
    stepsUsed: number;
    tokensUsed: number;
    lastActivity: string;
  } | null> {
    return getJobState(jobId ?? this.identity.jobId);
  }

  /**
   * Get conversation history
   */
  async getConversation(conversationId: string, limit = 50): Promise<{
    role: string;
    content: string;
    timestamp: string;
  }[]> {
    return getConversationMessages(conversationId, limit);
  }

  /**
   * Search knowledge base (cross-project)
   */
  async searchKnowledge(query: string, limit = 10): Promise<LedgerEntry[]> {
    return searchKnowledge(query, { projectId: this.identity.projectId, limit });
  }

  /**
   * Find similar past work
   */
  async findSimilar(description: string, limit = 5): Promise<LedgerEntry[]> {
    return findSimilarWork(description, { projectId: this.identity.projectId, limit });
  }

  /**
   * Get job history (all events for a job)
   */
  async getJobHistory(jobId?: string): Promise<LedgerEntry[]> {
    return queryLedger({
      job_id: jobId ?? this.identity.jobId,
      limit: 200,
    });
  }

  /**
   * Get project history
   */
  async getProjectHistory(projectId?: string, limit = 100): Promise<LedgerEntry[]> {
    return queryLedger({
      project_id: projectId ?? this.identity.projectId,
      limit,
    });
  }

  // =========================================================================
  // APPEND OPERATIONS (role-specific)
  // =========================================================================

  /**
   * Append an event (all agents)
   */
  async appendEvent(
    eventKind: string,
    summary: string,
    data: Record<string, unknown>
  ): Promise<LedgerEntry> {
    return appendEvent(
      this.identity.jobId,
      this.identity.traceId,
      eventKind,
      summary,
      {
        ...data,
        agent_role: this.identity.role,
      },
      this.identity.role
    );
  }

  /**
   * Append a message (coordinator only)
   */
  async appendMessage(
    conversationId: string,
    role: "user" | "assistant",
    content: string
  ): Promise<LedgerEntry> {
    this.requireRole(["coordinator"], "append messages");
    return appendMessage(conversationId, role, content, this.identity.projectId);
  }

  /**
   * Append job status (coordinator, all agents)
   */
  async appendJobStatus(
    status: string,
    details?: Record<string, unknown>
  ): Promise<LedgerEntry> {
    return appendJobStatus(
      this.identity.jobId,
      status,
      "agent",
      this.identity.role,
      {
        ...details,
        agent_role: this.identity.role,
      }
    );
  }

  /**
   * Append analysis (planner only)
   */
  async appendAnalysis(
    summary: string,
    data: Record<string, unknown>
  ): Promise<LedgerEntry> {
    this.requireRole(["planner"], "append analysis");
    return appendToLedger({
      kind: "analysis",
      job_id: this.identity.jobId,
      trace_id: this.identity.traceId,
      project_id: this.identity.projectId,
      actor_type: "agent",
      actor_id: this.identity.role,
      summary,
      data,
    });
  }

  /**
   * Append plan (planner only)
   */
  async appendPlan(
    summary: string,
    data: Record<string, unknown>
  ): Promise<LedgerEntry> {
    this.requireRole(["planner"], "append plan");
    return appendToLedger({
      kind: "plan",
      job_id: this.identity.jobId,
      trace_id: this.identity.traceId,
      project_id: this.identity.projectId,
      actor_type: "agent",
      actor_id: this.identity.role,
      summary,
      data,
    });
  }

  /**
   * Append patch (builder only)
   */
  async appendPatch(
    summary: string,
    data: Record<string, unknown>
  ): Promise<LedgerEntry> {
    this.requireRole(["builder"], "append patch");
    return appendToLedger({
      kind: "patch",
      job_id: this.identity.jobId,
      trace_id: this.identity.traceId,
      project_id: this.identity.projectId,
      actor_type: "agent",
      actor_id: this.identity.role,
      summary,
      data,
    });
  }

  /**
   * Append review (reviewer only)
   */
  async appendReview(
    summary: string,
    data: Record<string, unknown>
  ): Promise<LedgerEntry> {
    this.requireRole(["reviewer"], "append review");
    return appendToLedger({
      kind: "review",
      job_id: this.identity.jobId,
      trace_id: this.identity.traceId,
      project_id: this.identity.projectId,
      actor_type: "agent",
      actor_id: this.identity.role,
      summary,
      data,
    });
  }

  /**
   * Append evaluation (evaluator only)
   */
  async appendEvaluation(
    summary: string,
    data: Record<string, unknown>
  ): Promise<LedgerEntry> {
    this.requireRole(["evaluator"], "append evaluation");
    return appendToLedger({
      kind: "evaluation",
      job_id: this.identity.jobId,
      trace_id: this.identity.traceId,
      project_id: this.identity.projectId,
      actor_type: "agent",
      actor_id: this.identity.role,
      summary,
      data,
    });
  }

  /**
   * Append knowledge (all agents - cross-project learnings)
   */
  async appendKnowledge(
    summary: string,
    data: Record<string, unknown>,
    refs?: string[]
  ): Promise<LedgerEntry> {
    return appendKnowledge(
      summary,
      {
        ...data,
        learned_by: this.identity.role,
        source_job: this.identity.jobId,
      },
      this.identity.projectId,
      refs
    );
  }

  /**
   * Append escalation (all agents)
   */
  async appendEscalation(
    reason: string,
    data: Record<string, unknown>
  ): Promise<LedgerEntry> {
    return appendToLedger({
      kind: "escalation",
      job_id: this.identity.jobId,
      trace_id: this.identity.traceId,
      project_id: this.identity.projectId,
      actor_type: "agent",
      actor_id: this.identity.role,
      summary: `Escalation: ${reason}`,
      data: {
        ...data,
        agent_role: this.identity.role,
        escalation_reason: reason,
      },
    });
  }

  /**
   * Append error (all agents)
   */
  async appendError(
    error: string,
    data: Record<string, unknown>
  ): Promise<LedgerEntry> {
    return appendToLedger({
      kind: "error",
      job_id: this.identity.jobId,
      trace_id: this.identity.traceId,
      project_id: this.identity.projectId,
      actor_type: "agent",
      actor_id: this.identity.role,
      summary: `Error: ${error}`,
      data: {
        ...data,
        agent_role: this.identity.role,
        error_message: error,
      },
    });
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private requireRole(allowed: AgentRole[], action: string): void {
    if (!allowed.includes(this.identity.role)) {
      throw new Error(
        `RBAC: Agent role '${this.identity.role}' is not allowed to ${action}. ` +
        `Required: ${allowed.join(" or ")}`
      );
    }
  }

  /**
   * Get the agent's identity
   */
  getIdentity(): AgentIdentity {
    return { ...this.identity };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createAgentDBClient(identity: AgentIdentity): AgentDBClient {
  return new AgentDBClient(identity);
}

// ============================================================================
// ADMIN CLIENT (full access - for dashboard/admin)
// ============================================================================

export class AdminDBClient {
  /**
   * Query ledger with full access
   */
  async query(query: LedgerQuery): Promise<LedgerEntry[]> {
    return queryLedger(query);
  }

  /**
   * Get audit trail
   */
  async getAuditTrail(options: {
    jobId?: string;
    projectId?: string;
    since?: string;
    limit?: number;
  }): Promise<LedgerEntry[]> {
    return queryLedger({
      job_id: options.jobId,
      project_id: options.projectId,
      since: options.since,
      limit: options.limit ?? 100,
    });
  }

  /**
   * Append audit entry
   */
  async appendAudit(
    action: string,
    details: Record<string, unknown>,
    adminId?: string
  ): Promise<LedgerEntry> {
    return appendToLedger({
      kind: "audit",
      actor_type: "admin",
      actor_id: adminId,
      summary: action,
      data: details,
    });
  }

  /**
   * Get full job history
   */
  async getJobHistory(jobId: string): Promise<LedgerEntry[]> {
    return queryLedger({ job_id: jobId, limit: 500 });
  }

  /**
   * Get cross-project knowledge
   */
  async getAllKnowledge(limit = 100): Promise<LedgerEntry[]> {
    return queryLedger({ kind: "knowledge", limit });
  }
}

export function createAdminDBClient(): AdminDBClient {
  return new AdminDBClient();
}

