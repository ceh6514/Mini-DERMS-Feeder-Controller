import { useEffect, useState } from 'react';
import { fetchDevices, fetchFeederSummary } from '../api/client';
import { DeviceWithLatest, FeederSummary } from '../api/types';
import DeviceTable from '../components/DeviceTable';
import FeederChart from '../components/FeederChart';
import FeederSummaryCard from '../components/FeederSummary';
import DrEventForm from '../components/DrEventForm';

const POLL_INTERVAL_MS = 8000; // Refresh data roughly every 8 seconds.

const Dashboard = () => {
  const [summary, setSummary] = useState<FeederSummary | null>(null);
  const [devices, setDevices] = useState<DeviceWithLatest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let pollId: number | undefined;

    const loadData = async () => {
      try {
        const [summaryResponse, devicesResponse] = await Promise.all([
          fetchFeederSummary(),
          fetchDevices(),
        ]);

        if (!isMounted) return;

        setSummary(summaryResponse);
        setDevices(devicesResponse);
        setError(null);
      } catch (err) {
        console.error('Error loading dashboard data', err);
        if (isMounted) {
          setError('Unable to load data from the backend.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
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
    <div>
      <header>
        <div>
          <h1>Feeder Dashboard</h1>
          <p className="subtitle">Live view of feeder totals and connected devices.</p>
        </div>
        {summary && (
          <span className="badge">
            {summary.deviceCount} device{summary.deviceCount === 1 ? '' : 's'} online
          </span>
        )}
      </header>

      {loading && <div className="loading">Loading data...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && (
        <>
          <div className="grid" style={{ marginTop: '1rem' }}>
            <FeederSummaryCard summary={summary} />
            <FeederChart summary={summary} />
            <DrEventForm
              onCreated={async () => {
                try {
                  const [summaryResponse, devicesResponse] = await Promise.all([
                    fetchFeederSummary(),
                    fetchDevices(),
                  ]);
                  setSummary(summaryResponse);
                  setDevices(devicesResponse);
                } catch (refreshError) {
                  console.error('Failed to refresh after DR event', refreshError);
                }
              }}
            />
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
