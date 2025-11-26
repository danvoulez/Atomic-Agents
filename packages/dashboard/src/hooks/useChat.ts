/**
 * useChat Hook
 * 
 * WhatsApp-style async chat with real-time updates via SSE.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  status?: "sending" | "sent" | "delivered" | "read";
  metadata?: {
    action?: string;
    jobId?: string;
    projectId?: string;
  };
}

export type ChatStatus = "idle" | "thinking" | "typing" | "working" | "queueing" | "error";

export interface ChatState {
  messages: ChatMessage[];
  status: ChatStatus;
  projectId?: string;
  projectName?: string;
  activeJobId?: string;
  queuedJobs: string[];
  error?: string;
}

export interface UseChatOptions {
  conversationId: string;
  projectId?: string;
  projectName?: string;
  repoPath?: string;
  mode?: "mechanic" | "genius";
}

export function useChat(options: UseChatOptions) {
  const { conversationId, projectId, projectName, repoPath, mode = "mechanic" } = options;

  const [state, setState] = useState<ChatState>({
    messages: [],
    status: "idle",
    queuedJobs: [],
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  // Connect to SSE stream
  useEffect(() => {
    if (!conversationId) return;

    const url = `/api/chat/stream?conversationId=${encodeURIComponent(conversationId)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerEvent(data);
      } catch (e) {
        console.error("Failed to parse SSE event:", e);
      }
    };

    eventSource.onerror = () => {
      setState(s => ({ ...s, status: "error", error: "Connection lost" }));
      // Reconnect after delay
      setTimeout(() => {
        eventSourceRef.current?.close();
        // Will reconnect via useEffect
      }, 3000);
    };

    // Load initial messages
    loadMessages();

    return () => {
      eventSource.close();
    };
  }, [conversationId]);

  // Handle server events
  const handleServerEvent = useCallback((event: any) => {
    switch (event.type) {
      case "status":
        setState(s => ({
          ...s,
          status: event.status as ChatStatus,
          activeJobId: event.jobId ?? s.activeJobId,
        }));
        break;

      case "message":
        setState(s => ({
          ...s,
          messages: [...s.messages, event.message],
          status: "idle",
        }));
        break;

      case "job_update":
        setState(s => ({
          ...s,
          activeJobId: event.activeJobId,
          queuedJobs: event.queuedJobs ?? s.queuedJobs,
        }));
        break;

      case "error":
        setState(s => ({
          ...s,
          status: "error",
          error: event.error,
        }));
        break;

      case "connected":
        setState(s => ({ ...s, status: "idle", error: undefined }));
        break;
    }
  }, []);

  // Load messages from server
  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`);
      const data = await res.json();

      if (data.messages) {
        setState(s => ({
          ...s,
          messages: data.messages,
          projectId: data.state?.projectId,
          projectName: data.state?.projectName,
          activeJobId: data.state?.activeJobId,
          queuedJobs: data.state?.queuedJobs ?? [],
        }));
      }
    } catch (e) {
      console.error("Failed to load messages:", e);
    }
  }, [conversationId]);

  // Send a message
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: tempId,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
      status: "sending",
    };

    setState(s => ({
      ...s,
      messages: [...s.messages, userMessage],
      status: "thinking",
    }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: content,
          projectId,
          projectName,
          repoPath,
          mode,
        }),
      });

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Update message with real ID
      setState(s => ({
        ...s,
        messages: s.messages.map(m =>
          m.id === tempId ? { ...m, id: data.messageId, status: "sent" as const } : m
        ),
      }));
    } catch (error: any) {
      setState(s => ({
        ...s,
        status: "error",
        error: error.message,
        messages: s.messages.map(m =>
          m.id === tempId ? { ...m, status: "sent" as const } : m
        ),
      }));
    }
  }, [conversationId, projectId, projectName, repoPath, mode]);

  // Retry failed message
  const retry = useCallback(() => {
    setState(s => ({ ...s, status: "idle", error: undefined }));
    loadMessages();
  }, [loadMessages]);

  return {
    messages: state.messages,
    status: state.status,
    error: state.error,
    projectId: state.projectId,
    projectName: state.projectName,
    activeJobId: state.activeJobId,
    queuedJobs: state.queuedJobs,
    sendMessage,
    retry,
    refresh: loadMessages,
  };
}

