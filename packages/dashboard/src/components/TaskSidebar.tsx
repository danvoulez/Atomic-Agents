"use client";

/**
 * TaskSidebar - List of tasks with status indicators
 * Inspired by Vercel Template UI
 */

import { useEffect, useState } from "react";
import type { Task } from "../lib/atomic-adapter";

interface TaskSidebarProps {
  userId: string;
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
}

export default function TaskSidebar({ 
  userId, 
  selectedTaskId, 
  onSelectTask, 
  onNewTask 
}: TaskSidebarProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch(`/api/tasks?userId=${userId}`);
        const data = await res.json();
        setTasks(data.tasks || []);
      } catch (error) {
        console.error("Error fetching tasks:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, [userId]);

  const getStatusIcon = (status: Task["status"]) => {
    switch (status) {
      case "completed":
        return "✓";
      case "processing":
        return "○";
      case "error":
        return "✗";
      case "stopped":
        return "⊘";
      default:
        return "◌";
    }
  };

  const getStatusColor = (status: Task["status"]) => {
    switch (status) {
      case "completed":
        return "#22c55e";
      case "processing":
        return "#3b82f6";
      case "error":
        return "#ef4444";
      case "stopped":
        return "#f59e0b";
      default:
        return "#666";
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>
        <h2 style={styles.title}>Tasks</h2>
        <button style={styles.newButton} onClick={onNewTask}>
          + New
        </button>
      </div>

      <div style={styles.taskList}>
        {loading ? (
          <div style={styles.loading}>Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div style={styles.empty}>
            <p>No tasks yet</p>
            <button style={styles.createButton} onClick={onNewTask}>
              Create your first task
            </button>
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              style={{
                ...styles.taskItem,
                backgroundColor: task.id === selectedTaskId ? "#2d2d44" : "transparent",
                borderLeft: task.id === selectedTaskId ? "2px solid #8b5cf6" : "2px solid transparent",
              }}
              onClick={() => onSelectTask(task.id)}
            >
              <div style={styles.taskHeader}>
                <span 
                  style={{ 
                    ...styles.statusIcon, 
                    color: getStatusColor(task.status) 
                  }}
                >
                  {getStatusIcon(task.status)}
                </span>
                <span style={styles.taskTitle}>
                  {task.title || task.prompt.slice(0, 30) + "..."}
                </span>
              </div>
              <div style={styles.taskMeta}>
                <span style={styles.taskTime}>{formatTime(task.createdAt)}</span>
                {task.progress > 0 && task.status === "processing" && (
                  <span style={styles.taskProgress}>{task.progress}%</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: "280px",
    height: "100vh",
    backgroundColor: "#1a1a2e",
    borderRight: "1px solid #2d2d44",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    padding: "16px",
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
  newButton: {
    backgroundColor: "#8b5cf6",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
  },
  taskList: {
    flex: 1,
    overflow: "auto",
    padding: "8px 0",
  },
  taskItem: {
    padding: "12px 16px",
    cursor: "pointer",
    transition: "background-color 0.15s ease",
  },
  taskHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
  },
  statusIcon: {
    fontSize: "12px",
    marginTop: "2px",
  },
  taskTitle: {
    fontSize: "13px",
    color: "#e0e0e0",
    lineHeight: 1.4,
    flex: 1,
  },
  taskMeta: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "6px",
    paddingLeft: "20px",
  },
  taskTime: {
    fontSize: "11px",
    color: "#666",
  },
  taskProgress: {
    fontSize: "11px",
    color: "#8b5cf6",
    fontWeight: 500,
  },
  loading: {
    padding: "20px",
    textAlign: "center" as const,
    color: "#666",
    fontSize: "13px",
  },
  empty: {
    padding: "40px 20px",
    textAlign: "center" as const,
    color: "#666",
  },
  createButton: {
    marginTop: "12px",
    backgroundColor: "transparent",
    color: "#8b5cf6",
    border: "1px solid #8b5cf6",
    borderRadius: "6px",
    padding: "8px 16px",
    fontSize: "13px",
    cursor: "pointer",
  },
};

