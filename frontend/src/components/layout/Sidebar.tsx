import React from 'react';

interface SidebarProps {
  active: string;
  onChange: (key: string) => void;
}

const nav = [
  { key: 'hero', label: 'Overview' },
  { key: 'generation', label: 'Generation' },
  { key: 'consumption', label: 'Consumption' },
  { key: 'grid', label: 'Grid health' },
  { key: 'forecast', label: 'Forecast' },
  { key: 'devices', label: 'Devices' },
  { key: 'settings', label: 'Settings' },
];

const Sidebar: React.FC<SidebarProps> = ({ active, onChange }) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-panel">
        <div>
          <h1>DERMS Control</h1>
          <p className="subtle">SOC-aware priority scheduling</p>
        </div>
        <div className="nav-links">
          {nav.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nav-button ${active === item.key ? 'active' : ''}`}
              onClick={() => onChange(item.key)}
              aria-label={`Jump to ${item.label}`}
              aria-current={active === item.key ? 'true' : undefined}
              aria-controls={`${item.key}-section`}
            >
              <span aria-hidden className="nav-kicker">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
