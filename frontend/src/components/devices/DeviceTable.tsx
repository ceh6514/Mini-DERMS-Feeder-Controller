import React, { useCallback, useMemo } from 'react';
import { DeviceMetrics, DeviceWithLatest } from '../../api/types';

interface Props {
  devices: DeviceWithLatest[];
  metrics: DeviceMetrics[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: 'all' | 'physical' | 'simulated';
  onFilter: (f: 'all' | 'physical' | 'simulated') => void;
}

const DeviceTable: React.FC<Props> = ({ devices, metrics, selectedId, onSelect, filter, onFilter }) => {
  const filteredDevices = useMemo(() => {
    return devices.filter((d) => {
      if (filter === 'physical') return d.isPhysical || d.isPi;
      if (filter === 'simulated') return !(d.isPhysical || d.isPi);
      return true;
    });
  }, [devices, filter]);

  const metricLookup = useMemo(() => new Map(metrics.map((m) => [m.deviceId, m])), [metrics]);

  const spark = useCallback((value: number) => {
    const height = Math.min(100, Math.max(10, Math.abs(value) * 8));
    return <span style={{ height: `${height}%` }} />;
  }, []);

  return (
    <div className="table-wrapper">
      <div className="card" style={{ border: 'none', boxShadow: 'none' }}>
        <div className="filter-chips">
          {(['all', 'physical', 'simulated'] as const).map((key) => (
            <button
              type="button"
              key={key}
              className={`chip ${filter === key ? 'active' : ''}`}
              onClick={() => onFilter(key)}
            >
              {key === 'all' ? 'All devices' : key === 'physical' ? 'Physical' : 'Simulated'}
            </button>
          ))}
        </div>
        <table className="device-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Type</th>
              <th>SOC</th>
              <th>Priority</th>
              <th>Actual vs Setpoint</th>
              <th>Tracking error</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {filteredDevices.map((device) => {
              const metric = metricLookup.get(device.id);
              const telemetry = device.latestTelemetry;
              const soc = telemetry?.soc ?? metric?.soc ?? null;
              const socDisplay = soc !== null ? `${(soc * 100).toFixed(0)}%` : '—';
              const pActual = telemetry?.p_actual_kw ?? metric?.lastActualKw ?? 0;
              const pSetpoint = telemetry?.p_setpoint_kw ?? metric?.lastSetpointKw ?? 0;
              const err = metric?.avgAbsError ?? Math.abs(pActual - pSetpoint);
              const isPhysical = device.isPhysical || device.isPi;

              return (
                <tr
                  key={device.id}
                  className={`device-row ${selectedId === device.id ? 'active' : ''}`}
                  onClick={() => onSelect(device.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <div className="metric-row">
                      <strong>{device.id}</strong>
                      {isPhysical && <span className="badge physical">Physical</span>}
                    </div>
                    <div className="sparkline">{spark(pActual)}{spark(pSetpoint)}</div>
                  </td>
                  <td>{device.type}</td>
                  <td>{socDisplay}</td>
                  <td>{device.priority ?? 1}</td>
                  <td>
                    <div className="metric-row">
                      <span className="value" style={{ fontSize: '1rem' }}>{pActual.toFixed(1)} kW</span>
                      <span className="subtle">/{pSetpoint.toFixed(1)} kW</span>
                    </div>
                  </td>
                  <td>{err.toFixed(2)} kW</td>
                  <td>{isPhysical ? 'Pi agent' : 'Simulated'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default React.memo(DeviceTable);
