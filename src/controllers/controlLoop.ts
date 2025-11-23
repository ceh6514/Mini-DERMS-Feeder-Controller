import config from '../config';
import { getCurrentFeederLimit } from '../repositories/eventsRepo';
import {
  getLatestTelemetryPerDevice,
  TelemetryRow,
} from '../repositories/telemetryRepo';
import { getAllDevices, Device } from '../repositories/devicesRepo';
import { mqttClient } from '../mqttClient';

// Track the most recent setpoint we have commanded for each device.
const deviceSetpoints = new Map<string, number>();

interface DeviceWithTelemetry {
  device: Device;
  telemetry: TelemetryRow;
  currentSetpoint: number;
  pActual: number;
  pMax: number;
}

function buildDeviceLookup(devices: Device[]): Map<string, Device> {
  const lookup = new Map<string, Device>();
  for (const device of devices) {
    lookup.set(device.id, device);
  }
  return lookup;
}

function getCurrentSetpoint(deviceId: string, telemetry: TelemetryRow): number {
  const existing = deviceSetpoints.get(deviceId);
  if (existing !== undefined) return existing;

  if (telemetry.p_setpoint_kw !== undefined && telemetry.p_setpoint_kw !== null) {
    return telemetry.p_setpoint_kw;
  }

  return telemetry.p_actual_kw ?? 0;
}

function prepareEvDevices(
  latest: TelemetryRow[],
  devices: Map<string, Device>
): DeviceWithTelemetry[] {
  return latest
    .filter((row) => row.type === 'ev')
    .map((row) => {
      const meta = devices.get(row.device_id);
      const pMax = meta?.pMaxKw ?? row.device_p_max_kw ?? row.p_actual_kw ?? 0;
      const pActual = row.p_actual_kw ?? 0;
      const currentSetpoint = getCurrentSetpoint(row.device_id, row);

      return {
        device: meta ?? {
          id: row.device_id,
          type: row.type,
          siteId: row.site_id,
          pMaxKw: pMax,
        },
        telemetry: row,
        currentSetpoint,
        pActual,
        pMax,
      };
    });
}

function applyCurtailment(
  evDevices: DeviceWithTelemetry[],
  overload: number,
  stepKw: number
): Map<string, number> {
  const newSetpoints = new Map<string, number>();
  let remaining = overload;

  // Work on a copy of the state so we can iterate multiple passes
  const working = evDevices
    .map((ev) => ({ ...ev }))
    .sort((a, b) => b.pActual - a.pActual);

  while (remaining > 0.0001) {
    let changedThisPass = false;

    for (const ev of working) {
      if (remaining <= 0.0001) break;

      if (ev.currentSetpoint <= 0) {
        newSetpoints.set(ev.device.id, 0);
        continue;
      }

      const reduction = Math.min(stepKw, remaining, ev.currentSetpoint);
      const updatedSetpoint = Math.max(0, ev.currentSetpoint - reduction);
      if (updatedSetpoint !== ev.currentSetpoint) {
        changedThisPass = true;
      }

      ev.currentSetpoint = updatedSetpoint;
      remaining -= reduction;
      newSetpoints.set(ev.device.id, updatedSetpoint);
    }

    // Nothing more to reduce
    if (!changedThisPass) {
      break;
    }
  }

  return newSetpoints;
}

function applyRelaxation(
  evDevices: DeviceWithTelemetry[],
  headroom: number,
  stepKw: number
): Map<string, number> {
  const newSetpoints = new Map<string, number>();
  let remaining = headroom;

  // Iterate EVs in the order provided to spread increases somewhat evenly
  const working = evDevices.map((ev) => ({ ...ev }));

  while (remaining > 0.0001) {
    let changedThisPass = false;

    for (const ev of working) {
      if (remaining <= 0.0001) break;

      const available = Math.max(0, ev.pMax - ev.currentSetpoint);
      if (available <= 0) {
        newSetpoints.set(ev.device.id, ev.currentSetpoint);
        continue;
      }

      const increase = Math.min(stepKw, remaining, available);
      const updatedSetpoint = Math.min(ev.pMax, ev.currentSetpoint + increase);
      if (updatedSetpoint !== ev.currentSetpoint) {
        changedThisPass = true;
      }

      ev.currentSetpoint = updatedSetpoint;
      remaining -= increase;
      newSetpoints.set(ev.device.id, updatedSetpoint);
    }

    if (!changedThisPass) {
      break;
    }
  }

  return newSetpoints;
}

function publishCommands(commands: { deviceId: string; newSetpoint: number; prevSetpoint: number }[]) {
  for (const cmd of commands) {
    try {
      const topic = `der/control/${cmd.deviceId}`;
      const payload = JSON.stringify({ p_setpoint_kw: cmd.newSetpoint });
      mqttClient.publish(topic, payload);
    } catch (err) {
      console.error('[controlLoop] failed to publish command', err);
    }
  }
}

export function startControlLoop() {
  const intervalMs = config.controlIntervalSeconds * 1000;
  const marginKw = 0.5;
  const epsilon = 0.1;
  const stepKw = 1.0;

  setInterval(async () => {
    try {
      const now = new Date();
      const limitKw = await getCurrentFeederLimit(now);
      const latest = await getLatestTelemetryPerDevice();
      const devices = await getAllDevices();
      const deviceLookup = buildDeviceLookup(devices);

      if (latest.length === 0) {
        console.log('[controlLoop] no telemetry yet, skipping tick');
        return;
      }

      const totalKw = latest.reduce((sum, row) => sum + (row.p_actual_kw || 0), 0);
      const evDevices = prepareEvDevices(latest, deviceLookup);

      console.log('[controlLoop] total', totalKw.toFixed(2), 'limit', limitKw.toFixed(2));

      if (evDevices.length === 0) {
        console.log('[controlLoop] no EV devices found, skipping control');
        return;
      }

      let proposed = new Map<string, number>();

      if (totalKw > limitKw + marginKw) {
        const overload = totalKw - limitKw;
        proposed = applyCurtailment(evDevices, overload, stepKw);
      } else if (totalKw < limitKw - marginKw) {
        const headroom = limitKw - totalKw;
        proposed = applyRelaxation(evDevices, headroom, stepKw);
      } else {
        console.log('[controlLoop] within margin, no changes');
        return;
      }

      const commands: { deviceId: string; newSetpoint: number; prevSetpoint: number }[] = [];

      for (const ev of evDevices) {
        const previous = deviceSetpoints.get(ev.device.id) ?? ev.currentSetpoint;
        const newSetpoint = proposed.get(ev.device.id);

        if (newSetpoint === undefined) continue;

        deviceSetpoints.set(ev.device.id, newSetpoint);

        if (Math.abs(newSetpoint - previous) > epsilon) {
          commands.push({ deviceId: ev.device.id, newSetpoint, prevSetpoint: previous });
        }
      }

      if (commands.length > 0) {
        console.log(
          '[controlLoop] commands',
          commands.map((c) => ({ id: c.deviceId, setpoint: c.newSetpoint.toFixed(2) }))
        );
        publishCommands(commands);
      } else {
        console.log('[controlLoop] no setpoint changes beyond epsilon');
      }
    } catch (err) {
      console.error('[controlLoop] error', err);
    }
  }, intervalMs);
}
