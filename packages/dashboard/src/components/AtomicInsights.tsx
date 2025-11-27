"use client";

/**
 * AtomicInsights - Display Atomic Agents specific information
 * 
 * Shows: Mode, Agent Pipeline, Budget Usage, Quality Scores, TDLN Info
 */

import { useEffect, useState } from "react";

interface AtomicInsightsData {
  mode: string;
  agents: string[];
  budget: {
    stepsUsed: number;
    stepsMax: number;
    tokensUsed: number;
    costCents: number;
  };
  evaluation?: {
    correctness: number;
    efficiency: number;
    honesty: number;
    safety: number;
  };
  tdln?: {
    matchedRule: string;
    confidence: number;
  };
}

interface AtomicInsightsProps {
  taskId: string;
}

export default function AtomicInsights({ taskId }: AtomicInsightsProps) {
  const [data, setData] = useState<AtomicInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchInsights = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/atomic`);
        if (!res.ok) {
          if (res.status === 404) {
            setData(null);
            return;
          }
          throw new Error("Failed to fetch insights");
        }
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchInsights();
    
    // Refresh every 5 seconds
    const interval = setInterval(fetchInsights, 5000);
    return () => clearInterval(interval);
  }, [taskId]);

  if (loading) {
    return (
      <div style={styles.card}>
        <div style={styles.loading}>Loading insights...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.card}>
        <div style={styles.error}>Error: {error}</div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const budgetPercent = Math.round((data.budget.stepsUsed / data.budget.stepsMax) * 100);
  const overallScore = data.evaluation
    ? ((data.evaluation.correctness + data.evaluation.efficiency + data.evaluation.honesty + data.evaluation.safety) / 4 * 100).toFixed(0)
    : null;

  return (
    <div style={styles.card}>
      <h3 style={styles.title}>⚛️ Atomic Agents</h3>

      {/* Mode Badge */}
      <div style={styles.section}>
        <span style={styles.label}>Mode:</span>
        <span style={{
          ...styles.badge,
          backgroundColor: data.mode === "mechanic" ? "#3b82f6" : "#8b5cf6",
        }}>
          {data.mode === "mechanic" ? "🔧 Mechanic" : "🧠 Genius"}
        </span>
      </div>

      {/* Agent Pipeline */}
      <div style={styles.section}>
        <span style={styles.label}>Pipeline:</span>
        <div style={styles.pipeline}>
          {data.agents.map((agent, i) => (
            <span key={i} style={styles.pipelineItem}>
              <span style={styles.agentBadge}>{agent}</span>
              {i < data.agents.length - 1 && <span style={styles.arrow}>→</span>}
            </span>
          ))}
        </div>
      </div>

      {/* Budget Usage */}
      <div style={styles.section}>
        <span style={styles.label}>Budget:</span>
        <div style={styles.budgetContainer}>
          <div style={styles.progressBar}>
            <div 
              style={{
                ...styles.progressFill,
                width: `${budgetPercent}%`,
                backgroundColor: budgetPercent > 80 ? "#ef4444" : budgetPercent > 50 ? "#f59e0b" : "#22c55e",
              }} 
            />
          </div>
          <div style={styles.budgetStats}>
            <div style={styles.budgetItem}>
              <span style={styles.budgetLabel}>Steps</span>
              <span style={styles.budgetValue}>{data.budget.stepsUsed}/{data.budget.stepsMax}</span>
            </div>
            <div style={styles.budgetItem}>
              <span style={styles.budgetLabel}>Tokens</span>
              <span style={styles.budgetValue}>{data.budget.tokensUsed.toLocaleString()}</span>
            </div>
            <div style={styles.budgetItem}>
              <span style={styles.budgetLabel}>Cost</span>
              <span style={styles.budgetValue}>${(data.budget.costCents / 100).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quality Score */}
      {data.evaluation && (
        <div style={styles.section}>
          <span style={styles.label}>Quality:</span>
          <div style={styles.qualityContainer}>
            <div style={styles.overallScore}>
              <span style={styles.scoreValue}>{overallScore}%</span>
              <span style={styles.scoreLabel}>Overall</span>
            </div>
            <div style={styles.qualityGrid}>
              <div style={styles.qualityItem}>
                <span style={styles.qualityLabel}>✓ Correct</span>
                <span style={styles.qualityValue}>{(data.evaluation.correctness * 100).toFixed(0)}%</span>
              </div>
              <div style={styles.qualityItem}>
                <span style={styles.qualityLabel}>⚡ Efficient</span>
                <span style={styles.qualityValue}>{(data.evaluation.efficiency * 100).toFixed(0)}%</span>
              </div>
              <div style={styles.qualityItem}>
                <span style={styles.qualityLabel}>💬 Honest</span>
                <span style={styles.qualityValue}>{(data.evaluation.honesty * 100).toFixed(0)}%</span>
              </div>
              <div style={styles.qualityItem}>
                <span style={styles.qualityLabel}>🛡️ Safe</span>
                <span style={styles.qualityValue}>{(data.evaluation.safety * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TDLN Info */}
      {data.tdln && (
        <div style={styles.section}>
          <span style={styles.label}>TDLN:</span>
          <div style={styles.tdlnBox}>
            <div style={styles.tdlnRow}>
              <span style={styles.tdlnLabel}>Rule:</span>
              <span style={styles.tdlnValue}>{data.tdln.matchedRule}</span>
            </div>
            <div style={styles.tdlnRow}>
              <span style={styles.tdlnLabel}>Confidence:</span>
              <span style={styles.tdlnValue}>{(data.tdln.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: "12px",
    padding: "20px",
    border: "1px solid #2d2d44",
  },
  title: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#fff",
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  section: {
    marginBottom: "16px",
  },
  label: {
    fontSize: "12px",
    color: "#888",
    display: "block",
    marginBottom: "6px",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  badge: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: "9999px",
    fontSize: "13px",
    fontWeight: 500,
    color: "#fff",
  },
  pipeline: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "4px",
  },
  pipelineItem: {
    display: "flex",
    alignItems: "center",
  },
  agentBadge: {
    backgroundColor: "#2d2d44",
    padding: "4px 8px",
    borderRadius: "6px",
    fontSize: "12px",
    color: "#ccc",
  },
  arrow: {
    margin: "0 4px",
    color: "#666",
  },
  budgetContainer: {
    backgroundColor: "#0d0d1a",
    borderRadius: "8px",
    padding: "12px",
  },
  progressBar: {
    height: "6px",
    backgroundColor: "#2d2d44",
    borderRadius: "3px",
    overflow: "hidden",
    marginBottom: "12px",
  },
  progressFill: {
    height: "100%",
    borderRadius: "3px",
    transition: "width 0.3s ease",
  },
  budgetStats: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "8px",
  },
  budgetItem: {
    textAlign: "center" as const,
  },
  budgetLabel: {
    fontSize: "11px",
    color: "#666",
    display: "block",
  },
  budgetValue: {
    fontSize: "14px",
    fontWeight: 500,
    color: "#fff",
    fontFamily: "monospace",
  },
  qualityContainer: {
    backgroundColor: "#0d0d1a",
    borderRadius: "8px",
    padding: "12px",
  },
  overallScore: {
    textAlign: "center" as const,
    marginBottom: "12px",
    paddingBottom: "12px",
    borderBottom: "1px solid #2d2d44",
  },
  scoreValue: {
    fontSize: "32px",
    fontWeight: 700,
    color: "#22c55e",
    display: "block",
  },
  scoreLabel: {
    fontSize: "11px",
    color: "#666",
  },
  qualityGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "8px",
  },
  qualityItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  qualityLabel: {
    fontSize: "12px",
    color: "#888",
  },
  qualityValue: {
    fontSize: "13px",
    fontWeight: 500,
    color: "#fff",
    fontFamily: "monospace",
  },
  tdlnBox: {
    backgroundColor: "#0d0d1a",
    borderRadius: "8px",
    padding: "12px",
    fontFamily: "monospace",
    fontSize: "12px",
  },
  tdlnRow: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "4px",
  },
  tdlnLabel: {
    color: "#666",
  },
  tdlnValue: {
    color: "#8b5cf6",
  },
  loading: {
    color: "#888",
    textAlign: "center" as const,
    padding: "20px",
  },
  error: {
    color: "#ef4444",
    textAlign: "center" as const,
    padding: "20px",
  },
};

