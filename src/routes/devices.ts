import { Router } from 'express';
import { getAllDevices, getDeviceById } from '../repositories/devicesRepo';
import {
  getLatestTelemetryPerDevice,
  getLatestSolarWeatherSample,
  getRecentTelemetry,
  insertTelemetry,
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

router.post('/telemetry', async (req, res) => {
  const { device_id, ts, p_actual_kw, p_setpoint_kw, soc, site_id } = req.body ?? {};

  if (!device_id || typeof device_id !== 'string') {
    res.status(400).json({ error: 'device_id is required' });
    return;
  }

  if (!site_id || typeof site_id !== 'string') {
    res.status(400).json({ error: 'site_id is required' });
    return;
  }

  const timestamp = new Date(ts);
  if (!ts || Number.isNaN(timestamp.getTime())) {
    res.status(400).json({ error: 'ts must be a valid timestamp' });
    return;
  }

  const pActual = Number(p_actual_kw);
  if (!Number.isFinite(pActual)) {
    res.status(400).json({ error: 'p_actual_kw must be a number' });
    return;
  }

  let pSetpoint: number | null = null;
  if (p_setpoint_kw !== undefined && p_setpoint_kw !== null) {
    pSetpoint = Number(p_setpoint_kw);
    if (!Number.isFinite(pSetpoint)) {
      res.status(400).json({ error: 'p_setpoint_kw must be a number when provided' });
      return;
    }
  }

  let socValue: number | null = null;
  if (soc !== undefined && soc !== null) {
    socValue = Number(soc);
    if (!Number.isFinite(socValue)) {
      res.status(400).json({ error: 'soc must be a number when provided' });
      return;
    }
  }

  try {
    const device = await getDeviceById(device_id);
    const type = device?.type ?? 'manual';
    const siteId = device?.siteId ?? site_id;

    await insertTelemetry({
      device_id,
      ts: timestamp,
      type,
      p_actual_kw: pActual,
      p_setpoint_kw: pSetpoint,
      soc: socValue,
      site_id: siteId,
    });

    res.status(201).json({ status: 'ok' });
  } catch (err) {
    console.error('[telemetry] failed to save telemetry row', err);
    res.status(500).json({ error: 'Failed to save telemetry' });
  }
});

export default router;
