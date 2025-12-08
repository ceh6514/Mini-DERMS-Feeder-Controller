import { DrProgramRow } from '../repositories/drProgramsRepo';

export interface DrImpactPerDevice {
  deviceId: string;
  allowedKw: number;
  pMax: number;
  utilizationPct: number;
  priority: number;
}

export interface DrImpactSnapshot {
  timestampIso: string;
  availableBeforeKw: number;
  availableAfterKw: number;
  shedAppliedKw: number;
  elasticityFactor: number;
  totalEvKw: number;
  nonEvKw: number;
  avgUtilizationPct: number;
  priorityWeightedUtilizationPct: number;
  activeProgram: DrProgramRow | null;
  perDevice: DrImpactPerDevice[];
  feederId: string;
}

let lastImpact: DrImpactSnapshot | null = null;

export function recordDrImpact(snapshot: DrImpactSnapshot): void {
  lastImpact = snapshot;
}

export function getDrImpact(): DrImpactSnapshot | null {
  return lastImpact;
}
