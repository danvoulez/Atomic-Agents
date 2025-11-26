"use client";

import { useState, useRef, useEffect } from "react";
import { useChat, ChatMessage, ChatStatus } from "@/hooks/useChat";

interface ChatProps {
  conversationId: string;
  projectId?: string;
  projectName?: string;
}

export function Chat({ conversationId, projectId, projectName }: ChatProps) {
  const {
    messages,
    status,
    error,
    activeJobId,
    queuedJobs,
    sendMessage,
    retry,
  } = useChat({
    conversationId,
    projectId,
    projectName,
  });

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && status !== "thinking" && status !== "typing") {
      sendMessage(input);
      setInput("");
    }
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-title">
          <span className="chat-name">{projectName || "AI Assistant"}</span>
          <StatusIndicator status={status} />
        </div>
        {(activeJobId || queuedJobs.length > 0) && (
          <div className="chat-jobs">
            {activeJobId && <span className="job-badge working">Working</span>}
            {queuedJobs.length > 0 && (
              <span className="job-badge queued">{queuedJobs.length} queued</span>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>👋 Hey! What would you like to work on?</p>
            <p className="chat-hint">
              You can ask questions, discuss ideas, or tell me what to build.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Typing indicator */}
        {(status === "thinking" || status === "typing") && (
          <div className="message assistant">
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="chat-error">
          <span>{error}</span>
          <button onClick={retry}>Retry</button>
        </div>
      )}

      {/* Input */}
      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            status === "thinking" || status === "typing"
              ? "Waiting for response..."
              : "Type a message..."
          }
          disabled={status === "thinking" || status === "typing"}
        />
        <button
          type="submit"
          disabled={!input.trim() || status === "thinking" || status === "typing"}
        >
          Send
        </button>
      </form>

      <style jsx>{`
        .chat-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          max-height: 100vh;
          background: var(--bg-primary, #0d1117);
          color: var(--text-primary, #e6edf3);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border, #30363d);
          background: var(--bg-secondary, #161b22);
        }

        .chat-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .chat-name {
          font-weight: 600;
          font-size: 16px;
        }

        .chat-jobs {
          display: flex;
          gap: 8px;
        }

        .job-badge {
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
        }

        .job-badge.working {
          background: rgba(46, 160, 67, 0.2);
          color: #3fb950;
        }

        .job-badge.queued {
          background: rgba(210, 153, 34, 0.2);
          color: #d29922;
        }

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .chat-empty {
          text-align: center;
          padding: 40px 20px;
          color: var(--text-secondary, #8b949e);
        }

        .chat-empty p:first-child {
          font-size: 24px;
          margin-bottom: 8px;
        }

        .chat-hint {
          font-size: 14px;
        }

        .message {
          max-width: 80%;
          padding: 12px 16px;
          border-radius: 16px;
          line-height: 1.5;
          animation: fadeIn 0.2s ease-out;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .message.user {
          align-self: flex-end;
          background: #238636;
          color: white;
          border-bottom-right-radius: 4px;
        }

        .message.assistant {
          align-self: flex-start;
          background: var(--bg-tertiary, #21262d);
          border-bottom-left-radius: 4px;
        }

        .message.system {
          align-self: center;
          background: transparent;
          color: var(--text-secondary, #8b949e);
          font-size: 13px;
          padding: 8px 16px;
        }

        .message-time {
          font-size: 11px;
          color: var(--text-tertiary, #6e7681);
          margin-top: 4px;
        }

        .typing-indicator {
          display: flex;
          gap: 4px;
          padding: 4px 0;
        }

        .typing-indicator span {
          width: 8px;
          height: 8px;
          background: var(--text-secondary, #8b949e);
          border-radius: 50%;
          animation: bounce 1.4s infinite ease-in-out both;
        }

        .typing-indicator span:nth-child(1) {
          animation-delay: -0.32s;
        }

        .typing-indicator span:nth-child(2) {
          animation-delay: -0.16s;
        }

        @keyframes bounce {
          0%, 80%, 100% {
            transform: scale(0);
          }
          40% {
            transform: scale(1);
          }
        }

        .chat-error {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 20px;
          background: rgba(248, 81, 73, 0.1);
          border-top: 1px solid rgba(248, 81, 73, 0.3);
          color: #f85149;
          font-size: 14px;
        }

        .chat-error button {
          padding: 6px 12px;
          background: transparent;
          border: 1px solid #f85149;
          color: #f85149;
          border-radius: 6px;
          cursor: pointer;
        }

        .chat-input {
          display: flex;
          gap: 12px;
          padding: 16px 20px;
          border-top: 1px solid var(--border, #30363d);
          background: var(--bg-secondary, #161b22);
        }

        .chat-input input {
          flex: 1;
          padding: 12px 16px;
          background: var(--bg-primary, #0d1117);
          border: 1px solid var(--border, #30363d);
          border-radius: 8px;
          color: var(--text-primary, #e6edf3);
          font-size: 15px;
          outline: none;
          transition: border-color 0.2s;
        }

        .chat-input input:focus {
          border-color: #238636;
        }

        .chat-input input:disabled {
          opacity: 0.6;
        }

        .chat-input button {
          padding: 12px 24px;
          background: #238636;
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }

        .chat-input button:hover:not(:disabled) {
          background: #2ea043;
        }

        .chat-input button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

function StatusIndicator({ status }: { status: ChatStatus }) {
  const statusConfig: Record<ChatStatus, { color: string; text: string }> = {
    idle: { color: "#3fb950", text: "Online" },
    thinking: { color: "#d29922", text: "Thinking..." },
    typing: { color: "#d29922", text: "Typing..." },
    working: { color: "#58a6ff", text: "Working..." },
    queueing: { color: "#a371f7", text: "Queueing..." },
    error: { color: "#f85149", text: "Error" },
  };

  const config = statusConfig[status];

  return (
    <div className="status-indicator">
      <span className="status-dot" style={{ background: config.color }} />
      <span className="status-text">{config.text}</span>

      <style jsx>{`
        .status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: var(--text-secondary, #8b949e);
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          animation: ${status === "thinking" || status === "typing" ? "pulse 1.5s infinite" : "none"};
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
        }
      `}</style>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`message ${message.role}`}>
      <div className="message-content">{message.content}</div>
      <div className="message-time">{time}</div>

      {message.metadata?.action && (
        <div className="message-action">
          {message.metadata.action === "queued" && "📋 Added to queue"}
          {message.metadata.action === "started" && "🚀 Started working"}
          {message.metadata.action === "paused" && "⏸️ Paused"}
          {message.metadata.action === "switched_project" && "📂 Switched project"}
        </div>
      )}

      <style jsx>{`
        .message-content {
          white-space: pre-wrap;
          word-break: break-word;
        }

        .message-time {
          font-size: 11px;
          opacity: 0.6;
          margin-top: 4px;
          text-align: right;
        }

        .message-action {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          font-size: 12px;
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
}
