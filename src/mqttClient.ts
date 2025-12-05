import mqtt, { MqttClient } from 'mqtt';
import config from './config';
import { upsertDevice } from './repositories/devicesRepo';
import { insertTelemetry } from './repositories/telemetryRepo';
import { recordHeartbeat } from './state/controlLoopMonitor';

export let mqttClient: MqttClient | null = null;
let lastError: string | null = null;

/**
 * Parse a telemetry message and write it into the DB.
 */
async function parseAndStoreMessage(topic: string, payload: Buffer) {
  const topicParts = topic.split('/');
  const deviceId = topicParts[2] ?? '';

  try {
    const raw = JSON.parse(payload.toString('utf-8')) as {
      deviceId?: string;
      type?: string;
      timestamp?: string;
      p_actual_kw?: number;
      p_setpoint_kw?: number | null;
      soc?: number | null;
      site_id?: string;
      p_max_kw?: number;
      priority?: number | null;
    };

    const id = raw.deviceId ?? deviceId;
    const type = raw.type ?? 'unknown';
    const ts = raw.timestamp ? new Date(raw.timestamp) : new Date();
    const pActual = Number(raw.p_actual_kw ?? 0);
    const pSetpoint =
      raw.p_setpoint_kw !== undefined && raw.p_setpoint_kw !== null
        ? Number(raw.p_setpoint_kw)
        : null;
    const soc =
      raw.soc !== undefined && raw.soc !== null ? Number(raw.soc) : null;
    const siteId = raw.site_id ?? 'default';
    const pMaxKw = raw.p_max_kw ?? 0;
    const priority =
      raw.priority !== undefined && raw.priority !== null
        ? Number(raw.priority)
        : null;

    if (!id) {
      console.warn('[mqttClient] telemetry without deviceId, topic=', topic);
      return;
    }

    //Upsert device metadata (best-effort)
    await upsertDevice({
      id,
      type,
      siteId,
      pMaxKw,
      priority,
    });

    recordHeartbeat(id, ts.getTime());

    //Insert telemetry row (after the device row exists)
    await insertTelemetry({
      device_id: id,
      ts,
      type,
      p_actual_kw: pActual,
      p_setpoint_kw: pSetpoint,
      soc,
      site_id: siteId,
    });
  } catch (err) {
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
