import { useCallback, useEffect, useState } from 'react';
import {
  AggregatedMetricsResponse,
  DeviceMetrics,
  DeviceWithLatest,
  FeederHistoryResponse,
  FeederSummary,
  HealthResponse,
} from '../api/types';
import {
  fetchAggregatedMetrics,
  fetchDevices,
  fetchFeederHistory,
  fetchFeederSummary,
  fetchHealth,
  fetchTrackingErrors,
} from '../api/client';

interface LiveMetricsState {
  summary: FeederSummary | null;
  devices: DeviceWithLatest[];
  health: HealthResponse | null;
  history: FeederHistoryResponse | null;
  tracking: DeviceMetrics[];
  aggregated: AggregatedMetricsResponse | null;
  loading: boolean;
  error: string | null;
}

export function useLiveMetrics(pollMs = 8000): LiveMetricsState {
  const [state, setState] = useState<LiveMetricsState>({
    summary: null,
    devices: [],
    health: null,
    history: null,
    tracking: [],
    aggregated: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    try {
      const [summary, devices, health, history, tracking, aggregated] = await Promise.all([
        fetchFeederSummary(),
        fetchDevices(),
        fetchHealth(),
        fetchFeederHistory(30),
        fetchTrackingErrors(),
        fetchAggregatedMetrics('day'),
      ]);
      setState({
        summary,
        devices,
        health,
        history,
        tracking,
        aggregated,
        loading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load live data';
      setState((prev) => ({ ...prev, error: message, loading: false }));
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return state;
}
