import type { FeederHistoryResponse } from '../api/types';

interface FeederHistoryChartProps {
  data: FeederHistoryResponse | null;
  loading: boolean;
  error: string | null;
}

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

  const pathD = data.points
    .map((p, idx) => {
      const x = xScale(p.ts);
      const y = yScale(p.totalKw);
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  const areaD = `${pathD} L ${xScale(data.points[data.points.length - 1].ts).toFixed(2)} ${yScale(0)} L ${xScale(data.points[0].ts).toFixed(2)} ${yScale(0)} Z`;

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
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Feeder history chart">
        {/* Limit line */}
        <line
          x1={padding.left}
          y1={yScale(data.limitKw)}
          x2={width - padding.right}
          y2={yScale(data.limitKw)}
          stroke="#ef4444"
          strokeDasharray="6 4"
          strokeWidth={2}
        />
        {/* Area under total kW */}
        <path d={areaD} fill="#dbeafe" stroke="none" opacity={0.6} />
        {/* Total kW line */}
        <path d={pathD} fill="none" stroke="#2563eb" strokeWidth={3} strokeLinecap="round" />

        {/* Axes */}
        <line
          x1={padding.left}
          y1={yScale(0)}
          x2={width - padding.right}
          y2={yScale(0)}
          stroke="#cbd5e1"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="#cbd5e1"
        />

        {/* Y-axis labels */}
        {[0, yMax / 2, yMax].map((val) => (
          <g key={val}>
            <text x={padding.left - 8} y={yScale(val) + 4} textAnchor="end" fontSize={12} fill="#475569">
              {val.toFixed(0)} kW
            </text>
            <line
              x1={padding.left}
              y1={yScale(val)}
              x2={width - padding.right}
              y2={yScale(val)}
              stroke="#e2e8f0"
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
            fill="#475569"
          >
            {label.text}
          </text>
        ))}

        {/* Legend */}
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          <rect x={0} y={0} width={12} height={12} fill="#2563eb" />
          <text x={18} y={11} fontSize={12} fill="#0f172a">
            Total kW
          </text>
          <line x1={90} y1={6} x2={110} y2={6} stroke="#ef4444" strokeDasharray="6 4" strokeWidth={2} />
          <text x={116} y={11} fontSize={12} fill="#0f172a">
            Limit ({data.limitKw} kW)
          </text>
        </g>
      </svg>
    </div>
  );
};

export default FeederHistoryChart;
