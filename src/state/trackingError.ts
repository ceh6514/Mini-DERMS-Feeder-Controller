import config from '../config';
import { DeviceMetrics } from '../types/control';

interface TrackingSample {
  timestampMs: number;
  absError: number;
  actual: number;
  setpoint: number;
  priority: number;
  soc: number | null;
  type: string;
  siteId: string;
  isPhysical: boolean;
  feederId: string;
}

const trackingHistory = new Map<string, TrackingSample[]>();

function prune(windowMs: number) {
  const cutoff = Date.now() - windowMs;
  for (const [deviceId, samples] of trackingHistory.entries()) {
    const filtered = samples.filter((s) => s.timestampMs >= cutoff);
    if (filtered.length === 0) {
      trackingHistory.delete(deviceId);
    } else {
      trackingHistory.set(deviceId, filtered);
    }
  }
}

export function recordTrackingSample(args: {
  deviceId: string;
  type: string;
  siteId: string;
  feederId: string;
  priority: number;
  soc: number | null;
  isPhysical: boolean;
  setpointKw: number;
  actualKw: number;
}) {
  const windowMs = config.trackingErrorWindowMinutes * 60 * 1000;
  prune(windowMs);

  const absError = Math.abs(args.actualKw - args.setpointKw);
  const sample: TrackingSample = {
    timestampMs: Date.now(),
    absError,
    actual: args.actualKw,
    setpoint: args.setpointKw,
    priority: args.priority,
    soc: args.soc,
    type: args.type,
    siteId: args.siteId,
    isPhysical: args.isPhysical,
    feederId: args.feederId,
  };

  const existing = trackingHistory.get(args.deviceId) ?? [];
  existing.push(sample);
  trackingHistory.set(args.deviceId, existing);
}

export function getTrackingMetrics(windowMinutes?: number, feederId?: string): DeviceMetrics[] {
  const windowMs = (windowMinutes ?? config.trackingErrorWindowMinutes) * 60 * 1000;
  prune(windowMs);

  const normalizedFeeder = feederId?.trim();
  const metrics: DeviceMetrics[] = [];

  for (const [deviceId, samples] of trackingHistory.entries()) {
    const count = samples.length || 1;
    const totalError = samples.reduce((sum, s) => sum + s.absError, 0);
    const last = samples[samples.length - 1];
    if (normalizedFeeder && last.feederId !== normalizedFeeder) {
      continue;
    }

    metrics.push({
      deviceId,
      type: last.type,
      siteId: last.siteId,
      feederId: last.feederId,
      avgAbsError: totalError / count,
      lastSetpointKw: last.setpoint,
      lastActualKw: last.actual,
      priority: last.priority,
      soc: last.soc,
      isPhysical: last.isPhysical,
    });
  }

  return metrics;
}
