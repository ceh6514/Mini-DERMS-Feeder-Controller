import { Router } from 'express';
import { mqttClient } from '../mqttClient';
import {
  SimulationMode,
  clearSimulationOverride,
  getSimulationMode,
  setSimulationMode,
} from '../simulationState';

const router = Router();

router.get('/mode', (_req, res) => {
  const mode = getSimulationMode();
  res.json(mode);
});

router.post('/mode', (req, res) => {
  const mode = req.body?.mode as SimulationMode | undefined;
  if (mode !== 'day' && mode !== 'night') {
    res.status(400).json({ error: 'mode must be "day" or "night"' });
    return;
  }

  const updated = setSimulationMode(mode);

  if (mqttClient?.connected) {
    try {
      mqttClient.publish(
        'der/simulation/profile',
        JSON.stringify({ profile: updated.mode, source: updated.source })
      );
    } catch (err) {
      console.error('[simulation] failed to publish simulation profile', err);
    }
  }

  res.json(updated);
});

router.post('/mode/auto', (_req, res) => {
  const updated = clearSimulationOverride();
  if (mqttClient?.connected) {
    try {
      mqttClient.publish(
        'der/simulation/profile',
        JSON.stringify({ profile: updated.mode, source: updated.source })
      );
    } catch (err) {
      console.error('[simulation] failed to publish auto profile', err);
    }
  }
  res.json(updated);
});

export default router;
