export interface TimelineEvent {
  kind?: string;
  summary?: string;
}

export default function EventTimeline({ events, jobId }: { events: TimelineEvent[]; jobId?: string }) {
  return (
    <div>
      <h3>Events {jobId ? `for ${jobId}` : ""}</h3>
      <ul>
        {events.map((e, idx) => (
          <li key={idx}>{e.summary || e.kind || "event"}</li>
        ))}
      </ul>
    </div>
  );
}
