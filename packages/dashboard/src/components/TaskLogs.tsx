"use client";

/**
 * TaskLogs - Real-time log display with SSE streaming
 * Shows formatted events from Atomic Agents pipeline
 */

import { useEffect, useState, useRef } from "react";
import type { LogEntry } from "../lib/atomic-adapter";

interface TaskLogsProps {
  taskId: string;
  streaming?: boolean;
}

export default function TaskLogs({ taskId, streaming = true }: TaskLogsProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Fetch initial logs
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        const data = await res.json();
        if (data.task?.logs) {
          setLogs(data.task.logs);
        }
      } catch (err) {
        console.error("Error fetching logs:", err);
      }
    };
    
    fetchLogs();
  }, [taskId]);

  // SSE streaming
  useEffect(() => {
    if (!streaming) return;

    const eventSource = new EventSource(`/api/tasks/${taskId}/stream`);

    eventSource.onopen = () => {
      setConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        
        // Skip ping/done messages
        if (log.type === "ping" || log.type === "done") {
          return;
        }

        setLogs((prev) => [...prev, log]);
      } catch (err) {
        console.error("Error parsing SSE message:", err);
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
      setError("Connection lost. Retrying...");
    };

    return () => {
      eventSource.close();
    };
  }, [taskId, streaming]);

  const getLogColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "command":
        return "#3b82f6";
      case "success":
        return "#22c55e";
      case "error":
        return "#ef4444";
      case "warning":
        return "#f59e0b";
      default:
        return "#888";
    }
  };

  const getLogIcon = (type: LogEntry["type"]) => {
    switch (type) {
      case "command":
        return "▶";
      case "success":
        return "✓";
      case "error":
        return "✗";
      case "warning":
        return "⚠";
      default:
        return "•";
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>📝 Real-time Logs</h3>
        <div style={styles.status}>
          <span 
            style={{
              ...styles.statusDot,
              backgroundColor: connected ? "#22c55e" : "#666",
            }}
          />
          <span style={styles.statusText}>
            {connected ? "Live" : "Connecting..."}
          </span>
        </div>
      </div>

      {error && (
        <div style={styles.error}>{error}</div>
      )}

      <div style={styles.logsContainer}>
        {logs.length === 0 ? (
          <div style={styles.empty}>
            Waiting for events...
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={styles.logEntry}>
              <span style={styles.timestamp}>
                {formatTimestamp(log.timestamp)}
              </span>
              <span 
                style={{ 
                  ...styles.icon, 
                  color: getLogColor(log.type) 
                }}
              >
                {getLogIcon(log.type)}
              </span>
              <span 
                style={{ 
                  ...styles.message,
                  color: getLogColor(log.type),
                }}
              >
                {log.message}
              </span>
              {log.data?.tokensUsed && (
                <span style={styles.tokens}>
                  {log.data.tokensUsed} tokens
                </span>
              )}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: "#0d0d1a",
    borderRadius: "12px",
    border: "1px solid #2d2d44",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    padding: "12px 16px",
    backgroundColor: "#1a1a2e",
    borderBottom: "1px solid #2d2d44",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#fff",
    margin: 0,
  },
  status: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
  },
  statusText: {
    fontSize: "12px",
    color: "#888",
  },
  error: {
    padding: "8px 16px",
    backgroundColor: "#2d1f1f",
    color: "#ef4444",
    fontSize: "12px",
  },
  logsContainer: {
    flex: 1,
    overflow: "auto",
    padding: "12px 16px",
    fontFamily: "monospace",
    fontSize: "13px",
    lineHeight: 1.6,
    maxHeight: "400px",
  },
  empty: {
    color: "#666",
    textAlign: "center" as const,
    padding: "40px 0",
  },
  logEntry: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    marginBottom: "4px",
  },
  timestamp: {
    color: "#444",
    fontSize: "11px",
    flexShrink: 0,
  },
  icon: {
    fontSize: "12px",
    flexShrink: 0,
    marginTop: "2px",
  },
  message: {
    flex: 1,
    wordBreak: "break-word" as const,
  },
  tokens: {
    fontSize: "10px",
    color: "#666",
    backgroundColor: "#1a1a2e",
    padding: "2px 6px",
    borderRadius: "4px",
    flexShrink: 0,
  },
};

