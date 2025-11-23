import { Router } from 'express';
import { getAllDevices } from '../repositories/devicesRepo';
import { getLatestTelemetryPerDevice, getRecentTelemetry } from '../repositories/telemetryRepo';


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
      latestTelemetry: latestByDevice[d.id] ?? null,
    })),
  );
});

router.get('/telemetry/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const telemetry = await getRecentTelemetry(deviceId, 100);
  res.json(telemetry);
});

export default router;
