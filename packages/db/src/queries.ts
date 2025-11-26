import { query } from "./index";
import { JobRow, EventRow } from "./schema";

export async function listJobs(): Promise<JobRow[]> {
  return query<JobRow>("select * from jobs order by created_at desc");
}

export async function listEvents(jobId: string): Promise<EventRow[]> {
  return query<EventRow>("select * from events where job_id = $1 order by created_at", [jobId]);
}
