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
  };

  const existing = trackingHistory.get(args.deviceId) ?? [];
  existing.push(sample);
  trackingHistory.set(args.deviceId, existing);
}

export function getTrackingMetrics(windowMinutes?: number): DeviceMetrics[] {
  const windowMs = (windowMinutes ?? config.trackingErrorWindowMinutes) * 60 * 1000;
  prune(windowMs);

  return [...trackingHistory.entries()].map(([deviceId, samples]) => {
    const count = samples.length || 1;
    const totalError = samples.reduce((sum, s) => sum + s.absError, 0);
    const last = samples[samples.length - 1];
    return {
      deviceId,
      type: last.type,
      siteId: last.siteId,
      avgAbsError: totalError / count,
      lastSetpointKw: last.setpoint,
      lastActualKw: last.actual,
      priority: last.priority,
      soc: last.soc,
      isPhysical: last.isPhysical,
    };
  });
}
