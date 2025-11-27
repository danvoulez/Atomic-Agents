"use client";

import { useEffect, useState } from "react";
import { ActiveJob } from "@/types";
import JobProgress from "./JobProgress";
import EventTimeline from "./EventTimeline";
import { useJobStream } from "@/hooks/useJobStream";

export default function JobViewer({ job, jobId }: { job?: ActiveJob; jobId?: string }) {
  const resolvedId = job?.id ?? jobId ?? null;
  const { job: liveJob, events, isConnected, isComplete, error } = useJobStream(resolvedId);

  const [current, setCurrent] = useState<ActiveJob | null>(job ?? null);

  useEffect(() => {
    if (job) setCurrent(job);
  }, [job]);

  useEffect(() => {
    if (liveJob) {
      setCurrent(prev => ({
        ...(prev || ({} as ActiveJob)),
        id: liveJob.id,
        status: liveJob.status as any,
        stepsUsed: liveJob.stepsUsed,
        tokensUsed: liveJob.tokensUsed,
        currentAction: liveJob.currentAction,
      }));
    }
  }, [liveJob]);

  if (!resolvedId) return <div>No active job selected.</div>;

  return (
    <div>
      {current ? <JobProgress job={current} /> : <div>Loading job {resolvedId}...</div>}
      <div style={{ marginTop: 16 }}>
        <EventTimeline events={events} jobId={resolvedId} />
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "#888" }}>
        {isConnected ? "Live" : "Disconnected"}{isComplete ? " • Complete" : ""}{error ? ` • ${error}` : ""}
      </div>
    </div>
  );
}
