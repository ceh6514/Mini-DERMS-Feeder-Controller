import React from 'react';
import { DeviceMetrics, DeviceTelemetry } from '../../api/types';
import DashboardError from './DashboardError';
import DashboardSection from './DashboardSection';
import SetpointActualChart from '../charts/SetpointActualChart';
import TrackingErrorChart from '../charts/TrackingErrorChart';
import EmptyState from '../empty/EmptyState';

interface DeviceDetailSectionProps {
  sectionRef: React.RefObject<HTMLElement>;
  selectedId: string | null;
  telemetry: DeviceTelemetry[];
  tracking: DeviceMetrics[];
  error: string | null;
  onRetry: () => void;
}

const DeviceDetailSection: React.FC<DeviceDetailSectionProps> = ({
  sectionRef,
  selectedId,
  telemetry,
  tracking,
  error,
  onRetry,
}) => {
  const hasTracking = tracking.length > 0;

  return (
    <DashboardSection
      sectionId="devices"
      title="Devices"
      description="Selection-aware controls for individual DERs."
      icon="device"
      sectionRef={sectionRef}
    >
      {error && <DashboardError title="Device metrics" message={error} onRetry={onRetry} />}
      <div className="card-grid" role="region" aria-label="Device detail charts">
        <SetpointActualChart deviceId={selectedId} telemetry={telemetry} />
        {hasTracking ? (
          <TrackingErrorChart metrics={tracking} />
        ) : (
          <EmptyState title="No tracking data" description="Tracking metrics will appear when devices report telemetry." />
        )}
      </div>
    </DashboardSection>
  );
};

export default DeviceDetailSection;
