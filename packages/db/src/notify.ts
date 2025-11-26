import { pool } from "./index";

/**
 * Push an event to the dashboard SSE channel using Postgres NOTIFY.
 * Payload should include conversation_id and type to be filtered by listeners.
 */
export async function notifyDashboardEvent(payload: Record<string, unknown>): Promise<void> {
  await pool.query("SELECT pg_notify('dashboard_events', $1)", [JSON.stringify(payload)]);
}
