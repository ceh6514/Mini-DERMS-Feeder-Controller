import React from 'react';
import Sidebar from './Sidebar';
import AnimatedBackground from './AnimatedBackground';
import TopBar from './TopBar';
import { FeederSummary, HealthResponse } from '../../api/types';

interface Props {
  active: string;
  onNav: (key: string) => void;
  summary: FeederSummary | null;
  health: HealthResponse | null;
  theme: 'day' | 'night';
  children: React.ReactNode;
}

const LayoutShell: React.FC<Props> = ({ active, onNav, summary, health, theme, children }) => {
  return (
    <div className="layout-shell">
      <AnimatedBackground theme={theme} />
      <Sidebar active={active} onChange={onNav} />
      <main className="content">
        <TopBar summary={summary} health={health} theme={theme} />
        {children}
      </main>
    </div>
  );
};

export default LayoutShell;
