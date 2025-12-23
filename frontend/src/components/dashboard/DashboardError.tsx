import React from 'react';
import LineIcon from '../icons/LineIcon';

interface DashboardErrorProps {
  title: string;
  message: string;
  onRetry?: () => void;
}

const DashboardError: React.FC<DashboardErrorProps> = ({ title, message, onRetry }) => {
  return (
    <div className="card" role="alert" aria-live="assertive">
      <div className="section-head" style={{ marginBottom: '0.5rem' }}>
        <h3 style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <LineIcon name="alert" size={18} /> {title}
        </h3>
      </div>
      <p className="subtle" style={{ color: '#b91c1c' }}>
        {message}
      </p>
      {onRetry && (
        <button type="button" className="pill danger" onClick={onRetry} aria-label={`Retry loading ${title}`}>
          Retry
        </button>
      )}
    </div>
  );
};

export default DashboardError;
