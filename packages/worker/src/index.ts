/**
 * Worker - Processes jobs from the queue
 *
 * Polls the database for queued jobs, claims them, and runs
 * the appropriate agent to handle them.
 */

import {
  createAgent,
  createLLMClientFromEnv,
  getToolsForAgent,
  type LLMClient,
  type AgentJob,
  type AgentResult,
} from "@ai-coding-team/agents";
import { JobRow } from "@ai-coding-team/db";
import {
  isJobCancelling,
  markJobStatus,
  requeueStaleJobs,
  setJobHeartbeat,
  getJob,
  publishJobEvent,
} from "@ai-coding-team/db";
import { claimJob } from "./claim";
import { getLogger } from "./logger";
import { setupErrorBoundary, safeExecute } from "./error-boundary";
import { 
  recordJobClaimed, 
  recordJobCompleted, 
  recordJobFailed,
  recordWorkerHeartbeat,
  startMetricsFlushing,
  stopMetricsFlushing,
} from "./metrics";

const logger = getLogger().child({ component: "worker" });

export interface WorkerOptions {
  mode: "mechanic" | "genius";
  llmClient?: LLMClient;
}

/**
 * Worker that polls for and processes jobs.
 */
export class Worker {
  private llm: LLMClient;
  private mode: "mechanic" | "genius";
  private running = false;
  private draining = false;
  private currentJobId?: string;
  private loopPromise?: Promise<void>;
  private workerId: string;

  constructor(options: WorkerOptions) {
    this.mode = options.mode;
    this.llm = options.llmClient ?? createLLMClientFromEnv();
    this.workerId = crypto.randomUUID().slice(0, 8);
    
    // Set up error boundaries
    setupErrorBoundary();
    
    // Start metrics flushing
    startMetricsFlushing();
    
    logger.info("Worker initialized", { 
      workerId: this.workerId, 
      mode: this.mode 
    });
  }

  /**
   * Handle a single job directly (useful for testing).
   */
  async handle(
    goal: string,
    jobInput?: Partial<{
      id: string;
      traceId: string;
      mode: "mechanic" | "genius";
      repoPath: string;
      agentType: string;
    }>
  ): Promise<AgentResult> {
    const agentType = jobInput?.agentType ?? "coordinator";
    const job: AgentJob = {
      id: jobInput?.id ?? crypto.randomUUID(),
      traceId: jobInput?.traceId ?? crypto.randomUUID(),
      mode: jobInput?.mode ?? this.mode,
      agentType,
      goal,
      repoPath: jobInput?.repoPath ?? process.cwd(),
      stepCap: this.mode === "mechanic" ? 20 : 100,
      tokenCap: this.mode === "mechanic" ? 50000 : 200000,
      timeLimitMs: this.mode === "mechanic" ? 60000 : 300000,
    };

    const agent = createAgent(agentType, this.llm);
    return agent.run(job, {
      shouldCancel: async () => false,
    });
  }

  /**
   * Start polling the database for queued jobs.
   */
  startLoop(
    options: {
      pollIntervalMs?: number;
      heartbeatMs?: number;
      staleAfterMs?: number;
    } = {}
  ): Promise<void> {
    if (this.running) return this.loopPromise ?? Promise.resolve();

    const pollIntervalMs = options.pollIntervalMs ?? 2000;
    const heartbeatMs = options.heartbeatMs ?? 5000;
    const staleAfterMs = options.staleAfterMs ?? 30000;

    this.running = true;
    this.draining = false;

    const loop = async () => {
      while (this.running) {
        // Requeue any stale running jobs
        await requeueStaleJobs(staleAfterMs);

        // Check if draining and no current job
        if (this.draining && !this.currentJobId) {
          this.running = false;
          break;
        }

        // Try to claim a job
        const claim = await claimJob(this.mode);
        if (!claim) {
          await sleep(pollIntervalMs);
          continue;
        }

        // Process the claimed job
        await this.processJob(claim.job, heartbeatMs);
      }
    };

    this.loopPromise = loop();
    return this.loopPromise;
  }

  /**
   * Stop accepting new jobs but finish the current one.
   */
  async drain(): Promise<void> {
    this.draining = true;
    await this.loopPromise;
    stopMetricsFlushing();
  }

  /**
   * Process a single job.
   */
  private async processJob(
    job: JobRow,
    heartbeatMs: number
  ): Promise<void> {
    this.currentJobId = job.id;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    const startTime = Date.now();
    
    const jobLogger = logger.child({ 
      jobId: job.id, 
      traceId: job.trace_id,
      mode: job.mode,
    });

    try {
      jobLogger.info("Processing job", { goal: job.goal.slice(0, 100) });
      
      // Record job claimed
      recordJobClaimed(job.id, job.mode);
      await publishJobEvent("started", job.id, { 
        workerId: this.workerId,
        mode: job.mode,
        goal: job.goal.slice(0, 100),
      });

      // Start heartbeat
      heartbeatTimer = setInterval(
        () => {
          void setJobHeartbeat(job.id);
          recordWorkerHeartbeat(this.workerId, this.mode);
        },
        heartbeatMs
      );

      // Build agent job
      const agentType = job.agent_type ?? "coordinator";
      const agentJob: AgentJob = {
        id: job.id,
        traceId: job.trace_id,
        mode: job.mode as "mechanic" | "genius",
        agentType,
        goal: job.goal,
        repoPath: job.repo_path ?? process.cwd(),
        stepCap: job.step_cap ?? 20,
        tokenCap: job.token_cap ?? 100000,
        timeLimitMs: job.mode === "mechanic" ? 60000 : 300000,
        conversationId: job.conversation_id ?? undefined,
      };

      // Create and run the appropriate agent with its tools
      const agent = createAgent(agentType, this.llm);
      const result = await agent.run(agentJob, {
        shouldCancel: () => isJobCancelling(job.id),
      });

      const durationMs = Date.now() - startTime;
      
      // Get budget from job (would be updated by agent)
      const updatedJob = await getJob(job.id);
      const stepsUsed = updatedJob?.steps_used ?? 0;
      const tokensUsed = updatedJob?.tokens_used ?? 0;

      // Update job status based on result
      if (result.success) {
        await markJobStatus(job.id, "succeeded");
        recordJobCompleted(
          job.id, 
          job.mode, 
          durationMs,
          stepsUsed,
          tokensUsed
        );
        await publishJobEvent("completed", job.id, {
          durationMs,
          stepsUsed,
          tokensUsed,
        });
        jobLogger.info("Job completed successfully", { durationMs, stepsUsed, tokensUsed });
      } else if (result.reason === "cancelled") {
        await markJobStatus(job.id, "aborted");
        await publishJobEvent("cancelled", job.id, { durationMs });
        jobLogger.info("Job cancelled", { durationMs });
      } else {
        await markJobStatus(job.id, "failed");
        recordJobFailed(job.id, job.mode, result.reason ?? "unknown");
        await publishJobEvent("failed", job.id, { 
          durationMs,
          reason: result.reason,
        });
        jobLogger.warn("Job failed", { durationMs, reason: result.reason });
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      jobLogger.error("Job error", err instanceof Error ? err : undefined, { durationMs });
      
      await markJobStatus(job.id, "failed");
      recordJobFailed(job.id, job.mode, "exception");
      await publishJobEvent("failed", job.id, { 
        durationMs,
        reason: "exception",
        error: errorMessage,
      });
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      this.currentJobId = undefined;
    }
  }

  /**
   * Shutdown the worker
   */
  async shutdown(): Promise<void> {
    logger.info("Worker shutting down", { workerId: this.workerId });
    stopMetricsFlushing();
    await this.drain();
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { claimJob } from "./claim";
