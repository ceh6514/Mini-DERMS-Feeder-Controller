import React, { useMemo } from 'react';
import { DeviceMetrics } from '../../api/types';

interface Props {
  metrics: DeviceMetrics[];
}

const TrackingErrorChart: React.FC<Props> = ({ metrics }) => {
  const sorted = useMemo(
    () => [...metrics].sort((a, b) => b.avgAbsError - a.avgAbsError).slice(0, 8),
    [metrics],
  );
  const maxErr = useMemo(() => Math.max(1, ...sorted.map((m) => m.avgAbsError)), [sorted]);

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

const trackingEqual = (prev: Props, next: Props) => {
  if (prev.metrics.length !== next.metrics.length) return false;
  const prevSignature = prev.metrics.map((m) => `${m.deviceId}:${m.avgAbsError}`).join('|');
  const nextSignature = next.metrics.map((m) => `${m.deviceId}:${m.avgAbsError}`).join('|');
  return prevSignature === nextSignature;
};

export default React.memo(TrackingErrorChart, trackingEqual);
