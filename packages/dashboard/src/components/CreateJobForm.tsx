"use client";

import { useState } from "react";

export default function CreateJobForm({ onCreated }: { onCreated?: (id: string) => void }) {
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<"mechanic" | "genius">("mechanic");
  const [agentType, setAgentType] = useState("coordinator");
  const [repoPath, setRepoPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal, mode, agentType, repoPath }),
      });
      const { job, error } = await res.json();
      if (!res.ok) throw new Error(error || "Failed to create job");
      onCreated?.(job.id);
      setGoal("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
      <label>
        Goal
        <textarea value={goal} onChange={e => setGoal(e.target.value)} required rows={3} />
      </label>
      <label>
        Mode
        <select value={mode} onChange={e => setMode(e.target.value as any)}>
          <option value="mechanic">mechanic</option>
          <option value="genius">genius</option>
        </select>
      </label>
      <label>
        Agent Type
        <select value={agentType} onChange={e => setAgentType(e.target.value)}>
          <option value="coordinator">coordinator</option>
          <option value="planner">planner</option>
          <option value="builder">builder</option>
          <option value="reviewer">reviewer</option>
        </select>
      </label>
      <label>
        Repo Path (optional)
        <input value={repoPath} onChange={e => setRepoPath(e.target.value)} placeholder="/path/to/repo" />
      </label>
      <button type="submit" disabled={creating}>{creating ? "Creating…" : "Create Job"}</button>
      {error && <div style={{ color: "tomato" }}>{error}</div>}
    </form>
  );
}

