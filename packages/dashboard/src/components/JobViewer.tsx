import { ActiveJob } from "@/types";
import JobProgress from "./JobProgress";
import EventTimeline from "./EventTimeline";

export default function JobViewer({ job, jobId }: { job?: ActiveJob; jobId?: string }) {
  const resolvedId = job?.id ?? jobId;
  return (
    <div>
      {job ? <JobProgress job={job} /> : <div>{resolvedId ? `Job ${resolvedId}` : "No active job selected."}</div>}
      <EventTimeline events={[]} jobId={resolvedId} />
    </div>
  );
}
