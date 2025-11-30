import { Router } from 'express';
import { getCurrentFeederLimit } from '../repositories/eventsRepo';
import {
  getFeederHistory,
  getLatestTelemetryPerDevice,
} from '../repositories/telemetryRepo';

const router = Router();

/**
 * GET /api/feeder/summary
 *
 * Returns current feeder total kW, limit, device count, and per-type aggregates.
 */
router.get('/summary', async (_req, res) => {
  try {
    const now = new Date();
    const [limitKw, latest] = await Promise.all([
      getCurrentFeederLimit(now),
      getLatestTelemetryPerDevice(),
    ]);

    const summary = latest.reduce(
      (
        acc: {
          totalKw: number;
          deviceCount: number;
          byType: Record<string, { count: number; totalKw: number }>;
        },
        row: any,
      ) => {
        const p = Number(row.p_actual_kw ?? 0);
        acc.totalKw += p;
        acc.deviceCount += 1;

        const type = row.type ?? 'unknown';
        if (!acc.byType[type]) {
          acc.byType[type] = { count: 0, totalKw: 0 };
        }
        acc.byType[type].count += 1;
        acc.byType[type].totalKw += p;

        return acc;
      },
      {
        totalKw: 0,
        deviceCount: 0,
        byType: {} as Record<string, { count: number; totalKw: number }>,
      },
    );

    res.json({
      totalKw: summary.totalKw,
      limitKw,
      deviceCount: summary.deviceCount,
      byType: summary.byType,
    });
  } catch (err) {
    console.error('[feeder summary] error', err);
    res.status(500).json({ error: 'Failed to load feeder summary' });
  }
});

/**
 * GET /api/feeder/history?minutes=30&bucketSeconds=60
 *
 * Returns downsampled history of total feeder kW over a recent window.
 */
router.get('/history', async (req, res) => {
  try {
    const minutes = req.query.minutes ? Number(req.query.minutes) : 30;
    const bucketSeconds = req.query.bucketSeconds
      ? Number(req.query.bucketSeconds)
      : 60;

    const history = await getFeederHistory({ minutes, bucketSeconds });

    const now = new Date();
    const limitKw = await getCurrentFeederLimit(now);

    const points = history
      .map((p: any) => {
        // p.ts may be a Date or string depending on the query result
        const raw = (p as any).ts ?? (p as any).bucket_ts;
        const d =
          raw instanceof Date
            ? raw
            : raw
            ? new Date(raw)
            : null;

        if (!d || Number.isNaN(d.getTime())) {
          // skip invalid timestamps so we never crash on toISOString
          return null;
        }

        return {
          ts: d.toISOString(),
          totalKw: Number((p as any).total_kw ?? 0),
        };
      })
      .filter(
        (pt): pt is { ts: string; totalKw: number } => pt !== null,
      );

    res.json({
      limitKw,
      points,
    });
  } catch (err) {
    console.error('[feeder history] error', err);
    res.status(500).json({ error: 'Failed to load feeder history' });
  }
});

export default router;
