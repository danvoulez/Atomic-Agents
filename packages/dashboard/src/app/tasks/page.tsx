"use client";

/**
 * Tasks Page - Fusion Dashboard
 * 
 * Combines Vercel Template UI with Atomic Agents backend
 */

import { useState } from "react";
import TaskSidebar from "../../components/TaskSidebar";
import TaskLogs from "../../components/TaskLogs";
import AtomicInsights from "../../components/AtomicInsights";
import CreateTaskDialog from "../../components/CreateTaskDialog";

// Placeholder user ID - would come from auth in production
const DEMO_USER_ID = "demo-user-123";

export default function TasksPage() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleTaskCreated = (taskId: string) => {
    setSelectedTaskId(taskId);
    setShowCreateDialog(false);
  };

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <TaskSidebar
        userId={DEMO_USER_ID}
        selectedTaskId={selectedTaskId || undefined}
        onSelectTask={setSelectedTaskId}
        onNewTask={() => setShowCreateDialog(true)}
      />

      {/* Main Content */}
      <div style={styles.main}>
        {selectedTaskId ? (
          <div style={styles.content}>
            {/* Header */}
            <div style={styles.header}>
              <h1 style={styles.title}>Task Details</h1>
              <div style={styles.actions}>
                <button style={styles.actionButton}>
                  📁 Files
                </button>
                <button style={styles.actionButton}>
                  🔀 Create PR
                </button>
              </div>
            </div>

            {/* Two column layout */}
            <div style={styles.columns}>
              {/* Left: Logs */}
              <div style={styles.leftColumn}>
                <TaskLogs taskId={selectedTaskId} />
                
                {/* File Changes placeholder */}
                <div style={styles.fileChanges}>
                  <h3 style={styles.sectionTitle}>📁 File Changes</h3>
                  <p style={styles.placeholder}>
                    File changes will appear here when the task modifies code.
                  </p>
                </div>
              </div>

              {/* Right: Atomic Insights */}
              <div style={styles.rightColumn}>
                <AtomicInsights taskId={selectedTaskId} />
              </div>
            </div>
          </div>
        ) : (
          <div style={styles.empty}>
            <div style={styles.emptyContent}>
              <h2 style={styles.emptyTitle}>⚛️ Atomic Agents</h2>
              <p style={styles.emptyText}>
                Select a task from the sidebar or create a new one to get started.
              </p>
              <button 
                style={styles.createButton}
                onClick={() => setShowCreateDialog(true)}
              >
                + Create New Task
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Task Dialog */}
      {showCreateDialog && (
        <CreateTaskDialog
          userId={DEMO_USER_ID}
          onClose={() => setShowCreateDialog(false)}
          onCreated={handleTaskCreated}
        />
      )}
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    height: "100vh",
    backgroundColor: "#0d0d1a",
    color: "#fff",
  },
  main: {
    flex: 1,
    overflow: "auto",
  },
  content: {
    padding: "24px",
    maxWidth: "1400px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "24px",
  },
  title: {
    fontSize: "24px",
    fontWeight: 600,
    margin: 0,
  },
  actions: {
    display: "flex",
    gap: "8px",
  },
  actionButton: {
    backgroundColor: "#2d2d44",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "8px 16px",
    fontSize: "13px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 320px",
    gap: "24px",
  },
  leftColumn: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  rightColumn: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  fileChanges: {
    backgroundColor: "#1a1a2e",
    borderRadius: "12px",
    padding: "20px",
    border: "1px solid #2d2d44",
  },
  sectionTitle: {
    fontSize: "14px",
    fontWeight: 600,
    marginBottom: "12px",
    margin: "0 0 12px 0",
  },
  placeholder: {
    color: "#666",
    fontSize: "13px",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    minHeight: "400px",
  },
  emptyContent: {
    textAlign: "center" as const,
    maxWidth: "400px",
  },
  emptyTitle: {
    fontSize: "28px",
    marginBottom: "12px",
  },
  emptyText: {
    color: "#888",
    marginBottom: "24px",
    lineHeight: 1.6,
  },
  createButton: {
    backgroundColor: "#8b5cf6",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "12px 24px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
  },
};

