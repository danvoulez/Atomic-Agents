import { claimNextJob, isJobCancelling, markJobStatus, JobRow } from "@ai-coding-team/db";

export interface ClaimResult {
  job: JobRow;
  claimed: boolean;
}

/**
 * Claim a job using Postgres row-level locking (FOR UPDATE SKIP LOCKED).
 * If a job is already marked as cancelling, it is skipped and marked aborted.
 */
export async function claimJob(mode: string): Promise<ClaimResult | null> {
  const job = await claimNextJob(mode);
  if (!job) return null;

  if (await isJobCancelling(job.id)) {
    await markJobStatus(job.id, "aborted");
    return null;
  }

  return { job, claimed: true };
}
