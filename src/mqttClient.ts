import mqtt from 'mqtt';
import config from './config.js';
import { upsertDevice } from './repositories/devicesRepo.js';
import { insertTelemetry } from './repositories/telemetryRepo.js';

export const mqttClient = mqtt.connect({
  host: config.mqtt.host,
  port: config.mqtt.port,
  protocol: 'mqtt',
});

function parseMessage(topic: string, payload: Buffer) {
  const topicParts = topic.split('/');
  const deviceId = topicParts[2] ?? '';

  try {
    const parsed = JSON.parse(payload.toString());
    return { deviceId, data: parsed as Record<string, unknown> };
  } catch (err) {
    console.error('[mqttClient] failed to parse JSON payload', err);
    return null;
  }
}

export async function startMqttClient(): Promise<void> {
  return new Promise((resolve, reject) => {
    mqttClient.on('connect', () => {
      console.log(`[mqttClient] connected to mqtt://${config.mqtt.host}:${config.mqtt.port}`);
      mqttClient.subscribe('der/telemetry/#', (err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log('[mqttClient] subscribed to der/telemetry/#');
        resolve();
      });
    });

    mqttClient.on('message', async (topic, payload) => {
      const parsed = parseMessage(topic, payload);
      if (!parsed) {
        return;
      }

      const { deviceId, data } = parsed;

      const {
        deviceId: payloadDeviceId,
        type = 'ev',
        timestamp,
        p_actual_kw = 0,
        p_setpoint_kw = null,
        soc = null,
        site_id = 'default',
        p_max_kw = 0,
      } = data as Record<string, any>;

      const effectiveDeviceId = deviceId || payloadDeviceId;
      if (!effectiveDeviceId) {
        console.warn('[mqttClient] missing deviceId in topic or payload');
        return;
      }

      // Ensure the device exists before storing telemetry
      await upsertDevice({
        id: effectiveDeviceId,
        type: String(type),
        siteId: String(site_id ?? 'default'),
        pMaxKw: Number(p_max_kw ?? 0),
      });

      const ts = timestamp ? new Date(timestamp) : new Date();

      try {
        await insertTelemetry({
          device_id: effectiveDeviceId,
          ts,
          type: String(type),
          p_actual_kw: Number(p_actual_kw ?? 0),
          p_setpoint_kw: p_setpoint_kw !== undefined ? Number(p_setpoint_kw) : null,
          soc: soc !== undefined ? Number(soc) : null,
          site_id: String(site_id ?? 'default'),
        });
      } catch (err) {
        console.error('[mqttClient] failed to insert telemetry', err);
      }
    });

    mqttClient.on('error', (err) => {
      console.error('[mqttClient] connection error', err);
      reject(err);
    });
  });
}
