import config from '../config';
import { getCurrentFeederLimit } from '../repositories/eventsRepo';
import {
  getLatestTelemetryPerDevice,
  TelemetryRow,
} from '../repositories/telemetryRepo';
import { getAllDevices, Device } from '../repositories/devicesRepo';
import { mqttClient } from '../mqttClient';
import {
  getOfflineDeviceIds,
  markIterationError,
  markIterationStart,
  markIterationSuccess,
  shouldAlertOffline,
  shouldAlertStall,
} from '../state/controlLoopMonitor';
import { notifyOfflineDevices, notifyStalledLoop } from '../alerting';

// Track the most recent setpoint we have commanded for each device.
export const deviceSetpoints = new Map<string, number>();
// Track per-device deficit/credit used by the allocator to compensate under-served devices.
export const deviceDeficits = new Map<string, number>();

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
  if (availableForEv <= 0 || evDevices.length === 0) return allowed;

  const totalWeight = evDevices.reduce(
    (sum, ev) => sum + Math.max(1, Number.isFinite(ev.priority) ? ev.priority : 1),
    0
  );
  if (totalWeight <= 0) return allowed;

  const quantumPerWeight = availableForEv / totalWeight;

  // Accrue new credit based on weight, then allocate in deficit order to compensate
  // devices that were under-served in previous ticks.
  for (const ev of evDevices) {
    const weight = Math.max(1, Number.isFinite(ev.priority) ? ev.priority : 1);
    const existing = deviceDeficits.get(ev.device.id) ?? 0;
    deviceDeficits.set(ev.device.id, existing + weight * quantumPerWeight);
  }

  let remaining = availableForEv;
  const prioritized = [...evDevices].sort((a, b) => {
    const deficitB = deviceDeficits.get(b.device.id) ?? 0;
    const deficitA = deviceDeficits.get(a.device.id) ?? 0;
    if (deficitB !== deficitA) return deficitB - deficitA;
    const priorityB = Math.max(1, Number.isFinite(b.priority) ? b.priority : 1);
    const priorityA = Math.max(1, Number.isFinite(a.priority) ? a.priority : 1);
    if (priorityB !== priorityA) return priorityB - priorityA;
    return a.device.id.localeCompare(b.device.id);
  });

  for (const ev of prioritized) {
    if (remaining <= 0) break;
    const deficit = deviceDeficits.get(ev.device.id) ?? 0;
    const allocation = Math.min(deficit, ev.pMax, remaining);
    if (allocation > 0) {
      allowed.set(ev.device.id, allocation);
      deviceDeficits.set(ev.device.id, deficit - allocation);
      remaining -= allocation;
    } else {
      allowed.set(ev.device.id, 0);
    }
  }

  if (remaining > 0) {
    for (const ev of prioritized) {
      if (remaining <= 0) break;
      const current = allowed.get(ev.device.id) ?? 0;
      const headroom = Math.max(0, ev.pMax - current);
      if (headroom <= 0) continue;
      const bonus = Math.min(headroom, remaining);
      allowed.set(ev.device.id, current + bonus);
      const deficit = deviceDeficits.get(ev.device.id) ?? 0;
      deviceDeficits.set(ev.device.id, deficit - bonus);
      remaining -= bonus;
    }
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
    const now = new Date();
    const nowMs = now.getTime();
    const stalledState = shouldAlertStall(nowMs);
    if (stalledState) {
      notifyStalledLoop(stalledState);
    }

    const offlineToAlert = shouldAlertOffline(nowMs);
    if (offlineToAlert.length) {
      notifyOfflineDevices(offlineToAlert);
    }

    markIterationStart(nowMs);
    let errored = false;
    try {
      const limitKw = await getCurrentFeederLimit(now);
      const latest = await getLatestTelemetryPerDevice();
      const offlineDevices = getOfflineDeviceIds(nowMs);
      if (offlineDevices.size > 0) {
        console.warn(
          `[controlLoop] ${offlineDevices.size} device(s) offline, excluding from allocation`,
        );
      }

      const onlineTelemetry = latest.filter(
        (row) => !offlineDevices.has(row.device_id)
      );
      const devices = await getAllDevices();
      const deviceLookup = buildDeviceLookup(devices);
      const priorityLookup = new Map(
        devices.map((device) => [device.id, device.priority ?? 1])
      );

      if (onlineTelemetry.length === 0) {
        console.log('[controlLoop] no telemetry yet, skipping tick');
        return;
      }

      const totalKw = onlineTelemetry.reduce(
        (sum, row) => sum + (row.p_actual_kw || 0),
        0
      );
      const evDevices = prepareEvDevices(onlineTelemetry, deviceLookup);
      const totalEvKw = evDevices.reduce((sum, ev) => sum + ev.pActual, 0);
      const nonEvKw = totalKw - totalEvKw;
      const availableForEv = Math.max(limitKw - nonEvKw, 0);

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
      const deviceLogs: {
        id: string;
        priority: number;
        deficit: number;
        allowed: number;
        prev: number;
        next: number;
        pMax: number;
      }[] = [];

      for (const ev of evDevices) {
        const previous = deviceSetpoints.get(ev.device.id) ?? ev.currentSetpoint;
        let target = previous;

        const allowedShare = allowedShares.get(ev.device.id) ?? 0;

        if (overloaded) {
          target = allowedShare;
        } else if (hasHeadroom) {
          target = Math.min(ev.pMax, Math.max(previous + stepKw, allowedShare));
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

        deviceLogs.push({
          id: ev.device.id,
          priority: priorityLookup.get(ev.device.id) ?? ev.priority ?? 1,
          deficit: deviceDeficits.get(ev.device.id) ?? 0,
          allowed: allowedShare,
          prev: previous,
          next: newSetpoint,
          pMax: ev.pMax,
        });

        if (Math.abs(newSetpoint - previous) > epsilon) {
          commands.push({ deviceId: ev.device.id, newSetpoint, prevSetpoint: previous });
        }
      }

      if (commands.length > 0) {
        const commandSummaries = commands.map((c) => ({
          id: c.deviceId,
          setpoint: c.newSetpoint.toFixed(2),
          priority: priorityLookup.get(c.deviceId) ?? 1,
        }));
        const deficitSummaries = deviceLogs.map((log) => ({
          id: log.id,
          priority: log.priority,
          deficit: log.deficit.toFixed(2),
          allowed: log.allowed.toFixed(2),
          prev: log.prev.toFixed(2),
          next: log.next.toFixed(2),
          pMax: log.pMax.toFixed(2),
        }));
        console.log(
          '[controlLoop] total',
          totalKw.toFixed(2),
          'limit',
          limitKw.toFixed(2),
          'nonEv',
          nonEvKw.toFixed(2),
          'ev commands',
          commandSummaries,
          'ev deficits',
          deficitSummaries
        );
        publishCommands(
          commands,
          `total=${totalKw.toFixed(2)} limit=${limitKw.toFixed(2)} availableForEv=${availableForEv.toFixed(2)}`
        );
      } else {
        const deficitSummaries = deviceLogs.map((log) => ({
          id: log.id,
          priority: log.priority,
          deficit: log.deficit.toFixed(2),
          allowed: log.allowed.toFixed(2),
          prev: log.prev.toFixed(2),
          next: log.next.toFixed(2),
          pMax: log.pMax.toFixed(2),
        }));
        console.log('[controlLoop] no setpoint changes beyond epsilon', deficitSummaries);
      }
    } catch (err) {
      errored = true;
      markIterationError(err, Date.now());
      console.error('[controlLoop] error', err);
    } finally {
      if (!errored) {
        markIterationSuccess(Date.now());
      }
    }
  }, intervalMs);
}
