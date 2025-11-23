import { DeviceWithLatest, FeederSummary } from './types';

const BASE_URL = 'http://localhost:3001';

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
