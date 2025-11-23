import config from '../config';
import { query } from '../db';

export interface EventRow {
  id: number;
  ts_start: Date;
  ts_end: Date;
  limit_kw: number;
  type: string;
}

export async function createEvent(e: {
  tsStart: Date;
  tsEnd: Date;
  limitKw: number;
  type: string;
}): Promise<EventRow> {
  const text = `
    INSERT INTO events (ts_start, ts_end, limit_kw, type)
    VALUES ($1, $2, $3, $4)
    RETURNING id, ts_start, ts_end, limit_kw, type;
  `;
  const { rows } = await query<EventRow>(text, [e.tsStart, e.tsEnd, e.limitKw, e.type]);
  return rows[0];
}

export async function getActiveEvent(now: Date): Promise<EventRow | null> {
  const text = `
    SELECT id, ts_start, ts_end, limit_kw, type
    FROM events
    WHERE ts_start <= $1 AND ts_end >= $1
    ORDER BY ts_start DESC
    LIMIT 1;
  `;
  const { rows } = await query<EventRow>(text, [now]);
  return rows[0] ?? null;
}

export async function getCurrentFeederLimit(now: Date): Promise<number> {
  const active = await getActiveEvent(now);
  return active?.limit_kw ?? config.feederDefaultLimitKw;
}
