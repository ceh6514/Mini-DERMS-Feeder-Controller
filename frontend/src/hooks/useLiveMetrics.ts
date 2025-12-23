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

const buildJitteredDelay = (baseMs: number) => {
  const jitter = Math.random() * Math.min(1500, baseMs * 0.35);
  return baseMs + jitter;
};

export function useLiveMetrics(feederId?: string, pollMs = 4000, reloadToken = 0): LiveMetricsState {
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
  const latestSignatureRef = useRef<string>('');

  const load = useCallback(async (feederId?: string) => {
    if (inflightRef.current) return;
    inflightRef.current = true;

    abortRef.current = new AbortController();
    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));

    try {
      const [summary, devices, health, history, tracking, aggregated] = await Promise.all([
        fetchFeederSummary(feederId, abortRef.current.signal),
        fetchDevices(feederId, abortRef.current.signal),
        fetchHealth(abortRef.current.signal),
        fetchFeederHistory(30, feederId, abortRef.current.signal),
        fetchTrackingErrors(undefined, feederId, abortRef.current.signal),
        fetchAggregatedMetrics('day', undefined, feederId, abortRef.current.signal),
      ]);
      const signature = JSON.stringify({ summary, devices, health, history, tracking, aggregated });
      if (!mountedRef.current) return;
      if (signature !== latestSignatureRef.current) {
        latestSignatureRef.current = signature;
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
      } else {
        setState((prev) => ({ ...prev, loading: false, error: null }));
      }
    } catch (err) {
      if (!mountedRef.current || (err instanceof DOMException && err.name === 'AbortError')) return;
      const message = err instanceof Error ? err.message : 'Failed to load live data';
      setState((prev) => ({ ...prev, error: message, loading: false }));
    } finally {
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    latestSignatureRef.current = '';
  }, [feederId, reloadToken]);

  useEffect(() => {
    mountedRef.current = true;

    const tick = async () => {
      const isVisible = document.visibilityState === 'visible';
      if (isVisible) {
        await load(feederId);
      }
      const delay = isVisible ? buildJitteredDelay(pollMs) : buildJitteredDelay(pollMs * 3);
      timerRef.current = window.setTimeout(tick, delay);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load(feederId);
      }
    };

    void load(feederId);
    timerRef.current = window.setTimeout(tick, buildJitteredDelay(pollMs));
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      abortRef.current?.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [feederId, load, pollMs, reloadToken]);

  return state;
}
