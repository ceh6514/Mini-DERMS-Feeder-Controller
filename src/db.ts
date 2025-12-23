import { Pool } from 'pg';
import config from './config';
import { getSafetyPolicy } from './safetyPolicy';
import logger from './logger';
import { runMigrations } from './migrations';

export let pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

export function rebuildPool() {
  pool?.end?.().catch(() => undefined);
  pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });
}

export async function initSchema(): Promise<void> {
  await runMigrations();
}

export async function query<T = unknown>(
  text: string,
  params?: any[],
): Promise<{ rows: T[] }> {
  const policy = getSafetyPolicy();
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error('DB query timed out'));
    }, policy.dbQueryTimeoutMs);
  });

  try {
    const result = await Promise.race([pool.query(text, params), timeout]);
    return { rows: (result as any).rows as T[] };
  } catch (err) {
    logger.error({ err }, '[db] query failed');
    throw err;
  }
}
