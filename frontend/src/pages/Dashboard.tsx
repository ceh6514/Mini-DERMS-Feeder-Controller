import { useCallback, useEffect, useState } from 'react';
import {
  fetchDevices,
  fetchFeederHistory,
  fetchFeederSummary,
  fetchSimulationMode,
  resetSimulationMode,
  setSimulationMode,
} from '../api/client';
import {
  DeviceWithLatest,
  FeederHistoryResponse,
  FeederSummary,
  SimulationMode,
} from '../api/types';
import DeviceTable from '../components/DeviceTable';
import FeederChart from '../components/FeederChart';
import FeederSummaryCard from '../components/FeederSummary';
import DrEventForm from '../components/DrEventForm';
import FeederHistoryChart from '../components/FeederHistoryChart';
import TelemetryControlPanel from '../components/TelemetryControlPanel';

const POLL_INTERVAL_MS = 8000; // Refresh data roughly every 8 seconds.

const Dashboard = () => {
  const [summary, setSummary] = useState<FeederSummary | null>(null);
  const [devices, setDevices] = useState<DeviceWithLatest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<FeederHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [simulationMode, setSimulationModeState] = useState<SimulationMode>('day');
  const [modeSource, setModeSource] = useState<'auto' | 'manual'>('auto');
  const [modeMessage, setModeMessage] = useState<string | null>(null);
  const [modeUpdating, setModeUpdating] = useState(false);

  const refreshSummaryAndDevices = useCallback(async () => {
    try {
      const [summaryResponse, devicesResponse] = await Promise.all([
        fetchFeederSummary(),
        fetchDevices(),
      ]);
      setSummary(summaryResponse);
      setDevices(devicesResponse);
    } catch (refreshError) {
      console.error('Failed to refresh devices and summary', refreshError);
    }
  }, []);

  useEffect(() => {
    document.body.dataset.theme = simulationMode;
  }, [simulationMode]);

  useEffect(() => {
    let isMounted = true;
    let pollId: number | undefined;

    const loadData = async () => {
      try {
        setHistoryLoading(true);

        const [summaryResponse, devicesResponse, historyResponse, simModeResponse] = await Promise.all([
          fetchFeederSummary(),
          fetchDevices(),
          fetchFeederHistory(30),
          fetchSimulationMode(),
        ]);

        if (!isMounted) return;

        setSummary(summaryResponse);
        setDevices(devicesResponse);
        setHistory(historyResponse);
        setSimulationModeState(simModeResponse.mode);
        setModeSource(simModeResponse.source);
        setError(null);
        setHistoryError(null);
      } catch (err) {
        console.error('Error loading dashboard data', err);
        if (isMounted) {
          setError('Unable to load data from the backend.');
          const message = err instanceof Error ? err.message : 'Unknown error';
          setHistoryError(message);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          setHistoryLoading(false);
        }
      }
    };

    // Initial fetch when the dashboard mounts.
    loadData();

    // Poll periodically to keep the dashboard live.
    pollId = window.setInterval(loadData, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      if (pollId) {
        window.clearInterval(pollId);
      }
    };
  }, []);

  return (
    <div className="dashboard-shell">
      <div className="sky-layer" aria-hidden="true">
        <div className="orb" />
        <div className="cloud cloud-1" />
        <div className="cloud cloud-2" />
        <div className="stars" />
      </div>
      <div className="glass-panel">
        <header>
          <div>
            <h1>Feeder Dashboard</h1>
            <p className="subtitle">Live view of feeder totals and connected devices.</p>
            <div className="mode-row">
              <span className="pill">
                Profile: <strong>{simulationMode === 'day' ? 'Day' : 'Night'}</strong>
              </span>
              <span className="pill muted">{modeSource === 'manual' ? 'Manual' : 'Following clock'}</span>
            </div>
          </div>
          <div className="mode-actions">
            <button
              className="mode-toggle"
              onClick={async () => {
                setModeUpdating(true);
                try {
                  const next = simulationMode === 'day' ? 'night' : 'day';
                  const updated = await setSimulationMode(next);
                  setSimulationModeState(updated.mode);
                  setModeSource(updated.source);
                  setModeMessage(`Switched to ${updated.mode === 'day' ? 'Day' : 'Night'} profile`);
                } catch (err) {
                  const message = err instanceof Error ? err.message : 'Unable to update mode';
                  setModeMessage(message);
                } finally {
                  setModeUpdating(false);
                }
              }}
              disabled={modeUpdating}
            >
              {modeUpdating
                ? 'Switching...'
                : simulationMode === 'day'
                  ? 'Switch to Night Profile'
                  : 'Switch to Day Profile'}
            </button>
            {modeSource === 'manual' && (
              <button
                className="ghost-button"
                onClick={async () => {
                  setModeUpdating(true);
                  try {
                    const updated = await resetSimulationMode();
                    setSimulationModeState(updated.mode);
                    setModeSource(updated.source);
                    setModeMessage('Simulation following local clock');
                  } catch (err) {
                    const message = err instanceof Error ? err.message : 'Unable to reset mode';
                    setModeMessage(message);
                  } finally {
                    setModeUpdating(false);
                  }
                }}
                disabled={modeUpdating}
              >
                Follow clock
              </button>
            )}
          </div>
          {summary && (
            <span className="badge">
              {summary.deviceCount} device{summary.deviceCount === 1 ? '' : 's'} online
            </span>
          )}
        </header>
      </div>

      {modeMessage && <div className="notice">{modeMessage}</div>}

      {loading && <div className="loading">Loading data...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && (
        <>
          <div className="grid" style={{ marginTop: '1rem' }}>
            <FeederSummaryCard summary={summary} />
            <FeederChart summary={summary} />
            <DrEventForm
              onCreated={async () => {
                await refreshSummaryAndDevices();
              }}
            />
            <TelemetryControlPanel onSubmitted={refreshSummaryAndDevices} />
          </div>
          <div className="grid" style={{ marginTop: '1rem' }}>
            <FeederHistoryChart data={history} loading={historyLoading} error={historyError} />
          </div>
          <div className="table-wrapper card">
            <h2>Devices</h2>
            <DeviceTable devices={devices} />
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
