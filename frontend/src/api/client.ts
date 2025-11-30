import { DeviceWithLatest, DrEvent, FeederHistoryResponse, FeederSummary } from './types';

export interface CreateDrEventInput {
  limitKw: number;
  durationMinutes: number;
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
