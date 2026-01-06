import { describe, it, expect } from 'vitest';
import { normalizeTelemetryForCharts } from '../src/utils/telemetryNormalization.js';

describe('normalizeTelemetryForCharts', () => {
  it('sorts ascending and forward-fills setpoints', () => {
    const result = normalizeTelemetryForCharts([
      {
        timestamp: '2025-12-07T08:26:09.000Z',
        p_actual_kw: 5,
        p_setpoint_kw: null,
      },
      {
        timestamp: '2025-12-07T08:26:08.000Z',
        p_actual_kw: 4,
        p_setpoint_kw: 7,
      },
    ]);

    expect(result[0].tsIso).toBe('2025-12-07T08:26:08.000Z');
    expect(result[1].tsIso).toBe('2025-12-07T08:26:09.000Z');
    expect(result[0].setpoint_plot_kw).toBe(7);
    expect(result[1].setpoint_plot_kw).toBe(7);
  });

  it('keeps leading null setpoints as null until a value arrives', () => {
    const result = normalizeTelemetryForCharts([
      {
        timestamp: '2025-12-07T08:26:08.000Z',
        p_actual_kw: 4,
        p_setpoint_kw: null,
      },
      {
        timestamp: '2025-12-07T08:26:09.000Z',
        p_actual_kw: 5,
        p_setpoint_kw: 6,
      },
    ]);

    expect(result[0].setpoint_plot_kw).toBe(null);
    expect(result[1].setpoint_plot_kw).toBe(6);
  });

  it('prefers timestamp field, falls back to sim_ts, and normalizes watt-like values', () => {
    const result = normalizeTelemetryForCharts([
      {
        sim_ts: '2025-12-07T08:26:08.000Z',
        p_actual_kw: 0.5,
        p_setpoint_kw: null,
      },
      {
        timestamp: '2025-12-07T08:26:09.000Z',
        p_actual_kw: 7200,
        p_setpoint_kw: 7200,
      },
    ]);

    expect(result[0].tsIso).toBe('2025-12-07T08:26:08.000Z');
    expect(result[1].tsIso).toBe('2025-12-07T08:26:09.000Z');
    expect(result[1].p_actual_kw).toBe(7.2);
    expect(result[1].setpoint_plot_kw).toBe(7.2);
  });

  it('caps the returned window to the newest maxPoints entries', () => {
    const points = Array.from({ length: 10 }, (_, idx) => ({
      timestamp: `2025-12-07T08:26:0${idx}.000Z`,
      p_actual_kw: idx,
      p_setpoint_kw: idx,
    })).reverse();

    const result = normalizeTelemetryForCharts(points, 3);

    expect(result.length).toBe(3);
    expect(result[0].p_actual_kw).toBe(7);
    expect(result[2].p_actual_kw).toBe(9);
  });
});