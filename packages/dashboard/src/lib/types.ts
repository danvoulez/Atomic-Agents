export interface Task {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  repo: string;
  createdAt: string; // ISO 8601
  agent?: string;
  budget?: {
    stepsUsed: number;
    stepsMax: number;
  };
}

export interface Job {
  id: string;
  mode: 'mechanic' | 'genius';
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  worker: string;
  budget: {
    steps: { used: number; max: number; percent: number };
    tokens: { used: number; max: number; percent: number };
    costCents: number;
  };
  evaluation: {
    correctness: number;
    efficiency: number;
    honesty: number;
    safety: number;
    flags: string[];
  };
}

export interface JobEvent {
  id: string;
  timestamp: string;
  kind: 'info' | 'tool_call' | 'decision' | 'error';
  summary: string;
  toolName?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// Helper to map DB status to UI status
export function mapStatus(dbStatus: string): Task['status'] {
  if (dbStatus === 'queued') return 'pending';
  if (dbStatus === 'succeeded') return 'completed';
  if (dbStatus === 'aborted') return 'failed';
  return dbStatus as Task['status'];
}
