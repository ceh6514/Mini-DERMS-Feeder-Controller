import { DeviceWithLatest } from '../api/types';

interface Props {
  devices: DeviceWithLatest[];
}

const formatDate = (ts: string | null | undefined) => {
  if (!ts) return '—';
  const date = new Date(ts);
  return date.toLocaleString();
};

const DeviceTable = ({ devices }: Props) => {
  if (devices.length === 0) {
    return <div className="subtitle">No devices found.</div>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Device ID</th>
          <th>Type</th>
          <th>Site</th>
          <th>p_actual_kw</th>
          <th>p_max_kw</th>
          <th>SOC</th>
          <th>Last updated</th>
        </tr>
      </thead>
      <tbody>
        {devices.map((device) => {
          const latest = device.latestTelemetry;
          return (
            <tr key={device.id}>
              <td>{device.id}</td>
              <td style={{ textTransform: 'capitalize' }}>{device.type}</td>
              <td>{device.siteId}</td>
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
