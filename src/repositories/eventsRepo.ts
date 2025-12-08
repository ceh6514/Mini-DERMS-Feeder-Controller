import config from '../config';
import { query } from '../db';

export interface EventRow {
  id: number;
  ts_start: Date;
  ts_end: Date;
  limit_kw: number;
  type: string;
  feeder_id: string;
}

export async function createEvent(e: {
  tsStart: Date;
  tsEnd: Date;
  limitKw: number;
  type: string;
  feederId?: string;
}): Promise<EventRow> {
  const feederId = e.feederId?.trim() || config.defaultFeederId;
  const text = `
    INSERT INTO events (ts_start, ts_end, limit_kw, type, feeder_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, ts_start, ts_end, limit_kw, type, feeder_id;
  `;
  const { rows } = await query<EventRow>(text, [e.tsStart, e.tsEnd, e.limitKw, e.type, feederId]);
  return rows[0];
}

export async function getActiveEvent(now: Date, feederId?: string): Promise<EventRow | null> {
  const resolvedFeeder = feederId?.trim() || config.defaultFeederId;
  const text = `
    SELECT id, ts_start, ts_end, limit_kw, type, feeder_id
    FROM events
    WHERE ts_start <= $1 AND ts_end >= $1 AND feeder_id = $2
    ORDER BY ts_start DESC
    LIMIT 1;
  `;
  const { rows } = await query<EventRow>(text, [now, resolvedFeeder]);
  return rows[0] ?? null;
}

export async function getCurrentFeederLimit(now: Date, feederId?: string): Promise<number> {
  const active = await getActiveEvent(now, feederId);
  return active?.limit_kw ?? config.feederDefaultLimitKw;
}
