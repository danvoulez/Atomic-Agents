/**
 * Database schema types - matches migrations through 008_complete_schema.sql
 */

export type JobStatus =
  | "queued"
  | "running"
  | "waiting_human"
  | "succeeded"
  | "failed"
  | "aborted"
  | "cancelling";

export type AgentType =
  | "coordinator"
  | "planner"
  | "builder"
  | "reviewer"
  | "evaluator";

export type EventKind =
  | "tool_call"
  | "tool_result"
  | "analysis"
  | "plan"
  | "decision"
  | "error"
  | "escalation"
  | "evaluation"
  | "info"
  | "reasoning"
  | "clarification_needed"
  | "result";

export interface JobRow {
  id: string;
  trace_id: string;
  
  // Content
  mode: "mechanic" | "genius";
  agent_type: AgentType;
  goal: string;
  repo_path: string;
  
  // State
  status: JobStatus;
  assigned_to?: string | null;
  cancel_requested_at?: string | null;
  
  // LogLine
  logline_span?: string | null;
  span_hash?: string | null;
  
  // Hierarchy
  parent_job_id?: string | null;
  conversation_id?: string | null;
  
  // Budget
  step_cap: number;
  steps_used: number;
  token_cap?: number | null;
  tokens_used?: number | null;
  cost_cap_cents?: number | null;
  cost_used_cents?: number | null;
  
  // UI state
  current_action?: string | null;
  
  // Provenance
  created_by: string;
  proof_ref?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  last_heartbeat_at?: string | null;
}

export interface EventRow {
  id: string;
  job_id: string;
  trace_id: string;
  
  // Event type
  kind: EventKind;
  
  // Content
  tool_name?: string | null;
  params?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  summary?: string | null;
  
  // Metrics
  duration_ms?: number | null;
  tokens_used?: number | null;
  cost_cents?: number | null;
  
  // Provenance
  span_hash?: string | null;
  conversation_id?: string | null;
  created_at: string;
}

export interface EvaluationRow {
  id: string;
  job_id: string;
  
  // Scores (0.0 to 1.0)
  correctness?: number | null;
  efficiency?: number | null;
  honesty?: number | null;
  safety?: number | null;
  
  // Details
  flags: string[];
  feedback?: string | null;
  recommendations?: string[];
  
  // Metadata
  evaluated_by: string;
  created_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface ConversationRow {
  id: string;
  created_at: string;
}

export interface TruthPackRow {
  id: string;
  
  // Content
  input_raw: string;
  input_normalized: string;
  input_hash: string;
  
  output_logline: string;
  output_hash: string;
  
  // Translation trace
  grammar_id: string;
  rule_matched?: string | null;
  entities_captured: Record<string, string>;
  selection_trace?: string | null;
  selection_hash?: string | null;
  
  // Merkle commitment
  merkle_root: string;
  merkle_leaves: string[];
  
  // Optional signature
  signature_algorithm?: string | null;
  signature_public_key?: string | null;
  signature_value?: string | null;
  
  // Metadata
  created_at: string;
  expires_at?: string | null;
}

/**
 * Input types for creating records
 */

export interface JobInput {
  id?: string;
  trace_id?: string;
  mode: "mechanic" | "genius";
  agent_type: AgentType;
  goal: string;
  repo_path: string;
  status?: JobStatus;
  conversation_id?: string;
  parent_job_id?: string;
  step_cap?: number;
  token_cap?: number;
  cost_cap_cents?: number;
  created_by?: string;
  logline_span?: string;
  span_hash?: string;
  proof_ref?: string;
}

export interface EventInput {
  id?: string;
  job_id: string;
  trace_id: string;
  kind: EventKind;
  tool_name?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  summary?: string;
  duration_ms?: number;
  tokens_used?: number;
  cost_cents?: number;
  span_hash?: string;
  conversation_id?: string;
}

export interface EvaluationInput {
  job_id: string;
  correctness?: number;
  efficiency?: number;
  honesty?: number;
  safety?: number;
  flags?: string[];
  feedback?: string;
  recommendations?: string[];
  evaluated_by?: string;
}
