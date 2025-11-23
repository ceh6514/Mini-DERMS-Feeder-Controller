import { FeederSummary } from '../api/types';

interface Props {
  summary: FeederSummary | null;
}

const FeederChart = ({ summary }: Props) => {
  const limitKw = summary?.limitKw ?? 0;
  const totalKw = summary?.totalKw ?? 0;

  // Compute percentage while guarding against divide-by-zero.
  const percent = limitKw > 0 ? Math.min((totalKw / limitKw) * 100, 100) : 0;

  return (
    <div className="card">
      <h2>Feeder Load</h2>
      <p className="subtitle" style={{ marginBottom: '0.75rem' }}>
        Showing total feeder output against the configured limit.
      </p>
      <div className="chart-bar" aria-label="Feeder load utilization">
        <div className="chart-bar__fill" style={{ width: `${percent}%` }} />
        <div className="chart-bar__label">
          {totalKw.toFixed(1)} kW / {limitKw} kW ({percent.toFixed(0)}%)
        </div>
      </div>
    </div>
  );
};

export default FeederChart;
