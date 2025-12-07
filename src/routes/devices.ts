import { Router } from 'express';
import { getAllDevices, getDeviceById, upsertDevice } from '../repositories/devicesRepo';
import {
  getLatestTelemetryPerDevice,
  getLatestSolarWeatherSample,
  getRecentTelemetry,
  getLiveDevices,
  insertTelemetry,
} from '../repositories/telemetryRepo';
import { recordHeartbeat } from '../state/controlLoopMonitor';
import {
  TelemetryValidationError,
  validateTelemetryPayload,
} from '../validation/telemetry';


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
    devices.map((d) => {
      const isPi = d.id.startsWith('pi-');
      const isSimulated =
        d.id.startsWith('pv-') || d.id.startsWith('bat-') || d.id.startsWith('ev-');

      return {
        ...d,
        priority: d.priority ?? null,
        latestTelemetry: latestByDevice[d.id] ?? null,
        isPi,
        isSimulated,
      };
    }),
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

router.post('/telemetry', async (req, res) => {
  try {
    const telemetry = validateTelemetryPayload(req.body ?? {});
    const device = await getDeviceById(telemetry.deviceId);
    const type = device?.type ?? telemetry.type;
    const siteId = device?.siteId ?? telemetry.siteId;

    await upsertDevice({
      id: telemetry.deviceId,
      type,
      siteId,
      pMaxKw: telemetry.pMaxKw,
      priority: telemetry.priority,
    });

    recordHeartbeat(telemetry.deviceId, telemetry.ts.getTime());

    await insertTelemetry({
      device_id: telemetry.deviceId,
      ts: telemetry.ts,
      type,
      p_actual_kw: telemetry.pActualKw,
      p_setpoint_kw: telemetry.pSetpointKw,
      soc: telemetry.soc,
      site_id: siteId,
    });

    res.status(201).json({ status: 'ok' });
  } catch (err) {
    if (err instanceof TelemetryValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error('[telemetry] failed to save telemetry row', err);
    res.status(500).json({ error: 'Failed to save telemetry' });
  }
});

router.get('/live-devices', async (req, res) => {
  try {
    const minutesParam = Number(req.query.minutes ?? 2);
    const minutes = Number.isFinite(minutesParam) && minutesParam > 0 ? minutesParam : 2;
    const devices = await getLiveDevices(minutes);
    res.json(devices);
  } catch (err) {
    console.error('[live-devices] failed to load recent devices', err);
    res.status(500).json({ error: 'Failed to load live devices' });
  }
});

export default router;
