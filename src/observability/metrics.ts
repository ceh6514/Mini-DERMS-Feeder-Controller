import config from '../config';
import { pool } from '../db';
import { getMqttStatus } from '../mqttClient';
import { getControlLoopState } from '../state/controlLoopMonitor';
import { getTelemetryQualitySnapshot } from '../state/telemetryQuality';
import logger from '../logger';

type GaugeMetricName =
  | 'derms_db_up'
  | 'derms_mqtt_up'
  | 'derms_control_loop_ok'
  | 'derms_control_loop_offline_devices'
  | 'derms_stale_telemetry_dropped_total'
  | 'derms_control_degraded'
  | 'derms_control_stopped';

type CounterMetricName =
  | 'derms_stale_telemetry_total'
  | 'derms_missing_telemetry_total'
  | 'derms_mqtt_disconnect_total'
  | 'derms_mqtt_publish_fail_total'
  | 'derms_db_error_total';

type HistogramMetricName = 'derms_mqtt_publish_latency_ms';

type MetricDef = { help: string; type: 'gauge' | 'counter' | 'histogram' };
const metricDefs: Record<GaugeMetricName | CounterMetricName | HistogramMetricName, MetricDef> = {
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
  derms_control_degraded: {
    help: 'Control loop degraded mode (labels describe reason)',
    type: 'gauge',
  },
  derms_control_stopped: {
    help: 'Control loop stopped because of safety policy',
    type: 'gauge',
  },
  derms_stale_telemetry_total: {
    help: 'Count of stale telemetry samples by device',
    type: 'counter',
  },
  derms_missing_telemetry_total: {
    help: 'Count of missing telemetry occurrences by device',
    type: 'counter',
  },
  derms_mqtt_disconnect_total: {
    help: 'Total MQTT disconnects detected',
    type: 'counter',
  },
  derms_mqtt_publish_fail_total: {
    help: 'Total MQTT publish failures',
    type: 'counter',
  },
  derms_db_error_total: { help: 'Total DB errors grouped by operation', type: 'counter' },
  derms_mqtt_publish_latency_ms: {
    help: 'Latency histogram for MQTT publish operations (ms)',
    type: 'histogram',
  },
};

const gaugeValues: Record<GaugeMetricName, number> = {
  derms_db_up: 0,
  derms_mqtt_up: 0,
  derms_control_loop_ok: 0,
  derms_control_loop_offline_devices: 0,
  derms_stale_telemetry_dropped_total: 0,
  derms_control_degraded: 0,
  derms_control_stopped: 0,
};

const labeledGauges: Record<Extract<GaugeMetricName, 'derms_control_degraded' | 'derms_control_stopped'>, Map<string, number>> = {
  derms_control_degraded: new Map(),
  derms_control_stopped: new Map(),
};

const labeledCounters: Record<CounterMetricName, Map<string, number>> = {
  derms_stale_telemetry_total: new Map(),
  derms_missing_telemetry_total: new Map(),
  derms_mqtt_disconnect_total: new Map(),
  derms_mqtt_publish_fail_total: new Map(),
  derms_db_error_total: new Map(),
};

const histogramBuckets = [50, 100, 250, 500, 1000, 2000, 5000];
const histograms: Record<HistogramMetricName, { buckets: number[]; counts: number[]; sum: number; count: number }> = {
  derms_mqtt_publish_latency_ms: {
    buckets: histogramBuckets,
    counts: histogramBuckets.map(() => 0),
    sum: 0,
    count: 0,
  },
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

function renderLabeledCounters(name: CounterMetricName): string[] {
  const lines: string[] = [];
  const entries = labeledCounters[name];
  entries.forEach((value, labelKey) => {
    lines.push(`${name}${labelKey} ${value}`);
  });
  return lines;
}

function renderHistograms(name: HistogramMetricName): string[] {
  const lines: string[] = [];
  const hist = histograms[name];
  let cumulative = 0;
  hist.buckets.forEach((bucket, idx) => {
    cumulative += hist.counts[idx];
    lines.push(`${name}_bucket{le="${bucket}"} ${cumulative}`);
  });
  lines.push(`${name}_bucket{le="+Inf"} ${hist.count}`);
  lines.push(`${name}_sum ${hist.sum}`);
  lines.push(`${name}_count ${hist.count}`);
  return lines;
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
  (Object.keys(metricDefs) as (GaugeMetricName | CounterMetricName | HistogramMetricName)[]).forEach((name) => {
    const def = metricDefs[name];
    lines.push(`# HELP ${name} ${def.help}`);
    lines.push(`# TYPE ${name} ${def.type}`);
    if (def.type === 'gauge') {
      if (name === 'derms_control_degraded' || name === 'derms_control_stopped') {
        const map = labeledGauges[name];
        if (map.size === 0) {
          lines.push(`${name} 0`);
        } else {
          map.forEach((value, labelKey) => {
            lines.push(`${name}${labelKey} ${value}`);
          });
        }
      } else {
        lines.push(`${name} ${gaugeValues[name as GaugeMetricName] ?? 0}`);
      }
    } else if (def.type === 'counter') {
      lines.push(...renderLabeledCounters(name as CounterMetricName));
    } else if (def.type === 'histogram') {
      lines.push(...renderHistograms(name as HistogramMetricName));
    }
  });
  return lines.join('\n') + '\n';
}

function labelsToKey(labels: Record<string, string | number>): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

export function incrementCounter(
  name: CounterMetricName,
  labels: Record<string, string | number> = {},
  amount = 1,
): void {
  const key = labelsToKey(labels);
  const current = labeledCounters[name].get(key) ?? 0;
  labeledCounters[name].set(key, current + amount);
}

export function setGauge(
  name: Extract<GaugeMetricName, 'derms_control_degraded' | 'derms_control_stopped'>,
  value: number,
  labels: Record<string, string | number> = {},
): void {
  const key = labelsToKey(labels);
  labeledGauges[name].set(key, value);
}

export function observeHistogram(name: HistogramMetricName, valueMs: number): void {
  const hist = histograms[name];
  hist.count += 1;
  hist.sum += valueMs;
  hist.buckets.forEach((bucket, idx) => {
    if (valueMs <= bucket) {
      hist.counts[idx] += 1;
    }
  });
}
