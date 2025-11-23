import { FeederSummary } from '../api/types';

interface Props {
  summary: FeederSummary | null;
}

const FeederSummaryCard = ({ summary }: Props) => {
  if (!summary) {
    return (
      <div className="card">
        <h2>Feeder Summary</h2>
        <p className="subtitle">Waiting for feeder data...</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Feeder Summary</h2>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <p className="subtitle">Current Output</p>
          <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>
            {summary.totalKw.toFixed(1)} kW
          </div>
          <p style={{ color: '#475569', margin: 0 }}>Limit: {summary.limitKw} kW</p>
        </div>
        <div>
          <p className="subtitle">Devices</p>
          <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{summary.deviceCount}</div>
          <p style={{ color: '#475569', margin: 0 }}>Connected</p>
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <p className="subtitle" style={{ marginBottom: '0.35rem' }}>
          By device type
        </p>
        {Object.entries(summary.byType).length === 0 ? (
          <p style={{ color: '#475569', margin: 0 }}>No devices reporting yet.</p>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {Object.entries(summary.byType).map(([type, data]) => (
              <span key={type} className="status-pill">
                <strong style={{ textTransform: 'capitalize' }}>{type}</strong>
                <span>{data.count}x</span>
                <span>{data.totalKw.toFixed(1)} kW</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FeederSummaryCard;
