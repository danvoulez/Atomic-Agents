"use client";

import { useEffect, useState, useCallback } from "react";

export interface JobUpdate {
  id: string;
  status: string;
  stepsUsed: number;
  tokensUsed: number;
  currentAction?: string;
}

export interface JobEvent {
  id: string;
  kind: string;
  toolName?: string;
  summary?: string;
  createdAt: string;
}

interface UseJobStreamResult {
  job: JobUpdate | null;
  events: JobEvent[];
  isConnected: boolean;
  isComplete: boolean;
  error: string | null;
}

export function useJobStream(jobId: string | null): UseJobStreamResult {
  const [job, setJob] = useState<JobUpdate | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let eventSource: EventSource | null = null;

    const connect = () => {
      eventSource = new EventSource(`/api/jobs/${jobId}/stream`);

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      eventSource.onerror = (e) => {
        setIsConnected(false);
        setError("Connection lost. Retrying...");
      };

      eventSource.addEventListener("job", (e) => {
        const data = JSON.parse(e.data);
        setJob(data);
      });

      eventSource.addEventListener("event", (e) => {
        const data = JSON.parse(e.data);
        setEvents((prev) => {
          // Avoid duplicates
          if (prev.some((ev) => ev.id === data.id)) {
            return prev;
          }
          return [...prev, data];
        });
      });

      eventSource.addEventListener("complete", (e) => {
        setIsComplete(true);
        eventSource?.close();
      });
    };

    connect();

    return () => {
      eventSource?.close();
    };
  }, [jobId]);

  return { job, events, isConnected, isComplete, error };
}

