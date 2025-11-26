"use client";

import { useState, useEffect } from "react";
import { Chat } from "@/components/Chat";

export default function ChatPage() {
  // Generate or retrieve conversation ID
  const [conversationId, setConversationId] = useState<string>("");

  useEffect(() => {
    // Check for existing conversation in localStorage
    let id = localStorage.getItem("conversationId");
    if (!id) {
      id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("conversationId", id);
    }
    setConversationId(id);
  }, []);

  if (!conversationId) {
    return (
      <div className="loading">
        <span>Loading...</span>
        <style jsx>{`
          .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            color: #8b949e;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <Chat conversationId={conversationId} />

      <style jsx>{`
        .chat-page {
          height: 100vh;
          background: #0d1117;
        }
      `}</style>
    </div>
  );
}
