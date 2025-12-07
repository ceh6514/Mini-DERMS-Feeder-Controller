import { useEffect, useMemo, useRef, useState } from 'react';
import LayoutShell from '../components/layout/LayoutShell';
import SummaryCards from '../components/cards/SummaryCards';
import DeviceTable from '../components/devices/DeviceTable';
import SetpointActualChart from '../components/charts/SetpointActualChart';
import TrackingErrorChart from '../components/charts/TrackingErrorChart';
import SocDistributionChart from '../components/charts/SocDistributionChart';
import FeederHistoryChart from '../components/FeederHistoryChart';
import { useDayNightTheme } from '../hooks/useDayNightTheme';
import { useDeviceSelection } from '../hooks/useDeviceSelection';
import { useLiveMetrics } from '../hooks/useLiveMetrics';
import { DeviceTelemetry } from '../api/types';
import { fetchDeviceTelemetry } from '../api/client';
import TelemetryControlPanel from '../components/TelemetryControlPanel';

const Dashboard = () => {
  const theme = useDayNightTheme();
  const { summary, devices, health, history, tracking, aggregated, loading, error } = useLiveMetrics();
  const { selectedId, setSelectedId } = useDeviceSelection(devices, tracking);
  const [deviceTelemetry, setDeviceTelemetry] = useState<DeviceTelemetry[]>([]);
  const [filter, setFilter] = useState<'all' | 'physical' | 'simulated'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('overview');

  const overviewRef = useRef<HTMLDivElement | null>(null);
  const metricsRef = useRef<HTMLDivElement | null>(null);
  const devicesRef = useRef<HTMLDivElement | null>(null);
  const sitesRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const sectionRefs = {
    overview: overviewRef,
    metrics: metricsRef,
    devices: devicesRef,
    sites: sitesRef,
    settings: settingsRef,
  } as const;

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
    <LayoutShell active={activeSection} onNav={handleNav} summary={summary} health={health} theme={theme}>
      {error && <div className="toast">{error}</div>}
      <div ref={overviewRef}>
        <SummaryCards summary={summary} tracking={tracking} devices={devices} />
      </div>

      <div ref={metricsRef} className="section">
        <div className="card">
          <h3>Performance & fairness</h3>
          <p className="subtle">Animated, low-latency view of the control loop.</p>
          <div className="chart-shell">
            <SetpointActualChart deviceId={selectedId} telemetry={deviceTelemetry} />
            <TrackingErrorChart metrics={tracking} />
            <SocDistributionChart devices={devices} metrics={tracking} />
          </div>
        </div>
        <FeederHistoryChart data={history} loading={loading} error={error} />
      </div>

      <div ref={devicesRef} className="section single">
        <div>
          <h2>Devices</h2>
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
      </div>

      <div ref={sitesRef} className="section single">
        <div className="card-grid" style={{ marginTop: '1rem' }}>
          <div className="card">
            <h2>Sites</h2>
            <p className="subtle">Site-level telemetry rollups and history.</p>
            {aggregated ? (
              <p className="subtle">Fairness score {aggregated.feeder.fairnessScore.toFixed(2)}</p>
            ) : (
              <p className="subtle">Loading aggregated site metrics…</p>
            )}
          </div>
        </div>
      </div>

      <div ref={settingsRef} className="section single">
        <TelemetryControlPanel onSubmitted={() => handleNav('overview')} />
      </div>

      {toast && (
        <div className="toast" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      )}
    </LayoutShell>
  );
};

export default Dashboard;
