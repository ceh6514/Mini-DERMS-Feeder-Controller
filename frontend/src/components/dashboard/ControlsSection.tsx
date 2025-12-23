import React from 'react';
import DashboardSection from './DashboardSection';
import TelemetryControlPanel from '../TelemetryControlPanel';

interface ControlsSectionProps {
  sectionRef: React.RefObject<HTMLElement>;
  onSubmitted: () => void;
}

const ControlsSection: React.FC<ControlsSectionProps> = ({ sectionRef, onSubmitted }) => {
  return (
    <DashboardSection
      sectionId="settings"
      title="Controls"
      description="Adjust feeder constraints with a single submission."
      icon="spark"
      sectionRef={sectionRef}
    >
      <TelemetryControlPanel onSubmitted={onSubmitted} />
    </DashboardSection>
  );
};

export default ControlsSection;
