"use client";

import { useEffect, useState } from "react";

interface JobItem {
  id: string;
  goal: string;
  status: string;
  mode: string;
  created_at?: string;
}

export default function JobsList({ onSelect }: { onSelect?: (id: string) => void }) {
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Recent Jobs</h3>
        <button onClick={load} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button>
      </div>
      <ul>
        {jobs.map((j) => (
          <li key={j.id}>
            <a href="#" onClick={(e) => { e.preventDefault(); onSelect?.(j.id); }}>
              <code>{j.status}</code> • {j.goal.slice(0, 80)}{j.goal.length > 80 ? "…" : ""}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

