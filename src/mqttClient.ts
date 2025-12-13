import mqtt from 'mqtt';
type NodeMqttClient = ReturnType<typeof mqtt.connect>;
import config from './config';
import { upsertDevice } from './repositories/devicesRepo';
import { insertTelemetry } from './repositories/telemetryRepo';
import { recordHeartbeat } from './state/controlLoopMonitor';
import { TelemetryHandler } from './messaging/telemetryHandler';
import { ContractValidationError } from './contracts';
import logger from './logger';
import { incrementCounter } from './observability/metrics';

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
    });
  }
  return telemetryHandler;
}

/**
 * Parse a telemetry message and write it into the DB.
  */
async function parseAndStoreMessage(topic: string, payload: Buffer) {
  try {
    const raw = JSON.parse(payload.toString('utf-8')) as Record<string, unknown>;
    const handler = getTelemetryHandler();
    const result = await handler.handle(raw);

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
  mqttClient = mqtt.connect({
    host: config.mqtt.host,
    port: config.mqtt.port,
    protocol: 'mqtt',
  });

  mqttClient.on('connect', () => {
    lastError = null;
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
    //Handle telemetry messages
    if (topic.startsWith(`${baseTopic}/telemetry/`)) {
      parseAndStoreMessage(topic, payload).catch((err) => {
        logger.error({ err }, '[mqttClient] failed to handle telemetry message');
      });
    }
  });

  mqttClient.on('error', (err: Error) => {
    lastError = err.message;
    logger.error({ err }, '[mqttClient] connection error');
    incrementCounter('derms_mqtt_disconnect_total');
  });

  mqttClient.on('reconnect', () => {
    logger.warn('[mqttClient] reconnecting to broker...');
  });

  mqttClient.on('offline', () => {
    logger.warn('[mqttClient] broker offline or unreachable');
    incrementCounter('derms_mqtt_disconnect_total');
  });

  //We don't await anything here; startup should not block on MQTT
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
