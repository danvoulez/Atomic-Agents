export interface ClientEvent {
  id: string;
  summary?: string;
}

export function mapEvents(raw: any[]): ClientEvent[] {
  return raw.map(e => ({ id: e.id ?? crypto.randomUUID(), summary: e.summary }));
}
