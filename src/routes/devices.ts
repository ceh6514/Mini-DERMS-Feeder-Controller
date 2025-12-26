import { Router, type Request, type Response } from 'express';
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
import { asyncHandler } from './asyncHandler';
import logger from '../logger';


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

type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };
type Validator<T> = (payload: unknown) => ValidationResult<T>;

function parseOrRespond<T>(validator: Validator<T>, payload: unknown, res: Response): T | null {
  const result = validator(payload);
  if (!result.ok) {
    const issues = (result as { ok: false; issues: string[] }).issues;
    logger.warn('[http] request validation failed', { issues });
    res.status(400).json({ error: 'Invalid request', details: issues });
    return null;
  }
  return result.value;
}

const validateDevicesQuery: Validator<{ feederId?: string }> = (payload) => {
  const query = (payload ?? {}) as Record<string, unknown>;
  if (query.feederId === undefined) return { ok: true, value: { feederId: undefined } };
  if (typeof query.feederId !== 'string') {
    return { ok: false, issues: ['feederId must be a string'] };
  }
  const feederId = query.feederId.trim();
  if (!feederId) return { ok: false, issues: ['feederId must not be empty'] };
  return { ok: true, value: { feederId } };
};

const validateTelemetryQuery: Validator<{ limit: number }> = (payload) => {
  const query = (payload ?? {}) as Record<string, unknown>;
  const rawLimit = query.limit ?? 100;
  const limit = Number(rawLimit);
  if (!Number.isFinite(limit) || limit <= 0) {
    return { ok: false, issues: ['limit must be a positive number'] };
  }
  const bounded = Math.min(Math.floor(limit), 1000);
  return { ok: true, value: { limit: bounded } };
};

const validateTelemetryParams: Validator<{ deviceId: string }> = (payload) => {
  const params = (payload ?? {}) as Record<string, unknown>;
  if (typeof params.deviceId !== 'string' || params.deviceId.trim() === '') {
    return { ok: false, issues: ['deviceId is required'] };
  }
  return { ok: true, value: { deviceId: params.deviceId.trim() } };
};

type TelemetryInput = {
  v?: number;
  messageType: string;
  messageId: string;
  deviceId: string;
  deviceType: string;
  timestampMs: number;
  sentAtMs?: number;
  source?: string;
  payload: Record<string, unknown>;
} & Record<string, unknown>;

const validateTelemetryBody: Validator<TelemetryInput> = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, issues: ['body must be an object'] };
  }
  const body = payload as Record<string, unknown>;
  const issues: string[] = [];

  if (body.messageType !== 'telemetry') issues.push('messageType must be "telemetry"');
  if (typeof body.messageId !== 'string' || body.messageId.trim() === '')
    issues.push('messageId is required');
  if (typeof body.deviceId !== 'string' || body.deviceId.trim() === '')
    issues.push('deviceId is required');
  if (typeof body.deviceType !== 'string' || body.deviceType.trim() === '')
    issues.push('deviceType is required');
  if (typeof body.timestampMs !== 'number' || !Number.isFinite(body.timestampMs))
    issues.push('timestampMs must be a number');
  if (body.sentAtMs !== undefined && (typeof body.sentAtMs !== 'number' || !Number.isFinite(body.sentAtMs)))
    issues.push('sentAtMs must be a number when provided');
  if (body.source !== undefined && typeof body.source !== 'string') issues.push('source must be a string');
  if (!body.payload || typeof body.payload !== 'object') issues.push('payload must be provided');

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      ...body,
      v: typeof body.v === 'number' ? body.v : undefined,
      messageType: 'telemetry',
      messageId: body.messageId as string,
      deviceId: (body.deviceId as string).trim(),
      deviceType: (body.deviceType as string).trim(),
      timestampMs: body.timestampMs as number,
      sentAtMs: typeof body.sentAtMs === 'number' ? (body.sentAtMs as number) : undefined,
      source: typeof body.source === 'string' ? (body.source as string) : undefined,
      payload: body.payload as Record<string, unknown>,
    },
  };
};

const validateLiveDevicesQuery: Validator<{ minutes: number; feederId?: string }> = (payload) => {
  const query = (payload ?? {}) as Record<string, unknown>;
  const rawMinutes = query.minutes ?? 2;
  const minutes = Number(rawMinutes);
  const issues: string[] = [];
  if (!Number.isFinite(minutes) || minutes <= 0) {
    issues.push('minutes must be a positive number');
  }

  let feederId: string | undefined;
  if (query.feederId !== undefined) {
    if (typeof query.feederId !== 'string') {
      issues.push('feederId must be a string');
    } else if (query.feederId.trim() === '') {
      issues.push('feederId must not be empty');
    } else {
      feederId = query.feederId.trim();
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: { minutes: Math.min(Math.floor(minutes), 60), feederId } };
};

const validateSolarFeederParams: Validator<{ feederId: string }> = (payload) => {
  const params = (payload ?? {}) as Record<string, unknown>;
  if (typeof params.feederId !== 'string' || params.feederId.trim() === '') {
    return { ok: false, issues: ['feederId is required'] };
  }
  return { ok: true, value: { feederId: params.feederId.trim() } };
};

router.get('/devices', asyncHandler(async (req: Request, res) => {
  const parsedQuery = parseOrRespond(validateDevicesQuery, req.query, res);
  if (!parsedQuery) return;

  const [devices, latestTelemetry] = await Promise.all([
    getAllDevices(),
    getLatestTelemetryPerDevice(parsedQuery.feederId),
  ]);

  const filteredDevices = parsedQuery.feederId
    ? devices.filter((device) => device.feederId === parsedQuery.feederId)
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
}));

router.get('/telemetry/:deviceId', asyncHandler(async (req: Request, res) => {
  const params = parseOrRespond(validateTelemetryParams, req.params, res);
  if (!params) return;
  const query = parseOrRespond(validateTelemetryQuery, req.query, res);
  if (!query) return;

  const telemetry = await getRecentTelemetry(params.deviceId, query.limit);
  res.json(telemetry);
}));

router.get('/solar-feeders/:feederId/latest-weather', asyncHandler(async (req: Request, res) => {
  const params = parseOrRespond(validateSolarFeederParams, req.params, res);
  if (!params) return;

  const sample = await getLatestSolarWeatherSample(params.feederId);

  if (!sample) {
    res.status(404).json({ error: 'No data' });
    return;
  }

  res.json(sample);
}));

router.post(
  '/telemetry',
  requireRole('operator'),
  asyncHandler(async (req: Request, res) => {
    const payload = parseOrRespond(validateTelemetryBody, req.body ?? {}, res);
    if (!payload) return;
    try {
      const result = await telemetryHandler.handle(payload);
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
      throw err;
    }
  }),
);

router.get('/live-devices', asyncHandler(async (req: Request, res) => {
  const query = parseOrRespond(validateLiveDevicesQuery, req.query, res);
  if (!query) return;

  const devices = await getLiveDevices(query.minutes, query.feederId);
  res.json(devices);
}));

export default router;
