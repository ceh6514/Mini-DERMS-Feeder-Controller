import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import * as db from '../src/db';
import { insertTelemetry } from '../src/repositories/telemetryRepo';

const sampleRow = {
  message_id: '00000000-0000-4000-8000-000000000001',
  message_version: 1,
  message_type: 'telemetry' as const,
  sent_at: new Date(),
  source: 'simulator',
  device_id: 'ev-1',
  ts: new Date('2024-01-01T00:00:00Z'),
  type: 'ev',
  p_actual_kw: 1,
  p_setpoint_kw: 1,
  soc: 0.5,
  site_id: 'site-1',
  feeder_id: 'feeder-1',
  cloud_cover_pct: 0,
  shortwave_radiation_wm2: 0,
  estimated_power_w: 0,
};

describe('insertTelemetry', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('uses a single upsert statement and passes all parameters', async () => {
    const calls: { text: string; params: unknown[] }[] = [];
    mock.method(db, 'query', async (text: string, params?: unknown[]) => {
      calls.push({ text, params: params ?? [] });
      return { rows: [] };
    });

    const result = await insertTelemetry({ ...sampleRow });

    assert.equal(result, 'inserted');
    assert.equal(calls.length, 1);
    assert.equal((calls[0].text.match(/ON CONFLICT/g) ?? []).length, 1);
    assert.equal(calls[0].params.length, 16);
  });

  it('returns duplicate on constraint violation', async () => {
    const err: any = new Error('duplicate');
    err.code = '23505';
    mock.method(db, 'query', async () => {
      throw err;
    });

    const result = await insertTelemetry({ ...sampleRow });
    assert.equal(result, 'duplicate');
  });
});
