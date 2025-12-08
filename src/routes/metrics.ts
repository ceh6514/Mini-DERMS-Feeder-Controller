import { Router } from 'express';
import config from '../config';
import { getTrackingErrorWindow } from '../repositories/telemetryRepo';
import { getAllDevices } from '../repositories/devicesRepo';
import { getTrackingMetrics } from '../state/trackingError';
import { DeviceMetrics } from '../types/control';

const router = Router();

router.get('/metrics/tracking-error', async (req, res) => {
  try {
    const minutesParam = Number(req.query.minutes ?? config.trackingErrorWindowMinutes);
    const windowMinutes = Number.isFinite(minutesParam) && minutesParam > 0
      ? minutesParam
      : config.trackingErrorWindowMinutes;
    const feederId = typeof req.query.feederId === 'string' ? req.query.feederId : undefined;

    const [inMemory, dbMetrics, devices] = await Promise.all([
      getTrackingMetrics(windowMinutes, feederId),
      getTrackingErrorWindow(windowMinutes, feederId),
      getAllDevices(),
    ]);

    const relevantDevices = feederId
      ? devices.filter((device) => device.feederId === feederId)
      : devices;
    const deviceLookup = new Map(relevantDevices.map((d) => [d.id, d]));
    const merged = new Map<string, DeviceMetrics>();

    for (const metric of dbMetrics) {
      merged.set(metric.deviceId, metric);
    }

    for (const metric of inMemory) {
      merged.set(metric.deviceId, {
        ...merged.get(metric.deviceId),
        ...metric,
      });
    }

    const response = [...merged.values()].map((metric) => {
      const meta = deviceLookup.get(metric.deviceId);
      const isPhysical = metric.isPhysical || Boolean(meta?.isPhysical);
      return {
        ...metric,
        priority: meta?.priority ?? metric.priority ?? 1,
        isPhysical,
      };
    });

    res.json(response);
  } catch (err) {
    console.error('[metrics] failed to compute tracking error', err);
    res.status(500).json({ error: 'Failed to load tracking error metrics' });
  }
});

export default router;
