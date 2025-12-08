import {
  DeviceWithLatest,
  DrEvent,
  AggregatedMetricsResponse,
  FeederHistoryResponse,
  FeederSummary,
  HealthResponse,
  DrProgram,
  DrImpactSnapshot,
  MetricsWindow,
  SimulationMode,
  SimulationModeResponse,
  DeviceTelemetry,
  DeviceMetrics,
  FeederInfo,
} from './types';
import { authFetch } from './http';

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

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await authFetch('/api/health', { signal });
  if (!res.ok) {
    throw new Error('Failed to fetch health status');
  }
  return res.json();
}


// Fetch feeder summary from the backend.
export async function fetchFeederSummary(
  feederId?: string,
  signal?: AbortSignal,
): Promise<FeederSummary> {
  const params = new URLSearchParams();
  if (feederId) params.set('feederId', feederId);
  const res = await authFetch(
    `/api/feeder/summary${params.size ? `?${params.toString()}` : ''}`,
    { signal },
  );
  if (!res.ok) {
    throw new Error('Failed to fetch feeder summary');
  }
  return res.json();
}

// Fetch devices with their latest telemetry.
export async function fetchDevices(
  feederId?: string,
  signal?: AbortSignal,
): Promise<DeviceWithLatest[]> {
  const params = new URLSearchParams();
  if (feederId) params.set('feederId', feederId);
  const res = await authFetch(
    `/api/devices${params.size ? `?${params.toString()}` : ''}`,
    { signal },
  );
  if (!res.ok) {
    throw new Error('Failed to fetch devices');
  }
  return res.json();
}

export async function fetchFeeders(signal?: AbortSignal): Promise<FeederInfo[]> {
  const res = await authFetch(`/api/feeder/feeders`, { signal });
  if (!res.ok) {
    throw new Error('Failed to fetch feeders');
  }
  return res.json();
}

export async function createDrEvent(input: CreateDrEventInput): Promise<DrEvent> {
  const now = new Date();
  const tsStart = now.toISOString();
  const tsEnd = new Date(now.getTime() + input.durationMinutes * 60 * 1000).toISOString();

  const res = await authFetch(`/api/events`, {
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

export async function fetchDrPrograms(): Promise<DrProgram[]> {
  const res = await authFetch(`/api/dr-programs`);
  if (!res.ok) {
    throw new Error('Failed to fetch DR programs');
  }
  return (await res.json()) as DrProgram[];
}

export interface DrProgramInput {
  name: string;
  mode: 'fixed_cap' | 'price_elastic';
  tsStart: string;
  tsEnd: string;
  targetShedKw?: number;
  incentivePerKwh?: number;
  penaltyPerKwh?: number;
  isActive?: boolean;
}

export async function createDrProgram(input: DrProgramInput): Promise<DrProgram> {
  const res = await authFetch(`/api/dr-programs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create DR program: ${text}`);
  }
  return (await res.json()) as DrProgram;
}

export async function updateDrProgram(id: number, input: Partial<DrProgramInput>): Promise<DrProgram> {
  const res = await authFetch(`/api/dr-programs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update DR program: ${text}`);
  }
  return (await res.json()) as DrProgram;
}

export async function deleteDrProgram(id: number): Promise<void> {
  const res = await authFetch(`/api/dr-programs/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Failed to delete DR program: ${text}`);
  }
}

export async function activateDrProgram(id: number): Promise<DrProgram> {
  const res = await authFetch(`/api/dr-programs/${id}/activate`, {
    method: 'POST',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to activate DR program: ${text}`);
  }
  return (await res.json()) as DrProgram;
}

export async function fetchActiveDrProgramImpact(): Promise<{ program: DrProgram | null; impact: DrImpactSnapshot | null }> {
  const res = await authFetch(`/api/dr-programs/active`);
  if (!res.ok) {
    throw new Error('Failed to fetch active DR program');
  }
  return (await res.json()) as { program: DrProgram | null; impact: DrImpactSnapshot | null };
}

export async function fetchFeederHistory(
  minutes = 30,
  feederId?: string,
  signal?: AbortSignal,
): Promise<FeederHistoryResponse> {
  const params = new URLSearchParams({ minutes: String(minutes) });
  if (feederId) params.set('feederId', feederId);
  const res = await authFetch(`/api/feeder/history?` + params.toString(), { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch feeder history: ${res.status}`);
  }
  return (await res.json()) as FeederHistoryResponse;
}

export async function fetchSimulationMode(): Promise<SimulationModeResponse> {
  const res = await authFetch(`/api/simulation/mode`);
  if (!res.ok) {
    throw new Error('Failed to fetch simulation mode');
  }
  return (await res.json()) as SimulationModeResponse;
}

export async function setSimulationMode(mode: SimulationMode): Promise<SimulationModeResponse> {
  const res = await authFetch(`/api/simulation/mode`, {
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
  const res = await authFetch(`/api/simulation/mode/auto`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to reset simulation mode: ${text}`);
  }
  return (await res.json()) as SimulationModeResponse;
}

export async function sendTelemetry(input: TelemetryInput): Promise<void> {
  const res = await authFetch(`/api/telemetry`, {
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
  feederId?: string,
  signal?: AbortSignal,
): Promise<AggregatedMetricsResponse> {
  const params = new URLSearchParams({ window });
  if (bucketMinutes) {
    params.set('bucketMinutes', String(bucketMinutes));
  }
  if (feederId) {
    params.set('feederId', feederId);
  }

  const res = await authFetch(`/api/feeder/metrics?${params.toString()}`, { signal });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch aggregated metrics: ${text}`);
  }

  return (await res.json()) as AggregatedMetricsResponse;
}

export async function fetchTrackingErrors(
  minutes?: number,
  feederId?: string,
  signal?: AbortSignal,
): Promise<DeviceMetrics[]> {
  const params = new URLSearchParams();
  if (minutes) {
    params.set('minutes', String(minutes));
  }
  if (feederId) {
    params.set('feederId', feederId);
  }
  const res = await authFetch(
    `/api/metrics/tracking-error${params.size ? `?${params.toString()}` : ''}`,
    { signal },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch tracking error metrics: ${text}`);
  }
  return (await res.json()) as DeviceMetrics[];
}

export async function fetchDeviceTelemetry(
  deviceId: string,
  limit = 120,
): Promise<DeviceTelemetry[]> {
  const res = await authFetch(`/api/telemetry/${deviceId}?limit=${limit}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch telemetry for ${deviceId}: ${text}`);
  }
  return (await res.json()) as DeviceTelemetry[];
}
