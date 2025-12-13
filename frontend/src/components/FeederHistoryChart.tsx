import React from 'react';
import type { FeederHistoryResponse } from '../api/types';

interface FeederHistoryChartProps {
  data: FeederHistoryResponse | null;
  loading: boolean;
  error: string | null;
}

type ChartPoint = { x: number; y: number };

const buildMonotonePath = (points: ChartPoint[]) => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  const slopes = [] as number[];
  for (let i = 0; i < points.length - 1; i += 1) {
    const dx = points[i + 1].x - points[i].x;
    slopes.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }

  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes[slopes.length - 1];
    return (slopes[i - 1] + slopes[i]) / 2;
  });

  for (let i = 0; i < slopes.length; i += 1) {
    const slope = slopes[i];
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const a = tangents[i] / slope;
      const b = tangents[i + 1] / slope;
      const norm = Math.hypot(a, b);
      if (norm > 3) {
        const scale = 3 / norm;
        tangents[i] = scale * a * slope;
        tangents[i + 1] = scale * b * slope;
      }
    }
  }

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = p1.x - p0.x;
    const c1x = p0.x + dx / 3;
    const c1y = p0.y + (tangents[i] * dx) / 3;
    const c2x = p1.x - dx / 3;
    const c2y = p1.y - (tangents[i + 1] * dx) / 3;

    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
  }

  return path;
};

const FeederHistoryChart = ({ data, loading, error }: FeederHistoryChartProps) => {
  if (loading) {
    return (
      <div className="card">
        <h2>Feeder History (last 30 min)</h2>
        <p className="subtitle">Loading history…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2>Feeder History (last 30 min)</h2>
        <p className="subtitle" style={{ color: '#b91c1c' }}>
          Failed to load history: {error}
        </p>
      </div>
    );
  }

  if (!data || data.points.length === 0) {
    return (
      <div className="card">
        <h2>Feeder History (last 30 min)</h2>
        <p className="subtitle">No recent history.</p>
      </div>
    );
  }

  const width = 700;
  const height = 240;
  const padding = { top: 20, right: 20, bottom: 35, left: 50 };

  const sortedPoints = [...data.points]
    .map((p) => ({ ...p, tsMs: new Date(p.ts).getTime() }))
    .sort((a, b) => a.tsMs - b.tsMs);

  const points = sortedPoints.reduce<
    (typeof sortedPoints)[number][]
  >((acc, point) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.tsMs === point.tsMs) {
      acc[acc.length - 1] = point;
    } else {
      acc.push(point);
    }
    return acc;
  }, []);

  const values = points.map((p) => p.totalKw);
  const yMaxRaw = Math.max(data.limitKw, ...values, 1);
  const yPadding = Math.max(yMaxRaw * 0.2, 25);
  const yMax = yMaxRaw + yPadding;

  const firstTs = points[0].tsMs;
  const lastTs = points[points.length - 1].tsMs;
  const span = Math.max(lastTs - firstTs, 1);

  const xScale = (ts: string) => {
    const t = new Date(ts).getTime();
    return padding.left + ((t - firstTs) / span) * (width - padding.left - padding.right);
  };

  const yScale = (kw: number) => {
    const usableHeight = height - padding.top - padding.bottom;
    return padding.top + (1 - kw / yMax) * usableHeight;
  };

  const chartPoints: ChartPoint[] = points.map((p) => ({
    x: xScale(p.ts),
    y: yScale(p.totalKw),
  }));

  const pathD = buildMonotonePath(chartPoints);
  const first = chartPoints[0];
  const last = chartPoints[chartPoints.length - 1];
  const areaD = pathD
    ? `${pathD} L ${last.x.toFixed(2)} ${yScale(0)} L ${first.x.toFixed(2)} ${yScale(0)} Z`
    : '';

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const labelIndices = [0, Math.floor(points.length / 2), points.length - 1];
  const labels = Array.from(new Set(labelIndices)).map((idx) => ({
    x: xScale(points[idx].ts),
    text: formatTime(points[idx].ts),
  }));

  return (
    <div className="card">
      <h2>Feeder History (last 30 min)</h2>
      <p className="subtitle" style={{ marginBottom: '0.5rem' }}>
        Total feeder output compared to the active limit.
      </p>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Feeder history chart"
        className="history-chart"
      >
        <defs>
          <linearGradient id="historyArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-strong)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-accent-strong)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Limit line */}
        <line
          x1={padding.left}
          y1={yScale(data.limitKw)}
          x2={width - padding.right}
          y2={yScale(data.limitKw)}
          stroke="var(--color-warning)"
          strokeDasharray="6 4"
          strokeWidth={2}
        />
        {/* Area under total kW */}
        <path d={areaD} fill="url(#historyArea)" stroke="none" />
        {/* Total kW line */}
        <path
          d={pathD}
          fill="none"
          stroke="var(--color-accent-strong)"
          strokeWidth={3}
          strokeLinecap="round"
        />

        {/* Axes */}
        <line
          x1={padding.left}
          y1={yScale(0)}
          x2={width - padding.right}
          y2={yScale(0)}
          stroke="var(--color-border)"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="var(--color-border)"
        />

        {/* Y-axis labels */}
        {[0, yMax / 2, yMax].map((val) => (
          <g key={val}>
            <text x={padding.left - 8} y={yScale(val) + 4} textAnchor="end" fontSize={12} fill="var(--color-text-muted)">
              {val.toFixed(0)} kW
            </text>
            <line
              x1={padding.left}
              y1={yScale(val)}
              x2={width - padding.right}
              y2={yScale(val)}
              stroke="var(--color-border)"
              strokeDasharray="4 4"
            />
          </g>
        ))}

        {/* X-axis labels */}
        {labels.map((label) => (
          <text
            key={label.text + label.x}
            x={label.x}
            y={height - padding.bottom + 20}
            textAnchor="middle"
            fontSize={12}
            fill="var(--color-text-muted)"
          >
            {label.text}
          </text>
        ))}

        {/* Legend */}
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          <rect x={0} y={0} width={12} height={12} fill="var(--color-accent-strong)" />
          <text x={18} y={11} fontSize={12} fill="var(--color-text-strong)">
            Total kW
          </text>
          <line x1={90} y1={6} x2={110} y2={6} stroke="var(--color-warning)" strokeDasharray="6 4" strokeWidth={2} />
          <text x={116} y={11} fontSize={12} fill="var(--color-text-strong)">
            Limit ({data.limitKw} kW)
          </text>
        </g>
      </svg>
    </div>
  );
};

export default React.memo(FeederHistoryChart);
