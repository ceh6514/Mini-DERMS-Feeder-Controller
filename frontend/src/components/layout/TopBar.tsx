import React from 'react';
import { FeederInfo, FeederSummary, HealthResponse } from '../../api/types';
import LineIcon from '../icons/LineIcon';

interface TopBarProps {
  summary: FeederSummary | null;
  health: HealthResponse | null;
  theme: 'day' | 'night';
  feeders: FeederInfo[];
  selectedFeederId: string | null;
  onFeederChange: (feederId: string) => void;
}

const TopBar: React.FC<TopBarProps> = ({ summary, health, theme, feeders, selectedFeederId, onFeederChange }) => {
  const offlineCount = health?.controlLoop.offlineCount ?? 0;
  const loopStatus = health?.controlLoop.status ?? 'idle';
  const loopBadge = loopStatus === 'ok' ? 'success' : loopStatus === 'idle' ? 'warning' : 'danger';

  const feederOptions = feeders.length
    ? feeders
    : [{ feederId: summary?.feederId ?? 'default-feeder', parentFeederId: null, deviceCount: summary?.deviceCount ?? 0 }];

  return (
    <div className="topbar">
      <div className="title">
        <h2>Mini-DERMS Feeder Controller</h2>
        <div className="badge-row">
          <span className="pill">
            <LineIcon name={theme === 'day' ? 'sun' : 'moon'} size={16} />
            {theme === 'day' ? 'Day profile' : 'Night profile'}
          </span>
          <label className="pill" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <LineIcon name="network" size={16} />
            <span>Feeder</span>
            <select
              value={selectedFeederId ?? feederOptions[0]?.feederId}
              onChange={(e) => onFeederChange(e.target.value)}
              className="pill-select"
            >
              {feederOptions.map((feeder) => (
                <option key={feeder.feederId} value={feeder.feederId}>
                  {feeder.feederId} ({feeder.deviceCount})
                </option>
              ))}
            </select>
          </label>
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
