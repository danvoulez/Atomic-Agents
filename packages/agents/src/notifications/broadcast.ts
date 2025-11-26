/**
 * Notification Broadcast System
 * 
 * All important events flow through the same TDLN-OUT channel as chat.
 * The conversation page becomes a unified notification board.
 * 
 * Events that trigger notifications:
 * - Project lifecycle (complete, paused, deleted, resumed)
 * - Insights from the Wise Observer
 * - Job milestones (started, completed, failed)
 * - Budget alerts
 * - Escalations requiring attention
 * - System announcements
 */

import { appendMessageToLedger, appendToLedger } from "@ai-coding-team/db";

// ============================================================================
// NOTIFICATION SCHEMA (JSON format all agents use)
// ============================================================================

/**
 * Standard notification format - all agents write in this schema
 */
export interface Notification {
  // Identity
  id: string;
  timestamp: string;
  
  // Classification
  type: NotificationType;
  severity: "info" | "success" | "warning" | "critical";
  
  // Context
  projectId?: string;
  projectName?: string;
  jobId?: string;
  conversationId?: string;
  
  // Content
  title: string;
  message: string;
  details?: Record<string, unknown>;
  
  // Actions
  actions?: NotificationAction[];
  
  // Source
  source: {
    agent: string;           // "coordinator" | "planner" | "builder" | "insights_watcher" | "system"
    component?: string;      // More specific source
  };
}

export type NotificationType =
  // Project lifecycle
  | "project_created"
  | "project_completed"
  | "project_paused"
  | "project_resumed"
  | "project_deleted"
  
  // Job lifecycle
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "job_cancelled"
  
  // Wise Observer
  | "insight_discovered"
  | "pattern_detected"
  | "rule_proposed"
  | "project_notes"
  
  // Alerts
  | "budget_warning"
  | "budget_exceeded"
  | "escalation_required"
  | "error_spike"
  
  // System
  | "system_announcement"
  | "maintenance_scheduled"
  | "feature_released";

export interface NotificationAction {
  label: string;
  action: string;            // "view_job" | "approve_rule" | "dismiss" | etc.
  params?: Record<string, unknown>;
}

// ============================================================================
// TDLN-OUT TEMPLATES (render notifications as natural language)
// ============================================================================

const notificationTemplates: Record<NotificationType, (n: Notification) => string> = {
  // Project lifecycle
  project_created: (n) => `📁 New project started: **${n.projectName || n.projectId}**`,
  project_completed: (n) => `✅ Project completed: **${n.projectName || n.projectId}**\n${n.message}`,
  project_paused: (n) => `⏸️ Project paused: **${n.projectName || n.projectId}**`,
  project_resumed: (n) => `▶️ Project resumed: **${n.projectName || n.projectId}**`,
  project_deleted: (n) => `🗑️ Project archived: **${n.projectName || n.projectId}**`,
  
  // Job lifecycle
  job_started: (n) => `🚀 Started working on: ${n.message}`,
  job_completed: (n) => `✅ Completed: ${n.message}`,
  job_failed: (n) => `❌ Failed: ${n.message}\n${n.details?.error || ""}`,
  job_cancelled: (n) => `🛑 Cancelled: ${n.message}`,
  
  // Wise Observer
  insight_discovered: (n) => `🦉 **Insight**: ${n.title}\n\n${n.message}`,
  pattern_detected: (n) => `🔍 **Pattern detected**: ${n.title}\n\n${n.message}`,
  rule_proposed: (n) => `📋 **Proposed rule**: ${n.title}\n\n${n.message}\n\n_Awaiting approval_`,
  project_notes: (n) => `📝 **Project notes** for ${n.projectName || n.projectId}:\n\n${n.message}`,
  
  // Alerts
  budget_warning: (n) => `⚠️ **Budget warning**: ${n.message}`,
  budget_exceeded: (n) => `🚨 **Budget exceeded**: ${n.message}`,
  escalation_required: (n) => `🙋 **Needs your attention**: ${n.message}`,
  error_spike: (n) => `⚠️ **Error spike detected**: ${n.message}`,
  
  // System
  system_announcement: (n) => `📢 ${n.message}`,
  maintenance_scheduled: (n) => `🔧 Maintenance scheduled: ${n.message}`,
  feature_released: (n) => `✨ New feature: ${n.message}`,
};

// ============================================================================
// BROADCAST FUNCTIONS
// ============================================================================

/**
 * Broadcast a notification to a conversation (appears in chat)
 */
export async function broadcastNotification(
  notification: Omit<Notification, "id" | "timestamp">,
  targetConversationId: string
): Promise<void> {
  const fullNotification: Notification = {
    ...notification,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    conversationId: targetConversationId,
  };

  // Render to natural language using TDLN-OUT template
  const template = notificationTemplates[notification.type];
  const renderedMessage = template 
    ? template(fullNotification)
    : `[${notification.type}] ${notification.title}: ${notification.message}`;

  // Write to ledger as a system message
  await appendMessageToLedger(
    targetConversationId,
    "assistant",  // Appears as assistant message
    renderedMessage,
    notification.projectId
  );

  // Also store the structured notification
  await appendToLedger({
    kind: "event",
    conversation_id: targetConversationId,
    project_id: notification.projectId,
    job_id: notification.jobId,
    actor_type: "system",
    actor_id: notification.source.agent,
    summary: `Notification: ${notification.type}`,
    data: {
      notification: fullNotification,
      rendered_message: renderedMessage,
    },
  });
}

/**
 * Broadcast to all active conversations for a project
 */
export async function broadcastToProject(
  notification: Omit<Notification, "id" | "timestamp">,
  projectId: string,
  activeConversationIds: string[]
): Promise<void> {
  const notificationWithProject = {
    ...notification,
    projectId,
  };

  for (const conversationId of activeConversationIds) {
    await broadcastNotification(notificationWithProject, conversationId);
  }
}

/**
 * Broadcast to all conversations (global announcement)
 */
export async function broadcastGlobal(
  notification: Omit<Notification, "id" | "timestamp">,
  allConversationIds: string[]
): Promise<void> {
  for (const conversationId of allConversationIds) {
    await broadcastNotification(notification, conversationId);
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS (for common notifications)
// ============================================================================

export function createProjectNotification(
  type: "project_created" | "project_completed" | "project_paused" | "project_resumed" | "project_deleted",
  projectId: string,
  projectName?: string,
  details?: Record<string, unknown>
): Omit<Notification, "id" | "timestamp"> {
  const messages: Record<string, string> = {
    project_created: "Let's get started!",
    project_completed: details?.summary as string || "All tasks completed successfully.",
    project_paused: "Work has been paused. Resume when ready.",
    project_resumed: "Continuing where we left off.",
    project_deleted: "Project has been archived.",
  };

  return {
    type,
    severity: type === "project_completed" ? "success" : "info",
    projectId,
    projectName,
    title: `Project ${type.replace("project_", "")}`,
    message: messages[type],
    details,
    source: { agent: "system", component: "project_lifecycle" },
  };
}

export function createJobNotification(
  type: "job_started" | "job_completed" | "job_failed" | "job_cancelled",
  jobId: string,
  goal: string,
  details?: Record<string, unknown>
): Omit<Notification, "id" | "timestamp"> {
  const severities: Record<string, "info" | "success" | "warning" | "critical"> = {
    job_started: "info",
    job_completed: "success",
    job_failed: "warning",
    job_cancelled: "info",
  };

  return {
    type,
    severity: severities[type],
    jobId,
    title: goal.slice(0, 50),
    message: goal,
    details,
    source: { agent: "coordinator", component: "job_manager" },
  };
}

export function createInsightNotification(
  insight: {
    title: string;
    description: string;
    severity: "info" | "warning" | "critical";
    category: string;
    recommendation: string;
    shouldBecomeGlobalRule: boolean;
  },
  projectId?: string
): Omit<Notification, "id" | "timestamp"> {
  const type: NotificationType = insight.shouldBecomeGlobalRule 
    ? "rule_proposed" 
    : "insight_discovered";

  return {
    type,
    severity: insight.severity,
    projectId,
    title: insight.title,
    message: `${insight.description}\n\n**Recommendation**: ${insight.recommendation}`,
    details: {
      category: insight.category,
      shouldBecomeGlobalRule: insight.shouldBecomeGlobalRule,
    },
    source: { agent: "insights_watcher", component: "pattern_detector" },
    actions: insight.shouldBecomeGlobalRule ? [
      { label: "Approve Rule", action: "approve_rule" },
      { label: "Dismiss", action: "dismiss" },
    ] : undefined,
  };
}

export function createBudgetNotification(
  type: "budget_warning" | "budget_exceeded",
  projectId: string,
  details: { used: number; cap: number; percentage: number }
): Omit<Notification, "id" | "timestamp"> {
  return {
    type,
    severity: type === "budget_exceeded" ? "critical" : "warning",
    projectId,
    title: type === "budget_exceeded" ? "Budget Exceeded" : "Budget Warning",
    message: `${details.percentage}% of budget used (${details.used}¢ of ${details.cap}¢)`,
    details,
    source: { agent: "system", component: "budget_monitor" },
    actions: [
      { label: "Increase Budget", action: "increase_budget" },
      { label: "Pause Project", action: "pause_project" },
    ],
  };
}

export function createProjectNotesNotification(
  projectId: string,
  projectName: string | undefined,
  notes: {
    whatWorkedWell: string[];
    whatCouldImprove: string[];
  }
): Omit<Notification, "id" | "timestamp"> {
  const message = [
    notes.whatWorkedWell.length > 0 
      ? `**What worked well:**\n${notes.whatWorkedWell.map(w => `• ${w}`).join("\n")}`
      : null,
    notes.whatCouldImprove.length > 0 
      ? `**What could improve:**\n${notes.whatCouldImprove.map(w => `• ${w}`).join("\n")}`
      : null,
  ].filter(Boolean).join("\n\n");

  return {
    type: "project_notes",
    severity: "info",
    projectId,
    projectName,
    title: `Project Notes: ${projectName || projectId}`,
    message: message || "No notable observations.",
    source: { agent: "insights_watcher", component: "project_notes" },
  };
}

