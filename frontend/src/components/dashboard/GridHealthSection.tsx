import React from 'react';
import { DeviceMetrics, DeviceWithLatest } from '../../api/types';
import DashboardError from './DashboardError';
import DashboardSection from './DashboardSection';
import DeviceTable from '../devices/DeviceTable';
import EmptyState from '../empty/EmptyState';

interface GridHealthSectionProps {
  sectionRef: React.RefObject<HTMLElement>;
  devices: DeviceWithLatest[];
  metrics: DeviceMetrics[];
  selectedId: string | null;
  filter: 'all' | 'physical' | 'simulated';
  onFilter: (f: 'all' | 'physical' | 'simulated') => void;
  onSelect: (id: string) => void;
  error: string | null;
  onRetry: () => void;
}

const GridHealthSection: React.FC<GridHealthSectionProps> = ({
  sectionRef,
  devices,
  metrics,
  selectedId,
  filter,
  onFilter,
  onSelect,
  error,
  onRetry,
}) => {
  const hasDevices = devices.length > 0;

  return (
    <DashboardSection
      sectionId="grid"
      title="Grid health"
      description="Device quality, connectivity, and site fairness overview."
      icon="alert"
      sectionRef={sectionRef}
    >
      {error && <DashboardError title="Grid health data" message={error} onRetry={onRetry} />}
      <div className="card" aria-label="Device telemetry table" role="region">
        <h3>Device telemetry</h3>
        <p className="subtle">Tap a row to animate detail charts. Pi agents are highlighted.</p>
        {hasDevices ? (
          <DeviceTable
            devices={devices}
            metrics={metrics}
            selectedId={selectedId}
            onSelect={onSelect}
            filter={filter}
            onFilter={onFilter}
          />
        ) : (
          <EmptyState title="No devices visible" description="Select a feeder or adjust filters to view devices." />
        )}
      </div>
    </DashboardSection>
  );
};

export default GridHealthSection;
