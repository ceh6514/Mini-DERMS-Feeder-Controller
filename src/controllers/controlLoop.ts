import config from '../config';
import { getCurrentFeederLimit } from '../repositories/eventsRepo';
import {
  getLatestTelemetryPerDevice,
  TelemetryRow,
} from '../repositories/telemetryRepo';
import { getAllDevices, Device } from '../repositories/devicesRepo';
import { mqttClient } from '../mqttClient';

//Track the most recent setpoint we have commanded for each device.
export const deviceSetpoints = new Map<string, number>();

export interface DeviceWithTelemetry {
  device: Device;
  telemetry: TelemetryRow;
  currentSetpoint: number;
  pActual: number;
  pMax: number;
  priority: number;
}

export function buildDeviceLookup(devices: Device[]): Map<string, Device> {
  const lookup = new Map<string, Device>();
  for (const device of devices) {
    lookup.set(device.id, device);
  }
  return lookup;
}

export function getCurrentSetpoint(
  deviceId: string,
  telemetry: TelemetryRow
): number {
  const existing = deviceSetpoints.get(deviceId);
  if (existing !== undefined) return existing;

  if (telemetry.p_setpoint_kw !== undefined && telemetry.p_setpoint_kw !== null) {
    return telemetry.p_setpoint_kw;
  }

  return telemetry.p_actual_kw ?? 0;
}

export function prepareEvDevices(
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
      const priority = meta?.priority ?? 1;

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
        priority: priority > 0 ? priority : 1,
      };
    });
}

export function computeAllowedShares(
  evDevices: DeviceWithTelemetry[],
  availableForEv: number
): Map<string, number> {
  const allowed = new Map<string, number>();
  const totalWeight = evDevices.reduce((sum, ev) => {
    const capacityWeight = ev.pMax > 0 ? ev.pMax : 1;
    const priorityWeight = Math.max(ev.priority, 1);
    return sum + capacityWeight * priorityWeight;
  }, 0);
  if (totalWeight <= 0) return allowed;

  for (const ev of evDevices) {
    const capacityWeight = ev.pMax > 0 ? ev.pMax : 1;
    const priorityWeight = Math.max(ev.priority, 1);
    const weight = capacityWeight * priorityWeight;
    const share = (availableForEv * weight) / totalWeight;
    allowed.set(ev.device.id, Math.min(Math.max(0, share), ev.pMax));
  }

  return allowed;
}

function publishCommands(
  commands: { deviceId: string; newSetpoint: number; prevSetpoint: number }[],
  logContext: string
) {
  if (commands.length === 0) return;

  if (!mqttClient || !mqttClient.connected) {
    console.warn(
      `[controlLoop] MQTT not connected, skipping publish this tick (${logContext})`
    );
    return;
  }

  for (const cmd of commands) {
    try {
      const topic = `der/control/${cmd.deviceId}`;
      const payload = JSON.stringify({ p_setpoint_kw: cmd.newSetpoint });
      mqttClient.publish(topic, payload);
      deviceSetpoints.set(cmd.deviceId, cmd.newSetpoint);
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
      const totalEvKw = evDevices.reduce((sum, ev) => sum + ev.pActual, 0);
      const nonEvKw = totalKw - totalEvKw;
      const availableForEv = Math.max(limitKw - nonEvKw, 0);

      console.log(
        '[controlLoop] total',
        totalKw.toFixed(2),
        'limit',
        limitKw.toFixed(2),
        'nonEv',
        nonEvKw.toFixed(2)
      );

      if (evDevices.length === 0) {
        console.log('[controlLoop] no EV devices found, skipping control');
        return;
      }

      const overloaded = availableForEv < totalEvKw - marginKw;
      const hasHeadroom = availableForEv > totalEvKw + marginKw;
      if (!overloaded && !hasHeadroom) {
        console.log('[controlLoop] within margin, no changes');
        return;
      }

      const allowedShares = computeAllowedShares(evDevices, availableForEv);
      const commands: { deviceId: string; newSetpoint: number; prevSetpoint: number }[] = [];

      for (const ev of evDevices) {
        const previous = deviceSetpoints.get(ev.device.id) ?? ev.currentSetpoint;
        let target = previous;

        if (overloaded) {
          target = allowedShares.get(ev.device.id) ?? 0;
        } else if (hasHeadroom) {
          target = Math.min(ev.pMax, previous + stepKw);
        }

        target = Math.min(Math.max(0, target), ev.pMax);

        const delta = target - previous;
        let newSetpoint = previous;
        if (Math.abs(delta) > stepKw) {
          newSetpoint = previous + Math.sign(delta) * stepKw;
        } else {
          newSetpoint = target;
        }

        newSetpoint = Math.min(Math.max(0, newSetpoint), ev.pMax);

        if (Math.abs(newSetpoint - previous) > epsilon) {
          commands.push({ deviceId: ev.device.id, newSetpoint, prevSetpoint: previous });
        }
      }

      if (commands.length > 0) {
        console.log(
          '[controlLoop] ev commands',
          commands.map((c) => ({
            id: c.deviceId,
            setpoint: c.newSetpoint.toFixed(2),
            priority: evDevices.find((ev) => ev.device.id === c.deviceId)?.priority,
          }))
        );
        publishCommands(
          commands,
          `total=${totalKw.toFixed(2)} limit=${limitKw.toFixed(2)} availableForEv=${availableForEv.toFixed(2)}`
        );
      } else {
        console.log('[controlLoop] no setpoint changes beyond epsilon');
      }
    } catch (err) {
      console.error('[controlLoop] error', err);
    }
  }, intervalMs);
}
