import mqtt, { MqttClient } from 'mqtt';
import config from './config';
import { upsertDevice } from './repositories/devicesRepo';
import { insertTelemetry } from './repositories/telemetryRepo';
import { recordHeartbeat } from './state/controlLoopMonitor';
import {
  TelemetryValidationError,
  validateTelemetryPayload,
} from './validation/telemetry';

export let mqttClient: MqttClient | null = null;
let lastError: string | null = null;

/**
 * Parse a telemetry message and write it into the DB.
 */
async function parseAndStoreMessage(topic: string, payload: Buffer) {
  try {
    const raw = JSON.parse(payload.toString('utf-8')) as Record<string, unknown>;
    const topicParts = topic.split('/');
    const fallbackDeviceId = topicParts[2];
    const telemetry = validateTelemetryPayload(raw, fallbackDeviceId);

    //Upsert device metadata (best-effort)
    await upsertDevice({
      id: telemetry.deviceId,
      type: telemetry.type,
      siteId: telemetry.siteId,
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
    });
  } catch (err) {
    if (err instanceof TelemetryValidationError) {
      console.warn('[mqttClient] invalid telemetry payload', err.message);
      return;
    }
    console.error('[mqttClient] failed to parse telemetry', err);
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
    console.log(
      '[mqttClient] connected to MQTT broker',
      `${config.mqtt.host}:${config.mqtt.port}`
    );

    mqttClient.subscribe('der/telemetry/#', (err) => {
      if (err) {
        console.error('[mqttClient] subscribe error', err);
      } else {
        console.log('[mqttClient] subscribed to der/telemetry/#');
      }
    });
  });

  mqttClient.on('message', (topic, payload) => {
    //Handle telemetry messages
    if (topic.startsWith('der/telemetry/')) {
      parseAndStoreMessage(topic, payload).catch((err) => {
        console.error('[mqttClient] failed to handle telemetry message', err);
      });
    }
  });

  mqttClient.on('error', (err) => {
    lastError = err.message;
    console.error('[mqttClient] connection error', err);
  });

  mqttClient.on('reconnect', () => {
    console.warn('[mqttClient] reconnecting to broker...');
  });

  mqttClient.on('offline', () => {
    console.warn('[mqttClient] broker offline or unreachable');
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
