import React from 'react';
import { FeederSummary, HealthResponse } from '../../api/types';
import LineIcon from '../icons/LineIcon';

interface TopBarProps {
  summary: FeederSummary | null;
  health: HealthResponse | null;
  theme: 'day' | 'night';
}

const TopBar: React.FC<TopBarProps> = ({ summary, health, theme }) => {
  const offlineCount = health?.controlLoop.offlineCount ?? 0;
  const loopStatus = health?.controlLoop.status ?? 'idle';
  const loopBadge = loopStatus === 'ok' ? 'success' : loopStatus === 'idle' ? 'warning' : 'danger';

  return (
    <div className="topbar">
      <div className="title">
        <h2>Mini-DERMS Feeder Controller</h2>
        <div className="badge-row">
          <span className="pill">
            <LineIcon name={theme === 'day' ? 'sun' : 'moon'} size={16} />
            {theme === 'day' ? 'Day profile' : 'Night profile'}
          </span>
          {summary && (
            <span className="pill">
              {summary.deviceCount} devices • Limit {summary.limitKw.toFixed(1)} kW
            </span>
          )}
          <span className={`pill ${offlineCount > 0 ? 'danger' : 'muted'}`}>
            {offlineCount > 0 ? `${offlineCount} offline` : 'All devices online'}
          </span>
          <span className={`pill ${loopBadge}`}>
            Loop {loopStatus === 'ok' ? 'healthy' : loopStatus}
          </span>
        </div>
      </div>
      <div className="badge-row">
        <span className="badge">
          MQTT {health?.mqtt.connected ? 'connected' : 'disconnected'} • DB {health?.db.ok ? 'ok' : 'down'}
        </span>
        <span className="badge warning">Control horizon SOC-aware</span>
      </div>
    </div>
  );
};

export default TopBar;
