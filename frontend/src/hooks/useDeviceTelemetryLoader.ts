import { useEffect, useState } from 'react';
import { DeviceTelemetry } from '../api/types';
import { fetchDeviceTelemetry } from '../api/client';

export const useDeviceTelemetryLoader = (
  selectedId: string | null,
  onError?: (message: string) => void,
) => {
  const [deviceTelemetry, setDeviceTelemetry] = useState<DeviceTelemetry[]>([]);

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
        const message = err instanceof Error ? err.message : 'Failed to load telemetry';
        onError?.(message);
      });

    return () => controller.abort();
  }, [onError, selectedId]);

  return deviceTelemetry;
};
