import config from '../config';
import { pool } from '../db';
import { getMqttStatus } from '../mqttClient';
import { getControlLoopState } from '../state/controlLoopMonitor';
import { getTelemetryQualitySnapshot } from '../state/telemetryQuality';
import logger from '../logger';

type MetricName =
  | 'derms_db_up'
  | 'derms_mqtt_up'
  | 'derms_control_loop_ok'
  | 'derms_control_loop_offline_devices'
  | 'derms_stale_telemetry_dropped_total';

type MetricDef = { help: string; type: 'gauge' };
const metricDefs: Record<MetricName, MetricDef> = {
  derms_db_up: { help: 'Database connectivity (1=healthy,0=down)', type: 'gauge' },
  derms_mqtt_up: { help: 'MQTT connectivity (1=healthy,0=down)', type: 'gauge' },
  derms_control_loop_ok: { help: 'Control loop status (1=running,0=stalled/error)', type: 'gauge' },
  derms_control_loop_offline_devices: {
    help: 'Number of devices considered offline by the control loop',
    type: 'gauge',
  },
  derms_stale_telemetry_dropped_total: {
    help: 'Total number of telemetry samples ignored because they were stale',
    type: 'gauge',
  },
};

const gaugeValues: Record<MetricName, number> = {
  derms_db_up: 0,
  derms_mqtt_up: 0,
  derms_control_loop_ok: 0,
  derms_control_loop_offline_devices: 0,
  derms_stale_telemetry_dropped_total: 0,
};

export async function collectHealthMetrics() {
  try {
    await pool.query('SELECT 1');
    gaugeValues.derms_db_up = 1;
  } catch (err) {
    gaugeValues.derms_db_up = 0;
    logger.error({ err }, '[metrics] failed DB heartbeat');
  }

  const mqtt = getMqttStatus();
  gaugeValues.derms_mqtt_up = mqtt.connected ? 1 : 0;

  const controlLoop = getControlLoopState();
  const healthyLoop =
    controlLoop.status !== 'error' && controlLoop.status !== 'stalled';
  gaugeValues.derms_control_loop_ok = healthyLoop ? 1 : 0;
  gaugeValues.derms_control_loop_offline_devices = controlLoop.offlineDevices.length;

  const telemetryQuality = getTelemetryQualitySnapshot();
  gaugeValues.derms_stale_telemetry_dropped_total = telemetryQuality.staleTelemetryDropped;
}

export function shouldExposePrometheus(): boolean {
  return config.observability.prometheusEnabled;
}

export function prometheusPath(): string {
  return config.observability.prometheusPath;
}

export function metricsContentType(): string {
  return 'text/plain; version=0.0.4';
}

export function renderPrometheus(): string {
  const lines: string[] = [];
  (Object.keys(metricDefs) as MetricName[]).forEach((name) => {
    const def = metricDefs[name];
    lines.push(`# HELP ${name} ${def.help}`);
    lines.push(`# TYPE ${name} ${def.type}`);
    lines.push(`${name} ${gaugeValues[name]}`);
  });
  return lines.join('\n') + '\n';
}
