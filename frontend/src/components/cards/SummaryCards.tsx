import React from 'react';
import { DeviceMetrics, DeviceWithLatest, FeederSummary } from '../../api/types';

interface Props {
  summary: FeederSummary | null;
  tracking: DeviceMetrics[];
  devices: DeviceWithLatest[];
}

const SummaryCards: React.FC<Props> = ({ summary, tracking, devices }) => {
  const headroom = summary ? Math.max(summary.limitKw - summary.totalKw, 0) : 0;
  const avgTracking = tracking.length
    ? tracking.reduce((sum, m) => sum + m.avgAbsError, 0) / tracking.length
    : 0;
  const physicalCount = devices.filter((d) => d.isPhysical || d.isPi).length;
  const simulatedCount = devices.length - physicalCount;

  return (
    <div className="card-grid">
      <div className="card">
        <h3>Feeder load</h3>
        <div className="metric-row">
          <span className="value">{summary ? summary.totalKw.toFixed(1) : '--'} kW</span>
          <span className="subtle">of {summary ? summary.limitKw.toFixed(1) : '--'} kW</span>
        </div>
        <p className="subtle">Headroom: <span className="glow">{headroom.toFixed(1)} kW</span></p>
      </div>
      <div className="card">
        <h3>Tracking error</h3>
        <div className="metric-row">
          <span className="value">{avgTracking.toFixed(2)} kW</span>
          <span className="subtle">avg abs error</span>
        </div>
        <p className="subtle">Across {tracking.length || '0'} DERs</p>
      </div>
      <div className="card">
        <h3>Device origin</h3>
        <div className="metric-row">
          <span className="value">{physicalCount}</span>
          <span className="subtle">Physical Pi agents</span>
        </div>
        <p className="subtle">{simulatedCount} simulated peers</p>
      </div>
      <div className="card">
        <h3>Fairness & priority</h3>
        <p className="value">SOC-aware scheduler</p>
        <p className="subtle">Lower SOC + higher priority get headroom first.</p>
      </div>
    </div>
  );
};

export default SummaryCards;
