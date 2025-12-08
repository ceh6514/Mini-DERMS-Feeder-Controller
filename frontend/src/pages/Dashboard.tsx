import { useEffect, useMemo, useRef, useState } from 'react';
import LayoutShell from '../components/layout/LayoutShell';
import DeviceTable from '../components/devices/DeviceTable';
import SetpointActualChart from '../components/charts/SetpointActualChart';
import TrackingErrorChart from '../components/charts/TrackingErrorChart';
import SocDistributionChart from '../components/charts/SocDistributionChart';
import FeederHistoryChart from '../components/FeederHistoryChart';
import { useDayNightTheme } from '../hooks/useDayNightTheme';
import { useDeviceSelection } from '../hooks/useDeviceSelection';
import { useLiveMetrics } from '../hooks/useLiveMetrics';
import { DeviceTelemetry, FeederInfo } from '../api/types';
import { fetchDeviceTelemetry, fetchFeeders } from '../api/client';
import TelemetryControlPanel from '../components/TelemetryControlPanel';
import HeroStrip from '../components/layout/HeroStrip';
import OrganicDivider from '../components/layout/OrganicDivider';
import EmptyState from '../components/empty/EmptyState';
import LineIcon from '../components/icons/LineIcon';
import { useAuth } from '../auth/AuthProvider';

const Dashboard = () => {
  const theme = useDayNightTheme();
  const [feeders, setFeeders] = useState<FeederInfo[]>([]);
  const [selectedFeederId, setSelectedFeederId] = useState<string | null>(null);
  const { summary, devices, health, history, tracking, aggregated, loading, error } = useLiveMetrics(selectedFeederId ?? undefined);
  const { selectedId, setSelectedId } = useDeviceSelection(devices, tracking);
  const [deviceTelemetry, setDeviceTelemetry] = useState<DeviceTelemetry[]>([]);
  const [filter, setFilter] = useState<'all' | 'physical' | 'simulated'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('hero');
  const { user, logout } = useAuth();

  const heroRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef<HTMLDivElement | null>(null);
  const consumptionRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const forecastRef = useRef<HTMLDivElement | null>(null);
  const devicesRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const sectionRefs = {
    hero: heroRef,
    generation: generationRef,
    consumption: consumptionRef,
    grid: gridRef,
    forecast: forecastRef,
    devices: devicesRef,
    settings: settingsRef,
  } as const;

  useEffect(() => {
    fetchFeeders()
      .then((result) => {
        setFeeders(result);
        setSelectedFeederId((current) => current ?? result[0]?.feederId ?? null);
      })
      .catch((err) => setToast(err instanceof Error ? err.message : 'Failed to load feeders'));
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchDeviceTelemetry(selectedId, 120)
        .then(setDeviceTelemetry)
        .catch((err) => setToast(err instanceof Error ? err.message : 'Failed to load telemetry'));
    }
  }, [selectedId]);

  const viewDevices = useMemo(() => {
    if (filter === 'physical') return devices.filter((d) => d.isPhysical || d.isPi);
    if (filter === 'simulated') return devices.filter((d) => !(d.isPhysical || d.isPi));
    return devices;
  }, [devices, filter]);

  const handleNav = (key: string) => {
    setActiveSection(key);
    const ref = sectionRefs[key as keyof typeof sectionRefs];
    if (ref?.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

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
      {error && <div className="toast">{error}</div>}
      <div ref={heroRef}>
        <HeroStrip summary={summary} health={health} devices={devices} tracking={tracking} theme={theme} />
      </div>

      <OrganicDivider />

      <section ref={generationRef} className="section-block">
        <div className="section-head">
          <h2>
            <LineIcon name="power" size={20} /> Generation
          </h2>
          <p>Live feeder output against limits with renewable-first context.</p>
        </div>
        <div className="section-grid">
          <SetpointActualChart deviceId={selectedId} telemetry={deviceTelemetry} />
          <FeederHistoryChart data={history} loading={loading} error={error} />
        </div>
      </section>

      <section ref={consumptionRef} className="section-block">
        <div className="section-head">
          <h2>
            <LineIcon name="leaf" size={20} /> Consumption
          </h2>
          <p>How dispatch tracks demand and balances priority.</p>
        </div>
        <div className="section-grid">
          <TrackingErrorChart metrics={tracking} />
          <SocDistributionChart devices={devices} metrics={tracking} />
        </div>
      </section>

      <section ref={gridRef} className="section-block">
        <div className="section-head">
          <h2>
            <LineIcon name="alert" size={20} /> Grid health
          </h2>
          <p>Device quality, connectivity, and site fairness overview.</p>
        </div>
        <div className="card">
          <h3>Device telemetry</h3>
          <p className="subtle">Tap a row to animate detail charts. Pi agents are highlighted.</p>
          <DeviceTable
            devices={viewDevices}
            metrics={tracking}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            filter={filter}
            onFilter={setFilter}
          />
        </div>
      </section>

      <section ref={forecastRef} className="section-block">
        <div className="section-head">
          <h2>
            <LineIcon name="cloud" size={20} /> Forecast
          </h2>
          <p>Projected headroom and fairness outlook.</p>
        </div>
        <div className="card-grid">
          <div className="card">
            <h3>Headroom outlook</h3>
            <p className="subtle">Smooth curtailment and SOC-aware planning.</p>
            {aggregated ? (
              <div className="metric-row">
                <span className="value">{aggregated.feeder.fairnessScore.toFixed(2)}</span>
                <span className="subtle">Fairness score</span>
              </div>
            ) : (
              <EmptyState title="No forecast yet" description="Waiting for aggregated headroom metrics." />
            )}
          </div>
        </div>
      </section>

      <section ref={devicesRef} className="section-block">
        <div className="section-head">
          <h2>
            <LineIcon name="device" size={20} /> Devices
          </h2>
          <p>Selection-aware controls for individual DERs.</p>
        </div>
        <div className="card-grid">
          <SetpointActualChart deviceId={selectedId} telemetry={deviceTelemetry} />
          <TrackingErrorChart metrics={tracking} />
        </div>
      </section>

      <section ref={settingsRef} className="section-block">
        <div className="section-head">
          <h2>
            <LineIcon name="spark" size={20} /> Controls
          </h2>
          <p>Adjust feeder constraints with a single submission.</p>
        </div>
        <TelemetryControlPanel onSubmitted={() => handleNav('hero')} />
      </section>

      {toast && (
        <div className="toast" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      )}
    </LayoutShell>
  );
};

export default Dashboard;
