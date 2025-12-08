import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useLiveMetrics(feederId?: string, pollMs = 1500): LiveMetricsState {
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

  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const inflightRef = useRef(false);

  const load = useCallback(async (feederId?: string) => {
    if (inflightRef.current) return;
    inflightRef.current = true;

    abortRef.current = new AbortController();
    setState((prev) => ({ ...prev, loading: true }));

    try {
      const [summary, devices, health, history, tracking, aggregated] = await Promise.all([
        fetchFeederSummary(feederId, abortRef.current.signal),
        fetchDevices(feederId, abortRef.current.signal),
        fetchHealth(abortRef.current.signal),
        fetchFeederHistory(30, feederId, abortRef.current.signal),
        fetchTrackingErrors(undefined, feederId, abortRef.current.signal),
        fetchAggregatedMetrics('day', undefined, feederId, abortRef.current.signal),
      ]);
      if (!mountedRef.current) return;
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
      if (!mountedRef.current || (err instanceof DOMException && err.name === 'AbortError')) return;
      const message = err instanceof Error ? err.message : 'Failed to load live data';
      setState((prev) => ({ ...prev, error: message, loading: false }));
    } finally {
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const tick = async () => {
      if (document.visibilityState === 'visible') {
        await load(feederId);
      }
      timerRef.current = window.setTimeout(tick, pollMs);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load(feederId);
      }
    };

    void load(feederId);
    timerRef.current = window.setTimeout(tick, pollMs);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      abortRef.current?.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [feederId, load, pollMs]);

  return state;
}
