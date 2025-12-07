import { ControlParams, DeviceState } from '../types/control';

export function clampSoc(soc: number | null | undefined): number | null {
  if (soc === null || soc === undefined || Number.isNaN(Number(soc))) return null;
  return Math.min(1, Math.max(0, Number(soc)));
}

export function isDispatchableDevice(device: { type: string; id: string }): boolean {
  return device.type === 'ev' || device.type === 'battery' || device.id.startsWith('pi-');
}

function computeScore(device: DeviceState, params: ControlParams): number {
  const priority = Number.isFinite(device.priority) && device.priority > 0 ? device.priority : 1;
  const soc = clampSoc(device.soc);
  const socGap = soc !== null ? Math.max(params.targetSoc - soc, 0) : params.targetSoc;
  const reserveBoost = soc !== null && soc < params.minSocReserve ? 0.5 : 0;
  const socComponent = 1 + params.socWeight * (socGap + reserveBoost);
  const priorityComponent = params.respectPriority ? priority * 1.5 : priority;
  return socComponent * priorityComponent;
}

export function computeSocAwareAllocations(
  devices: DeviceState[],
  availableKw: number,
  params: ControlParams,
): Map<string, number> {
  const allocations = new Map<string, number>();
  if (devices.length === 0 || availableKw <= 0) {
    for (const device of devices) {
      allocations.set(device.id, 0);
    }
    return allocations;
  }

  const scores = devices.map((device) => {
    const score = computeScore(device, params);
    return { device, score: Math.max(score, 0.01) };
  });

  const totalScore = scores.reduce((sum, s) => sum + s.score * Math.max(s.device.pMaxKw, 0.1), 0);
  if (totalScore <= 0) {
    devices.forEach((d) => allocations.set(d.id, 0));
    return allocations;
  }

  for (const { device, score } of scores) {
    const share = (availableKw * score * Math.max(device.pMaxKw, 0.1)) / totalScore;
    const allocation = Math.min(device.pMaxKw, Math.max(0, share));
    allocations.set(device.id, allocation);
  }

  return allocations;
}
