"use client";

import { ComponentProps } from "react";

type AgentType = "coordinator" | "planner" | "builder" | "reviewer" | "evaluator";
type AgentStatus = "idle" | "working" | "waiting" | "complete" | "error";

interface AgentCardProps {
  agent: AgentType;
  status: AgentStatus;
  currentAction?: string;
  stepsUsed?: number;
  stepCap?: number;
}

const agentConfig: Record<AgentType, { name: string; icon: string; gradient: string }> = {
  coordinator: {
    name: "Coordinator",
    icon: "🎯",
    gradient: "var(--gradient-coordinator)",
  },
  planner: {
    name: "Planner",
    icon: "📋",
    gradient: "var(--gradient-planner)",
  },
  builder: {
    name: "Builder",
    icon: "🔨",
    gradient: "var(--gradient-builder)",
  },
  reviewer: {
    name: "Reviewer",
    icon: "🔍",
    gradient: "var(--gradient-reviewer)",
  },
  evaluator: {
    name: "Evaluator",
    icon: "📊",
    gradient: "var(--gradient-evaluator)",
  },
};

const statusStyles: Record<AgentStatus, { border: string; bg: string; text: string }> = {
  idle: {
    border: "border-[var(--border-primary)]",
    bg: "",
    text: "text-[var(--text-muted)]",
  },
  working: {
    border: "border-[var(--accent-blue)]",
    bg: "bg-[var(--accent-blue)]/10",
    text: "text-[var(--accent-blue)]",
  },
  waiting: {
    border: "border-[var(--status-warning)]",
    bg: "bg-[var(--status-warning)]/10",
    text: "text-[var(--status-warning)]",
  },
  complete: {
    border: "border-[var(--status-success)]",
    bg: "bg-[var(--status-success)]/10",
    text: "text-[var(--status-success)]",
  },
  error: {
    border: "border-[var(--status-error)]",
    bg: "bg-[var(--status-error)]/10",
    text: "text-[var(--status-error)]",
  },
};

export function AgentCard({ agent, status, currentAction, stepsUsed, stepCap }: AgentCardProps) {
  const config = agentConfig[agent];
  const style = statusStyles[status];

  return (
    <div
      className={`
        flex items-center gap-3 p-3 rounded-lg border transition-all duration-200
        ${style.border} ${style.bg}
      `}
    >
      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
        style={{ background: config.gradient }}
      >
        {config.icon}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{config.name}</span>
          <StatusBadge status={status} />
        </div>
        {currentAction && (
          <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
            {currentAction}
          </p>
        )}
      </div>

      {/* Progress */}
      {status === "working" && stepsUsed !== undefined && stepCap !== undefined && (
        <div className="flex items-center gap-2">
          <div className="text-xs text-[var(--text-muted)]">
            {stepsUsed}/{stepCap}
          </div>
          <Spinner />
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const labels: Record<AgentStatus, string> = {
    idle: "Idle",
    working: "Working",
    waiting: "Waiting",
    complete: "Done",
    error: "Error",
  };

  const styles: Record<AgentStatus, string> = {
    idle: "bg-[var(--bg-tertiary)] text-[var(--text-muted)]",
    working: "bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]",
    waiting: "bg-[var(--status-warning)]/20 text-[var(--status-warning)]",
    complete: "bg-[var(--status-success)]/20 text-[var(--status-success)]",
    error: "bg-[var(--status-error)]/20 text-[var(--status-error)]",
  };

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="w-4 h-4 animate-spin text-[var(--accent-blue)]"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export default AgentCard;

