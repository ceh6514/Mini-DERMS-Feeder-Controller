import React from 'react';
import Sidebar from './Sidebar';
import AnimatedBackground from './AnimatedBackground';
import TopBar from './TopBar';
import { FeederInfo, FeederSummary, HealthResponse } from '../../api/types';

interface Props {
  active: string;
  onNav: (key: string) => void;
  summary: FeederSummary | null;
  health: HealthResponse | null;
  theme: 'day' | 'night';
  feeders: FeederInfo[];
  selectedFeederId: string | null;
  onFeederChange: (feederId: string) => void;
  username: string;
  onLogout: () => void;
  children: React.ReactNode;
}

const LayoutShell: React.FC<Props> = ({
  active,
  onNav,
  summary,
  health,
  theme,
  feeders,
  selectedFeederId,
  onFeederChange,
  username,
  onLogout,
  children,
}) => {
  return (
    <div className="layout-shell">
      <AnimatedBackground theme={theme} />
      <Sidebar active={active} onChange={onNav} />
      <main className="content">
        <TopBar
          summary={summary}
          health={health}
          theme={theme}
          feeders={feeders}
          selectedFeederId={selectedFeederId}
          onFeederChange={onFeederChange}
          username={username}
          onLogout={onLogout}
        />
        {children}
      </main>
    </div>
  );
};

export default LayoutShell;
