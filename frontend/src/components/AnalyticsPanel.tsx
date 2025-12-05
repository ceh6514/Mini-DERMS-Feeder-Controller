import { useEffect, useMemo, useState } from 'react';
import { fetchAggregatedMetrics } from '../api/client';
import {
  AggregatedMetricsResponse,
  DeviceAggregate,
  HeadroomPoint,
  MetricsWindow,
  SocTrajectoryPoint,
} from '../api/types';

const CHART_WIDTH = 760;
const CHART_HEIGHT = 260;
const PADDING = { top: 20, right: 20, bottom: 35, left: 50 };

const palette = ['#1d4ed8', '#f97316', '#22c55e', '#a855f7', '#e11d48', '#0ea5e9'];

const buildLinePath = (points: { x: number; y: number }[]) => {
  if (!points.length) return '';
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    path += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  return path;
};

const formatTick = (ts: string) => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

interface ChartProps {
  title: string;
  subtitle: string;
  points: HeadroomPoint[];
  yAccessor: (p: HeadroomPoint) => number;
  yLabel: string;
  yMax?: number;
}

const HeadroomChart = ({ title, subtitle, points, yAccessor, yLabel, yMax }: ChartProps) => {
  if (points.length === 0) {
    return (
      <div className="card">
        <h2>{title}</h2>
        <p className="subtitle">{subtitle}</p>
        <p className="subtitle">No data for the selected window.</p>
      </div>
    );
  }

  const sorted = [...points].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const values = sorted.map(yAccessor);
  const maxValue = yMax ?? Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const span = sorted[sorted.length - 1].ts
    ? new Date(sorted[sorted.length - 1].ts).getTime() - new Date(sorted[0].ts).getTime()
    : 1;

  const xScale = (ts: string) => {
    const t = new Date(ts).getTime();
    return (
      PADDING.left +
      ((t - new Date(sorted[0].ts).getTime()) / Math.max(span, 1)) *
        (CHART_WIDTH - PADDING.left - PADDING.right)
    );
  };

  const yScale = (v: number) => {
    const usable = CHART_HEIGHT - PADDING.top - PADDING.bottom;
    return PADDING.top + (1 - (v - minValue) / Math.max(maxValue - minValue, 1)) * usable;
  };

  const chartPoints = sorted.map((p) => ({ x: xScale(p.ts), y: yScale(yAccessor(p)) }));
  const path = buildLinePath(chartPoints);

  const labelIndices = [0, Math.floor(sorted.length / 2), sorted.length - 1];
  const labels = Array.from(new Set(labelIndices)).map((idx) => ({
    x: xScale(sorted[idx].ts),
    text: formatTick(sorted[idx].ts),
  }));

  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="subtitle" style={{ marginBottom: '0.5rem' }}>
        {subtitle}
      </p>
      <svg width="100%" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img">
        <line
          x1={PADDING.left}
          y1={yScale(minValue)}
          x2={CHART_WIDTH - PADDING.right}
          y2={yScale(minValue)}
          stroke="var(--border-subtle)"
        />
        <path
          d={path}
          fill="none"
          stroke="var(--accent-strong)"
          strokeWidth={3}
          strokeLinecap="round"
        />
        {labels.map((l) => (
          <text key={l.x} x={l.x} y={CHART_HEIGHT - 10} textAnchor="middle" className="axis-label">
            {l.text}
          </text>
        ))}
        <text x={PADDING.left} y={PADDING.top} className="axis-label" textAnchor="start">
          {yLabel}
        </text>
      </svg>
    </div>
  );
};

interface MultiLineProps {
  trajectories: SocTrajectoryPoint[];
}

const SocTrajectoryChart = ({ trajectories }: MultiLineProps) => {
  if (trajectories.length === 0) {
    return (
      <div className="card">
        <h2>State of charge trajectories</h2>
        <p className="subtitle">No SOC data in the selected window.</p>
      </div>
    );
  }

  const grouped = trajectories.reduce<Record<string, SocTrajectoryPoint[]>>((acc, point) => {
    acc[point.deviceId] = acc[point.deviceId] ? [...acc[point.deviceId], point] : [point];
    return acc;
  }, {});

  const sortedKeys = Object.keys(grouped);
  const flattened = trajectories.map((t) => ({ ...t, tsMs: new Date(t.ts).getTime() }));
  const minTs = Math.min(...flattened.map((t) => t.tsMs));
  const maxTs = Math.max(...flattened.map((t) => t.tsMs));

  const xScale = (ts: string) =>
    PADDING.left +
    ((new Date(ts).getTime() - minTs) / Math.max(maxTs - minTs, 1)) *
      (CHART_WIDTH - PADDING.left - PADDING.right);
  const yScale = (soc: number) => {
    const usable = CHART_HEIGHT - PADDING.top - PADDING.bottom;
    return PADDING.top + (1 - soc) * usable;
  };

  return (
    <div className="card">
      <h2>State of charge trajectories</h2>
      <p className="subtitle">Minimum observed SOC per device over time.</p>
      <svg width="100%" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img">
        <line
          x1={PADDING.left}
          y1={yScale(0)}
          x2={CHART_WIDTH - PADDING.right}
          y2={yScale(0)}
          stroke="var(--border-subtle)"
        />
        <line
          x1={PADDING.left}
          y1={yScale(1)}
          x2={CHART_WIDTH - PADDING.right}
          y2={yScale(1)}
          stroke="var(--border-subtle)"
        />
        {sortedKeys.map((deviceId, idx) => {
          const color = palette[idx % palette.length];
          const points = grouped[deviceId]
            .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
            .map((p) => ({ x: xScale(p.ts), y: yScale(p.soc ?? 0) }));
          const path = buildLinePath(points);

          const labelX = points.length > 0 ? points[points.length - 1].x : PADDING.left;
          const labelY = points.length > 0 ? points[points.length - 1].y : PADDING.top;

          return (
            <g key={deviceId}>
              <path d={path} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
              <text x={labelX + 6} y={labelY} className="axis-label" fill={color}>
                {deviceId}
              </text>
            </g>
          );
        })}
        <text x={PADDING.left} y={PADDING.top} className="axis-label" textAnchor="start">
          SOC (0-1)
        </text>
      </svg>
    </div>
  );
};

const downloadCsv = (metrics: AggregatedMetricsResponse) => {
  const headroomRows = metrics.headroom.map((p) => ({
    ts: p.ts,
    totalKw: p.totalKw.toFixed(3),
    limitKw: p.limitKw.toFixed(3),
    utilizationPct: p.utilizationPct.toFixed(2),
    curtailmentPct: p.curtailmentPct.toFixed(2),
    fairnessScore: p.fairnessScore.toFixed(3),
  }));

  const deviceRows = metrics.devices.map((d) => ({
    deviceId: d.deviceId,
    type: d.deviceType,
    avgKw: d.avgKw.toFixed(3),
    maxKw: d.maxKw.toFixed(3),
    percentCurtailment: d.percentCurtailment.toFixed(2),
    minSoc: d.minSoc === null ? '' : d.minSoc.toFixed(3),
  }));

  const lines = [
    'Headroom time-series',
    'ts,total_kw,limit_kw,utilization_pct,curtailment_pct,fairness',
    ...headroomRows.map(
      (r) => `${r.ts},${r.totalKw},${r.limitKw},${r.utilizationPct},${r.curtailmentPct},${r.fairnessScore}`,
    ),
    '',
    'Device aggregates',
    'device_id,type,avg_kw,max_kw,percent_curtailment,min_soc',
    ...deviceRows.map(
      (r) => `${r.deviceId},${r.type},${r.avgKw},${r.maxKw},${r.percentCurtailment},${r.minSoc}`,
    ),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `feeder-metrics-${metrics.window}-${new Date().toISOString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

interface AnalyticsPanelProps {
  onMetricsLoaded?: (metrics: AggregatedMetricsResponse) => void;
}

const AnalyticsPanel = ({ onMetricsLoaded }: AnalyticsPanelProps) => {
  const [windowPreset, setWindowPreset] = useState<MetricsWindow>('day');
  const [metrics, setMetrics] = useState<AggregatedMetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useMemo(
    () =>
      async (preset: MetricsWindow) => {
        setLoading(true);
        setError(null);
        try {
          const result = await fetchAggregatedMetrics(preset);
          setMetrics(result);
          onMetricsLoaded?.(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to load aggregated metrics';
          setError(message);
        } finally {
          setLoading(false);
        }
      },
    [onMetricsLoaded],
  );

  useEffect(() => {
    fetchData(windowPreset);
  }, [fetchData, windowPreset]);

  return (
    <div className="card">
      <div className="card-header-row">
        <div>
          <h2>Operational insights</h2>
          <p className="subtitle">Headroom, curtailment, SOC, and fairness for each window.</p>
        </div>
        <div className="controls-row">
          {(['day', 'week', 'month'] as MetricsWindow[]).map((preset) => (
            <button
              key={preset}
              className={preset === windowPreset ? 'pill active' : 'pill'}
              onClick={() => setWindowPreset(preset)}
              disabled={loading}
            >
              {preset === 'day' ? 'Daily' : preset === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
          <button
            className="ghost-button"
            onClick={() => metrics && downloadCsv(metrics)}
            disabled={!metrics}
            style={{ marginLeft: '0.5rem' }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {loading && <p className="subtitle">Crunching telemetry…</p>}
      {error && (
        <p className="subtitle" style={{ color: '#b91c1c' }}>
          {error}
        </p>
      )}

      {metrics && !loading && !error && (
        <div className="grid" style={{ marginTop: '1rem' }}>
          <HeadroomChart
            title="Headroom utilization"
            subtitle="Feeder output as a fraction of the active limit."
            points={metrics.headroom}
            yAccessor={(p) => p.utilizationPct}
            yLabel="Utilization %"
            yMax={120}
          />
          <HeadroomChart
            title="Curtailment intensity"
            subtitle="Portion of requested power curtailed per aggregation bucket."
            points={metrics.headroom}
            yAccessor={(p) => p.curtailmentPct}
            yLabel="Curtailment %"
            yMax={100}
          />
          <SocTrajectoryChart trajectories={metrics.socTrajectories} />
          <HeadroomChart
            title="Fairness over time"
            subtitle="Balance of curtailment across devices (1 = balanced)."
            points={metrics.headroom}
            yAccessor={(p) => p.fairnessScore}
            yLabel="Fairness"
            yMax={1}
          />

          <div className="card" style={{ gridColumn: 'span 2' }}>
            <h3>Device rollup</h3>
            <p className="subtitle">Average and max power plus curtailment per device.</p>
            <div className="table-wrapper" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="device-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Type</th>
                    <th>Avg kW</th>
                    <th>Max kW</th>
                    <th>% Curtailment</th>
                    <th>Min SOC</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.devices.map((device: DeviceAggregate) => (
                    <tr key={device.deviceId}>
                      <td>{device.deviceId}</td>
                      <td>{device.deviceType}</td>
                      <td>{device.avgKw.toFixed(2)}</td>
                      <td>{device.maxKw.toFixed(2)}</td>
                      <td>{device.percentCurtailment.toFixed(1)}%</td>
                      <td>{device.minSoc === null ? '—' : device.minSoc.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsPanel;
