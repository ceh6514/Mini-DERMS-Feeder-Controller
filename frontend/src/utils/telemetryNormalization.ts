import { DeviceTelemetry } from '../api/types.js';

export interface NormalizedTelemetryPoint {
  tsIso: string;
  tsMs: number;
  p_actual_kw: number | null;
  p_setpoint_kw: number | null;
  setpoint_plot_kw: number | null;
}

export type TelemetryPoint = Partial<DeviceTelemetry> & {
  timestamp?: string;
  sim_ts?: string;
  p_actual_kw?: number | null;
  p_actual_w?: number | null;
  p_setpoint_kw?: number | null;
  p_setpoint_w?: number | null;
};

const KW_LIKE_WATT_THRESHOLD = 100;

function toKw(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;

  const abs = Math.abs(value);
  // Telemetry should already be kW, but occasionally watt values sneak in.
  // Treat values above ~100 as watt inputs and convert to kW to keep the
  // chart scale sane (e.g., 7200 W => 7.2 kW).
  if (abs > KW_LIKE_WATT_THRESHOLD) {
    return value / 1000;
  }

  return value;
}

function pickTimestamp(point: TelemetryPoint): string | null {
  return point.timestamp ?? point.ts ?? point.sim_ts ?? null;
}

export function normalizeTelemetryForCharts(
  points: TelemetryPoint[],
  maxPoints = 240,
): NormalizedTelemetryPoint[] {
  const normalized = points
    .map((raw) => {
      const iso = pickTimestamp(raw);
      if (!iso) return null;

      const tsMs = Date.parse(iso);
      if (Number.isNaN(tsMs)) return null;

      const pActualKw = toKw(raw.p_actual_kw ?? raw.p_actual_w ?? null);
      const pSetpointKw = toKw(raw.p_setpoint_kw ?? raw.p_setpoint_w ?? null);

      return {
        tsIso: iso,
        tsMs,
        p_actual_kw: pActualKw,
        p_setpoint_kw: pSetpointKw,
        setpoint_plot_kw: null as number | null,
      };
    })
    .filter((p): p is NormalizedTelemetryPoint => Boolean(p))
    .sort((a, b) => a.tsMs - b.tsMs)
    .slice(-maxPoints);

  let lastSetpoint: number | null = null;

  return normalized.map((point) => {
    if (point.p_setpoint_kw !== null && point.p_setpoint_kw !== undefined) {
      lastSetpoint = point.p_setpoint_kw;
    }

    return {
      ...point,
      setpoint_plot_kw: lastSetpoint,
    };
  });
}
