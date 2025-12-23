import React from 'react';
import { DeviceTelemetry, FeederHistoryResponse } from '../../api/types';
import DashboardError from './DashboardError';
import DashboardSection from './DashboardSection';
import SetpointActualChart from '../charts/SetpointActualChart';
import FeederHistoryChart from '../FeederHistoryChart';

interface GenerationSectionProps {
  sectionRef: React.RefObject<HTMLElement>;
  selectedId: string | null;
  telemetry: DeviceTelemetry[];
  history: FeederHistoryResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const GenerationSection: React.FC<GenerationSectionProps> = ({
  sectionRef,
  selectedId,
  telemetry,
  history,
  loading,
  error,
  onRetry,
}) => {
  return (
    <DashboardSection
      sectionId="generation"
      title="Generation"
      description="Live feeder output against limits with renewable-first context."
      icon="power"
      sectionRef={sectionRef}
    >
      {error && <DashboardError title="Generation data" message={error} onRetry={onRetry} />}
      <div className="section-grid" role="region" aria-label="Generation insights">
        <SetpointActualChart deviceId={selectedId} telemetry={telemetry} />
        <FeederHistoryChart data={history} loading={loading} error={error} />
      </div>
    </DashboardSection>
  );
};

export default GenerationSection;
