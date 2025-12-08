import type { ControlParams } from '../types/control';
import { clampSoc } from './scheduler';
import type { DeviceWithTelemetry } from './controlLoop';

interface SolverModule {
  Solve(model: unknown): Record<string, number | boolean | string> & {
    feasible?: boolean;
    bounded?: boolean;
  };
}

interface OptimizationResult {
  allocations: Map<string, number>;
  feasible: boolean;
  usedExternal: boolean;
  message?: string;
}

interface ObjectiveContext {
  weight: number;
  deficitBoost: number;
}

function tryLoadSolver(): SolverModule | null {
  try {
    // Optional dependency; only used when present and enabled.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('javascript-lp-solver');
  } catch (err) {
    return null;
  }
}

function buildLpModel(
  evDevices: DeviceWithTelemetry[],
  availableForEv: number,
  params: ControlParams,
  objectives: Map<string, ObjectiveContext>,
) {
  const constraints: Record<string, { ['<=']: number }> = {
    feeder: { ['<=']: availableForEv },
  };
  const variables: Record<string, Record<string, number>> = {};

  const enforceTargetSoc = params.optimizer?.enforceTargetSoc ?? true;

  for (const ev of evDevices) {
    const effectiveMax = (() => {
      if (enforceTargetSoc) {
        const soc = clampSoc(ev.soc);
        if (soc !== null && soc >= params.targetSoc) return 0;
      }
      return Math.max(ev.pMaxKw, 0);
    })();

    constraints[`${ev.id}_cap`] = { ['<=']: effectiveMax };

    const objective = objectives.get(ev.id)?.weight ?? 1;
    const deficitBoost = objectives.get(ev.id)?.deficitBoost ?? 0;

    variables[ev.id] = {
      objective: Math.max(objective + deficitBoost, 0.001),
      feeder: 1,
      [`${ev.id}_cap`]: 1,
    };
  }

  return {
    optimize: 'objective',
    opType: 'max',
    constraints,
    variables,
  };
}

function runLpOptimization(
  solver: SolverModule,
  evDevices: DeviceWithTelemetry[],
  availableForEv: number,
  params: ControlParams,
  objectives: Map<string, ObjectiveContext>,
): OptimizationResult {
  const model = buildLpModel(evDevices, availableForEv, params, objectives);
  try {
    const result = solver.Solve(model);
    const feasible = Boolean(result?.feasible ?? result?.bounded ?? false);
    const allocations = new Map<string, number>();
    if (!feasible) {
      return {
        allocations,
        feasible: false,
        usedExternal: true,
        message: 'external solver reported infeasible or unbounded model',
      };
    }

    for (const ev of evDevices) {
      const raw = result[ev.id];
      const value = Number.isFinite(raw) ? Number(raw) : 0;
      allocations.set(ev.id, Math.max(0, value));
    }

    return { allocations, feasible: true, usedExternal: true };
  } catch (err) {
    return {
      allocations: new Map(),
      feasible: false,
      usedExternal: true,
      message: err instanceof Error ? err.message : 'external solver error',
    };
  }
}

function runGreedyOptimization(
  evDevices: DeviceWithTelemetry[],
  availableForEv: number,
  params: ControlParams,
  objectives: Map<string, ObjectiveContext>,
): OptimizationResult {
  const enforceTargetSoc = params.optimizer?.enforceTargetSoc ?? true;
  const sorted = [...evDevices].sort((a, b) => {
    const objB = objectives.get(b.id);
    const objA = objectives.get(a.id);
    const weightB = (objB?.weight ?? 1) + (objB?.deficitBoost ?? 0);
    const weightA = (objA?.weight ?? 1) + (objA?.deficitBoost ?? 0);
    if (weightB !== weightA) return weightB - weightA;
    return a.id.localeCompare(b.id);
  });

  let remaining = availableForEv;
  const allocations = new Map<string, number>();

  for (const ev of sorted) {
    if (remaining <= 0) {
      allocations.set(ev.id, 0);
      continue;
    }

    const soc = clampSoc(ev.soc);
    if (enforceTargetSoc && soc !== null && soc >= params.targetSoc) {
      allocations.set(ev.id, 0);
      continue;
    }

    const cap = Math.max(ev.pMaxKw, 0);
    const grant = Math.min(cap, remaining);
    allocations.set(ev.id, grant);
    remaining -= grant;
  }

  for (const ev of evDevices) {
    if (!allocations.has(ev.id)) allocations.set(ev.id, 0);
  }

  return { allocations, feasible: true, usedExternal: false };
}

export function optimizeAllocations(
  evDevices: DeviceWithTelemetry[],
  availableForEv: number,
  params: ControlParams,
  objectives: Map<string, ObjectiveContext>,
  externalSolver?: SolverModule | null,
): OptimizationResult {
  const solverEnabled = params.optimizer?.solverEnabled ?? false;
  const solver = externalSolver ?? (solverEnabled ? tryLoadSolver() : null);

  if (solver) {
    const result = runLpOptimization(solver, evDevices, availableForEv, params, objectives);
    if (result.feasible) return result;
    const fallback = runGreedyOptimization(evDevices, availableForEv, params, objectives);
    return { ...fallback, feasible: false, usedExternal: true, message: result.message };
  }

  return runGreedyOptimization(evDevices, availableForEv, params, objectives);
}
