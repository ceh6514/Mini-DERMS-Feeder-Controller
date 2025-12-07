import React from 'react';
import { DeviceMetrics } from '../../api/types';

interface Props {
  metrics: DeviceMetrics[];
}

const TrackingErrorChart: React.FC<Props> = ({ metrics }) => {
  const sorted = [...metrics].sort((a, b) => b.avgAbsError - a.avgAbsError).slice(0, 8);
  const maxErr = Math.max(1, ...sorted.map((m) => m.avgAbsError));

  return (
    <div className="card">
      <h3>Average tracking error</h3>
      <p className="subtle">Rolling window by device</p>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {sorted.map((metric) => {
          const pct = (metric.avgAbsError / maxErr) * 100;
          return (
            <div key={metric.deviceId} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 60px', gap: '0.35rem', alignItems: 'center' }}>
              <span>{metric.deviceId}</span>
              <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, overflow: 'hidden', height: 10 }}>
                <div
                  style={{
                    width: `${pct}%`,
                    background: metric.isPhysical ? 'var(--color-positive)' : 'var(--color-accent-strong)',
                    height: '100%',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <span className="subtle">{metric.avgAbsError.toFixed(2)} kW</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TrackingErrorChart;
