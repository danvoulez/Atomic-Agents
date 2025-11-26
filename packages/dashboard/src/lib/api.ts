import { ActiveJob, Conversation, Message } from "@/types";

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

function apiUrl(path: string) {
  return `${baseUrl}${path}`;
}

export interface SendMessageResponse {
  messageId?: string;
  immediateResponse?: string;
  jobIds?: string[];
}

export const api = {
  async createConversation(): Promise<Conversation> {
    // In this scaffold we create a client-side ID. A production version would persist via the coordinator.
    return { id: crypto.randomUUID() };
  },

  async getMessages(conversationId: string): Promise<Message[]> {
    const res = await fetch(apiUrl(`/api/messages?conversationId=${conversationId}`), { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.messages as Message[]) ?? [];
  },

  async getActiveJobs(conversationId: string): Promise<ActiveJob[]> {
    const res = await fetch(apiUrl(`/api/jobs?conversationId=${conversationId}`), { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.jobs as ActiveJob[]) ?? [];
  },

  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    const res = await fetch(apiUrl("/api/messages"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, content })
    });
    if (!res.ok) throw new Error(`Failed to send message (${res.status})`);
    return (await res.json()) as SendMessageResponse;
  }
};
