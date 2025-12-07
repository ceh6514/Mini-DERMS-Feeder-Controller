import { useEffect, useMemo, useState } from 'react';
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

const Dashboard = () => {
  const theme = useDayNightTheme();
  const { summary, devices, health, history, tracking, aggregated, loading, error } = useLiveMetrics();
  const { selectedId, setSelectedId } = useDeviceSelection(devices, tracking);
  const [deviceTelemetry, setDeviceTelemetry] = useState<DeviceTelemetry[]>([]);
  const [filter, setFilter] = useState<'all' | 'physical' | 'simulated'>('all');
  const [toast, setToast] = useState<string | null>(null);

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

  return (
    <LayoutShell active="overview" onNav={() => {}} summary={summary} health={health} theme={theme}>
      {error && <div className="toast">{error}</div>}
      <SummaryCards summary={summary} tracking={tracking} devices={devices} />

      <div className="section">
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

      <div className="section single">
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

      {aggregated && (
        <div className="card-grid" style={{ marginTop: '1rem' }}>
          <div className="card">
            <h3>Headroom trend</h3>
            <p className="subtle">Fairness score {aggregated.feeder.fairnessScore.toFixed(2)}</p>
          </div>
          <div className="card">
            <h3>DR elasticity</h3>
            <p className="subtle">Priority-weighted utilization captured per tick.</p>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      )}
    </LayoutShell>
  );
};

export default Dashboard;
