import React from 'react';
import { DeviceMetrics, DeviceWithLatest } from '../../api/types';
import DashboardError from './DashboardError';
import DashboardSection from './DashboardSection';
import TrackingErrorChart from '../charts/TrackingErrorChart';
import SocDistributionChart from '../charts/SocDistributionChart';
import EmptyState from '../empty/EmptyState';

interface ConsumptionSectionProps {
  sectionRef: React.RefObject<HTMLElement>;
  metrics: DeviceMetrics[];
  devices: DeviceWithLatest[];
  error: string | null;
  onRetry: () => void;
}

const ConsumptionSection: React.FC<ConsumptionSectionProps> = ({ sectionRef, metrics, devices, error, onRetry }) => {
  const hasMetrics = metrics.length > 0;
  const hasDevices = devices.length > 0;

  return (
    <DashboardSection
      sectionId="consumption"
      title="Consumption"
      description="How dispatch tracks demand and balances priority."
      icon="leaf"
      sectionRef={sectionRef}
    >
      {error && <DashboardError title="Consumption metrics" message={error} onRetry={onRetry} />}
      <div className="section-grid" role="region" aria-label="Consumption analytics">
        {hasMetrics ? <TrackingErrorChart metrics={metrics} /> : <EmptyState title="No tracking data" description="Tracking metrics will appear once devices report telemetry." />}
        {hasDevices ? (
          <SocDistributionChart devices={devices} metrics={metrics} />
        ) : (
          <EmptyState title="No devices" description="Add devices or check feeder selection to view SOC distribution." />
        )}
      </div>
    </DashboardSection>
  );
};

export default ConsumptionSection;
