import { Router } from 'express';
import {
  activateDrProgram,
  createDrProgram,
  deleteDrProgram,
  getActiveDrProgram,
  getDrProgram,
  listDrPrograms,
  updateDrProgram,
} from '../repositories/drProgramsRepo';
import { getDrImpact } from '../state/drImpact';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const programs = await listDrPrograms();
    res.json(programs);
  } catch (err) {
    console.error('[dr programs] list failed', err);
    res.status(500).json({ error: 'Failed to list DR programs' });
  }
});

router.get('/active', async (req, res) => {
  try {
    const now = req.query.now ? new Date(String(req.query.now)) : new Date();
    const program = await getActiveDrProgram(now);
    res.json({ program, impact: getDrImpact() });
  } catch (err) {
    console.error('[dr programs] failed to fetch active program', err);
    res.status(500).json({ error: 'Failed to load active DR program' });
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid program id' });
  }

  try {
    const program = await getDrProgram(id);
    if (!program) {
      return res.status(404).json({ error: 'Program not found' });
    }
    res.json(program);
  } catch (err) {
    console.error('[dr programs] failed to fetch program', err);
    res.status(500).json({ error: 'Failed to load DR program' });
  }
});

router.post('/', async (req, res) => {
  const {
    name,
    mode,
    tsStart,
    tsEnd,
    targetShedKw,
    incentivePerKwh,
    penaltyPerKwh,
    isActive,
  } = req.body ?? {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  if (!mode || (mode !== 'fixed_cap' && mode !== 'price_elastic')) {
    return res.status(400).json({ error: 'mode must be fixed_cap or price_elastic' });
  }

  const startDate = tsStart ? new Date(tsStart) : null;
  const endDate = tsEnd ? new Date(tsEnd) : null;

  if (!startDate || Number.isNaN(startDate.getTime()) || !endDate || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'tsStart and tsEnd must be valid timestamps' });
  }

  try {
    const created = await createDrProgram({
      name,
      mode,
      tsStart: startDate,
      tsEnd: endDate,
      targetShedKw: targetShedKw !== undefined ? Number(targetShedKw) : 0,
      incentivePerKwh: incentivePerKwh !== undefined ? Number(incentivePerKwh) : 0,
      penaltyPerKwh: penaltyPerKwh !== undefined ? Number(penaltyPerKwh) : 0,
      isActive: Boolean(isActive),
    });

    if (isActive) {
      await activateDrProgram(created.id);
    }

    res.status(201).json(created);
  } catch (err) {
    console.error('[dr programs] failed to create', err);
    res.status(500).json({ error: 'Failed to create DR program' });
  }
});

router.post('/:id/activate', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid program id' });
  }

  try {
    const activated = await activateDrProgram(id);
    if (!activated) {
      return res.status(404).json({ error: 'Program not found' });
    }
    res.json(activated);
  } catch (err) {
    console.error('[dr programs] failed to activate', err);
    res.status(500).json({ error: 'Failed to activate DR program' });
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid program id' });
  }

  const { name, mode, tsStart, tsEnd, targetShedKw, incentivePerKwh, penaltyPerKwh, isActive } =
    req.body ?? {};

  if (mode && mode !== 'fixed_cap' && mode !== 'price_elastic') {
    return res.status(400).json({ error: 'mode must be fixed_cap or price_elastic' });
  }

  const startDate = tsStart ? new Date(tsStart) : undefined;
  const endDate = tsEnd ? new Date(tsEnd) : undefined;

  if (startDate && Number.isNaN(startDate.getTime())) {
    return res.status(400).json({ error: 'tsStart must be a valid timestamp' });
  }

  if (endDate && Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'tsEnd must be a valid timestamp' });
  }

  try {
    const updated = await updateDrProgram(id, {
      name,
      mode,
      tsStart: startDate,
      tsEnd: endDate,
      targetShedKw: targetShedKw !== undefined ? Number(targetShedKw) : undefined,
      incentivePerKwh: incentivePerKwh !== undefined ? Number(incentivePerKwh) : undefined,
      penaltyPerKwh: penaltyPerKwh !== undefined ? Number(penaltyPerKwh) : undefined,
      isActive: isActive !== undefined ? Boolean(isActive) : undefined,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Program not found' });
    }

    if (isActive) {
      await activateDrProgram(id);
    }

    res.json(updated);
  } catch (err) {
    console.error('[dr programs] failed to update', err);
    res.status(500).json({ error: 'Failed to update DR program' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid program id' });
  }

  try {
    await deleteDrProgram(id);
    res.status(204).send();
  } catch (err) {
    console.error('[dr programs] failed to delete', err);
    res.status(500).json({ error: 'Failed to delete DR program' });
  }
});

export default router;
