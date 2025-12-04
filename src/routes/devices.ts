import { Router } from 'express';
import { getAllDevices } from '../repositories/devicesRepo';
import {
  getLatestTelemetryPerDevice,
  getLatestSolarWeatherSample,
  getRecentTelemetry,
} from '../repositories/telemetryRepo';


const router = Router();

router.get('/devices', async (_req, res) => {
  const [devices, latestTelemetry] = await Promise.all([
    getAllDevices(),
    getLatestTelemetryPerDevice(),
  ]);

  const latestByDevice = latestTelemetry.reduce<Record<string, unknown>>((acc, row) => {
    acc[row.device_id] = row;
    return acc;
  }, {});

  res.json(
    devices.map((d) => ({
      ...d,
      priority: d.priority ?? null,
      latestTelemetry: latestByDevice[d.id] ?? null,
    })),
  );
});

router.get('/telemetry/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const telemetry = await getRecentTelemetry(deviceId, 100);
  res.json(telemetry);
});

router.get('/solar-feeders/:feederId/latest-weather', async (req, res) => {
  try {
    const { feederId } = req.params;
    const sample = await getLatestSolarWeatherSample(feederId);

    if (!sample) {
      res.status(404).json({ error: 'No data' });
      return;
    }

    res.json(sample);
  } catch (err) {
    console.error('[latest solar weather] error', err);
    res.status(500).json({ error: 'Failed to load latest solar weather' });
  }
});

export default router;
