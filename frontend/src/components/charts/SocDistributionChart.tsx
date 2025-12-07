import React from 'react';
import { DeviceMetrics, DeviceWithLatest } from '../../api/types';

interface Props {
  devices: DeviceWithLatest[];
  metrics: DeviceMetrics[];
}

const SocDistributionChart: React.FC<Props> = ({ devices, metrics }) => {
  const entries = devices
    .filter((d) => d.type === 'ev' || d.type === 'battery' || d.isPi)
    .map((d) => {
      const metric = metrics.find((m) => m.deviceId === d.id);
      const soc = d.latestTelemetry?.soc ?? metric?.soc ?? null;
      return { id: d.id, soc };
    })
    .filter((d) => d.soc !== null) as { id: string; soc: number }[];

  const bars = entries.slice(0, 12);

  return (
    <div className="card">
      <h3>SOC distribution</h3>
      <p className="subtle">EVs, batteries, and Pi agents</p>
      <div style={{ display: 'grid', gap: '0.35rem' }}>
        {bars.map((d) => (
          <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 50px', gap: '0.35rem', alignItems: 'center' }}>
            <span>{d.id}</span>
            <div style={{ background: 'var(--border)', borderRadius: 8, height: 10, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, d.soc * 100))}%`,
                  background: 'linear-gradient(90deg, #22c55e, #3b82f6)',
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

export default SocDistributionChart;
