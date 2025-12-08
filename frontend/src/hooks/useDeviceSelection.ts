import { useEffect, useMemo, useState } from 'react';
import { DeviceMetrics, DeviceWithLatest } from '../api/types';

export function useDeviceSelection(
  devices: DeviceWithLatest[],
  metrics: DeviceMetrics[],
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedId) ?? null,
    [devices, selectedId],
  );

  const selectedMetrics = useMemo(
    () => metrics.find((m) => m.deviceId === selectedId) ?? null,
    [metrics, selectedId],
  );

  useEffect(() => {
    const prioritized = [...devices].sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
    if (selectedId && !devices.find((d) => d.id === selectedId)) {
      setSelectedId(prioritized[0]?.id ?? null);
      return;
    }

    if (!selectedId && prioritized.length > 0) {
      setSelectedId(prioritized[0]?.id ?? null);
    }
  }, [devices, selectedId]);

  return { selectedId, setSelectedId, selectedDevice, selectedMetrics };
}
