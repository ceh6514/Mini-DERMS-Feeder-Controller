import assert from 'node:assert/strict';
import express from 'express';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import devicesRouter from '../src/routes/devices';
import * as devicesRepo from '../src/repositories/devicesRepo';
import * as telemetryRepo from '../src/repositories/telemetryRepo';

describe('device and telemetry route validation', () => {
  let server: any;
  let baseUrl: string;

  beforeEach(() => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { username: 'test', role: 'admin' };
      next();
    });
    app.use('/api', devicesRouter);
    server = app.listen(0);
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    mock.restoreAll();
    if (server) {
      server.close();
    }
  });

  it('rejects non-string feederId on /devices', async () => {
    const devicesMock = mock.method(devicesRepo, 'getAllDevices', async () => []);
    const telemetryMock = mock.method(telemetryRepo, 'getLatestTelemetryPerDevice', async () => []);

    const res = await fetch(`${baseUrl}/api/devices?feederId[]=bad`);
    assert.equal(res.status, 400);
    assert.equal(devicesMock.mock.callCount(), 0);
    assert.equal(telemetryMock.mock.callCount(), 0);
  });

  it('rejects invalid telemetry limits', async () => {
    const recentMock = mock.method(telemetryRepo, 'getRecentTelemetry', async () => []);
    const res = await fetch(`${baseUrl}/api/telemetry/dev-1?limit=-5`);

    assert.equal(res.status, 400);
    assert.equal(recentMock.mock.callCount(), 0);
  });

  it('rejects malformed telemetry bodies before processing', async () => {
    const insertMock = mock.method(telemetryRepo, 'insertTelemetry', async () => 'inserted');

    const res = await fetch(`${baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageType: 'telemetry', deviceId: '', payload: {} }),
    });

    assert.equal(res.status, 400);
    assert.equal(insertMock.mock.callCount(), 0);
  });

  it('rejects invalid live-device windows', async () => {
    const liveMock = mock.method(telemetryRepo, 'getLiveDevices', async () => []);
    const res = await fetch(`${baseUrl}/api/live-devices?minutes=0`);

    assert.equal(res.status, 400);
    assert.equal(liveMock.mock.callCount(), 0);
  });
});
