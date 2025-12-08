import { Router } from 'express';
import { createEvent } from '../repositories/eventsRepo';


const router = Router();

router.post('/', async (req, res) => {
  const { tsStart, tsEnd, limitKw, type, feederId } = req.body ?? {};

  if (!tsStart || !tsEnd || typeof limitKw !== 'number' || !type) {
    res.status(400).json({ error: 'tsStart, tsEnd, limitKw, and type are required' });
    return;
  }

  const startDate = new Date(tsStart);
  const endDate = new Date(tsEnd);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    res.status(400).json({ error: 'Invalid timestamps' });
    return;
  }

  try {
    const created = await createEvent({
      tsStart: startDate,
      tsEnd: endDate,
      limitKw,
      type,
      feederId,
    });
    res.status(201).json(created);
  } catch (err) {
    console.error('[events] failed to create event', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

export default router;
