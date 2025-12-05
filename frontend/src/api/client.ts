import {
  DeviceWithLatest,
  DrEvent,
  AggregatedMetricsResponse,
  FeederHistoryResponse,
  FeederSummary,
  MetricsWindow,
  SimulationMode,
  SimulationModeResponse,
} from './types';

export interface CreateDrEventInput {
  limitKw: number;
  durationMinutes: number;
}

export interface TelemetryInput {
  deviceId: string;
  ts: string;
  pActualKw: number;
  pSetpointKw?: number;
  soc?: number;
  siteId: string;
}

const BASE_URL =
  import.meta.env.VITE_API_URL ||
  `${window.location.protocol}//${window.location.hostname}:3001`;


// Fetch feeder summary from the backend.
export async function fetchFeederSummary(): Promise<FeederSummary> {
  const res = await fetch(`${BASE_URL}/api/feeder/summary`);
  if (!res.ok) {
    throw new Error('Failed to fetch feeder summary');
  }
  return res.json();
}

// Fetch devices with their latest telemetry.
export async function fetchDevices(): Promise<DeviceWithLatest[]> {
  const res = await fetch(`${BASE_URL}/api/devices`);
  if (!res.ok) {
    throw new Error('Failed to fetch devices');
  }
  return res.json();
}

export async function createDrEvent(input: CreateDrEventInput): Promise<DrEvent> {
  const now = new Date();
  const tsStart = now.toISOString();
  const tsEnd = new Date(now.getTime() + input.durationMinutes * 60 * 1000).toISOString();

  const res = await fetch(`${BASE_URL}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tsStart,
      tsEnd,
      limitKw: input.limitKw,
      type: 'dr',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create DR event: ${res.status} ${text}`);
  }

  return (await res.json()) as DrEvent;
}

export async function fetchFeederHistory(minutes = 30): Promise<FeederHistoryResponse> {
  const params = new URLSearchParams({ minutes: String(minutes) });
  const res = await fetch(`${BASE_URL}/api/feeder/history?` + params.toString());
  if (!res.ok) {
    throw new Error(`Failed to fetch feeder history: ${res.status}`);
  }
  return (await res.json()) as FeederHistoryResponse;
}

export async function fetchSimulationMode(): Promise<SimulationModeResponse> {
  const res = await fetch(`${BASE_URL}/api/simulation/mode`);
  if (!res.ok) {
    throw new Error('Failed to fetch simulation mode');
  }
  return (await res.json()) as SimulationModeResponse;
}

export async function setSimulationMode(mode: SimulationMode): Promise<SimulationModeResponse> {
  const res = await fetch(`${BASE_URL}/api/simulation/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update simulation mode: ${text}`);
  }
  return (await res.json()) as SimulationModeResponse;
}

export async function resetSimulationMode(): Promise<SimulationModeResponse> {
  const res = await fetch(`${BASE_URL}/api/simulation/mode/auto`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to reset simulation mode: ${text}`);
  }
  return (await res.json()) as SimulationModeResponse;
}

export async function sendTelemetry(input: TelemetryInput): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: input.deviceId,
      ts: input.ts,
      p_actual_kw: input.pActualKw,
      p_setpoint_kw: input.pSetpointKw ?? null,
      soc: input.soc ?? null,
      site_id: input.siteId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to send telemetry: ${text}`);
  }
}

export async function fetchAggregatedMetrics(
  window: MetricsWindow,
  bucketMinutes?: number,
): Promise<AggregatedMetricsResponse> {
  const params = new URLSearchParams({ window });
  if (bucketMinutes) {
    params.set('bucketMinutes', String(bucketMinutes));
  }

  const res = await fetch(`${BASE_URL}/api/feeder/metrics?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch aggregated metrics: ${text}`);
  }

  return (await res.json()) as AggregatedMetricsResponse;
}
