import config from '../config.js';
import { getCurrentFeederLimit } from '../repositories/eventsRepo.js';
import { getLatestTelemetryPerDevice, TelemetryRow } from '../repositories/telemetryRepo.js';
import { mqttClient } from '../mqttClient.js';

function computeNewSetpoint(
  device: TelemetryRow,
  deltaPerDevice: number,
  direction: 'increase' | 'decrease',
): number {
  const current = device.p_setpoint_kw ?? device.p_actual_kw ?? 0;
  const max = device.device_p_max_kw ?? device.p_actual_kw ?? current;

  if (direction === 'decrease') {
    return Math.max(0, current - deltaPerDevice);
  }

  // Increase direction
  const candidate = current + deltaPerDevice;
  return Math.min(candidate, max);
}

export function startControlLoop() {
  const intervalMs = config.controlIntervalSeconds * 1000;

  setInterval(async () => {
    try {
      const now = new Date();
      const limitKw = await getCurrentFeederLimit(now);
      const latest = await getLatestTelemetryPerDevice();

      const totalKw = latest.reduce((sum, row) => sum + (row.p_actual_kw || 0), 0);
      const evs = latest.filter((row) => row.type === 'ev');

      if (evs.length === 0) {
        return; // Nothing to control yet
      }

      // Determine whether we need to curtail or can loosen setpoints
      if (totalKw > limitKw) {
        const excess = totalKw - limitKw;
        const reductionPerEv = excess / evs.length;

        for (const ev of evs) {
          const newSetpoint = computeNewSetpoint(ev, reductionPerEv, 'decrease');
          if (newSetpoint !== (ev.p_setpoint_kw ?? ev.p_actual_kw ?? 0)) {
            mqttClient.publish(`der/control/${ev.device_id}`, JSON.stringify({ p_setpoint_kw: newSetpoint }));
          }
        }
      } else {
        const headroom = limitKw - totalKw;
        const increasePerEv = headroom / evs.length;

        for (const ev of evs) {
          const newSetpoint = computeNewSetpoint(ev, increasePerEv, 'increase');
          if (newSetpoint !== (ev.p_setpoint_kw ?? ev.p_actual_kw ?? 0)) {
            mqttClient.publish(`der/control/${ev.device_id}`, JSON.stringify({ p_setpoint_kw: newSetpoint }));
          }
        }
      }
    } catch (err) {
      console.error('[controlLoop] error', err);
    }
  }, intervalMs);
}
