import { useState } from 'react';
import { sendTelemetry } from '../api/client';

interface TelemetryControlPanelProps {
  onSubmitted?: () => void;
}

type MessageType = 'success' | 'error' | null;

const nowIsoLocal = () => {
  const now = new Date();
  const iso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  return iso;
};

const TelemetryControlPanel = ({ onSubmitted }: TelemetryControlPanelProps) => {
  const [deviceId, setDeviceId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [timestamp, setTimestamp] = useState(nowIsoLocal());
  const [pActual, setPActual] = useState('');
  const [pSetpoint, setPSetpoint] = useState('');
  const [soc, setSoc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<MessageType>(null);

  const resetMessage = () => {
    setMessage(null);
    setMessageType(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    resetMessage();

    if (!deviceId.trim()) {
      setMessage('Device ID is required.');
      setMessageType('error');
      return;
    }

    if (!siteId.trim()) {
      setMessage('Site ID is required.');
      setMessageType('error');
      return;
    }

    const parsedTimestamp = new Date(timestamp);
    if (Number.isNaN(parsedTimestamp.getTime())) {
      setMessage('Timestamp must be valid.');
      setMessageType('error');
      return;
    }

    const parsedPActual = Number(pActual);
    if (!Number.isFinite(parsedPActual)) {
      setMessage('p_actual_kw must be a number.');
      setMessageType('error');
      return;
    }

    let parsedPSetpoint: number | undefined;
    if (pSetpoint.trim()) {
      parsedPSetpoint = Number(pSetpoint);
      if (!Number.isFinite(parsedPSetpoint)) {
        setMessage('p_setpoint_kw must be a number when provided.');
        setMessageType('error');
        return;
      }
    }

    let parsedSoc: number | undefined;
    if (soc.trim()) {
      parsedSoc = Number(soc);
      if (!Number.isFinite(parsedSoc)) {
        setMessage('soc must be a number when provided.');
        setMessageType('error');
        return;
      }
    }

    setSubmitting(true);

    try {
      await sendTelemetry({
        deviceId: deviceId.trim(),
        ts: parsedTimestamp.toISOString(),
        pActualKw: parsedPActual,
        pSetpointKw: parsedPSetpoint,
        soc: parsedSoc,
        siteId: siteId.trim(),
      });

      setMessage('Telemetry sent successfully.');
      setMessageType('success');
      onSubmitted?.();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : 'Failed to send telemetry.';
      setMessage(errorText);
      setMessageType('error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card dr-form">
      <h2>Send Telemetry</h2>
      <form onSubmit={handleSubmit} className="dr-form__form">
        <label className="dr-form__label">
          <span>Device ID</span>
          <input
            type="text"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            placeholder="battery-1"
          />
        </label>

        <label className="dr-form__label">
          <span>Site ID</span>
          <input
            type="text"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            placeholder="site-1"
          />
        </label>

        <label className="dr-form__label">
          <span>Timestamp</span>
          <input
            type="datetime-local"
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
          />
        </label>

        <label className="dr-form__label">
          <span>p_actual_kw</span>
          <input
            type="number"
            value={pActual}
            onChange={(e) => setPActual(e.target.value)}
            placeholder="1.5"
            step="0.1"
          />
        </label>

        <label className="dr-form__label">
          <span>p_setpoint_kw</span>
          <input
            type="number"
            value={pSetpoint}
            onChange={(e) => setPSetpoint(e.target.value)}
            placeholder="2"
            step="0.1"
          />
        </label>

        <label className="dr-form__label">
          <span>SOC (%)</span>
          <input
            type="number"
            value={soc}
            onChange={(e) => setSoc(e.target.value)}
            placeholder="50"
            step="1"
          />
        </label>

        <button type="submit" disabled={submitting} className="dr-form__button">
          {submitting ? 'Sending…' : 'Send telemetry'}
        </button>
      </form>

      {message && (
        <div className={`dr-form__message ${messageType === 'success' ? 'success' : 'error'}`}>
          {message}
        </div>
      )}
    </div>
  );
};

export default TelemetryControlPanel;
