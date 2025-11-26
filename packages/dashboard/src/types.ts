export type Role = "user" | "assistant" | "system";

export interface JobRef {
  jobId: string;
  status?: string;
}

export interface Citation {
  source: string;
  label?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt?: string;
  jobRefs?: JobRef[];
  citations?: Citation[];
}

export interface ActiveJob {
  id: string;
  status: "queued" | "running" | "waiting_human" | "succeeded" | "failed" | "aborted" | "cancelling";
  stepCap?: number;
  stepsUsed?: number;
  startedAt?: string;
  currentAction?: string;
}

export interface Conversation {
  id: string;
}

export type ConversationStreamEvent =
  | { type: "message"; message: Message }
  | { type: "job_update"; job: ActiveJob }
  | { type: "heartbeat"; ts: number };
