import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LayoutShell from '../components/layout/LayoutShell';
import { useDayNightTheme } from '../hooks/useDayNightTheme';
import { useDeviceSelection } from '../hooks/useDeviceSelection';
import { useLiveMetrics } from '../hooks/useLiveMetrics';
import { DeviceTelemetry, FeederInfo } from '../api/types';
import { fetchDeviceTelemetry, fetchFeeders } from '../api/client';
import HeroStrip from '../components/layout/HeroStrip';
import OrganicDivider from '../components/layout/OrganicDivider';
import { useAuth } from '../auth/AuthProvider';
import GenerationSection from '../components/dashboard/GenerationSection';
import ConsumptionSection from '../components/dashboard/ConsumptionSection';
import GridHealthSection from '../components/dashboard/GridHealthSection';
import ForecastSection from '../components/dashboard/ForecastSection';
import DeviceDetailSection from '../components/dashboard/DeviceDetailSection';
import ControlsSection from '../components/dashboard/ControlsSection';

const Dashboard = () => {
  const theme = useDayNightTheme();
  const [feeders, setFeeders] = useState<FeederInfo[]>([]);
  const [selectedFeederId, setSelectedFeederId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const { summary, devices, health, history, tracking, aggregated, loading, error } = useLiveMetrics(
    selectedFeederId ?? undefined,
    4000,
    reloadToken,
  );
  const { selectedId, setSelectedId } = useDeviceSelection(devices, tracking);
  const [deviceTelemetry, setDeviceTelemetry] = useState<DeviceTelemetry[]>([]);
  const [filter, setFilter] = useState<'all' | 'physical' | 'simulated'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('hero');
  const { user, logout } = useAuth();
  const activeSectionRef = useRef(activeSection);

  const heroRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef<HTMLDivElement | null>(null);
  const consumptionRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const forecastRef = useRef<HTMLDivElement | null>(null);
  const devicesRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const sectionRefs = useMemo(
    () => ({
      hero: heroRef,
      generation: generationRef,
      consumption: consumptionRef,
      grid: gridRef,
      forecast: forecastRef,
      devices: devicesRef,
      settings: settingsRef,
    }),
    [],
  );

  useEffect(() => {
    fetchFeeders()
      .then((result) => {
        setFeeders(result);
        setSelectedFeederId((current) => current ?? result[0]?.feederId ?? null);
      })
      .catch((err) => setToast(err instanceof Error ? err.message : 'Failed to load feeders'));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDeviceTelemetry([]);
      return undefined;
    }

    const controller = new AbortController();

    fetchDeviceTelemetry(selectedId, 120, controller.signal)
      .then((data) => setDeviceTelemetry(data))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setToast(err instanceof Error ? err.message : 'Failed to load telemetry');
      });

    return () => controller.abort();
  }, [selectedId]);

  const viewDevices = useMemo(() => {
    if (filter === 'physical') return devices.filter((d) => d.isPhysical || d.isPi);
    if (filter === 'simulated') return devices.filter((d) => !(d.isPhysical || d.isPi));
    return devices;
  }, [devices, filter]);

  const handleNav = useCallback(
    (key: string) => {
      setActiveSection(key);
      const ref = sectionRefs[key as keyof typeof sectionRefs];
      if (ref?.current) {
        ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [sectionRefs],
  );

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  useEffect(() => {
    const sectionOrder = Object.keys(sectionRefs);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => {
            const aIndex = sectionOrder.indexOf((a.target as HTMLElement).dataset.section ?? '');
            const bIndex = sectionOrder.indexOf((b.target as HTMLElement).dataset.section ?? '');
            return aIndex - bIndex;
          });

        const nextSection = visible[0]?.target.getAttribute('data-section');
        if (nextSection && nextSection !== activeSectionRef.current) {
          activeSectionRef.current = nextSection;
          setActiveSection(nextSection);
        }
      },
      {
        threshold: 0.35,
      },
    );

    const elements = Object.values(sectionRefs)
      .map((ref) => ref.current)
      .filter((el): el is HTMLElement => Boolean(el));

    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [sectionRefs]);

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
      <div ref={heroRef} data-section="hero" id="hero-section" aria-label="Overview">
        <HeroStrip summary={summary} health={health} devices={devices} tracking={tracking} theme={theme} />
      </div>

      <OrganicDivider />

      <GenerationSection
        sectionRef={generationRef}
        selectedId={selectedId}
        telemetry={deviceTelemetry}
        history={history}
        loading={loading}
        error={error}
        onRetry={handleRetry}
      />

      <ConsumptionSection
        sectionRef={consumptionRef}
        metrics={tracking}
        devices={devices}
        error={error}
        onRetry={handleRetry}
      />

      <GridHealthSection
        sectionRef={gridRef}
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
        sectionRef={forecastRef}
        aggregated={aggregated}
        loading={loading}
        error={error}
        onRetry={handleRetry}
      />

      <DeviceDetailSection
        sectionRef={devicesRef}
        selectedId={selectedId}
        telemetry={deviceTelemetry}
        tracking={tracking}
        error={error}
        onRetry={handleRetry}
      />

      <ControlsSection sectionRef={settingsRef} onSubmitted={() => handleNav('hero')} />

      {toast && (
        <div className="toast" onAnimationEnd={() => setToast(null)} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </LayoutShell>
  );
};

export default Dashboard;
