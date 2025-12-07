import { DeviceWithLatest } from '../api/types';

interface Props {
  devices: DeviceWithLatest[];
  offlineDeviceIds?: Set<string>;
}

const formatDate = (ts: string | null | undefined) => {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleString();
};

const DeviceTable = ({ devices, offlineDeviceIds }: Props) => {
  if (devices.length === 0) {
    return <div className="subtitle">No devices found.</div>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Device ID</th>
          <th>Type</th>
          <th>Site</th>
          <th>Priority</th>
          <th>p_actual_kw</th>
          <th>p_max_kw</th>
          <th>SOC</th>
          <th>Last updated</th>
        </tr>
      </thead>
      <tbody>
        {devices.map((device) => {
          const latest = device.latestTelemetry;
          const isOffline = offlineDeviceIds?.has(device.id) ?? false;
          return (
            <tr key={device.id}>
              <td>
                <span className={`status-pill ${isOffline ? 'offline' : 'online'}`}>
                  <span className={`status-dot ${isOffline ? 'offline' : 'online'}`} />
                  {isOffline ? 'Offline' : 'Online'}
                </span>
              </td>
              <td>
                <div className="device-id-cell">
                  <div className="device-id-text">{device.id}</div>
                  <div className="device-tags">
                    {device.isPi && <span className="pill pi-pill">Pi agent</span>}
                    {!device.isPi && device.isSimulated && (
                      <span className="pill muted">Simulated</span>
                    )}
                  </div>
                </div>
              </td>
              <td style={{ textTransform: 'capitalize' }}>{device.type}</td>
              <td>{device.siteId}</td>
              <td>
                {device.type === 'ev'
                  ? device.priority ?? '—'
                  : '—'}
              </td>
              <td>{latest ? latest.p_actual_kw.toFixed(1) : '—'}</td>
              <td>{device.pMaxKw.toFixed(1)}</td>
              <td>{latest?.soc != null ? `${latest.soc}%` : '—'}</td>
              <td>{formatDate(latest?.ts)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export default DeviceTable;
