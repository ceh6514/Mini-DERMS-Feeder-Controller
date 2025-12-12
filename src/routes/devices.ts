import { Router } from 'express';
import { getAllDevices, getDeviceById, upsertDevice, isPhysicalDeviceId } from '../repositories/devicesRepo';
import {
  getLatestTelemetryPerDevice,
  getLatestSolarWeatherSample,
  getRecentTelemetry,
  getLiveDevices,
  insertTelemetry,
} from '../repositories/telemetryRepo';
import { recordHeartbeat } from '../state/controlLoopMonitor';
import { ContractValidationError } from '../contracts';
import { TelemetryHandler } from '../messaging/telemetryHandler';
import { requireRole } from '../auth';
import config from '../config';


const router = Router();

const telemetryHandler = new TelemetryHandler({
  save: (row) =>
    insertTelemetry({
      message_id: row.message_id,
      message_version: row.message_version,
      message_type: row.message_type,
      sent_at: row.sent_at,
      source: row.source,
      device_id: row.device_id,
      ts: row.ts,
      type: row.type,
      p_actual_kw: row.p_actual_kw,
      p_setpoint_kw: row.p_setpoint_kw,
      soc: row.soc,
      site_id: row.site_id,
      feeder_id: row.feeder_id,
    }),
});

router.get('/devices', async (req, res) => {
  const feederId = typeof req.query.feederId === 'string' ? req.query.feederId : undefined;
  const [devices, latestTelemetry] = await Promise.all([
    getAllDevices(),
    getLatestTelemetryPerDevice(feederId),
  ]);

  const filteredDevices = feederId
    ? devices.filter((device) => device.feederId === feederId)
    : devices;

  const latestByDevice = latestTelemetry.reduce<Record<string, unknown>>((acc, row) => {
    acc[row.device_id] = row;
    return acc;
  }, {});

  res.json(
    filteredDevices.map((d) => {
      const isPi = d.id.startsWith('pi-') || Boolean(d.isPhysical);
      const isSimulated =
        !isPi && (d.id.startsWith('pv-') || d.id.startsWith('bat-') || d.id.startsWith('ev-'));

      return {
        ...d,
        priority: d.priority ?? null,
        isPhysical: isPi,
        latestTelemetry: latestByDevice[d.id] ?? null,
        isPi,
        isSimulated,
      };
    }),
  );
});

router.get('/telemetry/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const limitParam = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100;
  const telemetry = await getRecentTelemetry(deviceId, limit);
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

router.post('/telemetry', requireRole('operator'), async (req, res) => {
  try {
    const result = await telemetryHandler.handle(req.body ?? {});
    const telemetry = result.parsed;
    if (!telemetry) {
      res.status(400).json({ error: 'Failed to parse telemetry' });
      return;
    }

    const device = await getDeviceById(telemetry.deviceId);
    const siteId = telemetry.payload.siteId ?? device?.siteId ?? config.defaultFeederId;
    const feederId = telemetry.payload.feederId ?? device?.feederId ?? siteId;

    await upsertDevice({
      id: telemetry.deviceId,
      type: telemetry.deviceType,
      siteId,
      feederId,
      pMaxKw:
        telemetry.payload.capabilities?.maxDischargeKw ??
        telemetry.payload.capabilities?.maxChargeKw ??
        telemetry.payload.capabilities?.maxExportKw ??
        telemetry.payload.capabilities?.maxImportKw ??
        config.feederDefaultLimitKw,
      priority: null,
      isPhysical: isPhysicalDeviceId(telemetry.deviceId),
    });

    if (result.newest) {
      recordHeartbeat(telemetry.deviceId, telemetry.timestampMs);
    }

    res.status(201).json({ status: 'ok' });
  } catch (err) {
    if (err instanceof ContractValidationError) {
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
    const feederId = typeof req.query.feederId === 'string' ? req.query.feederId : undefined;
    const devices = await getLiveDevices(minutes, feederId);
    res.json(devices);
  } catch (err) {
    console.error('[live-devices] failed to load recent devices', err);
    res.status(500).json({ error: 'Failed to load live devices' });
  }
});

export default router;
