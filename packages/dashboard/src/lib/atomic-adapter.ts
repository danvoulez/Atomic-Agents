/**
 * AtomicAdapter - Bridge between Vercel Template (tasks) and Atomic Agents (jobs)
 * 
 * This adapter enables the fusion of both systems:
 * - Vercel Template: UI/UX friendly task management
 * - Atomic Agents: Powerful multi-agent backend with TDLN pipeline
 */

import { pool, insertJob, getJob, listEvents, updateJob } from "@ai-coding-team/db";
import type { JobRow, EventRow } from "@ai-coding-team/db";

// ============================================================================
// TYPES
// ============================================================================

export interface Task {
  id: string;
  userId: string;
  prompt: string;
  title?: string;
  repoUrl?: string;
  selectedAgent?: string;
  selectedModel?: string;
  status: "pending" | "processing" | "completed" | "error" | "stopped";
  logs: LogEntry[];
  branchName?: string;
  sandboxId?: string;
  prUrl?: string;
  prNumber?: number;
  prStatus?: string;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  jobId?: string;
}

export interface LogEntry {
  type: "command" | "info" | "error" | "success" | "warning";
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface CreateTaskInput {
  userId: string;
  prompt: string;
  repoUrl?: string;
  selectedAgent?: string;
  selectedModel?: string;
  title?: string;
}

export interface TaskWithJob extends Task {
  job?: {
    id: string;
    traceId: string;
    mode: "mechanic" | "genius";
    agentType: string;
    goal: string;
    status: string;
    budget: {
      stepsUsed: number;
      stepsCap: number;
      tokensUsed: number;
      tokensCap: number;
      costUsedCents: number;
      costCapCents: number;
    };
    evaluation?: {
      correctness: number;
      efficiency: number;
      honesty: number;
      safety: number;
      overallScore: number;
      flags: string[];
      feedback: string;
    };
    tdln?: {
      matchedRule?: string;
      confidence?: number;
      span?: Record<string, unknown>;
    };
  };
  events: EventRow[];
}

// ============================================================================
// ATOMIC ADAPTER
// ============================================================================

export class AtomicAdapter {
  /**
   * Create Task → Creates both Task (Vercel) and Job (Atomic)
   */
  async createTask(input: CreateTaskInput): Promise<{ taskId: string; jobId: string }> {
    const taskId = crypto.randomUUID().replace(/-/g, "").slice(0, 21);
    
    // 1. Infer mode from prompt
    const mode = this.inferMode(input.prompt);
    
    // 2. Extract repo path from URL
    const repoPath = input.repoUrl ? this.extractRepoPath(input.repoUrl) : "/tmp/default-repo";
    
    // 3. Create job in Atomic Agents
    const job = await insertJob({
      goal: input.prompt,
      mode: mode,
      agent_type: input.selectedAgent || "coordinator",
      repo_path: repoPath,
      status: "queued",
      step_cap: mode === "mechanic" ? 20 : 50,
      token_cap: mode === "mechanic" ? 50000 : 100000,
      cost_cap_cents: mode === "mechanic" ? 500 : 2000,
      created_by: input.userId,
    });
    
    // 4. Create task in Vercel schema with link to job
    await pool.query(
      `INSERT INTO tasks (
        id, user_id, prompt, title, repo_url, selected_agent, selected_model,
        status, logs, progress, job_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
      [
        taskId,
        input.userId,
        input.prompt,
        input.title || this.generateTitle(input.prompt),
        input.repoUrl,
        input.selectedAgent || "coordinator",
        input.selectedModel,
        "pending",
        JSON.stringify([]),
        0,
        job.id,
      ]
    );
    
    // 5. Link job back to task
    await updateJob(job.id, { task_id: taskId } as any);
    
    // 6. Add initial log entry
    await this.addLog(taskId, {
      type: "info",
      message: `Task created with ${mode} mode`,
      timestamp: new Date().toISOString(),
    });
    
    return { taskId, jobId: job.id };
  }

  /**
   * Get task with full job details
   */
  async getTaskWithJob(taskId: string): Promise<TaskWithJob | null> {
    const result = await pool.query(
      `SELECT * FROM task_details WHERE id = $1`,
      [taskId]
    );
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return this.rowToTaskWithJob(row);
  }

  /**
   * List tasks for a user
   */
  async listTasks(userId: string, limit = 50): Promise<Task[]> {
    const result = await pool.query(
      `SELECT * FROM task_details WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    
    return result.rows.map(row => this.rowToTask(row));
  }

  /**
   * Stream events from job as task logs
   */
  async *streamTaskEvents(taskId: string): AsyncGenerator<LogEntry> {
    const task = await this.getTask(taskId);
    if (!task?.jobId) {
      throw new Error("No job associated with task");
    }
    
    let lastEventId: string | undefined;
    
    while (true) {
      // Poll for new events
      const events = await listEvents(task.jobId);
      
      // Find new events
      const newEvents = lastEventId 
        ? events.filter(e => e.created_at > (events.find(ev => ev.id === lastEventId)?.created_at || new Date(0)))
        : events;
      
      for (const event of newEvents) {
        const log = this.eventToLog(event);
        yield log;
        
        // Also save to task logs
        await this.addLog(taskId, log);
        
        lastEventId = event.id;
      }
      
      // Check if job is complete
      const job = await getJob(task.jobId);
      if (job && ["succeeded", "failed", "cancelled"].includes(job.status)) {
        // Yield final status
        yield {
          type: job.status === "succeeded" ? "success" : "error",
          message: job.status === "succeeded" 
            ? "Task completed successfully" 
            : `Task ${job.status}`,
          timestamp: new Date().toISOString(),
        };
        break;
      }
      
      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Get events for a task (non-streaming)
   */
  async getTaskEvents(taskId: string): Promise<LogEntry[]> {
    const task = await this.getTask(taskId);
    if (!task?.jobId) return [];
    
    const events = await listEvents(task.jobId);
    return events.map(e => this.eventToLog(e));
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task?.jobId) return;
    
    await updateJob(task.jobId, { status: "cancelled" });
    await this.updateTaskStatus(taskId, "stopped");
  }

  /**
   * Get atomic insights for a task
   */
  async getAtomicInsights(taskId: string): Promise<{
    mode: string;
    agents: string[];
    budget: {
      stepsUsed: number;
      stepsMax: number;
      tokensUsed: number;
      costCents: number;
    };
    evaluation?: {
      correctness: number;
      efficiency: number;
      honesty: number;
      safety: number;
    };
    tdln?: {
      matchedRule: string;
      confidence: number;
    };
  } | null> {
    const taskWithJob = await this.getTaskWithJob(taskId);
    if (!taskWithJob?.job) return null;
    
    const { job, events } = taskWithJob;
    
    // Extract unique agents from events
    const agents = [...new Set(
      events
        .filter(e => e.tool_name)
        .map(e => {
          // Infer agent from tool name
          if (e.tool_name?.includes("plan")) return "Planner";
          if (e.tool_name?.includes("patch") || e.tool_name?.includes("edit")) return "Builder";
          if (e.tool_name?.includes("review")) return "Reviewer";
          return "Coordinator";
        })
    )];
    
    return {
      mode: job.mode,
      agents: agents.length > 0 ? agents : ["Coordinator"],
      budget: {
        stepsUsed: job.budget.stepsUsed,
        stepsMax: job.budget.stepsCap,
        tokensUsed: job.budget.tokensUsed,
        costCents: job.budget.costUsedCents,
      },
      evaluation: job.evaluation,
      tdln: job.tdln ? {
        matchedRule: job.tdln.matchedRule || "unknown",
        confidence: job.tdln.confidence || 0,
      } : undefined,
    };
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  private async getTask(taskId: string): Promise<Task | null> {
    const result = await pool.query(
      `SELECT * FROM tasks WHERE id = $1`,
      [taskId]
    );
    
    if (result.rows.length === 0) return null;
    return this.rowToTask(result.rows[0]);
  }

  private async addLog(taskId: string, log: LogEntry): Promise<void> {
    await pool.query(
      `UPDATE tasks 
       SET logs = logs || $1::jsonb, updated_at = NOW() 
       WHERE id = $2`,
      [JSON.stringify([log]), taskId]
    );
  }

  private async updateTaskStatus(taskId: string, status: Task["status"]): Promise<void> {
    await pool.query(
      `UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, taskId]
    );
  }

  /**
   * Convert Atomic event to Vercel log entry
   */
  private eventToLog(event: EventRow): LogEntry {
    const typeMap: Record<string, LogEntry["type"]> = {
      tool_call: "command",
      tool_result: "info",
      error: "error",
      analysis: "info",
      plan: "success",
      decision: "info",
      escalation: "warning",
      evaluation: "success",
      info: "info",
    };

    return {
      type: typeMap[event.kind] || "info",
      message: this.formatEventMessage(event),
      timestamp: event.created_at.toISOString(),
      data: {
        kind: event.kind,
        toolName: event.tool_name,
        tokensUsed: event.tokens_used,
        durationMs: event.duration_ms,
      },
    };
  }

  /**
   * Format event message for display
   */
  private formatEventMessage(event: EventRow): string {
    switch (event.kind) {
      case "tool_call":
        return `🔧 ${event.tool_name}: ${event.summary || "Executing..."}`;
      
      case "tool_result":
        const result = event.result as { success?: boolean; error?: string } | null;
        return result?.success 
          ? `✓ ${event.tool_name} completed`
          : `✗ ${event.tool_name} failed: ${result?.error || "Unknown error"}`;
      
      case "analysis":
        return `📊 ${event.summary || "Analysis complete"}`;
      
      case "plan":
        return `📋 ${event.summary || "Plan created"}`;
      
      case "decision":
        return `🎯 ${event.summary || "Decision made"}`;
      
      case "error":
        return `❌ ${event.summary || "Error occurred"}`;
      
      case "escalation":
        return `⚠️ ${event.summary || "Escalation required"}`;
      
      case "evaluation":
        return `🎖️ ${event.summary || "Evaluation complete"}`;
      
      default:
        return event.summary || "Processing...";
    }
  }

  /**
   * Infer mode from prompt content
   */
  private inferMode(prompt: string): "mechanic" | "genius" {
    const lower = prompt.toLowerCase();
    
    const mechanicKeywords = [
      "fix", "bug", "error", "debug", "patch", "hotfix",
      "typo", "broken", "crash", "issue", "problem"
    ];
    
    const geniusKeywords = [
      "add", "implement", "create", "build", "refactor",
      "feature", "new", "design", "architect", "optimize"
    ];
    
    const mechanicScore = mechanicKeywords.filter(k => lower.includes(k)).length;
    const geniusScore = geniusKeywords.filter(k => lower.includes(k)).length;
    
    return mechanicScore > geniusScore ? "mechanic" : "genius";
  }

  /**
   * Extract repo path from GitHub URL
   */
  private extractRepoPath(repoUrl: string): string {
    // https://github.com/owner/repo → /tmp/repos/owner/repo
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
    if (match) {
      return `/tmp/repos/${match[1]}/${match[2].replace(/\.git$/, "")}`;
    }
    return "/tmp/default-repo";
  }

  /**
   * Generate title from prompt
   */
  private generateTitle(prompt: string): string {
    // Take first 50 chars, cut at word boundary
    const truncated = prompt.slice(0, 50);
    const lastSpace = truncated.lastIndexOf(" ");
    return lastSpace > 30 ? truncated.slice(0, lastSpace) + "..." : truncated;
  }

  /**
   * Convert database row to Task
   */
  private rowToTask(row: any): Task {
    return {
      id: row.id,
      userId: row.user_id,
      prompt: row.prompt,
      title: row.title,
      repoUrl: row.repo_url,
      selectedAgent: row.selected_agent,
      selectedModel: row.selected_model,
      status: row.status || row.task_status,
      logs: row.logs || [],
      branchName: row.branch_name,
      sandboxId: row.sandbox_id,
      prUrl: row.pr_url,
      prNumber: row.pr_number,
      prStatus: row.pr_status,
      progress: row.progress || 0,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      jobId: row.job_id,
    };
  }

  /**
   * Convert database row to TaskWithJob
   */
  private rowToTaskWithJob(row: any): TaskWithJob {
    const task = this.rowToTask(row);
    
    return {
      ...task,
      job: row.job_id ? {
        id: row.job_id,
        traceId: row.trace_id,
        mode: row.mode || "mechanic",
        agentType: row.agent_type || "coordinator",
        goal: row.goal || task.prompt,
        status: row.job_status || "queued",
        budget: {
          stepsUsed: row.steps_used || 0,
          stepsCap: row.step_cap || 20,
          tokensUsed: row.tokens_used || 0,
          tokensCap: row.token_cap || 50000,
          costUsedCents: row.cost_used_cents || 0,
          costCapCents: row.cost_cap_cents || 500,
        },
        evaluation: row.correctness ? {
          correctness: row.correctness,
          efficiency: row.efficiency,
          honesty: row.honesty,
          safety: row.safety,
          overallScore: row.overall_score,
          flags: row.evaluation_flags || [],
          feedback: row.evaluation_feedback || "",
        } : undefined,
        tdln: row.logline_span ? {
          span: typeof row.logline_span === "string" 
            ? JSON.parse(row.logline_span) 
            : row.logline_span,
          matchedRule: row.logline_span?.name,
          confidence: 0.9,
        } : undefined,
      } : undefined,
      events: row.events || [],
    };
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const atomicAdapter = new AtomicAdapter();

