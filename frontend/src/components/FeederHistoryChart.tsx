import type { FeederHistoryResponse } from '../api/types';

interface FeederHistoryChartProps {
  data: FeederHistoryResponse | null;
  loading: boolean;
  error: string | null;
}

type ChartPoint = { x: number; y: number };

const controlPoint = (
  current: ChartPoint,
  previous: ChartPoint,
  next: ChartPoint,
  reverse = false
) => {
  const smoothing = 0.2;
  const p = previous ?? current;
  const n = next ?? current;
  const o = {
    length: Math.hypot(n.x - p.x, n.y - p.y),
    angle: Math.atan2(n.y - p.y, n.x - p.x),
  };

  const angle = o.angle + (reverse ? Math.PI : 0);
  const length = o.length * smoothing;

  return {
    x: current.x + Math.cos(angle) * length,
    y: current.y + Math.sin(angle) * length,
  };
};

const bezierCommand = (point: ChartPoint, i: number, a: ChartPoint[]) => {
  const cps = controlPoint(a[i - 1] ?? point, a[i - 2] ?? point, point);
  const cpe = controlPoint(point, a[i - 1] ?? point, a[i + 1] ?? point, true);
  return `C ${cps.x.toFixed(2)} ${cps.y.toFixed(2)} ${cpe.x.toFixed(2)} ${cpe.y.toFixed(2)} ${
    point.x
  } ${point.y}`;
};

const buildSmoothPath = (points: ChartPoint[]) => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const commands = points.map((point, idx, arr) =>
    idx === 0 ? `M ${point.x} ${point.y}` : bezierCommand(point, idx, arr)
  );

  return commands.join(' ');
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

  const values = data.points.map((p) => p.totalKw);
  const yMax = Math.max(data.limitKw, ...values, 1);

  const firstTs = new Date(data.points[0].ts).getTime();
  const lastTs = new Date(data.points[data.points.length - 1].ts).getTime();
  const span = Math.max(lastTs - firstTs, 1);

  const xScale = (ts: string) => {
    const t = new Date(ts).getTime();
    return padding.left + ((t - firstTs) / span) * (width - padding.left - padding.right);
  };

  const yScale = (kw: number) => {
    const usableHeight = height - padding.top - padding.bottom;
    return padding.top + (1 - kw / yMax) * usableHeight;
  };

  const chartPoints: ChartPoint[] = data.points.map((p) => ({
    x: xScale(p.ts),
    y: yScale(p.totalKw),
  }));

  const pathD = buildSmoothPath(chartPoints);

  const first = chartPoints[0];
  const last = chartPoints[chartPoints.length - 1];
  const areaD = `${pathD} L ${last.x.toFixed(2)} ${yScale(0)} L ${first.x.toFixed(2)} ${yScale(0)} Z`;

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const labelIndices = [0, Math.floor(data.points.length / 2), data.points.length - 1];
  const labels = Array.from(new Set(labelIndices)).map((idx) => ({
    x: xScale(data.points[idx].ts),
    text: formatTime(data.points[idx].ts),
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
            <stop offset="0%" stopColor="var(--accent-strong)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent-strong)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Limit line */}
        <line
          x1={padding.left}
          y1={yScale(data.limitKw)}
          x2={width - padding.right}
          y2={yScale(data.limitKw)}
          stroke="var(--alert-strong)"
          strokeDasharray="6 4"
          strokeWidth={2}
        />
        {/* Area under total kW */}
        <path d={areaD} fill="url(#historyArea)" stroke="none" />
        {/* Total kW line */}
        <path
          d={pathD}
          fill="none"
          stroke="var(--accent-strong)"
          strokeWidth={3}
          strokeLinecap="round"
        />

        {/* Axes */}
        <line
          x1={padding.left}
          y1={yScale(0)}
          x2={width - padding.right}
          y2={yScale(0)}
          stroke="var(--border-subtle)"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="var(--border-subtle)"
        />

        {/* Y-axis labels */}
        {[0, yMax / 2, yMax].map((val) => (
          <g key={val}>
            <text x={padding.left - 8} y={yScale(val) + 4} textAnchor="end" fontSize={12} fill="var(--text-muted)">
              {val.toFixed(0)} kW
            </text>
            <line
              x1={padding.left}
              y1={yScale(val)}
              x2={width - padding.right}
              y2={yScale(val)}
              stroke="var(--border-muted)"
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
            fill="var(--text-muted)"
          >
            {label.text}
          </text>
        ))}

        {/* Legend */}
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          <rect x={0} y={0} width={12} height={12} fill="var(--accent-strong)" />
          <text x={18} y={11} fontSize={12} fill="var(--text-strong)">
            Total kW
          </text>
          <line x1={90} y1={6} x2={110} y2={6} stroke="var(--alert-strong)" strokeDasharray="6 4" strokeWidth={2} />
          <text x={116} y={11} fontSize={12} fill="var(--text-strong)">
            Limit ({data.limitKw} kW)
          </text>
        </g>
      </svg>
    </div>
  );
};

export default FeederHistoryChart;
