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
  | 'derms_control_stopped'
  | 'derms_control_cycle_interval_lag_seconds'
  | 'derms_control_cycle_inflight'
  | 'derms_devices_seen'
  | 'derms_devices_fresh'
  | 'derms_devices_stale'
  | 'derms_feeder_headroom_kw'
  | 'derms_feeder_allocated_kw'
  | 'derms_feeder_unused_kw'
  | 'derms_setpoint_inflight'
  | 'derms_telemetry_ingest_queue_depth';

type CounterMetricName =
  | 'derms_stale_telemetry_total'
  | 'derms_missing_telemetry_total'
  | 'derms_mqtt_disconnect_total'
  | 'derms_mqtt_publish_fail_total'
  | 'derms_db_error_total'
  | 'derms_contract_validation_fail_total'
  | 'derms_contract_version_reject_total'
  | 'derms_duplicate_message_total'
  | 'derms_out_of_order_total'
  | 'derms_telemetry_dropped_total'
  | 'derms_control_cycle_errors_total'
  | 'derms_setpoint_publish_total'
  | 'derms_setpoint_ack_total';

type HistogramMetricName =
  | 'derms_mqtt_publish_latency_ms'
  | 'derms_setpoint_publish_latency_seconds'
  | 'derms_control_cycle_duration_seconds'
  | 'derms_telemetry_age_seconds'
  | 'derms_device_allocated_kw';

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
  derms_control_cycle_interval_lag_seconds: {
    help: 'Difference between expected and actual control loop start time (seconds)',
    type: 'gauge',
  },
  derms_control_cycle_inflight: { help: 'Control loop currently running (0/1)', type: 'gauge' },
  derms_devices_seen: { help: 'Devices seen this control cycle', type: 'gauge' },
  derms_devices_fresh: { help: 'Devices with fresh telemetry this cycle', type: 'gauge' },
  derms_devices_stale: { help: 'Devices with stale telemetry this cycle', type: 'gauge' },
  derms_feeder_headroom_kw: { help: 'Feeder headroom available for allocation (kW)', type: 'gauge' },
  derms_feeder_allocated_kw: { help: 'Allocated feeder headroom (kW)', type: 'gauge' },
  derms_feeder_unused_kw: { help: 'Unused feeder headroom (kW)', type: 'gauge' },
  derms_setpoint_inflight: { help: 'Setpoints currently in-flight (0/1)', type: 'gauge' },
  derms_telemetry_ingest_queue_depth: {
    help: 'Current telemetry ingest queue depth after backpressure',
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
  derms_contract_validation_fail_total: {
    help: 'Count of contract validation failures grouped by messageType/reason',
    type: 'counter',
  },
  derms_contract_version_reject_total: {
    help: 'Count of messages rejected because of incompatible schema version',
    type: 'counter',
  },
  derms_duplicate_message_total: {
    help: 'Count of duplicated messages discarded because of idempotency rules',
    type: 'counter',
  },
  derms_out_of_order_total: {
    help: 'Count of out-of-order messages observed per message type',
    type: 'counter',
  },
  derms_telemetry_dropped_total: {
    help: 'Telemetry messages dropped because of backpressure limits',
    type: 'counter',
  },
  derms_control_cycle_errors_total: {
    help: 'Control loop errors grouped by stage (ingest|compute|publish|db)',
    type: 'counter',
  },
  derms_setpoint_publish_total: {
    help: 'Setpoint publish attempts grouped by result and deviceType',
    type: 'counter',
  },
  derms_setpoint_ack_total: {
    help: 'Setpoint acknowledgements grouped by result and deviceType',
    type: 'counter',
  },
  derms_mqtt_publish_latency_ms: {
    help: 'Latency histogram for MQTT publish operations (ms)',
    type: 'histogram',
  },
  derms_setpoint_publish_latency_seconds: {
    help: 'Latency histogram for setpoint publishes (seconds)',
    type: 'histogram',
  },
  derms_control_cycle_duration_seconds: {
    help: 'Duration of a full control loop cycle (seconds)',
    type: 'histogram',
  },
  derms_telemetry_age_seconds: {
    help: 'Age of telemetry samples by device type (seconds)',
    type: 'histogram',
  },
  derms_device_allocated_kw: {
    help: 'Allocated power per device by device type (kW)',
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
  derms_control_cycle_interval_lag_seconds: 0,
  derms_control_cycle_inflight: 0,
  derms_devices_seen: 0,
  derms_devices_fresh: 0,
  derms_devices_stale: 0,
  derms_feeder_headroom_kw: 0,
  derms_feeder_allocated_kw: 0,
  derms_feeder_unused_kw: 0,
  derms_setpoint_inflight: 0,
  derms_telemetry_ingest_queue_depth: 0,
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
  derms_contract_validation_fail_total: new Map(),
  derms_contract_version_reject_total: new Map(),
  derms_duplicate_message_total: new Map(),
  derms_out_of_order_total: new Map(),
  derms_telemetry_dropped_total: new Map(),
  derms_control_cycle_errors_total: new Map(),
  derms_setpoint_publish_total: new Map(),
  derms_setpoint_ack_total: new Map(),
};

const histogramBucketsMs = [50, 100, 250, 500, 1000, 2000, 5000];
const histogramBucketsSeconds = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
const histogramBucketsKw = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100];

type HistogramStore = { buckets: number[]; counts: number[]; sum: number; count: number };

const histograms: Record<HistogramMetricName, { buckets: number[]; data: Map<string, HistogramStore> }> = {
  derms_mqtt_publish_latency_ms: {
    buckets: histogramBucketsMs,
    data: new Map(),
  },
  derms_setpoint_publish_latency_seconds: {
    buckets: histogramBucketsSeconds,
    data: new Map(),
  },
  derms_control_cycle_duration_seconds: {
    buckets: histogramBucketsSeconds,
    data: new Map(),
  },
  derms_telemetry_age_seconds: {
    buckets: histogramBucketsSeconds,
    data: new Map(),
  },
  derms_device_allocated_kw: {
    buckets: histogramBucketsKw,
    data: new Map(),
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
  hist.data.forEach((store, labelKey) => {
    let cumulative = 0;
    store.buckets.forEach((bucket, idx) => {
      cumulative += store.counts[idx];
      const labels = labelKey ? `${labelKey.slice(0, -1)},le="${bucket}"}` : `{le="${bucket}"}`;
      lines.push(`${name}_bucket${labels} ${cumulative}`);
    });
    const labels = labelKey ? `${labelKey.slice(0, -1)},le="+Inf"}` : '{le="+Inf"}';
    lines.push(`${name}_bucket${labels} ${store.count}`);
    lines.push(`${name}_sum${labelKey} ${store.sum}`);
    lines.push(`${name}_count${labelKey} ${store.count}`);
  });
  if (hist.data.size === 0) {
    const buckets = hist.buckets;
    buckets.forEach((bucket) => {
      lines.push(`${name}_bucket{le="${bucket}"} 0`);
    });
    lines.push(`${name}_bucket{le="+Inf"} 0`);
    lines.push(`${name}_sum 0`);
    lines.push(`${name}_count 0`);
  }
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

export function setGaugeValue(name: Exclude<GaugeMetricName, 'derms_control_degraded' | 'derms_control_stopped'>, value: number) {
  gaugeValues[name] = value;
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

export function observeHistogram(
  name: HistogramMetricName,
  value: number,
  labels: Record<string, string | number> = {},
): void {
  const hist = histograms[name];
  const key = labelsToKey(labels);
  if (!hist.data.has(key)) {
    hist.data.set(key, {
      buckets: [...hist.buckets],
      counts: hist.buckets.map(() => 0),
      sum: 0,
      count: 0,
    });
  }

  const store = hist.data.get(key)!;
  store.count += 1;
  store.sum += value;
  store.buckets.forEach((bucket, idx) => {
    if (value <= bucket) {
      store.counts[idx] += 1;
    }
  });
}

export function resetMetricsForTest(): void {
  (Object.keys(gaugeValues) as GaugeMetricName[]).forEach((name) => {
    gaugeValues[name] = 0;
  });

  (Object.keys(labeledGauges) as Extract<
    GaugeMetricName,
    'derms_control_degraded' | 'derms_control_stopped'
  >[]).forEach((name) => labeledGauges[name].clear());

  (Object.keys(labeledCounters) as CounterMetricName[]).forEach((name) =>
    labeledCounters[name].clear(),
  );

  (Object.keys(histograms) as HistogramMetricName[]).forEach((name) => {
    const hist = histograms[name];
    hist.data.clear();
  });
}
