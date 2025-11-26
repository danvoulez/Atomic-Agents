import { useEffect, useState } from "react";

export function useJob(jobId?: string) {
  const [status, setStatus] = useState("queued");
  useEffect(() => {
    if (jobId) setStatus("running");
  }, [jobId]);
  return { status };
}
