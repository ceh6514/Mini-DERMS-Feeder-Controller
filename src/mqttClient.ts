import mqtt from 'mqtt';
import config from './config';
import { upsertDevice } from './repositories/devicesRepo';
import { insertTelemetry } from './repositories/telemetryRepo';
import { recordHeartbeat } from './state/controlLoopMonitor';
import {
  TelemetryValidationError,
  validateTelemetryPayload,
} from './validation/telemetry';
import logger from './logger';
import { incrementCounter } from './observability/metrics';

export let mqttClient: any = null;
let lastError: string | null = null;
const baseTopic = config.mqtt.topicPrefix.replace(/\/+$/, '');

/**
 * Parse a telemetry message and write it into the DB.
 */
async function parseAndStoreMessage(topic: string, payload: Buffer) {
  try {
    const raw = JSON.parse(payload.toString('utf-8')) as Record<string, unknown>;
    const topicParts = topic.split('/');
    const fallbackDeviceId = topicParts[topicParts.length - 1];
    const telemetry = validateTelemetryPayload(raw, fallbackDeviceId);

    //Upsert device metadata (best-effort)
    await upsertDevice({
      id: telemetry.deviceId,
      type: telemetry.type,
      siteId: telemetry.siteId,
      feederId: telemetry.feederId ?? telemetry.siteId ?? config.defaultFeederId,
      pMaxKw: telemetry.pMaxKw,
      priority: telemetry.priority,
    });

    recordHeartbeat(telemetry.deviceId, telemetry.ts.getTime());

    //Insert telemetry row (after the device row exists)
    await insertTelemetry({
      device_id: telemetry.deviceId,
      ts: telemetry.ts,
      type: telemetry.type,
      p_actual_kw: telemetry.pActualKw,
      p_setpoint_kw: telemetry.pSetpointKw,
      soc: telemetry.soc,
      site_id: telemetry.siteId,
      feeder_id: telemetry.feederId ?? telemetry.siteId ?? config.defaultFeederId,
    });
  } catch (err) {
    if (err instanceof TelemetryValidationError) {
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
}
