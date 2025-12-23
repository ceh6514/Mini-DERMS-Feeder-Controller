import fs from 'fs';
import path from 'path';
import pg from 'pg';
import config from './config';
import logger from './logger';

const { Pool } = pg as any;

type Direction = 'up' | 'down';

interface RunMigrationsOptions {
  direction?: Direction;
  to?: string | null;
  client?: any;
  searchPath?: string;
}

interface MigrationFile {
  version: string;
  upPath: string;
  downPath: string;
}

function resolveMigrationsDir() {
  const distPath = path.join(__dirname, '..', 'migrations');
  if (fs.existsSync(distPath)) return distPath;
  const rootPath = path.join(__dirname, '..', '..', 'migrations');
  if (fs.existsSync(rootPath)) return rootPath;
  throw new Error('[migrations] migrations directory not found');
}

function loadMigrations(): MigrationFile[] {
  const migrationsDir = resolveMigrationsDir();
  const entries = fs.readdirSync(migrationsDir);
  const migrationNames = entries
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();

  return migrationNames.map((version) => ({
    version,
    upPath: path.join(migrationsDir, `${version}.sql`),
    downPath: path.join(migrationsDir, `${version}.down.sql`),
  }));
}

async function withClient<T>(
  provided: any | undefined,
  fn: (client: any) => Promise<T>,
): Promise<T> {
  if (provided && typeof (provided as any).release === 'function' && typeof (provided as any).query === 'function' && !(provided instanceof Pool)) {
    return fn(provided as any);
  }

  if (provided instanceof Pool) {
    const client = await provided.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  const tempPool = new Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });
  const client = await tempPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await tempPool.end();
  }
}

async function ensureMigrationsTable(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function runMigrations(options: RunMigrationsOptions = {}): Promise<void> {
  const direction: Direction = options.direction ?? 'up';
  const to = options.to ?? null;
  const migrations = loadMigrations();

  await withClient(options.client, async (client) => {
    if (options.searchPath) {
      await client.query(`SET search_path TO ${options.searchPath}`);
    }
    await ensureMigrationsTable(client);

    if (direction === 'up') {
      for (const migration of migrations) {
        const applied = await client.query(
          'SELECT version FROM schema_migrations WHERE version = $1',
          [migration.version],
        );
        if ((applied.rows ?? []).length > 0) continue;

        const sql = fs.readFileSync(migration.upPath, 'utf-8');
        await client.query('BEGIN');
        if (options.searchPath) {
          await client.query(`SET LOCAL search_path TO ${options.searchPath}`);
        }
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
        await client.query('COMMIT');
        logger.info('[migrations] applied', { migration: migration.version });
      }
      return;
    }

    // direction === 'down'
    const appliedMigrations = await client.query(
      'SELECT version FROM schema_migrations ORDER BY applied_at DESC, version DESC',
    );
    const appliedSet = new Set((appliedMigrations.rows ?? []).map((r: any) => r.version));

    const toRollback = migrations
      .filter((m) => appliedSet.has(m.version))
      .sort((a, b) => b.version.localeCompare(a.version));

    if (toRollback.length === 0) return;

    for (const migration of toRollback) {
      if (to && migration.version <= to) {
        break;
      }
      if (!fs.existsSync(migration.downPath)) {
        throw new Error(`[migrations] missing down script for ${migration.version}`);
      }
      const sql = fs.readFileSync(migration.downPath, 'utf-8');
      await client.query('BEGIN');
      if (options.searchPath) {
        await client.query(`SET LOCAL search_path TO ${options.searchPath}`);
      }
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [migration.version]);
      await client.query('COMMIT');
      logger.warn('[migrations] rolled back', { migration: migration.version });

      if (to && migration.version === to) {
        break;
      }
      if (!to) {
        // Default rollback only the latest migration
        break;
      }
    }
  });
}
