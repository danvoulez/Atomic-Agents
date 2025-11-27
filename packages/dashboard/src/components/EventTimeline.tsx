export interface TimelineEvent {
  id?: string;
  kind?: string;
  summary?: string;
  toolName?: string;
  createdAt?: string;
}

export default function EventTimeline({ events, jobId }: { events: TimelineEvent[]; jobId?: string }) {
  return (
    <div>
      <h3>Events {jobId ? `for ${jobId}` : ""}</h3>
      {events.length === 0 ? (
        <div>No events yet.</div>
      ) : (
        <ul>
          {events.map((e) => (
            <li key={e.id || `${e.kind}-${e.createdAt}`}>
              <strong>{e.kind?.toUpperCase()}</strong>
              {e.toolName ? ` • ${e.toolName}` : ""} — {e.summary || e.createdAt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
