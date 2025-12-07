import React, { useMemo } from 'react';
import { DeviceTelemetry } from '../../api/types';
import { normalizeTelemetryForCharts } from '../../utils/telemetryNormalization';

interface Props {
  deviceId: string | null;
  telemetry: DeviceTelemetry[];
}

const SetpointActualChart: React.FC<Props> = ({ deviceId, telemetry }) => {
  const points = useMemo(() => normalizeTelemetryForCharts(telemetry, 240), [telemetry]);

  if (!deviceId || points.length === 0) {
    return (
      <div className="card">
        <h3>Setpoint vs actual</h3>
        <p className="subtle">Select a device to view its recent trajectory.</p>
      </div>
    );
  }

  const width = 520;
  const height = 200;
  const padding = { top: 16, right: 12, bottom: 28, left: 42 };
  const times = points.map((p) => p.tsMs);
  const values = points.flatMap((p) => [p.p_actual_kw, p.setpoint_plot_kw].filter((v): v is number => v !== null));
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const span = Math.max(maxT - minT, 1);
  const maxVal = values.length > 0 ? Math.max(1, ...values.map((v) => Math.abs(v))) : 1;

  const scaleX = (ts: number) =>
    padding.left + ((ts - minT) / span) * (width - padding.left - padding.right);
  const scaleY = (v: number) => padding.top + (1 - v / (maxVal * 1.2)) * (height - padding.top - padding.bottom);

  const buildPath = (valueFn: (p: typeof points[number]) => number | null) => {
    let started = false;
    return points
      .map((p) => {
        const value = valueFn(p);
        if (value === null) return null;
        const command = started ? 'L' : 'M';
        started = true;
        return `${command} ${scaleX(p.tsMs).toFixed(1)} ${scaleY(value).toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  };

  const actualPath = buildPath((p) => p.p_actual_kw);
  const setpointPath = buildPath((p) => p.setpoint_plot_kw);
  const areaPath = actualPath
    ? `${actualPath} L ${scaleX(times[times.length - 1]).toFixed(1)} ${scaleY(0).toFixed(1)} L ${scaleX(times[0]).toFixed(1)} ${scaleY(0).toFixed(1)} Z`
    : '';

  return (
    <div className="card">
      <h3>Setpoint vs actual</h3>
      <p className="subtle">Recent power commands for {deviceId}</p>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Setpoint vs actual">
        <defs>
          <linearGradient id="actualFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {setpointPath && (
          <path d={setpointPath} fill="none" stroke="var(--color-text-muted)" strokeWidth={2} strokeDasharray="6 6" />
        )}
        {actualPath && <path d={actualPath} fill="none" stroke="var(--color-accent-strong)" strokeWidth={3} />}
        {areaPath && <path d={areaPath} fill="url(#actualFill)" opacity={0.4} />}
        <line
          x1={padding.left}
          y1={scaleY(0)}
          x2={width - padding.right}
          y2={scaleY(0)}
          stroke="var(--color-border)"
        />
      </svg>
    </div>
  );
};

export default SetpointActualChart;
