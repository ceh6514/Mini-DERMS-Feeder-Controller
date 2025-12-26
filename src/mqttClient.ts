import fs from 'fs';
import mqtt from 'mqtt/dist/mqtt';
/**
 * MQTT ingestion client.
 *
 * Subscribes to `<topicPrefix>/telemetry/#` with QoS 0 for streaming device reports and
 * enforces TLS/credential configuration plus payload/time guards. Control setpoints are
 * published from the control loop at QoS 1/retained so devices receive the latest target
 * after reconnecting.
 */
type NodeMqttClient = ReturnType<typeof mqtt.connect>;
import config from './config';
import { upsertDevice } from './repositories/devicesRepo';
import { insertTelemetry, insertTelemetryBatch } from './repositories/telemetryRepo';
import { recordHeartbeat } from './state/controlLoopMonitor';
import { TelemetryHandler } from './messaging/telemetryHandler';
import { ContractValidationError } from './contracts';
import logger from './logger';
import { incrementCounter } from './observability/metrics';
import { setMqttReady } from './state/readiness';

export let mqttClient: NodeMqttClient | null = null;
let lastError: string | null = null;
const baseTopic = config.mqtt.topicPrefix.replace(/\/+$/, '');
let telemetryHandler: TelemetryHandler | null = null;

function getTelemetryHandler() {
  if (!telemetryHandler) {
    telemetryHandler = new TelemetryHandler({
      save: (row) =>
        insertTelemetry({
          message_id: row.message_id,
          message_version: row.message_version,
          message_type: row.message_type,
          sent_at: row.sent_at,
          source: row.source,
          device_id: row.device_id,
          ts: row.ts,
          type: row.type,
          p_actual_kw: row.p_actual_kw,
          p_setpoint_kw: row.p_setpoint_kw,
          soc: row.soc,
          site_id: row.site_id,
          feeder_id: row.feeder_id,
        }),
      saveBatch: (rows) =>
        insertTelemetryBatch(
          rows.map((row) => ({
            ...row,
            message_type: row.message_type,
          })),
        ),
    }, {
      batchSize: config.telemetryIngest.batchSize,
      flushIntervalMs: config.telemetryIngest.flushIntervalMs,
      maxQueueSize: config.telemetryIngest.maxQueueSize,
    });
  }
  return telemetryHandler;
}

/**
 * Parse a telemetry message and write it into the DB.
  */
async function parseAndStoreMessage(topic: string, payload: Buffer) {
  try {
    if (payload.length > config.mqtt.maxPayloadBytes) {
      logger.warn('[mqttClient] dropped payload exceeding max size', {
        topic,
        bytes: payload.length,
      });
      incrementCounter('derms_telemetry_dropped_total', { reason: 'payload_too_large' });
      return;
    }

    const raw = JSON.parse(payload.toString('utf-8')) as Record<string, unknown>;
    const handler = getTelemetryHandler();
    const result = (await Promise.race([
      handler.handle(raw),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('telemetry_processing_timeout')),
          config.mqtt.processingTimeoutMs,
        ),
      ),
    ])) as Awaited<ReturnType<TelemetryHandler['handle']>>;

    if (!result.parsed) return;
    const telemetry = result.parsed;

    await upsertDevice({
      id: telemetry.deviceId,
      type: telemetry.deviceType,
      siteId: telemetry.payload.siteId ?? telemetry.payload.feederId ?? config.defaultFeederId,
      feederId: telemetry.payload.feederId ?? telemetry.payload.siteId ?? config.defaultFeederId,
      pMaxKw:
        telemetry.payload.capabilities?.maxDischargeKw ??
        telemetry.payload.capabilities?.maxChargeKw ??
        telemetry.payload.capabilities?.maxExportKw ??
        telemetry.payload.capabilities?.maxImportKw ??
        config.feederDefaultLimitKw,
      priority: null,
    });

    if (result.newest) {
      recordHeartbeat(telemetry.deviceId, telemetry.timestampMs);
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'telemetry_processing_timeout') {
      logger.error({ topic }, '[mqttClient] telemetry processing exceeded time budget');
      incrementCounter('derms_telemetry_dropped_total', { reason: 'processing_timeout' });
      return;
    }
    if (err instanceof ContractValidationError) {
      logger.warn('[mqttClient] invalid telemetry payload', { err });
      return;
    }
    logger.error(err as Error, '[mqttClient] failed to parse telemetry');
  }
}

/**
 * Initialize the MQTT client, set up subscriptions and handlers.
 *
 * NOTE: This function returns immediately; it does NOT wait for the
 * broker connection. We don't want startup to block forever if MQTT
 * is slow or down.
 */
export async function startMqttClient(): Promise<void> {
  setMqttReady(false, 'connecting');
  const protocol = config.mqtt.tls.enabled ? 'mqtts' : 'mqtt';
  if (config.mqtt.tls.enabled && protocol !== 'mqtts') {
    throw new Error('TLS is enabled for MQTT but a secure protocol was not selected');
  }

  const tlsOptions = config.mqtt.tls.enabled
    ? {
        protocol,
        ca: config.mqtt.tls.caPath ? fs.readFileSync(config.mqtt.tls.caPath) : undefined,
        cert: config.mqtt.tls.certPath ? fs.readFileSync(config.mqtt.tls.certPath) : undefined,
        key: config.mqtt.tls.keyPath ? fs.readFileSync(config.mqtt.tls.keyPath) : undefined,
        rejectUnauthorized: config.mqtt.tls.rejectUnauthorized,
      }
    : { protocol };

  const authOptions = config.mqtt.auth.username
    ? { username: config.mqtt.auth.username, password: config.mqtt.auth.password }
    : {};

  mqttClient = mqtt.connect({
    host: config.mqtt.host,
    port: config.mqtt.port,
    ...tlsOptions,
    ...authOptions,
  });

  mqttClient.on('connect', () => {
    lastError = null;
    setMqttReady(true);
    logger.info('[mqttClient] connected to MQTT broker', {
      host: config.mqtt.host,
      port: config.mqtt.port,
    });

    mqttClient.subscribe(`${baseTopic}/telemetry/#`, (err: Error | null) => {
      if (err) {
        logger.error({ err }, '[mqttClient] subscribe error');
      } else {
        logger.info('[mqttClient] subscribed to telemetry topic');
      }
    });
  });

  mqttClient.on('message', (topic: string, payload: Buffer) => {
    handleTelemetryMessage(topic, payload).catch((err) => {
      logger.error({ err }, '[mqttClient] failed to handle telemetry message');
    });
  });

  mqttClient.on('error', (err: Error) => {
    lastError = err.message;
    setMqttReady(false, err.message);
    logger.error({ err }, '[mqttClient] connection error');
    incrementCounter('derms_mqtt_disconnect_total');
  });

  mqttClient.on('reconnect', () => {
    setMqttReady(false, 'reconnecting');
    logger.warn('[mqttClient] reconnecting to broker...');
  });

  mqttClient.on('offline', () => {
    setMqttReady(false, 'offline');
    logger.warn('[mqttClient] broker offline or unreachable');
    incrementCounter('derms_mqtt_disconnect_total');
  });

  //We don't await anything here; startup should not block on MQTT
}

export async function handleTelemetryMessage(topic: string, payload: Buffer) {
  if (topic.startsWith(`${baseTopic}/telemetry/`)) {
    await parseAndStoreMessage(topic, payload);
  }
}

export function getMqttStatus() {
  return {
    host: config.mqtt.host,
    port: config.mqtt.port,
    connected: Boolean(mqttClient?.connected),
    lastError,
  };
}

export async function stopMqttClient(): Promise<void> {
  if (!mqttClient) return;

  await new Promise<void>((resolve) => {
    try {
      mqttClient.end(true, {}, resolve);
    } catch {
      resolve();
    }
  });
  mqttClient = null;
  telemetryHandler = null;
}
