import fs from 'fs';
import { randomUUID } from 'crypto';
import mqtt from 'mqtt';
import net from 'net';
import { Pool as PgPool } from 'pg';
import { spawnSync } from 'node:child_process';
type MqttClient = ReturnType<typeof mqtt.connect>;
type PgPoolType = any;
import type { ControlLoopIterationResult } from '../../src/controllers/controlLoop';
import type { StartedServer } from '../../src/server';

export const dockerAvailable =
  process.env.SKIP_E2E_DOCKER === 'true' ? false : fs.existsSync('/var/run/docker.sock');

export interface TestStack {
  topicPrefix: string;
  baseUrl: string;
  dbPool: PgPoolType;
  stop: () => Promise<void>;
  publishTelemetry: (deviceId: string, payload: Partial<Record<string, unknown>>) => Promise<void>;
  createSetpointCollector: () => Promise<SetpointCollector>;
  runControlOnce: () => Promise<ControlLoopIterationResult>;
  restartBroker: () => Promise<void>;
}

export interface SetpointMessage {
  topic: string;
  payload: any;
}

export interface SetpointCollector {
  messages: SetpointMessage[];
  waitForCount: (expected: number, timeoutMs?: number) => Promise<SetpointMessage[]>;
  disconnect: () => Promise<void>;
}

interface StartedTestContainer {
  getHost(): string;
  getMappedPort(port: number): number;
  restart(): Promise<void>;
  stop(): Promise<void>;
}

function buildAuthUsers() {
  return JSON.stringify([
    { username: 'admin', password: 'Adm1n!2345678', role: 'admin' },
    { username: 'operator', password: 'Op3rator!23456', role: 'operator' },
    { username: 'viewer', password: 'View3r!23456', role: 'viewer' },
  ]);
}

async function waitForMqtt(client: MqttClient, timeoutMs = 10000): Promise<void> {
  if (client.connected) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('MQTT connect timeout')), timeoutMs);
    client.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    client.once('error', (err: unknown) => {
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 15000,
  label = 'condition',
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

async function createMqttPublisher(host: string, port: number): Promise<MqttClient> {
  const client = mqtt.connect({ host, port, protocol: 'mqtt', reconnectPeriod: 1000 });
  await waitForMqtt(client);
  return client;
}

async function startPostgresContainer(database: string): Promise<StartedTestContainer> {
  const name = `derms-e2e-pg-${randomUUID()}`;
  const result = spawnSync('docker', [
    'run',
    '-d',
    '--name',
    name,
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-e',
    `POSTGRES_DB=${database}`,
    '-p',
    '0:5432',
    'postgres:16-alpine',
  ]);
  if (result.status !== 0) {
    throw new Error(`Failed to start postgres container: ${result.stderr?.toString()}`);
  }

  const portInfo = spawnSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf-8' });
  const mapped = portInfo.stdout.trim().split(':').pop();
  const mappedPort = mapped ? Number(mapped) : NaN;
  if (!Number.isFinite(mappedPort)) {
    throw new Error('Failed to determine mapped postgres port');
  }

  await waitFor(async () => {
    const client = new PgPool({
      host: '127.0.0.1',
      port: mappedPort,
      user: 'postgres',
      password: 'postgres',
      database,
    });
    try {
      await client.query('SELECT 1');
      return true;
    } catch {
      return false;
    } finally {
      await client.end();
    }
  }, 20000, 'postgres readiness');

  return {
    getHost: () => '127.0.0.1',
    getMappedPort: (_port: number) => mappedPort,
    restart: async () => {
      spawnSync('docker', ['restart', name]);
      await waitFor(async () => {
    const client = new PgPool({
          host: '127.0.0.1',
          port: mappedPort,
          user: 'postgres',
          password: 'postgres',
          database,
        });
        try {
          await client.query('SELECT 1');
          return true;
        } catch {
          return false;
        } finally {
          await client.end();
        }
      }, 20000, 'postgres restart');
    },
    stop: async () => {
      spawnSync('docker', ['rm', '-f', name]);
    },
  };
}

async function createMosquitto(): Promise<StartedTestContainer> {
  const name = `derms-e2e-mqtt-${randomUUID()}`;
  const result = spawnSync('docker', [
    'run',
    '-d',
    '--name',
    name,
    '-p',
    '0:1883',
    'eclipse-mosquitto:2',
    'sh',
    '-c',
    "echo -e 'listener 1883\nallow_anonymous true\npersistence false' > /mosquitto/config/mosquitto.conf && mosquitto -c /mosquitto/config/mosquitto.conf",
  ]);
  if (result.status !== 0) {
    throw new Error(`Failed to start mosquitto container: ${result.stderr?.toString()}`);
  }
  const containerName = name;
  const portInfo = spawnSync('docker', ['port', containerName, '1883/tcp'], { encoding: 'utf-8' });
  const mapped = portInfo.stdout.trim().split(':').pop();
  const mappedPort = mapped ? Number(mapped) : NaN;
  if (!Number.isFinite(mappedPort)) {
    throw new Error('Failed to determine mapped MQTT port');
  }

  await waitFor(() => new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: mappedPort }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  }), 15000, 'mosquitto readiness');

  return {
    getHost: () => '127.0.0.1',
    getMappedPort: (_port: number) => mappedPort,
    restart: async () => {
      spawnSync('docker', ['restart', containerName]);
      await waitFor(() => new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port: mappedPort }, () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => resolve(false));
      }), 15000, 'mosquitto restart');
    },
    stop: async () => {
      spawnSync('docker', ['rm', '-f', containerName]);
    },
  };
}

export async function startTestStack(envOverrides: Record<string, string> = {}): Promise<TestStack> {
  const topicPrefix = `derms-test/${Date.now()}-${randomUUID()}`;
  const dbName = `derms_${randomUUID().replace(/-/g, '')}`;
  const pgContainer = await startPostgresContainer(dbName);
  const mqttContainer = await createMosquitto();

  const dbHost = pgContainer.getHost();
  const dbPort = pgContainer.getMappedPort(5432);
  const mqttHost = mqttContainer.getHost();
  const mqttPort = mqttContainer.getMappedPort(1883);

  const sharedEnv: Record<string, string> = {
    DB_HOST: dbHost,
    DB_PORT: String(dbPort),
    DB_USER: 'postgres',
    DB_PASSWORD: 'postgres',
    DB_NAME: dbName,
    MQTT_HOST: mqttHost,
    MQTT_PORT: String(mqttPort),
    MQTT_TOPIC_PREFIX: topicPrefix,
    PORT: '0',
    AUTH_USERS: buildAuthUsers(),
    JWT_SECRET: 'test-suite-secret-rotate-me-please-123',
    PROMETHEUS_ENABLED: 'true',
    LOG_PRETTY: 'false',
    CONTROL_INTERVAL_SECONDS: '2',
    FEEDER_DEFAULT_LIMIT_KW: '8',
    CONTROL_GLOBAL_KW_LIMIT: '8',
    ...envOverrides,
  };

  Object.assign(process.env, sharedEnv);

  const { startServer } = await import('../../src/server');
  const { runControlLoopCycle } = await import('../../src/controllers/controlLoop');
  const { pool: dbPool } = await import('../../src/db');

  const server: StartedServer = await startServer({ startControlLoop: false });
  const baseUrl = `http://localhost:${server.port}`;

  const publisher = await createMqttPublisher(mqttHost, mqttPort);

  async function publishTelemetry(deviceId: string, payload: Partial<Record<string, unknown>>): Promise<void> {
    const telemetry = {
      deviceId,
      type: 'ev',
      ts: new Date().toISOString(),
      p_actual_kw: 1,
      p_setpoint_kw: 1,
      soc: 0.5,
      site_id: 'site-1',
      feeder_id: 'feeder-1',
      p_max_kw: 5,
      priority: 1,
      ...payload,
    };

    const topic = `${topicPrefix}/telemetry/${deviceId}`;
    await new Promise<void>((resolve, reject) => {
      publisher.publish(topic, JSON.stringify(telemetry), (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async function createSetpointCollector(): Promise<SetpointCollector> {
    const client = mqtt.connect({ host: mqttHost, port: mqttPort, protocol: 'mqtt', reconnectPeriod: 500 });
    await waitForMqtt(client);
    await new Promise<void>((resolve, reject) => {
      client.subscribe(`${topicPrefix}/control/#`, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const messages: SetpointMessage[] = [];
    client.on('message', (topic: string, payload: Buffer) => {
      try {
        messages.push({ topic, payload: JSON.parse(payload.toString('utf-8')) });
      } catch {
        messages.push({ topic, payload: payload.toString('utf-8') });
      }
    });

    return {
      messages,
      waitForCount: async (expected: number, timeoutMs = 10000) => {
        await waitFor(() => messages.length >= expected, timeoutMs, 'setpoint messages');
        return messages;
      },
      disconnect: async () => {
        await new Promise<void>((resolve) => client.end(true, {}, resolve));
      },
    };
  }

  async function stop() {
    await new Promise<void>((resolve) => publisher.end(true, {}, resolve));
    await server.stop();
    await mqttContainer.stop();
    await pgContainer.stop();
  }

  return {
    topicPrefix,
    baseUrl,
    dbPool,
    stop,
    publishTelemetry,
    createSetpointCollector,
    runControlOnce: () => runControlLoopCycle(),
    restartBroker: () => mqttContainer.restart(),
  };
}
