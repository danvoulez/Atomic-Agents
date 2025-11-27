"use client";

/**
 * CreateTaskDialog - Modal for creating new tasks
 * Modern UI inspired by Vercel Template
 */

import { useState } from "react";

interface CreateTaskDialogProps {
  userId: string;
  onClose: () => void;
  onCreated: (taskId: string) => void;
}

export default function CreateTaskDialog({ 
  userId, 
  onClose, 
  onCreated 
}: CreateTaskDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("coordinator");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = [
    { id: "coordinator", name: "🎯 Coordinator", desc: "Orchestrates the full pipeline" },
    { id: "planner", name: "📋 Planner", desc: "Creates detailed implementation plans" },
    { id: "builder", name: "🔨 Builder", desc: "Writes and modifies code" },
    { id: "reviewer", name: "🔍 Reviewer", desc: "Reviews code for quality" },
    { id: "evaluator", name: "⚖️ Evaluator", desc: "Evaluates correctness and safety" },
    { id: "watcher", name: "👁️ Watcher", desc: "Monitors for patterns" },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          prompt,
          repoUrl: repoUrl || undefined,
          selectedAgent,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create task");
      }

      onCreated(data.taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // Infer mode from prompt
  const inferredMode = prompt.toLowerCase().match(/fix|bug|error|debug/)
    ? "mechanic"
    : "genius";

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Create New Task</h2>
          <button style={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Prompt */}
          <div style={styles.field}>
            <label style={styles.label}>What do you want to do?</label>
            <textarea
              style={styles.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Fix the authentication bug in login.ts"
              rows={3}
              required
              autoFocus
            />
            {prompt && (
              <div style={styles.modeHint}>
                <span 
                  style={{ 
                    ...styles.modeBadge,
                    backgroundColor: inferredMode === "mechanic" ? "#3b82f6" : "#8b5cf6",
                  }}
                >
                  {inferredMode === "mechanic" ? "🔧 Mechanic Mode" : "🧠 Genius Mode"}
                </span>
              </div>
            )}
          </div>

          {/* Repo URL */}
          <div style={styles.field}>
            <label style={styles.label}>Repository URL (optional)</label>
            <input
              style={styles.input}
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
            />
          </div>

          {/* Agent Selection */}
          <div style={styles.field}>
            <label style={styles.label}>Agent</label>
            <div style={styles.agentGrid}>
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  style={{
                    ...styles.agentOption,
                    borderColor: selectedAgent === agent.id ? "#8b5cf6" : "#2d2d44",
                    backgroundColor: selectedAgent === agent.id ? "#1a1a3e" : "transparent",
                  }}
                  onClick={() => setSelectedAgent(agent.id)}
                >
                  <div style={styles.agentName}>{agent.name}</div>
                  <div style={styles.agentDesc}>{agent.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={styles.error}>{error}</div>
          )}

          {/* Actions */}
          <div style={styles.actions}>
            <button 
              type="button" 
              style={styles.cancelButton}
              onClick={onClose}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              style={styles.submitButton}
              disabled={loading || !prompt.trim()}
            >
              {loading ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  dialog: {
    backgroundColor: "#1a1a2e",
    borderRadius: "16px",
    width: "100%",
    maxWidth: "560px",
    maxHeight: "90vh",
    overflow: "auto",
    border: "1px solid #2d2d44",
  },
  header: {
    padding: "20px 24px",
    borderBottom: "1px solid #2d2d44",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: "18px",
    fontWeight: 600,
    color: "#fff",
    margin: 0,
  },
  closeButton: {
    backgroundColor: "transparent",
    border: "none",
    color: "#888",
    fontSize: "18px",
    cursor: "pointer",
    padding: "4px",
  },
  field: {
    padding: "0 24px",
    marginTop: "20px",
  },
  label: {
    display: "block",
    fontSize: "13px",
    fontWeight: 500,
    color: "#ccc",
    marginBottom: "8px",
  },
  textarea: {
    width: "100%",
    backgroundColor: "#0d0d1a",
    border: "1px solid #2d2d44",
    borderRadius: "8px",
    padding: "12px",
    fontSize: "14px",
    color: "#fff",
    resize: "vertical",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  input: {
    width: "100%",
    backgroundColor: "#0d0d1a",
    border: "1px solid #2d2d44",
    borderRadius: "8px",
    padding: "12px",
    fontSize: "14px",
    color: "#fff",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  modeHint: {
    marginTop: "8px",
  },
  modeBadge: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: "9999px",
    fontSize: "12px",
    color: "#fff",
  },
  agentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "8px",
  },
  agentOption: {
    padding: "12px",
    borderRadius: "8px",
    border: "1px solid #2d2d44",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  agentName: {
    fontSize: "13px",
    fontWeight: 500,
    color: "#fff",
    marginBottom: "2px",
  },
  agentDesc: {
    fontSize: "11px",
    color: "#888",
  },
  error: {
    margin: "16px 24px 0",
    padding: "12px",
    backgroundColor: "#2d1f1f",
    borderRadius: "8px",
    color: "#ef4444",
    fontSize: "13px",
  },
  actions: {
    padding: "24px",
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
    borderTop: "1px solid #2d2d44",
    marginTop: "24px",
  },
  cancelButton: {
    backgroundColor: "transparent",
    color: "#888",
    border: "1px solid #2d2d44",
    borderRadius: "8px",
    padding: "10px 20px",
    fontSize: "14px",
    cursor: "pointer",
  },
  submitButton: {
    backgroundColor: "#8b5cf6",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
  },
};

