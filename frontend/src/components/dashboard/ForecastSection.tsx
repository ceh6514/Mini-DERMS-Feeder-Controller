import React from 'react';
import { AggregatedMetricsResponse } from '../../api/types';
import DashboardError from './DashboardError';
import DashboardSection from './DashboardSection';
import EmptyState from '../empty/EmptyState';

interface ForecastSectionProps {
  sectionRef: React.RefObject<HTMLElement>;
  aggregated: AggregatedMetricsResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const ForecastSection: React.FC<ForecastSectionProps> = ({ sectionRef, aggregated, loading, error, onRetry }) => {
  const fairnessScore = aggregated?.feeder.fairnessScore ?? null;

  return (
    <DashboardSection
      sectionId="forecast"
      title="Forecast"
      description="Projected headroom and fairness outlook."
      icon="cloud"
      sectionRef={sectionRef}
    >
      {error && <DashboardError title="Forecast data" message={error} onRetry={onRetry} />}
      <div className="card-grid" role="region" aria-label="Forecast insights">
        <div className="card">
          <h3>Headroom outlook</h3>
          <p className="subtle">Smooth curtailment and SOC-aware planning.</p>
          {loading ? (
            <p className="subtle">Loading forecast…</p>
          ) : fairnessScore !== null ? (
            <div className="metric-row" aria-live="polite">
              <span className="value">{fairnessScore.toFixed(2)}</span>
              <span className="subtle">Fairness score</span>
            </div>
          ) : (
            <EmptyState title="No forecast yet" description="Waiting for aggregated headroom metrics." />
          )}
        </div>
      </div>
    </DashboardSection>
  );
};

export default ForecastSection;
