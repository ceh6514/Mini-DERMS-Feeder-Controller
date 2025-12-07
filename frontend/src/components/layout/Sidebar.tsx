import React from 'react';

interface SidebarProps {
  active: string;
  onChange: (key: string) => void;
}

const nav = [
  { key: 'overview', label: 'Overview' },
  { key: 'devices', label: 'Devices' },
  { key: 'sites', label: 'Sites' },
  { key: 'metrics', label: 'Metrics' },
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
            >
              <span aria-hidden>•</span> {item.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
