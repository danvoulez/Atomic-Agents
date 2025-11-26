import { Message } from "@/types";

export default function MessageBubble({ message }: { message: Message }) {
  return (
    <div style={{ background: "#111827", padding: 8, borderRadius: 6, marginBottom: 6 }}>
      <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>{message.role}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>
      {message.jobRefs?.length ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af" }}>
          Jobs: {message.jobRefs.map(ref => ref.jobId).join(", ")}
        </div>
      ) : null}
      {message.citations?.length ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af" }}>
          Sources: {message.citations.map(c => c.source).join(", ")}
        </div>
      ) : null}
    </div>
  );
}
