import { useCallback, useEffect, useRef, useState } from "react";
import { api, SendMessageResponse } from "@/lib/api";
import { ActiveJob, ConversationStreamEvent, Message } from "@/types";

export function useConversation(initialConversationId?: string) {
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!conversationId) return;

    api.getMessages(conversationId).then(setMessages).catch(() => setMessages([]));
    api.getActiveJobs(conversationId).then(setActiveJobs).catch(() => setActiveJobs([]));

    const es = new EventSource(`/api/events/stream?conversationId=${conversationId}`);
    esRef.current = es;

    es.onmessage = evt => {
      try {
        const data: ConversationStreamEvent = JSON.parse(evt.data);
        if (data.type === "message" && data.message) {
          setMessages(prev => [...prev, data.message]);
        }
        if (data.type === "job_update" && data.job) {
          setActiveJobs(prev => {
            const filtered = prev.filter(j => j.id !== data.job.id);
            return data.job.status === "running" ? [...filtered, data.job] : filtered;
          });
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [conversationId]);

  const handleImmediateResponse = useCallback((result: SendMessageResponse) => {
    if (!result.immediateResponse) return;
    const assistantMessage: Message = {
      id: result.messageId ?? `assistant-${Date.now()}`,
      role: "assistant",
      content: result.immediateResponse,
      jobRefs: result.jobIds?.map(jobId => ({ jobId }))
    };
    setMessages(prev => [...prev, assistantMessage]);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      setIsProcessing(true);
      try {
        let convId = conversationId;
        if (!convId) {
          const conv = await api.createConversation();
          convId = conv.id;
          setConversationId(convId);
        }

        const userMessage: Message = {
          id: `user-${Date.now()}`,
          role: "user",
          content,
          createdAt: new Date().toISOString()
        };
        setMessages(prev => [...prev, userMessage]);

        const result = await api.sendMessage(convId!, content);
        handleImmediateResponse(result);
        return result;
      } catch (error: any) {
        setMessages(prev => [
          ...prev,
          { id: `error-${Date.now()}`, role: "assistant", content: `Error: ${error?.message ?? "Failed to send"}` }
        ]);
      } finally {
        setIsProcessing(false);
      }
    },
    [conversationId, handleImmediateResponse]
  );

  return {
    conversationId,
    messages,
    activeJobs,
    sendMessage,
    isProcessing
  };
}
