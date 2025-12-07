import React, { useEffect, useRef } from 'react';
import { DeviceMetrics, DeviceWithLatest, FeederSummary, HealthResponse } from '../../api/types';
import LineIcon from '../icons/LineIcon';

interface Props {
  summary: FeederSummary | null;
  health: HealthResponse | null;
  devices: DeviceWithLatest[];
  tracking: DeviceMetrics[];
  theme: 'day' | 'night';
}

const HeroStrip: React.FC<Props> = ({ summary, health, devices, tracking, theme }) => {
  const heroRef = useRef<HTMLDivElement | null>(null);

  const headroom = summary ? Math.max(summary.limitKw - summary.totalKw, 0) : 0;
  const utilization = summary && summary.limitKw > 0 ? (summary.totalKw / summary.limitKw) * 100 : 0;
  const offlineCount = health?.controlLoop.offlineCount ?? 0;
  const staleCount = tracking.filter((m) => m.lastActualKw === null).length;
  const avgTracking = tracking.length
    ? tracking.reduce((sum, m) => sum + m.avgAbsError, 0) / tracking.length
    : 0;

  useEffect(() => {
    const element = heroRef.current;
    if (!element) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return;

    const handleMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 10;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 8;
      element.style.setProperty('--parallax-x', `${x}px`);
      element.style.setProperty('--parallax-y', `${y}px`);
    };

    element.addEventListener('pointermove', handleMove);
    return () => element.removeEventListener('pointermove', handleMove);
  }, []);

  return (
    <div className="hero" ref={heroRef}>
      <div className="hero-mesh" aria-hidden />
      <div className="hero-grid">
        <div className="hero-left">
          <div className="hero-title">
            <div>
              <h1>Feeder equilibrium</h1>
              <p className="hero-sub">Balanced scheduling for renewable-first dispatch.</p>
            </div>
            <span className="pill">
              <LineIcon name={theme === 'day' ? 'sun' : 'moon'} size={18} />
              {theme === 'day' ? 'Day profile' : 'Night profile'}
            </span>
          </div>

          <div className="hero-kpis">
            <div className="kpi-card">
              <span className="kpi-label">Feeder load</span>
              <span className="kpi-value">{summary ? summary.totalKw.toFixed(1) : '--'} kW</span>
              <span className="kpi-meta">Limit {summary ? summary.limitKw.toFixed(1) : '--'} kW</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Headroom</span>
              <span className="kpi-value">{headroom.toFixed(1)} kW</span>
              <span className="kpi-meta">Utilization {utilization.toFixed(1)}%</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Device mix</span>
              <span className="kpi-value">{summary?.deviceCount ?? devices.length}</span>
              <span className="kpi-meta">{devices.filter((d) => d.isPhysical || d.isPi).length} physical / {devices.length - devices.filter((d) => d.isPhysical || d.isPi).length} simulated</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Tracking error</span>
              <span className="kpi-value">{avgTracking.toFixed(2)} kW</span>
              <span className="kpi-meta">Across {tracking.length || '0'} DERs</span>
            </div>
          </div>

          <div className="hero-badges">
            <span className={`pill ${offlineCount > 0 ? 'danger' : 'success'}`}>
              <LineIcon name="device" size={16} />
              {offlineCount > 0 ? `${offlineCount} offline` : 'All devices online'}
            </span>
            <span className={`pill ${staleCount > 0 ? 'warning' : 'success'}`}>
              <LineIcon name="cloud" size={16} />
              {staleCount > 0 ? `${staleCount} stale readings` : 'Live telemetry good'}
            </span>
            <span className="pill">
              <LineIcon name="power" size={16} />
              Loop {health?.controlLoop.status ?? 'idle'}
            </span>
          </div>
        </div>

        <div className="card" style={{ alignSelf: 'stretch' }}>
          <h3>System state</h3>
          <p className="subtle">Health snapshots and channel status.</p>
          <div className="badge-row">
            <span className={`badge ${health?.mqtt.connected ? 'success' : 'danger'}`}>
              MQTT {health?.mqtt.connected ? 'connected' : 'disconnected'}
            </span>
            <span className={`badge ${health?.db.ok ? 'success' : 'danger'}`}>DB {health?.db.ok ? 'ok' : 'down'}</span>
            <span className="badge warning">
              <LineIcon name="alert" size={14} />
              SLA {health?.status ?? 'unknown'}
            </span>
          </div>
          <div className="subtle" style={{ marginTop: '0.75rem' }}>
            Mode respects SOC-aware priority with smooth curtailment.
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeroStrip;
