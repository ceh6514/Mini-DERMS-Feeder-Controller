import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getMigrationState, runMigrations } from '../src/migrations';

class FakeClient {
  migrations = new Set<string>();
  release() {}
  async query(sql: string, params?: any[]) {
    if (typeof sql === 'string') {
      if (sql.startsWith('SELECT version FROM schema_migrations')) {
        const rows = Array.from(this.migrations)
          .filter((version) => {
            if (params && params.length > 0) {
              return version === params[0];
            }
            return true;
          })
          .map((version) => ({ version }));
        return { rows };
      }
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        this.migrations.add(params?.[0]);
        return { rows: [] };
      }
      if (sql.startsWith('DELETE FROM schema_migrations')) {
        this.migrations.delete(params?.[0]);
        return { rows: [] };
      }
      // BEGIN/COMMIT/SET LOCAL and migration SQL are treated as no-ops
      return { rows: [] };
    }
    return { rows: [] };
  }
}

describe('database migrations', () => {
  it('runs all migrations on a clean schema and records versions', async () => {
    const client = new FakeClient();
    await runMigrations({ client });
    assert.ok(client.migrations.size > 0);
  });

  it('is idempotent and supports rolling back the latest migration', async () => {
    const client = new FakeClient();
    await runMigrations({ client });
    const appliedCount = client.migrations.size;
    await runMigrations({ client });
    assert.equal(client.migrations.size, appliedCount);

    await runMigrations({ client, direction: 'down' });
    assert.equal(client.migrations.size, appliedCount - 1);
  });

  it('reports pending migrations', async () => {
    const client = new FakeClient();
    const stateBefore = await getMigrationState({ client });
    assert.equal(stateBefore.ok, false);

    await runMigrations({ client });
    const stateAfter = await getMigrationState({ client });
    assert.equal(stateAfter.ok, true);
    assert.ok(stateAfter.applied.length > 0);
  });
});
