import { Router } from 'express';
import { getCurrentFeederLimit } from '../repositories/eventsRepo';
import { getFeederHistory, getLatestTelemetryPerDevice } from '../repositories/telemetryRepo';


const router = Router();

router.get('/summary', async (_req, res) => {
  const now = new Date();
  const [limitKw, latest] = await Promise.all([
    getCurrentFeederLimit(now),
    getLatestTelemetryPerDevice(),
  ]);

  const summary = latest.reduce(
    (acc, row) => {
      const type = row.type;
      const pActual = row.p_actual_kw ?? 0;
      acc.totalKw += pActual;
      acc.deviceCount += 1;

      if (!acc.byType[type]) {
        acc.byType[type] = { count: 0, totalKw: 0 };
      }

      acc.byType[type].count += 1;
      acc.byType[type].totalKw += pActual;
      return acc;
    },
    { totalKw: 0, deviceCount: 0, byType: {} as Record<string, { count: number; totalKw: number }> },
  );

  res.json({
    totalKw: summary.totalKw,
    limitKw,
    deviceCount: summary.deviceCount,
    byType: summary.byType,
  });
});

router.get('/history', async (req, res) => {
  try {
    const minutes = req.query.minutes ? Number(req.query.minutes) : 30;
    const bucketSeconds = req.query.bucketSeconds ? Number(req.query.bucketSeconds) : 60;

    const history = await getFeederHistory({ minutes, bucketSeconds });

    // For simplicity use the current limit over the requested window.
    const now = new Date();
    const limitKw = await getCurrentFeederLimit(now);

    res.json({
      limitKw,
      points: history.map((p) => ({
        ts: p.ts.toISOString(),
        totalKw: p.total_kw,
      })),
    });
  } catch (err) {
    console.error('[feeder history] error', err);
    res.status(500).json({ error: 'Failed to load feeder history' });
  }
});

export default router;
