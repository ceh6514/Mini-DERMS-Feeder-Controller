import { Router } from 'express';
import { getCurrentFeederLimit } from '../repositories/eventsRepo.js';
import { getLatestTelemetryPerDevice } from '../repositories/telemetryRepo.js';

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

export default router;
