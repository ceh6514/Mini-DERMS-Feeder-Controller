import React, { useMemo } from 'react';
import { DeviceMetrics, DeviceWithLatest } from '../../api/types';

interface Props {
  devices: DeviceWithLatest[];
  metrics: DeviceMetrics[];
}

const SocDistributionChart: React.FC<Props> = ({ devices, metrics }) => {
  const bars = useMemo(() => {
    const entries = devices
      .filter((d) => d.type === 'ev' || d.type === 'battery' || d.isPi)
      .map((d) => {
        const metric = metrics.find((m) => m.deviceId === d.id);
        const soc = d.latestTelemetry?.soc ?? metric?.soc ?? null;
        return { id: d.id, soc };
      })
      .filter((d) => d.soc !== null) as { id: string; soc: number }[];

    return entries.slice(0, 12);
  }, [devices, metrics]);

  return (
    <div className="card">
      <h3>SOC distribution</h3>
      <p className="subtle">EVs, batteries, and Pi agents</p>
      <div style={{ display: 'grid', gap: '0.35rem' }}>
        {bars.map((d) => (
          <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 50px', gap: '0.35rem', alignItems: 'center' }}>
            <span>{d.id}</span>
            <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, height: 10, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, d.soc * 100))}%`,
                  background: 'linear-gradient(90deg, var(--color-accent), var(--color-positive))',
                  height: '100%',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span className="subtle">{(d.soc * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const socEqual = (prev: Props, next: Props) => {
  if (prev.devices.length !== next.devices.length) return false;
  if (prev.metrics.length !== next.metrics.length) return false;
  return prev.metrics.every(
    (metric, idx) =>
      metric.deviceId === next.metrics[idx]?.deviceId && metric.soc === next.metrics[idx]?.soc,
  );
};

export default React.memo(SocDistributionChart, socEqual);
