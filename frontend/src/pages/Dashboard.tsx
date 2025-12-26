import { useCallback, useMemo, useState } from 'react';
import LayoutShell from '../components/layout/LayoutShell';
import { useDayNightTheme } from '../hooks/useDayNightTheme';
import { useDeviceSelection } from '../hooks/useDeviceSelection';
import { useLiveMetrics } from '../hooks/useLiveMetrics';
import HeroStrip from '../components/layout/HeroStrip';
import OrganicDivider from '../components/layout/OrganicDivider';
import { useAuth } from '../auth/AuthProvider';
import GenerationSection from '../components/dashboard/GenerationSection';
import ConsumptionSection from '../components/dashboard/ConsumptionSection';
import GridHealthSection from '../components/dashboard/GridHealthSection';
import ForecastSection from '../components/dashboard/ForecastSection';
import DeviceDetailSection from '../components/dashboard/DeviceDetailSection';
import ControlsSection from '../components/dashboard/ControlsSection';
import { useFeederSelection } from '../hooks/useFeederSelection';
import { useDeviceTelemetryLoader } from '../hooks/useDeviceTelemetryLoader';
import { useDashboardSections } from '../hooks/useDashboardSections';

const Dashboard = () => {
  const theme = useDayNightTheme();
  const { feeders, selectedFeederId, setSelectedFeederId, toast, setToast } = useFeederSelection();
  const [reloadToken, setReloadToken] = useState(0);
  const { summary, devices, health, history, tracking, aggregated, loading, error } = useLiveMetrics(
    selectedFeederId ?? undefined,
    4000,
    reloadToken,
  );
  const { selectedId, setSelectedId } = useDeviceSelection(devices, tracking);
  const [filter, setFilter] = useState<'all' | 'physical' | 'simulated'>('all');
  const { user, logout } = useAuth();
  const { sectionRefs, activeSection, handleNav } = useDashboardSections();
  const deviceTelemetry = useDeviceTelemetryLoader(selectedId, setToast);

  const viewDevices = useMemo(() => {
    if (filter === 'physical') return devices.filter((d) => d.isPhysical || d.isPi);
    if (filter === 'simulated') return devices.filter((d) => !(d.isPhysical || d.isPi));
    return devices;
  }, [devices, filter]);

  const handleRetry = useCallback(() => setReloadToken((token) => token + 1), []);
  
  return (
    <LayoutShell
      active={activeSection}
      onNav={handleNav}
      summary={summary}
      health={health}
      theme={theme}
      feeders={feeders}
      selectedFeederId={selectedFeederId}
      onFeederChange={setSelectedFeederId}
      username={user?.username ?? 'unknown'}
      onLogout={logout}
    >
      {error && (
        <div className="toast" role="alert" aria-live="assertive">
          {error}
        </div>
      )}
      <div ref={sectionRefs.hero} data-section="hero" id="hero-section" aria-label="Overview">
        <HeroStrip summary={summary} health={health} devices={devices} tracking={tracking} theme={theme} />
      </div>

      <OrganicDivider />

      <GenerationSection
        sectionRef={sectionRefs.generation}
        selectedId={selectedId}
        telemetry={deviceTelemetry}
        history={history}
        loading={loading}
        error={error}
        onRetry={handleRetry}
      />

      <ConsumptionSection
        sectionRef={sectionRefs.consumption}
        metrics={tracking}
        devices={devices}
        error={error}
        onRetry={handleRetry}
      />

      <GridHealthSection
        sectionRef={sectionRefs.grid}
        devices={viewDevices}
        metrics={tracking}
        selectedId={selectedId}
        filter={filter}
        onFilter={setFilter}
        onSelect={(id) => setSelectedId(id)}
        error={error}
        onRetry={handleRetry}
      />

      <ForecastSection
        sectionRef={sectionRefs.forecast}
        aggregated={aggregated}
        loading={loading}
        error={error}
        onRetry={handleRetry}
      />

      <DeviceDetailSection
        sectionRef={sectionRefs.devices}
        selectedId={selectedId}
        telemetry={deviceTelemetry}
        tracking={tracking}
        error={error}
        onRetry={handleRetry}
      />

      <ControlsSection sectionRef={sectionRefs.settings} onSubmitted={() => handleNav('hero')} />

      {toast && (
        <div className="toast" onAnimationEnd={() => setToast(null)} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </LayoutShell>
  );
};

export default Dashboard;
