import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mock } from 'node:test';

import { authRouter, requireAuth } from '../src/auth';
import config from '../src/config';
import feederRouter from '../src/routes/feeder';
import drProgramsRouter from '../src/routes/drPrograms';
import * as telemetryRepo from '../src/repositories/telemetryRepo';
import * as eventsRepo from '../src/repositories/eventsRepo';
import * as drProgramsRepo from '../src/repositories/drProgramsRepo';
import { DrProgramInput } from '../src/repositories/drProgramsRepo';
import { verifyPassword } from '../src/security/passwords';

const testPasswords: Record<string, string> = {
  admin: 'Adm1n!2345678',
  operator: 'Op3rator!23456',
  viewer: 'View3r!23456',
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth);
  app.use('/api/feeder', feederRouter);
  app.use('/api/dr-programs', drProgramsRouter);
  return app;
}

function base64url(input: Buffer | string): string {
  return Buffer.isBuffer(input)
    ? input.toString('base64url')
    : Buffer.from(input).toString('base64url');
}

function signRawToken(header: Record<string, unknown>, payload: Record<string, unknown>) {
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', config.auth.jwtSecret)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

function buildExpiredToken(username = 'viewer') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = buildPayload({
    username,
    iatOffsetSeconds: -7200,
    expOffsetSeconds: -3600,
  });
  return signRawToken(header, payload);
}

function buildPayload({
  username = 'viewer',
  role = 'viewer',
  iatOffsetSeconds = 0,
  expOffsetSeconds = config.auth.tokenTtlHours * 60 * 60,
  issuer = config.auth.issuer,
  audience = config.auth.audience,
}: {
  username?: string;
  role?: string;
  iatOffsetSeconds?: number;
  expOffsetSeconds?: number;
  issuer?: string;
  audience?: string;
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    username,
    role,
    iat: nowSeconds + iatOffsetSeconds,
    exp: nowSeconds + expOffsetSeconds,
    iss: issuer,
    aud: audience,
  };
}

function buildBadAlgToken() {
  const header = { alg: 'HS512', typ: 'JWT' };
  const payload = buildPayload({});
  return signRawToken(header, payload);
}

function buildBadIssuerToken() {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = buildPayload({ issuer: 'unexpected-issuer' });
  return signRawToken(header, payload);
}

function getOperatorCreds() {
  const operatorUser = config.auth.users.find((u) => u.role === 'operator') ?? config.auth.users[0];
  if (!operatorUser) {
    throw new Error('No AUTH_USERS configured for tests');
  }

  const password = testPasswords[operatorUser.username];
  if (!password) {
    throw new Error(`No test password registered for ${operatorUser.username}`);
  }

  return { ...operatorUser, password };
}

async function startServer() {
  const app = createApp();
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to allocate port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  return { baseUrl, close };
}

async function loginAndGetToken(
  baseUrl: string,
  username = getOperatorCreds().username,
  password = testPasswords[username],
) {
  if (!password) {
    throw new Error(`Missing test password for ${username}`);
  }
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  assert.ok(body.token, 'login should return a token');
  return body.token as string;
}

describe('API authentication and routing', () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  beforeEach(async () => {
    for (const user of config.auth.users) {
      const password = testPasswords[user.username];
      if (!password) continue;
      const valid = await verifyPassword(password, user.passwordHash);
      assert.ok(valid, `Configured hash for ${user.username} should match the test fixture password`);
    }
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('requires bearer auth and propagates feederId to summary queries', async () => {
    const limitSpy = mock.method(eventsRepo, 'getCurrentFeederLimit', async () => 25);
    const latestSpy = mock.method(telemetryRepo, 'getLatestTelemetryPerDevice', async () => [
      {
        device_id: 'ev-1',
        ts: new Date('2024-01-01T00:00:00Z'),
        type: 'ev',
        p_actual_kw: 5,
        p_setpoint_kw: 6,
        site_id: 'site-1',
        feeder_id: 'feeder-auth',
      },
    ]);

    const { baseUrl, close } = await startServer();
    try {
      const unauthorized = await fetch(`${baseUrl}/api/feeder/summary`);
      assert.strictEqual(unauthorized.status, 401);

      const token = await loginAndGetToken(baseUrl);
      const resp = await fetch(`${baseUrl}/api/feeder/summary?feederId=feeder-auth`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(resp.status, 200);
      const body = await resp.json();
      assert.strictEqual(body.feederId, 'feeder-auth');
      assert.strictEqual(limitSpy.mock.callCount(), 1);
      assert.strictEqual(latestSpy.mock.callCount(), 1);
      assert.strictEqual(latestSpy.mock.calls[0].arguments[0], 'feeder-auth');
    } finally {
      await close();
    }
  });

  it('falls back to the default feeder when feederId is missing', async () => {
    mock.method(eventsRepo, 'getCurrentFeederLimit', async () => 10);
    mock.method(telemetryRepo, 'getLatestTelemetryPerDevice', async () => [
      {
        device_id: 'ev-2',
        ts: new Date('2024-01-01T00:00:00Z'),
        type: 'ev',
        p_actual_kw: 4,
        site_id: 'site-1',
        feeder_id: config.defaultFeederId,
      },
    ]);

    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAndGetToken(baseUrl);
      const resp = await fetch(`${baseUrl}/api/feeder/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await resp.json();
      assert.strictEqual(body.feederId, config.defaultFeederId);
      assert.strictEqual(body.deviceCount, 1);
    } finally {
      await close();
    }
  });

  it('rejects invalid or expired JWTs', async () => {
    const { baseUrl, close } = await startServer();
    try {
      const expiredToken = buildExpiredToken();
      const expiredResp = await fetch(`${baseUrl}/api/feeder/summary`, {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      assert.strictEqual(expiredResp.status, 401);

      const malformedResp = await fetch(`${baseUrl}/api/feeder/summary`, {
        headers: { Authorization: 'Bearer not-a-token' },
      });
      assert.strictEqual(malformedResp.status, 401);
    } finally {
      await close();
    }
  });

  it('rejects JWTs with unsupported alg header', async () => {
    const { baseUrl, close } = await startServer();
    try {
      const badAlgToken = buildBadAlgToken();
      const resp = await fetch(`${baseUrl}/api/feeder/summary`, {
        headers: { Authorization: `Bearer ${badAlgToken}` },
      });
      assert.strictEqual(resp.status, 401);
    } finally {
      await close();
    }
  });

  it('rejects JWTs with mismatched issuer', async () => {
    const { baseUrl, close } = await startServer();
    try {
      const badIssuer = buildBadIssuerToken();
      const resp = await fetch(`${baseUrl}/api/feeder/summary`, {
        headers: { Authorization: `Bearer ${badIssuer}` },
      });
      assert.strictEqual(resp.status, 401);
    } finally {
      await close();
    }
  });

  it('rejects invalid login attempts', async () => {
    const { baseUrl, close } = await startServer();
    try {
      const badPasswordResp = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: getOperatorCreds().username, password: 'bad-password' }),
      });
      assert.strictEqual(badPasswordResp.status, 401);

      const missingFields = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: getOperatorCreds().username }),
      });
      assert.strictEqual(missingFields.status, 400);
    } finally {
      await close();
    }
  });

  it('allows operators to create and activate DR programs', async () => {
    const createSpy = mock.method(drProgramsRepo, 'createDrProgram', async (input: DrProgramInput) => ({
      id: 99,
      name: input.name,
      mode: input.mode,
      ts_start: input.tsStart,
      ts_end: input.tsEnd,
      target_shed_kw: input.targetShedKw ?? 0,
      incentive_per_kwh: input.incentivePerKwh ?? 0,
      penalty_per_kwh: input.penaltyPerKwh ?? 0,
      is_active: Boolean(input.isActive),
    }));
    const activateSpy = mock.method(drProgramsRepo, 'activateDrProgram', async (id: number) => ({
      id,
      name: 'test',
      mode: 'fixed_cap',
      ts_start: new Date('2024-01-01T00:00:00Z'),
      ts_end: new Date('2024-01-02T00:00:00Z'),
      target_shed_kw: 3,
      incentive_per_kwh: 0,
      penalty_per_kwh: 0,
      is_active: true,
    }));

    const { baseUrl, close } = await startServer();
    try {
      const { username, password } = getOperatorCreds();
      const token = await loginAndGetToken(baseUrl, username, password);
      const resp = await fetch(`${baseUrl}/api/dr-programs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'shed-feeder-a',
          mode: 'fixed_cap',
          tsStart: '2024-01-01T00:00:00Z',
          tsEnd: '2024-01-02T00:00:00Z',
          targetShedKw: 3,
          isActive: true,
        }),
      });

      assert.strictEqual(resp.status, 201);
      assert.strictEqual(createSpy.mock.callCount(), 1);
      assert.strictEqual(activateSpy.mock.callCount(), 1);
    } finally {
      await close();
    }
  });
});
